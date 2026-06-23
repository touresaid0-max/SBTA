ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_naissance date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_naissance date;
NOTIFY pgrst, 'reload schema';