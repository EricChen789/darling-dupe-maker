-- D1 Migration 004: Change tracking infrastructure for NAR1 smart filing
-- Tables: change_events, nar1_filings, form_linkages
-- Columns: companies.nar1_due_date, auth_users.accessible_company_groups
-- Apply: npx wrangler d1 execute secretary-db --remote --file=migrations/004_change_tracking.sql

-- ─── Change Events (统一变更日志) ───
CREATE TABLE IF NOT EXISTS change_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  event_type TEXT NOT NULL,
  person_id TEXT,
  role TEXT DEFAULT '',
  old_value TEXT DEFAULT '',
  new_value TEXT DEFAULT '',
  change_date TEXT NOT NULL DEFAULT '',
  related_form_type TEXT DEFAULT '',
  nar1_period_id TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_change_events_company ON change_events(company_id);
CREATE INDEX IF NOT EXISTS idx_change_events_period ON change_events(nar1_period_id);
CREATE INDEX IF NOT EXISTS idx_change_events_type ON change_events(event_type);

-- ─── NAR1 Filings (NAR1 申报记录) ───
CREATE TABLE IF NOT EXISTS nar1_filings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  period_start TEXT NOT NULL DEFAULT '',
  period_end TEXT NOT NULL DEFAULT '',
  filing_date TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  form_history_id TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_nar1_filings_company ON nar1_filings(company_id);

-- ─── Form Linkages (表单关联规则) ───
CREATE TABLE IF NOT EXISTS form_linkages (
  id TEXT PRIMARY KEY,
  primary_form TEXT NOT NULL,
  linked_form TEXT NOT NULL,
  linkage_type TEXT NOT NULL DEFAULT 'always_together',
  description TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_form_linkages_primary ON form_linkages(primary_form);

-- ─── Companies: NAR1 due date ───
-- SQLite/D1 doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- Run once manually; skip if column already exists (checked at app level)
ALTER TABLE companies ADD COLUMN nar1_due_date TEXT DEFAULT '';

-- ─── Auth Users: accessible company groups (multi-tenant) ───
ALTER TABLE auth_users ADD COLUMN accessible_company_groups TEXT DEFAULT '*';

-- ─── Seed: Form Linkages (表单关联种子数据) ───
INSERT OR IGNORE INTO form_linkages (id, primary_form, linked_form, linkage_type, description, is_active) VALUES
  ('link_001', 'NR1', 'IRC3111A', 'always_together', '更改註冊辦事處地址時須同時通知稅務局更改業務地址', 1),
  ('link_002', 'NDR1', 'IR1263', 'always_together', '申請撤銷註冊時須同時通知稅務局', 1),
  ('link_003', 'NN9', 'IRC3111A', 'always_together', '非香港公司更改地址時須同時通知稅務局更改業務地址', 1),
  ('link_004', 'ND2A', 'ND4', 'conditional', '若同時有董事/秘書辭任及委任，需一併提交 ND4 辭任通知書', 1),
  ('link_005', 'NNC1', 'IRBR1', 'always_together', '根據《商業登記條例》，NNC1（法團成立表格）須連同IRBR1（致商業登記署通知書）一併提交', 1),
  ('link_006', 'NN1', 'IRBR2', 'always_together', '根據《商業登記條例》第5B(1)及5D(2)條，NN1（註冊非香港公司申請書）須連同IRBR2（致商業登記署通知書）一併提交', 1);
