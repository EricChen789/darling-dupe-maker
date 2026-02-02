-- Create storage bucket for PDF templates
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdf-templates', 'pdf-templates', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to templates
CREATE POLICY "Public can read PDF templates"
ON storage.objects FOR SELECT
USING (bucket_id = 'pdf-templates');