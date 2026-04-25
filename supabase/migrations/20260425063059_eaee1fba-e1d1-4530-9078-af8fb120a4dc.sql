-- 公司日誌表
CREATE TABLE public.company_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name_hint TEXT NOT NULL DEFAULT '',
  source_folder TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL DEFAULT 'OTHER',
  original_filename TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL DEFAULT '',
  html_content TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  doc_date TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_logs_company_id ON public.company_logs(company_id);
CREATE INDEX idx_company_logs_doc_type ON public.company_logs(doc_type);
CREATE INDEX idx_company_logs_source_folder ON public.company_logs(source_folder);

ALTER TABLE public.company_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read company_logs" ON public.company_logs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert company_logs" ON public.company_logs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update company_logs" ON public.company_logs
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete company_logs" ON public.company_logs
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_company_logs_updated_at
  BEFORE UPDATE ON public.company_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 儲存桶
INSERT INTO storage.buckets (id, name, public) VALUES ('company-logs', 'company-logs', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated read company-logs files" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'company-logs');
CREATE POLICY "Authenticated upload company-logs files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'company-logs');
CREATE POLICY "Authenticated update company-logs files" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'company-logs');
CREATE POLICY "Authenticated delete company-logs files" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'company-logs');