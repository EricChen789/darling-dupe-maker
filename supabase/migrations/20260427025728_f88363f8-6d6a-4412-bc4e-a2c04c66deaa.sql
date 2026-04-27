ALTER TABLE public.companies
ADD COLUMN status text NOT NULL DEFAULT 'active';

ALTER TABLE public.companies
ADD CONSTRAINT companies_status_check CHECK (status IN ('active','inactive','deregistered'));

CREATE INDEX IF NOT EXISTS idx_companies_status ON public.companies(status);