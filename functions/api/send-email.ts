// Cloudflare Pages Function: Send Email via MailChannels
// MailChannels 是 Cloudflare Workers 的合作夥伴，Workers 可免費發送郵件。
//
// 前置設定（一次性）：
//   1. 在發送域名的 DNS 加入 SPF 記錄：v=spf1 include:mailchannels.net ~all
//   2. 在 wrangler.toml 或 Pages Dashboard 設定環境變數：
//      SENDER_EMAIL  — 發件人電郵（必須與 SPF 域名匹配）
//      SENDER_NAME   — 發件人名稱（可選，預設 "Muse Labs 公司秘書"）
//   3. 若無 SPF 域名，MailChannels 會拒收（202 但實際不發送）。

interface Env {
  DB: D1Database;
  JWT_SECRET?: string;
  SENDER_EMAIL?: string;
  SENDER_NAME?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ── JWT 驗證（與 [[route]].ts 共用同樣的 JWT_SECRET）──
async function base64url(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function substituteVars(text: string, vars: Record<string, string>): string {
  if (!text) return "";
  return text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) =>
    vars[key] !== undefined && vars[key] !== "" ? vars[key] : `{${key}}`
  );
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── 驗證 JWT ──
  const authHeader = context.request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (context.env.JWT_SECRET && token) {
    const payload = await verifyJWT(token, context.env.JWT_SECRET);
    if (!payload) return json({ error: "Invalid or expired token" }, 401);
  }

  const data = await context.request.json() as Record<string, any>;
  const to = (data.to || "").trim();
  const cc = (data.cc || "").trim();
  const subject = (data.subject || "").trim();
  const body = (data.body || "").trim();
  const companyId = data.company_id || null;
  const templateId = data.template_id || null;
  const scheduledAt = data.scheduled_at || null;
  const variables: Record<string, string> = data.variables || {};

  if (!to) return json({ error: "收件人 (to) 為必填" }, 400);
  if (!subject) return json({ error: "主旨 (subject) 為必填" }, 400);

  // ── 變數替換 ──
  const finalSubject = substituteVars(subject, variables);
  const finalBody = substituteVars(body, variables);

  // ── 判斷郵件類型 ──
  let emailType = "general";
  if (templateId) {
    const trow = await context.env.DB.prepare(
      "SELECT template_type FROM email_templates WHERE id = ?"
    ).bind(templateId).first() as any;
    if (trow) emailType = trow.template_type || "general";
  }

  const logId = crypto.randomUUID();
  const now = new Date().toISOString();

  // ── 排程模式：只存不發 ──
  if (scheduledAt && new Date(scheduledAt).getTime() > Date.now()) {
    await context.env.DB.prepare(
      `INSERT INTO email_logs (id, company_id, template_id, to_email, cc_email, subject, body, status, scheduled_at, email_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`
    ).bind(logId, companyId, templateId, to, cc, finalSubject, finalBody, scheduledAt, emailType, now, now).run();

    return json({ success: true, id: logId, status: "scheduled" });
  }

  // ── 立即發送：經 MailChannels ──
  const senderEmail = context.env.SENDER_EMAIL || "noreply@secretary-email-worker.czijun59.workers.dev";
  const senderName = context.env.SENDER_NAME || "Muse Labs 公司秘書";

  try {
    // MailChannels Send API（Cloudflare Workers 自動授權，無需 API Key）
    const mcResp = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: to }],
          ...(cc ? { cc: [{ email: cc }] } : {}),
        }],
        from: { email: senderEmail, name: senderName },
        subject: finalSubject,
        content: [{
          type: "text/html",
          value: finalBody.replace(/\n/g, "<br>"),
        }],
      }),
    });

    const mcBody = await mcResp.text().catch(() => "");
    const sent = mcResp.ok || mcResp.status === 202;
    const errMsg = sent ? "" : `MailChannels HTTP ${mcResp.status}: ${mcBody}`.slice(0, 500);

    await context.env.DB.prepare(
      `INSERT INTO email_logs (id, company_id, template_id, to_email, cc_email, subject, body, status, sent_at, error, email_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      logId, companyId, templateId, to, cc, finalSubject, finalBody,
      sent ? "sent" : "failed",
      sent ? now : null,
      errMsg,
      emailType, now, now
    ).run();

    if (!sent) {
      console.error(`[send-email] MailChannels error: ${errMsg}`);
    }

    return json({
      success: sent,
      id: logId,
      status: sent ? "sent" : "failed",
      ...(sent ? {} : { error: errMsg }),
    });
  } catch (e: any) {
    const errMsg = (e.message || "Unknown error").slice(0, 500);
    console.error(`[send-email] Exception:`, e);

    await context.env.DB.prepare(
      `INSERT INTO email_logs (id, company_id, template_id, to_email, cc_email, subject, body, status, error, email_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?)`
    ).bind(logId, companyId, templateId, to, cc, finalSubject, finalBody, errMsg, emailType, now, now).run();

    return json({ success: false, error: errMsg }, 500);
  }
}
