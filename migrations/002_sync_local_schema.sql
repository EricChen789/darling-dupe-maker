-- D1 Migration 002: 把生产 secretary-db 补齐到本地 SQLite 当前 schema
-- 背景：本地经过多次 auto_migrate 加了表和列，生产 D1 仍停留在 001 基线。
-- 应用（run-once）：npx wrangler d1 execute secretary-db --remote --file=migrations/002_sync_local_schema.sql
-- 注意：SQLite ADD COLUMN 无 IF NOT EXISTS，本迁移假设生产处于 001 基线、以下列均不存在。

-- ─── 新表：登录/邮件/发票 ───

CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  template_type TEXT DEFAULT 'general',
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  template_id TEXT,
  to_email TEXT DEFAULT '',
  cc_email TEXT DEFAULT '',
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  status TEXT DEFAULT 'sent',
  scheduled_at TEXT DEFAULT NULL,
  sent_at TEXT DEFAULT NULL,
  error TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_number TEXT DEFAULT '',
  description TEXT DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'HKD',
  status TEXT DEFAULT 'pending',
  issue_date TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 补列：officers / shareholders / user_roles ───

ALTER TABLE officers ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE shareholders ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE user_roles ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE user_roles ADD COLUMN updated_at TEXT DEFAULT '';

-- ─── 补列：reminders（前端用 status/reminder_type/notes/completed_at）───

ALTER TABLE reminders ADD COLUMN reminder_type TEXT DEFAULT 'NAR1';
ALTER TABLE reminders ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE reminders ADD COLUMN notes TEXT DEFAULT '';
ALTER TABLE reminders ADD COLUMN notified_at TEXT DEFAULT NULL;
ALTER TABLE reminders ADD COLUMN completed_at TEXT DEFAULT NULL;

-- ─── 补列：resolutions ───

ALTER TABLE resolutions ADD COLUMN resolution_date TEXT DEFAULT '';
ALTER TABLE resolutions ADD COLUMN signers TEXT DEFAULT '';
ALTER TABLE resolutions ADD COLUMN is_ai_generated INTEGER DEFAULT 0;
ALTER TABLE resolutions ADD COLUMN notes TEXT DEFAULT '';

-- ─── 补列：secretary_templates（+13 列）───

ALTER TABLE secretary_templates ADD COLUMN label TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN identity TEXT DEFAULT 'corporate';
ALTER TABLE secretary_templates ADD COLUMN name_english TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN name_chinese TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN id_number TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN br_number TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN tcsp_number TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN place_incorporated TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN address TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN service_address TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN email TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN phone TEXT DEFAULT '';
ALTER TABLE secretary_templates ADD COLUMN is_default INTEGER DEFAULT 0;

-- ─── 补列：share_transactions（生产 001 结构陈旧，缺转让双方/币别/单价等）───

ALTER TABLE share_transactions ADD COLUMN from_person_id TEXT;
ALTER TABLE share_transactions ADD COLUMN from_name TEXT DEFAULT '';
ALTER TABLE share_transactions ADD COLUMN to_person_id TEXT;
ALTER TABLE share_transactions ADD COLUMN to_name TEXT DEFAULT '';
ALTER TABLE share_transactions ADD COLUMN share_type TEXT DEFAULT '';
ALTER TABLE share_transactions ADD COLUMN currency TEXT DEFAULT 'HKD';
ALTER TABLE share_transactions ADD COLUMN price_per_share TEXT DEFAULT '';
ALTER TABLE share_transactions ADD COLUMN total_consideration TEXT DEFAULT '';
ALTER TABLE share_transactions ADD COLUMN instrument_number TEXT DEFAULT '';
ALTER TABLE share_transactions ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

-- ─── 索引 ───

CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_company ON email_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
