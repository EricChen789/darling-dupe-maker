
CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  reminder_type text NOT NULL DEFAULT 'NAR1',
  title text NOT NULL DEFAULT '',
  due_date text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  notes text NOT NULL DEFAULT '',
  notified_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read reminders" ON public.reminders FOR SELECT USING (true);
CREATE POLICY "Public insert reminders" ON public.reminders FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update reminders" ON public.reminders FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin/mod delete reminders" ON public.reminders FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role));
CREATE TRIGGER reminders_updated_at BEFORE UPDATE ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_reminders_company ON public.reminders(company_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON public.reminders(due_date);

CREATE TABLE IF NOT EXISTS public.resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  resolution_type text NOT NULL DEFAULT 'general',
  title text NOT NULL DEFAULT '',
  resolution_date text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  signers text NOT NULL DEFAULT '',
  is_ai_generated boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read resolutions" ON public.resolutions FOR SELECT USING (true);
CREATE POLICY "Public insert resolutions" ON public.resolutions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update resolutions" ON public.resolutions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin/mod delete resolutions" ON public.resolutions FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role));
CREATE TRIGGER resolutions_updated_at BEFORE UPDATE ON public.resolutions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_resolutions_company ON public.resolutions(company_id);
