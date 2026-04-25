
ALTER TABLE public.officers
  ADD COLUMN IF NOT EXISTS passport_file_path TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS id_card_file_path TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_proof_file_path TEXT DEFAULT '';

-- Storage policies for company-documents bucket (officer files live under officers/<id>/...)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public read company-documents') THEN
    CREATE POLICY "Public read company-documents"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'company-documents');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public insert company-documents') THEN
    CREATE POLICY "Public insert company-documents"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'company-documents');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public update company-documents') THEN
    CREATE POLICY "Public update company-documents"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'company-documents');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public delete company-documents') THEN
    CREATE POLICY "Public delete company-documents"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'company-documents');
  END IF;
END $$;
