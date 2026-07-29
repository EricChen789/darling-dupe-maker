-- D1 Migration 004: WhatsApp Queue System
-- Adds: whatsapp_queue table for cron-based batch sending
-- Apply: npx wrangler d1 execute secretary-db --remote --file=migrations/004_whatsapp_queue.sql

-- ─── WhatsApp Queue (消息隊列) ───
CREATE TABLE IF NOT EXISTS whatsapp_queue (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  task_title TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | processing | sent | failed
  error TEXT DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  scheduled_at TEXT DEFAULT NULL,           -- ISO timestamp for delayed send; NULL = send immediately
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_status ON whatsapp_queue(status, scheduled_at, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_company ON whatsapp_queue(company_id);

-- ─── Update existing whatsapp_logs to track status properly ───
-- Add columns if they don't exist (idempotent — D1 will error silently)
-- Note: D1 doesn't support IF NOT EXISTS for ALTER TABLE, so these may fail if columns exist.
-- Run only if columns are missing.
-- ALTER TABLE whatsapp_logs ADD COLUMN queue_id TEXT DEFAULT NULL;
-- ALTER TABLE whatsapp_logs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE whatsapp_logs ADD COLUMN error TEXT DEFAULT '';
