// Email Worker — 處理兩件事：
//   1. 定時發送排程郵件（cron trigger 每 60 秒觸發一次）
//   2. 接收郵件（Cloudflare Email Routing 轉發至此 Worker）
//
// 部署：npx wrangler deploy --config email-worker/wrangler.toml
//
// 收件設定（一次性）：
//   1. 在 Cloudflare Dashboard → 你的域名 → Email Routing
//   2. 啟用 Email Routing，設定 MX 記錄
//   3. 建立 Catch-All 規則 → 傳送至 Worker → secretary-email-worker
//   4. 所有 @你的域名 的郵件都會轉發到此 Worker 處理

interface Env {
  DB: D1Database;
  SENDER_EMAIL: string;
  SENDER_NAME: string;
}

async function sendAndUpdate(env: Env, log: any) {
  const senderEmail = env.SENDER_EMAIL || "noreply@secretary-email-worker.czijun59.workers.dev";
  const senderName = env.SENDER_NAME || "Muse Labs 公司秘書";

  try {
    const mcResp = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: log.to_email }],
          ...(log.cc_email ? { cc: [{ email: log.cc_email }] } : {}),
        }],
        from: { email: senderEmail, name: senderName },
        subject: log.subject,
        content: [{ type: "text/html", value: (log.body || "").replace(/\n/g, "<br>") }],
      }),
    });

    const mcBody = await mcResp.text().catch(() => "");
    const sent = mcResp.ok || mcResp.status === 202;

    if (sent) {
      await env.DB.prepare(
        `UPDATE email_logs SET status = 'sent', sent_at = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(new Date().toISOString(), log.id).run();
      console.log(`[email-worker] Sent: ${log.id} → ${log.to_email}`);
    } else {
      const err = `MailChannels HTTP ${mcResp.status}: ${mcBody}`.slice(0, 500);
      await env.DB.prepare(
        `UPDATE email_logs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(err, log.id).run();
      console.error(`[email-worker] Failed: ${log.id} — ${err}`);
    }
  } catch (e: any) {
    const err = (e.message || "Unknown").slice(0, 500);
    await env.DB.prepare(
      `UPDATE email_logs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(err, log.id).run();
    console.error(`[email-worker] Error: ${log.id} — ${err}`);
  }
}

export default {
  // ─── 排程處理：每分鐘檢查是否有待發送的郵件 ───
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

  // ─── 接收郵件：Email Routing 轉發到此 ───
  async email(
    message: any, // ForwardableEmailMessage
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
    ).bind(logId, `${from} → ${to}`, subject, bodyText, now, now, now).run();

    console.log(`[email-worker] Received: ${from} → ${to} | ${subject}`);
  },

  // ─── HTTP handler ───
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK — Email Worker", { status: 200 });
    }

    // 手動觸發排程處理（開發/除錯用）
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

    // 查看待發送的排程郵件
    if (url.pathname === "/pending") {
      const { results } = await env.DB.prepare(
        "SELECT id, to_email, subject, scheduled_at, status FROM email_logs WHERE status = 'scheduled' ORDER BY scheduled_at ASC"
      ).all();
      return new Response(JSON.stringify(results || []), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Email Worker — /health /pending /trigger-scheduled", { status: 200 });
  },
};
