
ALTER TABLE public.persons ADD COLUMN migration_dedup_key TEXT;
CREATE INDEX idx_persons_migration_dedup_key ON public.persons(migration_dedup_key);
