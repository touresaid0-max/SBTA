/*
# Integrate garage parts/tire exits into Gestionnaire & DAF charge reports

## Purpose
When a Gérant Principal records a parts/tire exit (garage_sorties_pieces),
it should automatically appear as a bus charge in:
- Gestionnaire Dashboard, Financial Report, Bus Performance, Bus Activity
- DAF Dashboard, Consolidated Report, Bus Performance, Financial Report

## Approach (same pattern as stock_gerant migration 20260610184857)
1. Add 'garage_pieces' to vehicle_expenses.source CHECK constraint.
2. Add garage_sortie_id UNIQUE column for dedup.
3. Trigger on garage_sorties_pieces AFTER INSERT/UPDATE/DELETE syncs vehicle_expenses.
4. RPC functions updated to SUM source='garage_pieces' as expense_garage_pieces.

## Note: Functions were pre-dropped via execute_sql to avoid return-type change errors.
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. Extend source CHECK + add dedup column
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE vehicle_expenses
  DROP CONSTRAINT IF EXISTS vehicle_expenses_source_check;

ALTER TABLE vehicle_expenses
  ADD CONSTRAINT vehicle_expenses_source_check
  CHECK (source IN ('charge_achat', 'comptable', 'stock_gerant', 'garage_pieces'));

ALTER TABLE vehicle_expenses
  ADD COLUMN IF NOT EXISTS garage_sortie_id uuid UNIQUE;

-- ═══════════════════════════════════════════════════════════════════
-- 2. Trigger function
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_garage_sortie_to_vehicle_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_registration text;
  v_company_id   uuid;
  v_vehicle_id   uuid;
  v_amount       numeric;
  v_piece_name   text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM vehicle_expenses WHERE garage_sortie_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.car_id IS NOT NULL THEN
    SELECT b.registration_number, b.company_id
      INTO v_registration, v_company_id
      FROM buses b WHERE b.id = NEW.car_id;
  END IF;

  v_company_id := COALESCE(v_company_id, NEW.groupe_id);
  IF v_company_id IS NULL THEN RETURN NEW; END IF;

  IF v_registration IS NOT NULL THEN
    SELECT fv.id INTO v_vehicle_id
      FROM fleet_vehicles fv WHERE fv.registration_number = v_registration LIMIT 1;
  END IF;

  v_amount := COALESCE(NEW.montant, NEW.quantite * NEW.prix_unitaire, 0);
  SELECT p.nom INTO v_piece_name FROM garage_pieces p WHERE p.id = NEW.piece_id;

  INSERT INTO vehicle_expenses (
    company_id, vehicle_id, registration_number,
    expense_date, week_start, description,
    amount, source, garage_sortie_id, created_at, updated_at
  ) VALUES (
    v_company_id, v_vehicle_id, COALESCE(v_registration, ''),
    NEW.date, date_trunc('week', NEW.date)::date,
    'Garage SBTA — ' || COALESCE(v_piece_name, 'Piece'),
    v_amount, 'garage_pieces', NEW.id, now(), now()
  )
  ON CONFLICT (garage_sortie_id) DO UPDATE
    SET company_id = EXCLUDED.company_id, vehicle_id = EXCLUDED.vehicle_id,
        registration_number = EXCLUDED.registration_number, expense_date = EXCLUDED.expense_date,
        week_start = EXCLUDED.week_start, description = EXCLUDED.description,
        amount = EXCLUDED.amount, updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_garage_sortie ON garage_sorties_pieces;
CREATE TRIGGER trg_sync_garage_sortie
  AFTER INSERT OR UPDATE OR DELETE ON garage_sorties_pieces
  FOR EACH ROW EXECUTE FUNCTION public.sync_garage_sortie_to_vehicle_expense();

-- ═══════════════════════════════════════════════════════════════════
-- 3. Backfill
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO vehicle_expenses (
  company_id, vehicle_id, registration_number,
  expense_date, week_start, description,
  amount, source, garage_sortie_id, created_at, updated_at
)
SELECT
  COALESCE(b.company_id, sp.groupe_id), fv.id, COALESCE(b.registration_number, ''),
  sp.date, date_trunc('week', sp.date)::date,
  'Garage SBTA — ' || COALESCE(p.nom, 'Piece'),
  COALESCE(sp.montant, sp.quantite * sp.prix_unitaire, 0),
  'garage_pieces', sp.id, now(), now()
FROM garage_sorties_pieces sp
LEFT JOIN buses b ON b.id = sp.car_id
LEFT JOIN fleet_vehicles fv ON fv.registration_number = b.registration_number
LEFT JOIN garage_pieces p ON p.id = sp.piece_id
WHERE COALESCE(b.company_id, sp.groupe_id) IS NOT NULL
ON CONFLICT (garage_sortie_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 4. get_gestionnaire_dashboard_kpis
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_gestionnaire_dashboard_kpis(
  p_date_from date, p_date_to date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_company_id uuid; v_result jsonb;
BEGIN
  v_company_id := get_gestionnaire_company_id();
  IF v_company_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT jsonb_build_object(
    'total_revenue', COALESCE(SUM(r.total_price), 0),
    'trip_count', COUNT(DISTINCT s.id),
    'active_bus_count', COUNT(DISTINCT s.bus_id),
    'driver_count', COUNT(DISTINCT s.driver_id),
    'cc_carburant_complement', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = v_company_id AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_ration', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = v_company_id AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_peage', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = v_company_id AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_enlevements_amount', COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.company_id = v_company_id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_reparation', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = v_company_id AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'vehicle_expenses_amount', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = v_company_id AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_carburant_comptable', COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.company_id = v_company_id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_autres', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = v_company_id AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_charge_stock', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = v_company_id AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = v_company_id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0)
  ) INTO v_result
  FROM schedules s JOIN buses b ON b.id = s.bus_id JOIN reservations r ON r.schedule_id = s.id
  WHERE b.company_id = v_company_id AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to AND r.status IN ('confirmee', 'utilisee');

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 5. get_gestionnaire_revenue_by_bus (was pre-dropped)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_gestionnaire_revenue_by_bus(
  p_date_from date, p_date_to date
) RETURNS TABLE(
  bus_id uuid, registration_number text, model text, trip_count bigint,
  revenue numeric, cc_carburant numeric, cc_ration numeric, cc_peage numeric,
  fuel_enlev numeric, expense_reparation numeric, expense_autres numeric,
  expense_charge_stock numeric, expense_garage_pieces numeric, vehicle_exp numeric,
  fuel_carburant_comptable numeric, total_expense numeric, margin numeric
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_company_id uuid;
BEGIN
  v_company_id := get_gestionnaire_company_id();
  IF v_company_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT b.id AS bus_id, b.registration_number, b.model,
      COUNT(DISTINCT s.id)::bigint AS trip_count, COALESCE(SUM(r.total_price), 0) AS revenue,
      COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_carburant,
      COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_ration,
      COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_peage,
      COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.bus_id = b.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_enlev,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_reparation,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_autres,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_charge_stock,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_garage_pieces,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS vehicle_exp,
      COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.bus_id = b.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_carburant_comptable
    FROM buses b
    JOIN schedules s ON s.bus_id = b.id AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee', 'utilisee')
    WHERE b.company_id = v_company_id
    GROUP BY b.id, b.registration_number, b.model
  )
  SELECT base.bus_id, base.registration_number, base.model, base.trip_count, base.revenue,
    base.cc_carburant, base.cc_ration, base.cc_peage, base.fuel_enlev,
    base.expense_reparation, base.expense_autres, base.expense_charge_stock,
    base.expense_garage_pieces, base.vehicle_exp, base.fuel_carburant_comptable,
    (base.cc_carburant + base.cc_ration + base.cc_peage + base.fuel_enlev + base.expense_reparation + base.expense_autres + base.expense_charge_stock + base.expense_garage_pieces + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
    (base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage - base.fuel_enlev - base.expense_reparation - base.expense_autres - base.expense_charge_stock - base.expense_garage_pieces - base.vehicle_exp - base.fuel_carburant_comptable) AS margin
  FROM base;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 6. get_daf_consolidated_kpis
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_consolidated_kpis(
  p_company_ids uuid[], p_date_from date, p_date_to date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT is_daf_user() THEN RETURN '{}'::jsonb; END IF;

  SELECT jsonb_build_object(
    'total_revenue', COALESCE(SUM(r.total_price), 0),
    'trip_count', COUNT(DISTINCT s.id),
    'active_bus_count', COUNT(DISTINCT s.bus_id),
    'driver_count', COUNT(DISTINCT s.driver_id),
    'cc_carburant_complement', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = ANY(p_company_ids) AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_ration', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = ANY(p_company_ids) AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_peage', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = ANY(p_company_ids) AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_enlevements_amount', COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.company_id = ANY(p_company_ids) AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_reparation', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'vehicle_expenses_amount', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_carburant_comptable', COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.company_id = ANY(p_company_ids) AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_autres', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_charge_stock', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids) AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0)
  ) INTO v_result
  FROM schedules s JOIN buses b ON b.id = s.bus_id JOIN reservations r ON r.schedule_id = s.id
  WHERE b.company_id = ANY(p_company_ids) AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to AND r.status IN ('confirmee', 'utilisee');

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 7. get_daf_revenue_by_bus (was pre-dropped)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_revenue_by_bus(
  p_company_ids uuid[], p_date_from date, p_date_to date
) RETURNS TABLE(
  bus_id uuid, registration_number text, model text, company_name text,
  trip_count bigint, revenue numeric, cc_carburant numeric, cc_ration numeric,
  cc_peage numeric, fuel_enlev numeric, expense_reparation numeric, expense_autres numeric,
  expense_charge_stock numeric, expense_garage_pieces numeric, vehicle_exp numeric,
  fuel_carburant_comptable numeric, total_expense numeric, margin numeric
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT b.id AS bus_id, b.registration_number, b.model, c.name AS company_name,
      COUNT(DISTINCT s.id)::bigint AS trip_count, COALESCE(SUM(r.total_price), 0) AS revenue,
      COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_carburant,
      COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_ration,
      COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc WHERE cc.bus_id = b.id AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0) AS cc_peage,
      COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.bus_id = b.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_enlev,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_reparation,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_autres,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_charge_stock,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_garage_pieces,
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS vehicle_exp,
      COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.bus_id = b.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_carburant_comptable
    FROM buses b
    JOIN companies c ON c.id = b.company_id
    JOIN schedules s ON s.bus_id = b.id AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee', 'utilisee')
    WHERE b.company_id = ANY(p_company_ids)
    GROUP BY b.id, b.registration_number, b.model, c.name
  )
  SELECT base.bus_id, base.registration_number, base.model, base.company_name,
    base.trip_count, base.revenue, base.cc_carburant, base.cc_ration, base.cc_peage,
    base.fuel_enlev, base.expense_reparation, base.expense_autres, base.expense_charge_stock,
    base.expense_garage_pieces, base.vehicle_exp, base.fuel_carburant_comptable,
    (base.cc_carburant + base.cc_ration + base.cc_peage + base.fuel_enlev + base.expense_reparation + base.expense_autres + base.expense_charge_stock + base.expense_garage_pieces + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
    (base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage - base.fuel_enlev - base.expense_reparation - base.expense_autres - base.expense_charge_stock - base.expense_garage_pieces - base.vehicle_exp - base.fuel_carburant_comptable) AS margin
  FROM base;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 8. get_daf_kpis_by_company (was pre-dropped)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_daf_kpis_by_company(
  p_company_ids uuid[], p_date_from date, p_date_to date
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT is_daf_user() THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'company_id', c.id, 'company_name', c.name,
    'total_revenue', COALESCE(SUM(r.total_price), 0),
    'trip_count', COUNT(DISTINCT s.id), 'active_bus_count', COUNT(DISTINCT s.bus_id),
    'cc_carburant_complement', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = c.id AND cc.charge_type = 'carburant_complement' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_ration', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = c.id AND cc.charge_type = 'ration' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'cc_peage', COALESCE((SELECT SUM(cc.amount) FROM counter_charges cc JOIN buses b2 ON b2.id = cc.bus_id WHERE b2.company_id = c.id AND cc.charge_type = 'peage' AND cc.charge_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_enlevements_amount', COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.company_id = c.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_reparation', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'comptable' AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %') AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'vehicle_expenses_amount', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'charge_achat' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'fuel_carburant_comptable', COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.company_id = c.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_autres', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_charge_stock', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'stock_gerant' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0),
    'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL WHERE COALESCE(fv_d.company_id, fv_r.company_id) = c.id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0)
  ) ORDER BY c.name), '[]'::jsonb) INTO v_result
  FROM companies c
  LEFT JOIN schedules s ON s.bus_id IN (SELECT b2.id FROM buses b2 WHERE b2.company_id = c.id) AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
  LEFT JOIN reservations r ON r.schedule_id = s.id AND r.status IN ('confirmee', 'utilisee')
  WHERE c.id = ANY(p_company_ids)
  GROUP BY c.id, c.name;

  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';
