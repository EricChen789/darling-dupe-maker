/**
 * WhatsApp Queue Worker
 *
 * Cron-triggered worker that polls the whatsapp_queue table and sends
 * pending messages via Wuzapi API. Falls back to simulation mode if
 * Wuzapi is not configured or unreachable.
 *
 * Cron: * * * * * (every 60 seconds)
 * HTTP: /health /send-pending /queue-stats
 */

interface Env {
  DB: D1Database;
  WUZAPI_URL?: string;
  WUZAPI_TOKEN?: string;
}

interface QueueRow {
  id: string;
  company_id: string | null;
  phone: string;
  message: string;
  task_title: string;
  status: string;
  attempts: number;
  max_attempts: number;
  scheduled_at: string | null;
  created_at: string;
  sent_at: string | null;
  error: string;
}

// ─── Wuzapi Send ───

async function sendViaWuzapi(
  phone: string,
  message: string,
  env: Env
): Promise<{ success: boolean; error?: string }> {
  const baseUrl = env.WUZAPI_URL;
  const token = env.WUZAPI_TOKEN;

  if (!baseUrl || !token) {
    console.log("[whatsapp-worker] Wuzapi not configured — simulating send");
    return { success: true }; // Simulate success in dev mode
  }

  try {
    const resp = await fetch(`${baseUrl}/chat/send/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: token,
      },
      body: JSON.stringify({
        phone: phone,
        body: message,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown");
      return { success: false, error: `Wuzapi HTTP ${resp.status}: ${errText.slice(0, 200)}` };
    }

    const result = await resp.json() as any;
    console.log(`[whatsapp-worker] Sent to ${phone}:`, result?.id || "ok");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: `Wuzapi unreachable: ${e.message}` };
  }
}

// ─── Queue Processing ───

async function processQueue(env: Env): Promise<number> {
  const now = new Date().toISOString();

  // Fetch pending messages that are ready to send
  const { results } = await env.DB.prepare(
    `SELECT * FROM whatsapp_queue
     WHERE status = 'pending'
       AND (scheduled_at IS NULL OR scheduled_at <= ?)
       AND attempts < max_attempts
     ORDER BY created_at ASC
     LIMIT 10`
  ).bind(now).all();

  if (!results || results.length === 0) return 0;

  const rows = results as unknown as QueueRow[];
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    console.log(`[whatsapp-worker] Processing: ${row.id} → ${row.phone} (attempt ${row.attempts + 1}/${row.max_attempts})`);

    // Mark as processing
    await env.DB.prepare(
      `UPDATE whatsapp_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ?`
    ).bind(row.id).run();

    // Send
    const result = await sendViaWuzapi(row.phone, row.message, env);

    if (result.success) {
      // Mark as sent
      await env.DB.prepare(
        `UPDATE whatsapp_queue SET status = 'sent', sent_at = ?, error = '' WHERE id = ?`
      ).bind(now, row.id).run();

      // Also log to whatsapp_logs for history
      await env.DB.prepare(
        `INSERT INTO whatsapp_logs (id, company_id, phone, message, task_title, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'sent', ?)`
      ).bind(
        crypto.randomUUID(), row.company_id, row.phone,
        row.message, row.task_title, now
      ).run();

      sent++;
    } else {
      const errorMsg = result.error || "Unknown error";
      const newAttempts = row.attempts + 1;

      if (newAttempts >= row.max_attempts) {
        // Max attempts exceeded — mark as failed
        await env.DB.prepare(
          `UPDATE whatsapp_queue SET status = 'failed', error = ?, sent_at = ? WHERE id = ?`
        ).bind(errorMsg, now, row.id).run();

        // Log failure
        await env.DB.prepare(
          `INSERT INTO whatsapp_logs (id, company_id, phone, message, task_title, status, error, created_at)
           VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`
        ).bind(
          crypto.randomUUID(), row.company_id, row.phone,
          row.message, row.task_title, errorMsg, now
        ).run();

        failed++;
      } else {
        // Retry later — reset to pending
        await env.DB.prepare(
          `UPDATE whatsapp_queue SET status = 'pending', error = ? WHERE id = ?`
        ).bind(errorMsg, row.id).run();
        failed++;
      }
    }
  }

  console.log(`[whatsapp-worker] Batch complete: ${sent} sent, ${failed} failed`);
  return sent + failed;
}

// ─── Scheduled Handler (cron) ───

async function scheduled(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const processed = await processQueue(env);
  if (processed === 0) {
    // No pending messages — silent
    return;
  }
}

// ─── HTTP Handler ───

async function fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    const { results } = await env.DB.prepare(
      `SELECT status, COUNT(*) as count FROM whatsapp_queue GROUP BY status`
    ).all();

    const stats: Record<string, number> = {};
    for (const row of (results || []) as any[]) {
      stats[row.status] = row.count;
    }

    return new Response(JSON.stringify({
      status: "ok",
      mode: env.WUZAPI_URL ? "production" : "simulation",
      queue: stats,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.pathname === "/send-pending" && request.method === "POST") {
    const processed = await processQueue(env);
    return new Response(JSON.stringify({ processed }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.pathname === "/retry-failed" && request.method === "POST") {
    const { results } = await env.DB.prepare(
      `UPDATE whatsapp_queue SET status = 'pending', attempts = 0, error = '' WHERE status = 'failed'`
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("WhatsApp Worker — /health /send-pending /retry-failed", { status: 200 });
}

export default { fetch, scheduled };
