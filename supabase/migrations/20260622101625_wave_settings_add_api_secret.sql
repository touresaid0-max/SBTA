ALTER TABLE wave_settings ADD COLUMN IF NOT EXISTS api_secret text DEFAULT '' NOT NULL;

NOTIFY pgrst, 'reload schema';