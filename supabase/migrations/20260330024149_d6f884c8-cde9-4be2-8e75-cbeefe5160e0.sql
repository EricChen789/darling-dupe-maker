ALTER TABLE public.officers
  ADD COLUMN IF NOT EXISTS address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS date_appointed text DEFAULT '',
  ADD COLUMN IF NOT EXISTS date_ceased text DEFAULT '',
  ADD COLUMN IF NOT EXISTS place_incorporated text DEFAULT '',
  ADD COLUMN IF NOT EXISTS company_number_ref text DEFAULT '';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS quorum text DEFAULT '',
  ADD COLUMN IF NOT EXISTS register_date text DEFAULT '';

ALTER TABLE public.shareholders
  ADD COLUMN IF NOT EXISTS share_type text DEFAULT '';