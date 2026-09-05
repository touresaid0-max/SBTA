-- Drop functions whose return types are changing
DROP FUNCTION IF EXISTS public.get_daf_kpis_by_company(uuid[], date, date);
DROP FUNCTION IF EXISTS public.get_daf_revenue_by_bus(uuid[], date, date);

-- ── 1. get_daf_consolidated_kpis: add expense_garage_pieces + company_count ──
CREATE OR REPLACE FUNCTION public.get_daf_consolidated_kpis(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_daf_user() THEN RETURN '{}'::jsonb; END IF;

  SELECT jsonb_build_object(
    'total_revenue', COALESCE(SUM(r.total_price), 0) + COALESCE((
      SELECT SUM(mb.unit_price * mb.seats_count)
      FROM mobile_bookings mb
      JOIN schedules s2 ON s2.id = mb.schedule_id
      JOIN buses b2 ON b2.id = s2.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND mb.status = 'confirmed'
        AND s2.departure_datetime::date BETWEEN p_date_from AND p_date_to
    ), 0),
    'trip_count',              COUNT(DISTINCT s.id),
    'active_bus_count',        COUNT(DISTINCT s.bus_id),
    'driver_count',            COUNT(DISTINCT s.driver_id),
    'company_count',           COUNT(DISTINCT b.company_id),
    'cc_carburant_complement', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND cc.charge_type = 'carburant_complement'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_ration', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND cc.charge_type = 'ration'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_peage', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND cc.charge_type = 'peage'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'cc_autres', COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b2 ON b2.id = cc.bus_id
      WHERE b2.company_id = ANY(p_company_ids)
        AND cc.charge_type = 'autres'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'fuel_enlevements_amount', COALESCE((
      SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.company_id = ANY(p_company_ids)
        AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'expense_reparation', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'comptable'
        AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0),
    'vehicle_expenses_amount', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'charge_achat'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0),
    'fuel_carburant_comptable', COALESCE((
      SELECT SUM(cfw.total_amount)
      FROM comptable_fuel_withdrawals cfw
      WHERE cfw.company_id = ANY(p_company_ids)
        AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'expense_autres', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'comptable'
        AND ve.description LIKE 'Sortie stock — %'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0),
    'expense_charge_stock', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'stock_gerant'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0),
    'expense_garage_pieces', COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
        AND ve.source = 'garage_pieces'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0)
  )
  INTO v_result
  FROM schedules s
  JOIN buses b ON b.id = s.bus_id
  JOIN reservations r ON r.schedule_id = s.id
  WHERE b.company_id = ANY(p_company_ids)
    AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    AND r.status IN ('confirmee', 'utilisee');

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daf_consolidated_kpis(uuid[], date, date) TO authenticated;


-- ── 2. get_daf_kpis_by_company: add expense_charge_stock + expense_garage_pieces ──
CREATE OR REPLACE FUNCTION public.get_daf_kpis_by_company(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(
  company_id uuid, company_name text, company_code text, parent_id uuid, is_group boolean,
  revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric,
  expense_reparation numeric, expense_autres numeric,
  expense_charge_stock numeric, expense_garage_pieces numeric,
  vehicle_exp numeric, fuel_carburant_comptable numeric,
  total_expense numeric, margin numeric,
  trip_count bigint, bus_count bigint, driver_count bigint,
  breakdown_received numeric, breakdown_transferred numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  WITH scr AS (
    SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = ANY(p_company_ids)
  ),
  scc AS (
    SELECT * FROM schedule_company_charges(p_date_from, p_date_to)
    WHERE company_id = ANY(p_company_ids)
  ),
  agg AS (
    SELECT scr.company_id,
      COALESCE(SUM(scr.revenue), 0)            AS revenue,
      COUNT(DISTINCT scr.schedule_id)::bigint  AS trip_count,
      COUNT(DISTINCT scr.bus_id)::bigint       AS bus_count,
      COUNT(DISTINCT scr.driver_id)
        FILTER (WHERE scr.driver_id IS NOT NULL)::bigint AS driver_count,
      COALESCE(SUM(CASE WHEN scr.is_beneficiary THEN scr.revenue ELSE 0 END), 0) AS breakdown_received,
      COALESCE(SUM(CASE WHEN NOT scr.is_beneficiary THEN scr.transferred_amount ELSE 0 END), 0) AS breakdown_transferred
    FROM scr
    GROUP BY scr.company_id
  ),
  cc_agg AS (
    SELECT scc.company_id,
      COALESCE(SUM(scc.cc_carburant), 0) AS cc_carburant,
      COALESCE(SUM(scc.cc_ration), 0)    AS cc_ration,
      COALESCE(SUM(scc.cc_peage), 0)     AS cc_peage,
      COALESCE(SUM(scc.cc_autres), 0)    AS cc_autres
    FROM scc
    GROUP BY scc.company_id
  )
  SELECT
    co.id, co.name, co.code, co.parent_id, COALESCE(co.is_group, false),
    COALESCE(agg.revenue, 0) AS revenue,
    COALESCE(cca.cc_carburant, 0) AS cc_carburant,
    COALESCE(cca.cc_ration, 0)    AS cc_ration,
    COALESCE(cca.cc_peage, 0)     AS cc_peage,
    COALESCE(cca.cc_autres, 0)    AS cc_autres,
    COALESCE((
      SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.company_id = co.id
        AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
    ), 0) AS fuel_enlev,
    COALESCE((
      SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
        AND ve.source = 'comptable'
        AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0) AS expense_reparation,
    COALESCE((
      SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
        AND ve.source = 'comptable'
        AND ve.description LIKE 'Sortie stock — %'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0) AS expense_autres,
    COALESCE((
      SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
        AND ve.source = 'stock_gerant'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0) AS expense_charge_stock,
    COALESCE((
      SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
        AND ve.source = 'garage_pieces'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0) AS expense_garage_pieces,
    COALESCE((
      SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number
        AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
        AND ve.source = 'charge_achat'
        AND ve.expense_date BETWEEN p_date_from AND p_date_to
        AND ve.validation_status = 'validee'
    ), 0) AS vehicle_exp,
    COALESCE((
      SELECT SUM(cfw.total_amount)
      FROM comptable_fuel_withdrawals cfw
      WHERE cfw.company_id = co.id
        AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
    ), 0) AS fuel_carburant_comptable,
    0::numeric AS total_expense,
    0::numeric AS margin,
    COALESCE(agg.trip_count, 0)::bigint,
    COALESCE(agg.bus_count, 0)::bigint,
    COALESCE(agg.driver_count, 0)::bigint,
    COALESCE(agg.breakdown_received, 0),
    COALESCE(agg.breakdown_transferred, 0)
  FROM companies co
  LEFT JOIN agg ON agg.company_id = co.id
  LEFT JOIN cc_agg cca ON cca.company_id = co.id
  WHERE co.id = ANY(p_company_ids)
    AND COALESCE(co.is_active, true) = true
  ORDER BY co.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daf_kpis_by_company(uuid[], date, date) TO authenticated;


-- ── 3. get_daf_revenue_by_bus: add expense_garage_pieces ──
CREATE OR REPLACE FUNCTION public.get_daf_revenue_by_bus(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(
  bus_id uuid, registration_number text, model text,
  company_id uuid, company_name text,
  trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric,
  expense_reparation numeric, expense_autres numeric,
  expense_charge_stock numeric, expense_garage_pieces numeric,
  vehicle_exp numeric, fuel_carburant_comptable numeric,
  total_expense numeric, margin numeric,
  breakdown_received numeric, breakdown_transferred numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  WITH scr AS (
    SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
    WHERE company_id = ANY(p_company_ids)
  ),
  scc AS (
    SELECT * FROM schedule_company_charges(p_date_from, p_date_to)
    WHERE company_id = ANY(p_company_ids)
  ),
  agg AS (
    SELECT scr.bus_id, scr.company_id,
      COUNT(DISTINCT scr.schedule_id)::bigint AS trip_count,
      COALESCE(SUM(scr.revenue), 0)           AS revenue,
      COALESCE(SUM(CASE WHEN scr.is_beneficiary THEN scr.revenue ELSE 0 END), 0)
        AS breakdown_received,
      COALESCE(SUM(CASE WHEN NOT scr.is_beneficiary THEN scr.transferred_amount ELSE 0 END), 0)
        AS breakdown_transferred
    FROM scr
    GROUP BY scr.bus_id, scr.company_id
  ),
  cc_agg AS (
    SELECT scc.bus_id, scc.company_id,
      COALESCE(SUM(scc.cc_carburant), 0) AS cc_carburant,
      COALESCE(SUM(scc.cc_ration), 0)    AS cc_ration,
      COALESCE(SUM(scc.cc_peage), 0)     AS cc_peage,
      COALESCE(SUM(scc.cc_autres), 0)    AS cc_autres
    FROM scc
    GROUP BY scc.bus_id, scc.company_id
  ),
  base AS (
    SELECT
      b.id AS bus_id, b.registration_number, b.model,
      a.company_id, co.name AS company_name,
      a.trip_count, a.revenue, a.breakdown_received, a.breakdown_transferred,
      COALESCE(cca.cc_carburant, 0) AS cc_carburant,
      COALESCE(cca.cc_ration, 0)    AS cc_ration,
      COALESCE(cca.cc_peage, 0)     AS cc_peage,
      COALESCE(cca.cc_autres, 0)    AS cc_autres,
      COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe WHERE fe.bus_id = b.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_enlev,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'comptable'
          AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_reparation,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'comptable' AND ve.description LIKE 'Sortie stock — %'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_autres,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'stock_gerant'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_charge_stock,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'garage_pieces'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS expense_garage_pieces,
      COALESCE((
        SELECT SUM(ve.amount) FROM vehicle_expenses ve
        LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
        LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
        WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
          AND ve.source = 'charge_achat'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS vehicle_exp,
      COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw WHERE cfw.bus_id = b.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_carburant_comptable
    FROM buses b
    JOIN agg a ON a.bus_id = b.id
    JOIN companies co ON co.id = a.company_id
    LEFT JOIN cc_agg cca ON cca.bus_id = b.id AND cca.company_id = a.company_id
  )
  SELECT base.bus_id, base.registration_number, base.model,
    base.company_id, base.company_name, base.trip_count, base.revenue,
    base.cc_carburant, base.cc_ration, base.cc_peage, base.cc_autres,
    base.fuel_enlev,
    base.expense_reparation, base.expense_autres, base.expense_charge_stock, base.expense_garage_pieces,
    base.vehicle_exp, base.fuel_carburant_comptable,
    (base.cc_carburant + base.cc_ration + base.cc_peage + base.cc_autres
      + base.fuel_enlev + base.expense_reparation + base.expense_autres
      + base.expense_charge_stock + base.expense_garage_pieces + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
    (base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage - base.cc_autres
      - base.fuel_enlev - base.expense_reparation - base.expense_autres
      - base.expense_charge_stock - base.expense_garage_pieces - base.vehicle_exp - base.fuel_carburant_comptable) AS margin,
    base.breakdown_received, base.breakdown_transferred
  FROM base
  ORDER BY base.revenue DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daf_revenue_by_bus(uuid[], date, date) TO authenticated;