ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS preferred_presenter_id UUID REFERENCES public.presenters(id) ON DELETE SET NULL;