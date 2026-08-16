/*
# Fix garage pieces charge attribution to correct company

## Problem
Bus "9999 LK 01" has two fleet_vehicles entries (one for SBTA company 11111111,
one for TST company 22222222). The trigger used `LIMIT 1` which picked the TST
fleet_vehicle. The RPCs filter by `fleet_vehicles.company_id`, so the 540,000 +
30,000 + 15,000 + 20,000 = 605,000 F CFA SBTA charges were attributed to TST
or dropped, leaving only 40,000 visible for SBTA.

## Fix
1. Fix the trigger to pick the fleet_vehicle matching the bus's company_id.
2. Fix the 4 existing vehicle_expenses rows with wrong vehicle_id.
3. Update all garage_pieces RPC subqueries to use `ve.company_id` directly
   instead of joining through fleet_vehicles — the trigger always sets
   company_id correctly from the bus, so this is more robust.
4. No changes to other expense sources (comptable, charge_achat, stock_gerant)
   — they keep their existing fleet_vehicles join pattern.
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. Fix the trigger to match fleet_vehicle by company_id
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

  -- Pick the fleet_vehicle matching BOTH registration AND company_id
  IF v_registration IS NOT NULL THEN
    SELECT fv.id INTO v_vehicle_id
      FROM fleet_vehicles fv
      WHERE fv.registration_number = v_registration
        AND fv.company_id = v_company_id
      LIMIT 1;
  END IF;
  -- Fallback: any matching registration if no company match
  IF v_vehicle_id IS NULL AND v_registration IS NOT NULL THEN
    SELECT fv.id INTO v_vehicle_id
      FROM fleet_vehicles fv
      WHERE fv.registration_number = v_registration
      LIMIT 1;
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

-- ═══════════════════════════════════════════════════════════════════
-- 2. Fix existing rows with wrong vehicle_id
-- ═══════════════════════════════════════════════════════════════════

UPDATE vehicle_expenses ve
  SET vehicle_id = fv_correct.id
  FROM fleet_vehicles fv_correct
  WHERE ve.source = 'garage_pieces'
    AND ve.vehicle_id <> fv_correct.id
    AND fv_correct.registration_number = ve.registration_number
    AND fv_correct.company_id = ve.company_id
    AND EXISTS (
      SELECT 1 FROM fleet_vehicles fv_wrong
      WHERE fv_wrong.id = ve.vehicle_id
        AND fv_wrong.company_id <> ve.company_id
    );

-- ═══════════════════════════════════════════════════════════════════
-- 3. Update get_gestionnaire_dashboard_kpis — use ve.company_id directly
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
    'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.company_id = v_company_id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0)
  ) INTO v_result
  FROM schedules s JOIN buses b ON b.id = s.bus_id JOIN reservations r ON r.schedule_id = s.id
  WHERE b.company_id = v_company_id AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to AND r.status IN ('confirmee', 'utilisee');

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Update get_gestionnaire_revenue_by_bus — garage_pieces uses ve.company_id
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_gestionnaire_revenue_by_bus(date, date);

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
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.registration_number = b.registration_number AND ve.company_id = v_company_id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_garage_pieces,
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
-- 5. Update get_daf_consolidated_kpis — garage_pieces uses ve.company_id
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
    'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.company_id = ANY(p_company_ids) AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0)
  ) INTO v_result
  FROM schedules s JOIN buses b ON b.id = s.bus_id JOIN reservations r ON r.schedule_id = s.id
  WHERE b.company_id = ANY(p_company_ids) AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to AND r.status IN ('confirmee', 'utilisee');

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 6. Update get_daf_revenue_by_bus — garage_pieces uses ve.company_id
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_daf_revenue_by_bus(uuid[], date, date);

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
      COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.registration_number = b.registration_number AND ve.company_id = b.company_id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0) AS expense_garage_pieces,
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
-- 7. Update get_daf_kpis_by_company — garage_pieces uses ve.company_id
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
    'expense_garage_pieces', COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve WHERE ve.company_id = c.id AND ve.source = 'garage_pieces' AND ve.expense_date BETWEEN p_date_from AND p_date_to), 0)
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
