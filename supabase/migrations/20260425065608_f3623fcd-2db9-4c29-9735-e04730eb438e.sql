-- Allow service-side bulk linking and reading by anyone for company_logs
DROP POLICY IF EXISTS "Authenticated read company_logs" ON public.company_logs;
DROP POLICY IF EXISTS "Authenticated insert company_logs" ON public.company_logs;
DROP POLICY IF EXISTS "Authenticated update company_logs" ON public.company_logs;
DROP POLICY IF EXISTS "Authenticated delete company_logs" ON public.company_logs;

CREATE POLICY "Public read company_logs" ON public.company_logs FOR SELECT USING (true);
CREATE POLICY "Public insert company_logs" ON public.company_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update company_logs" ON public.company_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete company_logs" ON public.company_logs FOR DELETE USING (true);

-- Auto match function: link a single log row to a company by hint
CREATE OR REPLACE FUNCTION public.link_company_logs_by_hint()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  WITH norm_companies AS (
    SELECT id, name,
      regexp_replace(lower(regexp_replace(name, '[^A-Za-z0-9 ]', ' ', 'g')), '\s+', ' ', 'g') AS nname
    FROM companies
  ),
  norm_logs AS (
    SELECT id, company_name_hint,
      trim(regexp_replace(lower(regexp_replace(company_name_hint, '[^A-Za-z0-9 ]', ' ', 'g')), '\s+', ' ', 'g')) AS nhint
    FROM company_logs
    WHERE company_id IS NULL
  ),
  matches AS (
    SELECT DISTINCT ON (l.id) l.id AS log_id, c.id AS company_id
    FROM norm_logs l
    JOIN norm_companies c
      ON c.nname LIKE (l.nhint || '%')
     AND length(l.nhint) >= 3
    ORDER BY l.id, length(c.nname) ASC
  )
  UPDATE company_logs cl SET company_id = m.company_id
  FROM matches m
  WHERE cl.id = m.log_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Trigger to keep updated_at fresh
DROP TRIGGER IF EXISTS company_logs_set_updated_at ON public.company_logs;
CREATE TRIGGER company_logs_set_updated_at
BEFORE UPDATE ON public.company_logs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();