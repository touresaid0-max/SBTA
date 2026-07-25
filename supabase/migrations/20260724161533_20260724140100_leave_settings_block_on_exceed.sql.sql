-- Add block_on_ceiling_exceed setting to leave_settings
ALTER TABLE leave_settings
  ADD COLUMN IF NOT EXISTS block_on_ceiling_exceed boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
