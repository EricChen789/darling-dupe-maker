-- Add service_address to officers and shareholders
ALTER TABLE public.officers ADD COLUMN IF NOT EXISTS service_address text DEFAULT '';
ALTER TABLE public.shareholders ADD COLUMN IF NOT EXISTS service_address text DEFAULT '';

-- Create significant_controllers table
CREATE TABLE IF NOT EXISTS public.significant_controllers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  identity text NOT NULL DEFAULT 'natural',
  name_english text NOT NULL DEFAULT '',
  name_chinese text DEFAULT '',
  id_number text DEFAULT '',
  address text DEFAULT '',
  service_address text DEFAULT '',
  date_became text DEFAULT '',
  date_ceased text DEFAULT '',
  nature_shares boolean DEFAULT false,
  nature_voting boolean DEFAULT false,
  nature_appoint boolean DEFAULT false,
  nature_influence boolean DEFAULT false,
  nature_trust boolean DEFAULT false,
  nature_other text DEFAULT '',
  is_designated_rep boolean DEFAULT false,
  designated_rep_name text DEFAULT '',
  designated_rep_contact text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scr_company ON public.significant_controllers(company_id);

ALTER TABLE public.significant_controllers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read scr" ON public.significant_controllers FOR SELECT USING (true);
CREATE POLICY "Allow public insert scr" ON public.significant_controllers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update scr" ON public.significant_controllers FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete scr" ON public.significant_controllers FOR DELETE USING (true);

CREATE TRIGGER scr_set_updated_at
BEFORE UPDATE ON public.significant_controllers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();