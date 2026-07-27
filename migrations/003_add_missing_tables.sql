-- D1 Migration 003: Add missing tables present in local SQLite but not in production D1
-- Tables: company_versions, form_history, whatsapp_logs
-- Apply: npx wrangler d1 execute secretary-db --remote --file=migrations/003_add_missing_tables.sql

-- ─── Company Versions (VE-01: 版本快照) ───
CREATE TABLE IF NOT EXISTS company_versions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  snapshot TEXT NOT NULL DEFAULT '{}',
  changed_fields TEXT NOT NULL DEFAULT '[]',
  change_summary TEXT DEFAULT '',
  changed_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_company_versions_company ON company_versions(company_id);

-- ─── Form History (表单填写历史) ───
CREATE TABLE IF NOT EXISTS form_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL DEFAULT '',
  form_type TEXT NOT NULL,
  submission_index INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  form_data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_form_history_user_form
  ON form_history(user_id, form_type, submission_index DESC);

-- ─── WhatsApp Logs (WhatsApp 发送日志) ───
CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  phone TEXT DEFAULT '',
  message TEXT DEFAULT '',
  task_title TEXT DEFAULT '',
  status TEXT DEFAULT 'sent',
  error TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_company ON whatsapp_logs(company_id);

-- ─── Add missing reminders columns (if not already added by 002) ───
-- These are idempotent - D1 will just error silently if columns exist
-- We use a separate approach: check and skip via app logic
