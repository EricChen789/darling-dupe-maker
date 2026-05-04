
ALTER TABLE public.persons ADD COLUMN IF NOT EXISTS date_of_birth text NOT NULL DEFAULT '';
ALTER TABLE public.officers ADD COLUMN IF NOT EXISTS date_of_birth text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.share_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  transaction_date text NOT NULL DEFAULT '',
  transaction_type text NOT NULL DEFAULT 'transfer',
  from_person_id uuid,
  from_name text NOT NULL DEFAULT '',
  to_person_id uuid,
  to_name text NOT NULL DEFAULT '',
  shares integer NOT NULL DEFAULT 0,
  share_type text NOT NULL DEFAULT '',
  currency text NOT NULL DEFAULT 'HKD',
  price_per_share text NOT NULL DEFAULT '',
  total_consideration text NOT NULL DEFAULT '',
  instrument_number text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.share_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read share_transactions" ON public.share_transactions FOR SELECT USING (true);
CREATE POLICY "Public insert share_transactions" ON public.share_transactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update share_transactions" ON public.share_transactions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin/moderator delete share_transactions" ON public.share_transactions FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'moderator'::app_role));

CREATE TRIGGER share_transactions_updated_at
  BEFORE UPDATE ON public.share_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_share_transactions_company ON public.share_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_share_transactions_from ON public.share_transactions(from_person_id);
CREATE INDEX IF NOT EXISTS idx_share_transactions_to ON public.share_transactions(to_person_id);
