UPDATE public.companies SET
  reg_flat = TRIM(BOTH ' ,，、' FROM regexp_replace(reg_flat, '[^\x00-\x7F]+', '', 'g')),
  reg_building = TRIM(BOTH ' ,，、' FROM regexp_replace(reg_building, '[^\x00-\x7F]+', '', 'g')),
  reg_street = TRIM(BOTH ' ,，、' FROM regexp_replace(reg_street, '[^\x00-\x7F]+', '', 'g')),
  reg_district = TRIM(BOTH ' ,，、' FROM regexp_replace(reg_district, '[^\x00-\x7F]+', '', 'g'))
WHERE reg_flat ~ '[^\x00-\x7F]'
   OR reg_building ~ '[^\x00-\x7F]'
   OR reg_street ~ '[^\x00-\x7F]'
   OR reg_district ~ '[^\x00-\x7F]';

-- Collapse multiple spaces left after removal
UPDATE public.companies SET
  reg_flat = regexp_replace(reg_flat, '\s+', ' ', 'g'),
  reg_building = regexp_replace(reg_building, '\s+', ' ', 'g'),
  reg_street = regexp_replace(reg_street, '\s+', ' ', 'g'),
  reg_district = regexp_replace(reg_district, '\s+', ' ', 'g');