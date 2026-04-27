ALTER TABLE public.shareholders 
  ADD COLUMN IF NOT EXISTS issue_price text DEFAULT '',
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'HKD',
  ADD COLUMN IF NOT EXISTS paid_up text DEFAULT '',
  ADD COLUMN IF NOT EXISTS unpaid text DEFAULT '';