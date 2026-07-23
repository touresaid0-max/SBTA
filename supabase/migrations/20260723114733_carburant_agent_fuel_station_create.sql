/*
# Allow Agent Carburant to create and manage fuel stations

## Purpose
The "Agent Carburant" role needs to create new fuel stations directly from the
Carburant module, using the same `fuel_stations` table as the Admin module.
Previously only the `admin` role could INSERT/UPDATE; the `carburant` role could
only SELECT active stations.

## Changes

### 1. Unique constraint on fuel_stations.name
- Adds `UNIQUE (name)` to prevent duplicate station names.
- The `code` column already has a unique constraint (`fuel_stations_code_unique`).
- Both name and code uniqueness are enforced at the database level.

### 2. RLS policies for carburant role on fuel_stations
- **INSERT**: allows `carburant` role to insert new stations (WITH CHECK).
- **UPDATE**: allows `carburant` role to update stations they manage.
- The existing SELECT policies (admin + carburant active-only + authenticated active-only) remain unchanged.

## Security
- Only authenticated users with `role = 'carburant'` (verified via `get_my_role_carburant()`) gain INSERT/UPDATE access.
- The `admin` policies remain in place and unchanged.
- No destructive operations — no data is lost or renamed.
*/

-- 1. Unique name constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fuel_stations_name_unique'
      AND conrelid = 'fuel_stations'::regclass
  ) THEN
    ALTER TABLE fuel_stations ADD CONSTRAINT fuel_stations_name_unique UNIQUE (name);
  END IF;
END $$;

-- 2. INSERT policy for carburant role
DROP POLICY IF EXISTS "Agent carburant can insert fuel stations" ON fuel_stations;
CREATE POLICY "Agent carburant can insert fuel stations"
ON fuel_stations FOR INSERT
TO authenticated
WITH CHECK (get_my_role_carburant() = 'carburant');

-- 3. UPDATE policy for carburant role
DROP POLICY IF EXISTS "Agent carburant can update fuel stations" ON fuel_stations;
CREATE POLICY "Agent carburant can update fuel stations"
ON fuel_stations FOR UPDATE
TO authenticated
USING (get_my_role_carburant() = 'carburant')
WITH CHECK (get_my_role_carburant() = 'carburant');
