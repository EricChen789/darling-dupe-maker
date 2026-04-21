-- Create presenters table
CREATE TABLE IF NOT EXISTS public.presenters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text DEFAULT '',
  contact text DEFAULT '',
  type text NOT NULL DEFAULT 'individual', -- individual | company | tcsp
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.presenters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view presenters"
  ON public.presenters FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert presenters"
  ON public.presenters FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update presenters"
  ON public.presenters FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete presenters"
  ON public.presenters FOR DELETE TO authenticated USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presenters_updated_at ON public.presenters;
CREATE TRIGGER trg_presenters_updated_at
  BEFORE UPDATE ON public.presenters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default presenters
INSERT INTO public.presenters (name, address, contact, type)
VALUES
  ('Paul Tang', '', '', 'individual'),
  ('Twinsail', '', '', 'tcsp'),
  ('個人 Individual', '', '', 'individual')
ON CONFLICT DO NOTHING;