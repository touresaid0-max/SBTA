-- Add colis_direction column to users for Agent Courrier SORTANT/ENTRANT assignment
-- Values: NULL (default = both), ['sortant'], ['entrant'], ['sortant','entrant']
ALTER TABLE users ADD COLUMN IF NOT EXISTS colis_direction text[] DEFAULT NULL;

COMMENT ON COLUMN users.colis_direction IS 'Agent Courrier direction filter: sortant, entrant, or both. NULL = both (default).';