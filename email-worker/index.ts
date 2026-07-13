// Email Worker — 處理兩件事：
//   1. 定時發送排程郵件（cron trigger 每 60 秒觸發一次）
//   2. 接收郵件（Cloudflare Email Routing 轉發至此 Worker）
//
// 部署：npx wrangler deploy --config email-worker/wrangler.toml
//
// 發送：使用 Resend API（免費 100 封/天）
//   - 在 resend.com 註冊取得 API Key
//   - 設定環境變數 RESEND_API_KEY

interface Env {
  DB: D1Database;
  SENDER_EMAIL: string;
  SENDER_NAME: string;
  RESEND_API_KEY?: string;
}

async function sendAndUpdate(env: Env, log: any) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[email-worker] RESEND_API_KEY not set");
    await env.DB.prepare(
      `UPDATE email_logs SET status = 'failed', error = 'RESEND_API_KEY not configured', updated_at = datetime('now') WHERE id = ?`
    ).bind(log.id).run();
    return;
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.SENDER_NAME
          ? `${env.SENDER_NAME} <onboarding@resend.dev>`
          : "Muse Labs <onboarding@resend.dev>",
        to: [log.to_email],
        ...(log.cc_email ? { cc: [log.cc_email] } : {}),
        subject: log.subject,
        html: (log.body || "").replace(/\n/g, "<br>"),
      }),
    });

    const respBody = await resp.text().catch(() => "");
    const sent = resp.ok;

    if (sent) {
      await env.DB.prepare(
        `UPDATE email_logs SET status = 'sent', sent_at = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(new Date().toISOString(), log.id).run();
      console.log(`[email-worker] Sent: ${log.id} -> ${log.to_email}`);
    } else {
      const err = `Resend HTTP ${resp.status}: ${respBody}`.slice(0, 500);
      await env.DB.prepare(
        `UPDATE email_logs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(err, log.id).run();
      console.error(`[email-worker] Failed: ${log.id} - ${err}`);
    }
  } catch (e: any) {
    const err = (e.message || "Unknown").slice(0, 500);
    await env.DB.prepare(
      `UPDATE email_logs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(err, log.id).run();
    console.error(`[email-worker] Error: ${log.id} - ${err}`);
  }
}

export default {
  // --- 排程處理：每分鐘檢查是否有待發送的郵件 ---
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const now = new Date().toISOString();

    const { results } = await env.DB.prepare(
      `SELECT * FROM email_logs
       WHERE status = 'scheduled'
         AND scheduled_at IS NOT NULL
         AND scheduled_at <= ?
       ORDER BY scheduled_at ASC
       LIMIT 20`
    ).bind(now).all();

    if (!results || results.length === 0) return;

    console.log(`[email-worker] Processing ${results.length} scheduled email(s)`);

    for (const row of results as any[]) {
      await sendAndUpdate(env, row);
    }
  },

  // --- 接收郵件：Email Routing 轉發到此 ---
  async email(
    message: any,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const logId = crypto.randomUUID();
    const now = new Date().toISOString();

    const from = message.from;
    const to = message.to;
    const subject = (message.headers?.get?.("subject") as string) || "(無主旨)";

    let bodyText = "";
    try {
      const rawEmail = await new Response(message.raw).text();
      bodyText = rawEmail.substring(0, 10000);
    } catch (e) {
      bodyText = `[郵件解析錯誤: ${String(e)}]`;
    }

    await env.DB.prepare(
      `INSERT INTO email_logs (id, to_email, subject, body, status, sent_at, email_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'incoming', ?, 'incoming', ?, ?)`
    ).bind(logId, `${from} -> ${to}`, subject, bodyText, now, now, now).run();

    console.log(`[email-worker] Received: ${from} -> ${to} | ${subject}`);
  },

  // --- HTTP handler ---
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK - Email Worker", { status: 200 });
    }

    // 手動觸發排程處理
    if (url.pathname === "/trigger-scheduled" && request.method === "POST") {
      const now = new Date().toISOString();
      const { results } = await env.DB.prepare(
        `SELECT * FROM email_logs
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
         ORDER BY scheduled_at ASC LIMIT 20`
      ).bind(now).all();

      if (!results || results.length === 0) {
        return new Response(JSON.stringify({ processed: 0, message: "No pending emails" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      for (const row of results as any[]) {
        await sendAndUpdate(env, row);
      }
      return new Response(JSON.stringify({ processed: results.length }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 立即發送郵件（經 Resend API）
    if (url.pathname === "/send" && request.method === "POST") {
      const apiKey = env.RESEND_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ success: false, error: "RESEND_API_KEY not configured" }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }
      try {
        const data = await request.json() as any;
        const { to, cc, subject, body } = data;
        if (!to || !subject) {
          return new Response(JSON.stringify({ success: false, error: "to and subject required" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }
        const senderName = env.SENDER_NAME || "Muse Labs";
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${senderName} <onboarding@resend.dev>`,
            to: [to],
            ...(cc ? { cc: [cc] } : {}),
            subject,
            html: (body || "").replace(/\n/g, "<br>"),
          }),
        });
        const respBody = await resp.text().catch(() => "");
        const sent = resp.ok;
        return new Response(JSON.stringify({
          success: sent,
          ...(sent ? {} : { error: `Resend HTTP ${resp.status}: ${respBody}`.slice(0, 500) }),
        }), {
          status: sent ? 200 : 502,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: (e.message || "Unknown").slice(0, 500) }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }
    }

    // 查看待發送的排程郵件
    if (url.pathname === "/pending") {
      const { results } = await env.DB.prepare(
        "SELECT id, to_email, subject, scheduled_at, status FROM email_logs WHERE status = 'scheduled' ORDER BY scheduled_at ASC"
      ).all();
      return new Response(JSON.stringify(results || []), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Email Worker - /health /send /pending /trigger-scheduled", { status: 200 });
  },
};
