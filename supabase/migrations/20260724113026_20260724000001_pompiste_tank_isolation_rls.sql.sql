-- ─────────────────────────────────────────────────────────────────
-- Pompiste → Cuve isolation (access control)
--
-- Goal: a pompiste may only see / manage the tank(s) explicitly
-- assigned to them via fuel_tanks.pompiste_id.
-- Agent Carburant keeps full visibility.
--
-- Strategy: replace the broad SELECT policies on the tank-scoped
-- tables (fuel_tanks, fuel_depotages, fuel_enlevements) so that a
-- pompiste row is visible only when the tank belongs to them.
-- All other roles keep their existing (broad) access.
-- ─────────────────────────────────────────────────────────────────

-- Helper: role of the current user (avoids repeated subqueries)
CREATE OR REPLACE FUNCTION _current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM users WHERE id = auth.uid() LIMIT 1;
$$;

-- Helper: is the current user an Agent Carburant (full access)?
CREATE OR REPLACE FUNCTION _is_carburant_agent()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND role = 'carburant'
  );
$$;

-- Helper: set of tank ids assigned to the current pompiste
CREATE OR REPLACE FUNCTION _my_tank_ids()
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM fuel_tanks WHERE pompiste_id = auth.uid();
$$;

-- ════════════════════════════════════════════════════════════════
-- fuel_tanks
-- ════════════════════════════════════════════════════════════════

-- Replace the broad SELECT policy with a scoped one.
DROP POLICY IF EXISTS "Authenticated users can view fuel tanks" ON fuel_tanks;
DROP POLICY IF EXISTS "pompiste view own fuel tanks" ON fuel_tanks;

CREATE POLICY "pompiste view own fuel tanks"
  ON fuel_tanks FOR SELECT
  TO authenticated
  USING (
    _is_carburant_agent()
    OR _current_user_role() NOT IN ('pompiste')
    OR pompiste_id = auth.uid()
  );

-- ════════════════════════════════════════════════════════════════
-- fuel_depotages
-- ════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "All authenticated can read depotages" ON fuel_depotages;
DROP POLICY IF EXISTS "pompiste view own depotages" ON fuel_depotages;

CREATE POLICY "pompiste view own depotages"
  ON fuel_depotages FOR SELECT
  TO authenticated
  USING (
    _is_carburant_agent()
    OR _current_user_role() NOT IN ('pompiste')
    OR tank_id IN (SELECT id FROM _my_tank_ids())
  );

DROP POLICY IF EXISTS "Pompiste and admin can insert depotages" ON fuel_depotages;
DROP POLICY IF EXISTS "pompiste insert own depotages" ON fuel_depotages;

CREATE POLICY "pompiste insert own depotages"
  ON fuel_depotages FOR INSERT
  TO authenticated
  WITH CHECK (
    _is_carburant_agent()
    OR (
      _current_user_role() = 'pompiste'
      AND tank_id IN (SELECT id FROM _my_tank_ids())
    )
    OR (
      _current_user_role() NOT IN ('pompiste', 'carburant')
      AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
          AND users.role IN ('admin','daf')
      )
    )
  );

-- ════════════════════════════════════════════════════════════════
-- fuel_enlevements
-- ════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "All authenticated can read enlevements" ON fuel_enlevements;
DROP POLICY IF EXISTS "pompiste view own enlevements" ON fuel_enlevements;

CREATE POLICY "pompiste view own enlevements"
  ON fuel_enlevements FOR SELECT
  TO authenticated
  USING (
    _is_carburant_agent()
    OR _current_user_role() NOT IN ('pompiste')
    OR tank_id IN (SELECT id FROM _my_tank_ids())
  );

DROP POLICY IF EXISTS "Pompiste and admin can insert enlevements" ON fuel_enlevements;
DROP POLICY IF EXISTS "pompiste insert own enlevements" ON fuel_enlevements;

CREATE POLICY "pompiste insert own enlevements"
  ON fuel_enlevements FOR INSERT
  TO authenticated
  WITH CHECK (
    _is_carburant_agent()
    OR (
      _current_user_role() = 'pompiste'
      AND tank_id IN (SELECT id FROM _my_tank_ids())
    )
    OR (
      _current_user_role() NOT IN ('pompiste', 'carburant')
      AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
          AND users.role IN ('admin','daf')
      )
    )
  );
