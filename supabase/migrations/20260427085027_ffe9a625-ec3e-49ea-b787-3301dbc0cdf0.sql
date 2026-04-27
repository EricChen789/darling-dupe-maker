
-- 中央人員主檔
CREATE TABLE public.persons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  identity TEXT NOT NULL DEFAULT 'natural', -- 'natural' | 'corporate'
  
  -- 姓名
  name_english TEXT NOT NULL DEFAULT '',
  name_chinese TEXT NOT NULL DEFAULT '',
  previous_name_english TEXT NOT NULL DEFAULT '',
  previous_name_chinese TEXT NOT NULL DEFAULT '',
  alias_english TEXT NOT NULL DEFAULT '',
  alias_chinese TEXT NOT NULL DEFAULT '',
  
  -- 身份證件
  id_number TEXT NOT NULL DEFAULT '',
  passport_number TEXT NOT NULL DEFAULT '',
  passport_expiry TEXT NOT NULL DEFAULT '',
  passport_country TEXT NOT NULL DEFAULT '',
  
  -- 聯絡與地址
  address TEXT NOT NULL DEFAULT '',
  service_address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  
  -- 法人專用
  place_incorporated TEXT NOT NULL DEFAULT '',
  company_number_ref TEXT NOT NULL DEFAULT '',
  tcsp_number TEXT NOT NULL DEFAULT '',
  
  -- 檔案
  passport_file_path TEXT NOT NULL DEFAULT '',
  id_card_file_path TEXT NOT NULL DEFAULT '',
  address_proof_file_path TEXT NOT NULL DEFAULT '',
  
  -- 正規化鍵（去英文標點、空白、轉小寫）用於去重比對
  normalized_key TEXT GENERATED ALWAYS AS (
    LOWER(REGEXP_REPLACE(COALESCE(name_english, ''), '[^A-Za-z0-9]', '', 'g'))
  ) STORED,
  
  notes TEXT NOT NULL DEFAULT '',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_persons_normalized_key ON public.persons(normalized_key);
CREATE INDEX idx_persons_name_chinese ON public.persons(name_chinese);
CREATE INDEX idx_persons_id_number ON public.persons(id_number);
CREATE INDEX idx_persons_identity ON public.persons(identity);

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read persons" ON public.persons FOR SELECT USING (true);
CREATE POLICY "Allow public insert persons" ON public.persons FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update persons" ON public.persons FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete persons" ON public.persons FOR DELETE USING (true);

CREATE TRIGGER persons_updated_at
  BEFORE UPDATE ON public.persons
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 人員與公司的角色關聯
CREATE TABLE public.person_company_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES public.persons(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  
  role TEXT NOT NULL, -- 'director' | 'secretary' | 'shareholder' | 'reserve_director'
  
  -- 任期
  date_appointed TEXT NOT NULL DEFAULT '',
  date_ceased TEXT NOT NULL DEFAULT '',
  
  -- 此角色可覆蓋的送達地址（為空時用 persons.service_address）
  service_address_override TEXT NOT NULL DEFAULT '',
  
  -- 股東專用
  shares INTEGER NOT NULL DEFAULT 0,
  share_type TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'HKD',
  issue_price TEXT NOT NULL DEFAULT '',
  paid_up TEXT NOT NULL DEFAULT '',
  unpaid TEXT NOT NULL DEFAULT '',
  
  notes TEXT NOT NULL DEFAULT '',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pcr_person_id ON public.person_company_roles(person_id);
CREATE INDEX idx_pcr_company_id ON public.person_company_roles(company_id);
CREATE INDEX idx_pcr_role ON public.person_company_roles(role);
CREATE INDEX idx_pcr_company_role ON public.person_company_roles(company_id, role);

ALTER TABLE public.person_company_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read person_company_roles" ON public.person_company_roles FOR SELECT USING (true);
CREATE POLICY "Allow public insert person_company_roles" ON public.person_company_roles FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update person_company_roles" ON public.person_company_roles FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete person_company_roles" ON public.person_company_roles FOR DELETE USING (true);

CREATE TRIGGER pcr_updated_at
  BEFORE UPDATE ON public.person_company_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
