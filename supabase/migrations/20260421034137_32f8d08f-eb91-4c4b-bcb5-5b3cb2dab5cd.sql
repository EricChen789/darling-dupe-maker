-- Add new columns to companies table
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS incorporation_date text DEFAULT '',
  ADD COLUMN IF NOT EXISTS jurisdiction text DEFAULT 'Hong Kong',
  ADD COLUMN IF NOT EXISTS ci_file_path text DEFAULT '',
  ADD COLUMN IF NOT EXISTS br_file_path text DEFAULT '';

-- Create private storage bucket for company documents (CI / BR copies)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-documents', 'company-documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for company-documents bucket
CREATE POLICY "Authenticated users can view company documents"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'company-documents');

CREATE POLICY "Authenticated users can upload company documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'company-documents');

CREATE POLICY "Authenticated users can update company documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'company-documents');

CREATE POLICY "Authenticated users can delete company documents"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'company-documents');