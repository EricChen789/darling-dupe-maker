// Email Worker — Cloudflare Workers + MailChannels (free, unlimited sending)
//   - MailChannels API: free via Cloudflare Workers partnership
//   - Resend API: fallback if RESEND_API_KEY is configured
//   - Email Routing: receive incoming emails from Cloudflare Email Routing
//
// Required DNS SPF record: v=spf1 include:relay.mailchannels.net ~all
//
// 部署：npx wrangler deploy --config email-worker/wrangler.toml

interface Env {
  DB: D1Database;
  SENDER_EMAIL: string;
  SENDER_NAME: string;
  RESEND_API_KEY?: string;
}

// ── MailChannels (primary, free via Cloudflare) ──
async function sendViaMailChannels(
  env: Env,
  log: any
): Promise<boolean> {
  const senderEmail = env.SENDER_EMAIL || "noreply@techforliving.net";
  const senderName = env.SENDER_NAME || "Muse Labs 公司秘書";

  try {
    const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: log.to_email }],
            ...(log.cc_email ? { cc: [{ email: log.cc_email }] } : {}),
          },
        ],
        from: {
          email: senderEmail,
          name: senderName,
        },
        subject: log.subject,
        content: [
          {
            type: "text/plain",
            value: (log.body || "").replace(/<br>/g, "\n").replace(/<[^>]+>/g, ""),
          },
          {
            type: "text/html",
            value: (log.body || "").replace(/\n/g, "<br>"),
          },
        ],
      }),
    });

    if (resp.ok || resp.status === 202) {
      console.log(`[email-worker:MAILCHANNELS] Sent: ${log.id} -> ${log.to_email}`);
      return true;
    }
    const errBody = await resp.text().catch(() => "");
    console.error(`[email-worker:MAILCHANNELS] Failed ${resp.status}: ${errBody.slice(0, 300)}`);
    return false;
  } catch (e: any) {
    console.error(`[email-worker:MAILCHANNELS] Error: ${e.message}`);
    return false;
  }
}

// ── Resend (fallback) ──
async function sendViaResend(
  env: Env,
  log: any
): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return false;

  try {
    const senderName = env.SENDER_NAME || "Muse Labs 公司秘書";
    const senderEmail = env.SENDER_EMAIL || "noreply@techforliving.net";
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${senderName} <${senderEmail}>`,
        to: [log.to_email],
        ...(log.cc_email ? { cc: [log.cc_email] } : {}),
        subject: log.subject,
        html: (log.body || "").replace(/\n/g, "<br>"),
      }),
    });

    if (resp.ok) {
      console.log(`[email-worker:RESEND] Sent: ${log.id} -> ${log.to_email}`);
      return true;
    }
    const errBody = await resp.text().catch(() => "");
    console.error(`[email-worker:RESEND] Failed ${resp.status}: ${errBody.slice(0, 300)}`);
    return false;
  } catch (e: any) {
    console.error(`[email-worker:RESEND] Error: ${e.message}`);
    return false;
  }
}

// ── Main send logic ──
async function sendAndUpdate(env: Env, log: any) {
  let sent = false;
  let errorMsg = "";

  // Try MailChannels first (free via Cloudflare)
  sent = await sendViaMailChannels(env, log);

  // Fallback to Resend if MailChannels fails
  if (!sent && env.RESEND_API_KEY) {
    sent = await sendViaResend(env, log);
  }

  if (sent) {
    await env.DB.prepare(
      `UPDATE email_logs SET status = 'sent', sent_at = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(new Date().toISOString(), log.id).run();
  } else {
    errorMsg = errorMsg || "All sending methods failed";
    await env.DB.prepare(
      `UPDATE email_logs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(errorMsg, log.id).run();
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
      return new Response("OK - Email Worker (MailChannels + Resend)", { status: 200 });
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

    // 立即發送郵件
    if (url.pathname === "/send" && request.method === "POST") {
      try {
        const data = await request.json() as any;
        const { to, cc, subject, body } = data;
        if (!to || !subject) {
          return new Response(JSON.stringify({ success: false, error: "to and subject required" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }

        // Try MailChannels first
        let sent = await sendViaMailChannels(env, { to_email: to, cc_email: cc || "", subject, body });

        // Fallback to Resend
        if (!sent && env.RESEND_API_KEY) {
          sent = await sendViaResend(env, { to_email: to, cc_email: cc || "", subject, body });
        }

        return new Response(JSON.stringify({
          success: sent,
          ...(sent ? {} : { error: "All sending methods failed" }),
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
