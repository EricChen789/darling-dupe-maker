ALTER TABLE public.companies
  ADD COLUMN reg_flat text DEFAULT '' ,
  ADD COLUMN reg_building text DEFAULT '',
  ADD COLUMN reg_street text DEFAULT '',
  ADD COLUMN reg_district text DEFAULT '',
  ADD COLUMN reg_region text DEFAULT '香港 Hong Kong';