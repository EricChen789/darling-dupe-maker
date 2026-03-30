ALTER TABLE public.shareholders
  ADD COLUMN IF NOT EXISTS identity text NOT NULL DEFAULT 'natural',
  ADD COLUMN IF NOT EXISTS id_number text DEFAULT '',
  ADD COLUMN IF NOT EXISTS name_chinese text DEFAULT '',
  ADD COLUMN IF NOT EXISTS name_english text DEFAULT '',
  ADD COLUMN IF NOT EXISTS address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS email text DEFAULT '';