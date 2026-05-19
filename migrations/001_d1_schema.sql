-- D1 Migration: secretary-db schema (converted from Supabase Postgres)
-- D1 uses SQLite - UUIDs stored as TEXT, timestamps as TEXT (ISO 8601)

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chinese_name TEXT DEFAULT '',
  company_number TEXT DEFAULT '',
  trading_name TEXT DEFAULT '',
  business_nature TEXT DEFAULT '',
  company_type TEXT DEFAULT '私人公司 Private company',
  business_code TEXT DEFAULT '',
  company_group TEXT DEFAULT '',
  quorum TEXT DEFAULT '',
  register_date TEXT DEFAULT '',
  reg_flat TEXT DEFAULT '',
  reg_building TEXT DEFAULT '',
  reg_street TEXT DEFAULT '',
  reg_district TEXT DEFAULT '',
  reg_region TEXT DEFAULT '香港 Hong Kong',
  incorporation_date TEXT DEFAULT '',
  jurisdiction TEXT DEFAULT 'Hong Kong',
  ci_file_path TEXT DEFAULT '',
  br_file_path TEXT DEFAULT '',
  preferred_presenter_id TEXT,
  presenter_reference TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  ci_number TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  signer_role_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS officers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name_english TEXT NOT NULL DEFAULT '',
  name_chinese TEXT DEFAULT '',
  identity TEXT NOT NULL DEFAULT 'natural',
  role TEXT NOT NULL CHECK (role IN ('director', 'secretary')),
  id_number TEXT DEFAULT '',
  address TEXT DEFAULT '',
  date_appointed TEXT DEFAULT '',
  date_ceased TEXT DEFAULT '',
  place_incorporated TEXT DEFAULT '',
  company_number_ref TEXT DEFAULT '',
  service_address TEXT DEFAULT '',
  passport_number TEXT DEFAULT '',
  passport_expiry TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  email TEXT DEFAULT '',
  passport_file_path TEXT DEFAULT '',
  id_card_file_path TEXT DEFAULT '',
  address_proof_file_path TEXT DEFAULT '',
  tcsp_number TEXT DEFAULT '',
  previous_name_chinese TEXT DEFAULT '',
  previous_name_english TEXT DEFAULT '',
  alias_chinese TEXT DEFAULT '',
  alias_english TEXT DEFAULT '',
  date_of_birth TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shareholders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  shares INTEGER NOT NULL DEFAULT 0,
  identity TEXT NOT NULL DEFAULT 'natural',
  id_number TEXT DEFAULT '',
  name_chinese TEXT DEFAULT '',
  name_english TEXT DEFAULT '',
  address TEXT DEFAULT '',
  email TEXT DEFAULT '',
  share_type TEXT DEFAULT '',
  service_address TEXT DEFAULT '',
  issue_price TEXT DEFAULT '',
  currency TEXT DEFAULT 'HKD',
  paid_up TEXT DEFAULT '',
  unpaid TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL DEFAULT 'natural',
  name_english TEXT NOT NULL DEFAULT '',
  name_chinese TEXT DEFAULT '',
  previous_name_english TEXT DEFAULT '',
  previous_name_chinese TEXT DEFAULT '',
  alias_english TEXT DEFAULT '',
  alias_chinese TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  passport_number TEXT DEFAULT '',
  passport_expiry TEXT DEFAULT '',
  passport_country TEXT DEFAULT '',
  address TEXT DEFAULT '',
  service_address TEXT DEFAULT '',
  email TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  place_incorporated TEXT DEFAULT '',
  company_number_ref TEXT DEFAULT '',
  tcsp_number TEXT DEFAULT '',
  passport_file_path TEXT DEFAULT '',
  id_card_file_path TEXT DEFAULT '',
  address_proof_file_path TEXT DEFAULT '',
  normalized_key TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  date_of_birth TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS person_company_roles (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  date_appointed TEXT DEFAULT '',
  date_ceased TEXT DEFAULT '',
  service_address_override TEXT DEFAULT '',
  shares INTEGER DEFAULT 0,
  share_type TEXT DEFAULT '',
  currency TEXT DEFAULT 'HKD',
  issue_price TEXT DEFAULT '',
  paid_up TEXT DEFAULT '',
  unpaid TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_reserve INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS presenters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'individual',
  phone TEXT DEFAULT '',
  fax TEXT DEFAULT '',
  email TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS significant_controllers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  identity TEXT NOT NULL DEFAULT 'natural',
  name_english TEXT NOT NULL DEFAULT '',
  name_chinese TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  address TEXT DEFAULT '',
  service_address TEXT DEFAULT '',
  date_became TEXT DEFAULT '',
  date_ceased TEXT DEFAULT '',
  nature_shares INTEGER DEFAULT 0,
  nature_voting INTEGER DEFAULT 0,
  nature_appoint INTEGER DEFAULT 0,
  nature_influence INTEGER DEFAULT 0,
  nature_trust INTEGER DEFAULT 0,
  nature_other TEXT DEFAULT '',
  is_designated_rep INTEGER DEFAULT 0,
  designated_rep_name TEXT DEFAULT '',
  designated_rep_contact TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_name_hint TEXT DEFAULT '',
  source_folder TEXT DEFAULT '',
  doc_type TEXT DEFAULT '',
  original_filename TEXT DEFAULT '',
  storage_path TEXT DEFAULT '',
  html_content TEXT DEFAULT '',
  text_content TEXT DEFAULT '',
  doc_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  is_completed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resolutions (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  resolution_type TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS secretary_templates (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  content TEXT DEFAULT '',
  template_type TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS share_transactions (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  shareholder_id TEXT REFERENCES shareholders(id) ON DELETE CASCADE,
  transaction_type TEXT DEFAULT '',
  shares INTEGER DEFAULT 0,
  price TEXT DEFAULT '',
  transaction_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_companies_group ON companies(company_group);
CREATE INDEX IF NOT EXISTS idx_companies_number ON companies(company_number);
CREATE INDEX IF NOT EXISTS idx_officers_company ON officers(company_id);
CREATE INDEX IF NOT EXISTS idx_shareholders_company ON shareholders(company_id);
CREATE INDEX IF NOT EXISTS idx_scr_company ON significant_controllers(company_id);
CREATE INDEX IF NOT EXISTS idx_pcr_person ON person_company_roles(person_id);
CREATE INDEX IF NOT EXISTS idx_pcr_company ON person_company_roles(company_id);
CREATE INDEX IF NOT EXISTS idx_logs_company ON company_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_reminders_company ON reminders(company_id);
CREATE INDEX IF NOT EXISTS idx_resolutions_company ON resolutions(company_id);
CREATE INDEX IF NOT EXISTS idx_transactions_company ON share_transactions(company_id);
