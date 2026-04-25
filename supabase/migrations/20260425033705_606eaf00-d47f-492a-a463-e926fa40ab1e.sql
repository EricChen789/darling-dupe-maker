ALTER TABLE public.officers
  ADD COLUMN IF NOT EXISTS passport_number text DEFAULT '',
  ADD COLUMN IF NOT EXISTS passport_expiry text DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp text DEFAULT '',
  ADD COLUMN IF NOT EXISTS email text DEFAULT '';