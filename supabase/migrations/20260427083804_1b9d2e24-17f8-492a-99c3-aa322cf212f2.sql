ALTER TABLE public.officers
  ADD COLUMN IF NOT EXISTS previous_name_chinese text DEFAULT '',
  ADD COLUMN IF NOT EXISTS previous_name_english text DEFAULT '',
  ADD COLUMN IF NOT EXISTS alias_chinese text DEFAULT '',
  ADD COLUMN IF NOT EXISTS alias_english text DEFAULT '';