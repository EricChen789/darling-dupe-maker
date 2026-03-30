
-- Delete records where address was parsed as name (English addresses)
DELETE FROM officers WHERE 
  name_english LIKE '%, NEW' 
  OR name_english LIKE 'issued by%'
  OR name_english ~ '^[0-9]+[A-Z]'
  OR name_english LIKE '%TERRACE%'
  OR name_english LIKE '%LANE, %'
  OR name_english LIKE '%HILLS,%'
  OR name_english LIKE '%VILLAS,%'
  OR name_english LIKE '%TSUEN,%'
  OR name_english LIKE '%PATH,%';

-- Delete records where Chinese address was parsed as name
DELETE FROM officers WHERE 
  name_english LIKE '%俊園%'
  OR name_english LIKE '%前海%'
  OR name_english LIKE '%北角%'
  OR name_english LIKE '%四川%'
  OR name_english LIKE '%廣東%'
  OR name_english LIKE '%新界%'
  OR name_english LIKE '%沿山%'
  OR name_english LIKE '%浙江%'
  OR name_english LIKE '%深圳%'
  OR name_english LIKE '%湖北%'
  OR name_english LIKE '%碧海%'
  OR name_english LIKE '%香港%'
  OR name_english LIKE '%沙田%';

-- Fix records where Chinese name is mixed into English name field
UPDATE officers SET name_english = 'JIE ELYNI', name_chinese = '余麗妮' WHERE name_english = 'JIE ELYNI 余麗妮';
UPDATE officers SET name_english = 'MA AYE AYE KHINE', name_chinese = '饒碧雲' WHERE name_english = 'MA AYE AYE KHINE 饒碧雲';
UPDATE officers SET name_english = 'DONG SHU KEI BEAU', name_chinese = '童樹基' WHERE name_english = 'DONG SHU KEI BEAU 童樹基';
UPDATE officers SET name_english = 'SIU MUK LUNG', name_chinese = '蕭木龍' WHERE name_english = 'SIU MUK LUNG 蕭木龍'
