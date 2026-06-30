/*
  # Counter ownership by chef de gare (multi-chef stations)

  Adds an optional responsible chef de gare to each counter. Used only for
  stations that have more than one chef de gare so that each chef sees and
  manages only the counters (and their assigned guichetiers) attributed to them.

  - counters.manager_id: nullable FK to users(id). NULL keeps the current
    behavior (every chef of the station sees the counter), which is what
    single-chef stations rely on.

  No existing data is removed or altered.
*/

ALTER TABLE counters
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_counters_manager ON counters(manager_id);

NOTIFY pgrst, 'reload schema';
