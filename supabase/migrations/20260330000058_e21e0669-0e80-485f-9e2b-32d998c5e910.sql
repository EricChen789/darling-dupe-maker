
-- Companies table
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  chinese_name TEXT DEFAULT '',
  company_number TEXT DEFAULT '',
  trading_name TEXT DEFAULT '',
  business_nature TEXT DEFAULT '',
  company_type TEXT DEFAULT '私人公司 Private company',
  business_code TEXT DEFAULT '',
  company_group TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Officers table (directors and secretaries)
CREATE TABLE public.officers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  name_english TEXT NOT NULL DEFAULT '',
  name_chinese TEXT DEFAULT '',
  identity TEXT NOT NULL DEFAULT 'natural' CHECK (identity IN ('natural', 'corporate')),
  role TEXT NOT NULL CHECK (role IN ('director', 'secretary')),
  id_number TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Shareholders table
CREATE TABLE public.shareholders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  shares INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_companies_group ON public.companies(company_group);
CREATE INDEX idx_companies_number ON public.companies(company_number);
CREATE INDEX idx_officers_company ON public.officers(company_id);
CREATE INDEX idx_shareholders_company ON public.shareholders(company_id);

-- Enable RLS (public read for now, no auth required)
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shareholders ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read companies" ON public.companies FOR SELECT USING (true);
CREATE POLICY "Allow public insert companies" ON public.companies FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update companies" ON public.companies FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete companies" ON public.companies FOR DELETE USING (true);

CREATE POLICY "Allow public read officers" ON public.officers FOR SELECT USING (true);
CREATE POLICY "Allow public insert officers" ON public.officers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update officers" ON public.officers FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete officers" ON public.officers FOR DELETE USING (true);

CREATE POLICY "Allow public read shareholders" ON public.shareholders FOR SELECT USING (true);
CREATE POLICY "Allow public insert shareholders" ON public.shareholders FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update shareholders" ON public.shareholders FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete shareholders" ON public.shareholders FOR DELETE USING (true);
