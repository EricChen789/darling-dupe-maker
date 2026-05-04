-- 1. 預備董事旗標
ALTER TABLE public.person_company_roles
  ADD COLUMN IF NOT EXISTS is_reserve boolean NOT NULL DEFAULT false;

-- 2. 秘書範本表
CREATE TABLE IF NOT EXISTS public.secretary_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  identity text NOT NULL DEFAULT 'corporate',
  name_english text NOT NULL DEFAULT '',
  name_chinese text NOT NULL DEFAULT '',
  id_number text NOT NULL DEFAULT '',
  br_number text NOT NULL DEFAULT '',
  tcsp_number text NOT NULL DEFAULT '',
  place_incorporated text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  service_address text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.secretary_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read secretary_templates"
  ON public.secretary_templates FOR SELECT USING (true);

CREATE POLICY "Public insert secretary_templates"
  ON public.secretary_templates FOR INSERT WITH CHECK (true);

CREATE POLICY "Admin/moderator update secretary_templates"
  ON public.secretary_templates FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'moderator'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'moderator'::app_role));

CREATE POLICY "Admin/moderator delete secretary_templates"
  ON public.secretary_templates FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'moderator'::app_role));

CREATE TRIGGER secretary_templates_set_updated_at
  BEFORE UPDATE ON public.secretary_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();