ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS presenter_reference TEXT DEFAULT '';