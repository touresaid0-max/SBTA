/*
# Suivi automatique des réparations déclenché par les sorties de pièces

1. Purpose
   When a part exit (garage_sorties_pieces) is created, automatically create or
   attach a repair record (garage_reparations) for the same bus. Track status
   changes in a history table, notify the responsable logistique, and expose a
   single source of truth for available buses (cars_disponibles view).

2. Changes to garage_reparations
   - Add columns: technicien_id, updated_at, bus_id (→ buses),
     source_sortie_id (link to the triggering sortie).
   - Extend statut CHECK to BROUILLON | EN RÉPARATION | LIBÉRÉ.
   - Migrate old 'en cours'/'terminée' values.

3. New tables
   - garage_historique_statuts: traces every status change.
   - garage_reparation_notifications: notifications to responsable logistique.

4. New view
   - cars_disponibles: buses with NO active EN RÉPARATION repair.

5. Triggers
   - trg_auto_create_reparation: AFTER INSERT on garage_sorties_pieces.
   - trg_log_reparation_status: AFTER UPDATE of statut on garage_reparations.

6. RLS on all new tables.

7. Realtime on notifications + reparations.
*/

-- ===========================================================================
-- 1. Extend garage_reparations
-- ===========================================================================
ALTER TABLE public.garage_reparations
  ADD COLUMN IF NOT EXISTS technicien_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS bus_id uuid REFERENCES public.buses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_sortie_id uuid REFERENCES public.garage_sorties_pieces(id) ON DELETE SET NULL;

-- Migrate old statut values
UPDATE public.garage_reparations SET statut = 'EN RÉPARATION' WHERE statut = 'en cours';
UPDATE public.garage_reparations SET statut = 'LIBÉRÉ' WHERE statut = 'terminée';

-- Replace CHECK constraint
ALTER TABLE public.garage_reparations DROP CONSTRAINT IF EXISTS garage_reparations_statut_check;
ALTER TABLE public.garage_reparations
  ADD CONSTRAINT garage_reparations_statut_check
  CHECK (statut IN ('BROUILLON', 'EN RÉPARATION', 'LIBÉRÉ'));

ALTER TABLE public.garage_reparations ALTER COLUMN statut SET DEFAULT 'BROUILLON';

-- ===========================================================================
-- 2. garage_historique_statuts
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.garage_historique_statuts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparation_id   uuid NOT NULL REFERENCES public.garage_reparations(id) ON DELETE CASCADE,
  ancien_statut   text,
  nouveau_statut  text NOT NULL,
  change_par      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  date_changement timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garage_historique_reparation
  ON public.garage_historique_statuts(reparation_id);

ALTER TABLE public.garage_historique_statuts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_historique_statuts" ON public.garage_historique_statuts;
CREATE POLICY "select_historique_statuts"
  ON public.garage_historique_statuts FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_historique_statuts" ON public.garage_historique_statuts;
CREATE POLICY "insert_historique_statuts"
  ON public.garage_historique_statuts FOR INSERT
  TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' IS NOT NULL);

-- ===========================================================================
-- 3. garage_reparation_notifications
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.garage_reparation_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparation_id   uuid NOT NULL REFERENCES public.garage_reparations(id) ON DELETE CASCADE,
  destinataire_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message         text NOT NULL,
  lu              boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garage_reparation_notif_destinataire
  ON public.garage_reparation_notifications(destinataire_id, created_at DESC);

ALTER TABLE public.garage_reparation_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_reparation_notifications" ON public.garage_reparation_notifications;
CREATE POLICY "select_own_reparation_notifications"
  ON public.garage_reparation_notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = destinataire_id);

DROP POLICY IF EXISTS "insert_reparation_notifications" ON public.garage_reparation_notifications;
CREATE POLICY "insert_reparation_notifications"
  ON public.garage_reparation_notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' IS NOT NULL);

DROP POLICY IF EXISTS "update_own_reparation_notifications" ON public.garage_reparation_notifications;
CREATE POLICY "update_own_reparation_notifications"
  ON public.garage_reparation_notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = destinataire_id)
  WITH CHECK (auth.uid() = destinataire_id);

-- ===========================================================================
-- 4. View: cars_disponibles
-- ===========================================================================
CREATE OR REPLACE VIEW public.cars_disponibles AS
SELECT b.id, b.registration_number, b.company_id, b.brand, b.model, b.total_seats
FROM public.buses b
WHERE b.id NOT IN (
  SELECT r.bus_id
  FROM public.garage_reparations r
  WHERE r.bus_id IS NOT NULL
    AND r.statut = 'EN RÉPARATION'
)
ORDER BY b.registration_number;

-- ===========================================================================
-- 5. Trigger: auto-create repair on part exit
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.auto_create_reparation_from_sortie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus_id uuid;
  v_existing_reparation_id uuid;
  v_reparation_id uuid;
BEGIN
  -- Try to resolve bus_id directly (car_id might be a bus id)
  SELECT id INTO v_bus_id FROM public.buses WHERE id = NEW.car_id LIMIT 1;

  -- Fallback: match by registration_number via garage_cars
  IF v_bus_id IS NULL THEN
    SELECT b.id INTO v_bus_id
    FROM public.buses b
    JOIN public.garage_cars gc ON gc.immatriculation = b.registration_number
    WHERE gc.id = NEW.car_id
    LIMIT 1;
  END IF;

  IF v_bus_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check for an active repair (statut != LIBÉRÉ)
  SELECT id INTO v_existing_reparation_id
  FROM public.garage_reparations
  WHERE bus_id = v_bus_id AND statut != 'LIBÉRÉ'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_reparation_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Create a new BROUILLON repair
  INSERT INTO public.garage_reparations (bus_id, car_id, date, statut, description, source_sortie_id)
  VALUES (v_bus_id, NEW.car_id, NEW.date, 'BROUILLON', 'Créée automatiquement depuis sortie de pièces', NEW.id)
  RETURNING id INTO v_reparation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_reparation ON public.garage_sorties_pieces;
CREATE TRIGGER trg_auto_create_reparation
  AFTER INSERT ON public.garage_sorties_pieces
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_reparation_from_sortie();

-- ===========================================================================
-- 6. Trigger: log status change + notify responsable logistique
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.log_reparation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus_reg text;
  v_destinataire record;
BEGIN
  IF OLD.statut IS DISTINCT FROM NEW.statut THEN
    -- Log the status change
    INSERT INTO public.garage_historique_statuts (reparation_id, ancien_statut, nouveau_statut, change_par, date_changement)
    VALUES (NEW.id, OLD.statut, NEW.statut, nullif(current_setting('app.current_user_id', true), '')::uuid, now());

    -- Get bus registration
    SELECT b.registration_number INTO v_bus_reg
    FROM public.buses b WHERE b.id = NEW.bus_id LIMIT 1;

    IF v_bus_reg IS NULL THEN
      SELECT gc.immatriculation INTO v_bus_reg
      FROM public.garage_cars gc WHERE gc.id = NEW.car_id LIMIT 1;
    END IF;

    IF v_bus_reg IS NULL THEN v_bus_reg := 'N/A'; END IF;

    -- Notify all responsable logistique users
    FOR v_destinataire IN
      SELECT id FROM public.users WHERE role = 'responsable_logistique' AND status = 'active'
    LOOP
      INSERT INTO public.garage_reparation_notifications (reparation_id, destinataire_id, message)
      VALUES (NEW.id, v_destinataire.id, 'Car ' || v_bus_reg || ' — statut: ' || OLD.statut || ' → ' || NEW.statut);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_reparation_status ON public.garage_reparations;
CREATE TRIGGER trg_log_reparation_status
  AFTER UPDATE OF statut ON public.garage_reparations
  FOR EACH ROW
  EXECUTE FUNCTION public.log_reparation_status_change();

-- ===========================================================================
-- 7. Realtime
-- ===========================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.garage_reparation_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.garage_reparations;
