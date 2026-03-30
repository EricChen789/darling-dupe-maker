-- Bulk data import from RTF files: officers addresses, IDs, dates; shareholders addresses, share types; companies quorum
-- This migration updates existing records with data extracted from ROD/ROM documents

-- Companies quorum and register dates
UPDATE companies SET quorum = '1' WHERE company_number = '667527';
UPDATE companies SET quorum = '1' WHERE company_number = '2030762';
UPDATE companies SET quorum = '1' WHERE company_number = '1792490';
UPDATE companies SET quorum = '1' WHERE company_number = '1567433';
UPDATE companies SET quorum = '2' WHERE company_number = '513816';
UPDATE companies SET quorum = '1' WHERE company_number = '1883366';
UPDATE companies SET quorum = '1' WHERE company_number = '2087510';
UPDATE companies SET quorum = '1' WHERE company_number = '1563753';