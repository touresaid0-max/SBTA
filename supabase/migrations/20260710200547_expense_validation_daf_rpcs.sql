/*
# Update DAF RPCs to exclude pending expenses

## Overview
Adds `AND ve.validation_status = 'validee'` filter to all vehicle_expenses queries
in DAF RPC functions. This ensures expenses awaiting validation (from TST/ETL/SNT)
do not appear in DAF reports until validated.

## Modified Functions
1. get_daf_consolidated_kpis - filters all expense subqueries
2. get_daf_kpis_by_company - filters all expense subqueries per company
3. get_daf_revenue_by_bus - filters all expense subqueries per bus
*/

-- ───────────────────────────────────────────────────────────────────
-- 1. get_daf_consolidated_kpis
-- ───────────────────────────────────────────────────────────────────
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

-- ───────────────────────────────────────────────────────────────────
-- 2. get_daf_kpis_by_company
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_daf_kpis_by_company(uuid[], date, date);

CREATE FUNCTION public.get_daf_kpis_by_company(
  p_company_ids uuid[],
  p_date_from   date,
  p_date_to     date
)
RETURNS TABLE(
  company_id               uuid,
  company_name             text,
  company_code             text,
  parent_id                uuid,
  is_group                 boolean,
  revenue                  numeric,
  cc_carburant             numeric,
  cc_ration                numeric,
  cc_peage                 numeric,
  fuel_enlev               numeric,
  expense_reparation       numeric,
  expense_autres           numeric,
  vehicle_exp              numeric,
  fuel_carburant_comptable numeric,
  total_expense            numeric,
  margin                   numeric,
  trip_count               bigint,
  bus_count                bigint,
  driver_count             bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    co.id AS company_id,
    co.name AS company_name,
    co.code AS company_code,
    co.parent_id,
    COALESCE(co.is_group, false) AS is_group,
    COALESCE((
      SELECT SUM(r.total_price)
      FROM reservations r
      JOIN schedules s ON s.id = r.schedule_id
      JOIN buses b ON b.id = s.bus_id
      WHERE b.company_id = co.id
        AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
        AND r.status IN ('confirmee', 'utilisee')
    ), 0) AS revenue,
    COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b ON b.id = cc.bus_id
      WHERE b.company_id = co.id
        AND cc.charge_type = 'carburant_complement'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0) AS cc_carburant,
    COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b ON b.id = cc.bus_id
      WHERE b.company_id = co.id
        AND cc.charge_type = 'ration'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0) AS cc_ration,
    COALESCE((
      SELECT SUM(cc.amount) FROM counter_charges cc
      JOIN buses b ON b.id = cc.bus_id
      WHERE b.company_id = co.id
        AND cc.charge_type = 'peage'
        AND cc.charge_date BETWEEN p_date_from AND p_date_to
    ), 0) AS cc_peage,
    COALESCE((
      SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.company_id = co.id
        AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
    ), 0) AS fuel_enlev,
    COALESCE((
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
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
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
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
      SELECT SUM(ve.amount)
      FROM vehicle_expenses ve
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
    COALESCE((
      SELECT COUNT(DISTINCT s.id)
      FROM schedules s JOIN buses b ON b.id = s.bus_id
      WHERE b.company_id = co.id
        AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    ), 0)::bigint AS trip_count,
    COALESCE((
      SELECT COUNT(DISTINCT s.bus_id)
      FROM schedules s JOIN buses b ON b.id = s.bus_id
      WHERE b.company_id = co.id
        AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    ), 0)::bigint AS bus_count,
    COALESCE((
      SELECT COUNT(DISTINCT s.driver_id)
      FROM schedules s JOIN buses b ON b.id = s.bus_id
      WHERE b.company_id = co.id
        AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
        AND s.driver_id IS NOT NULL
    ), 0)::bigint AS driver_count
  FROM companies co
  WHERE co.id = ANY(p_company_ids)
    AND COALESCE(co.is_active, true) = true
  ORDER BY co.name;
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- 3. get_daf_revenue_by_bus
-- ───────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_daf_revenue_by_bus(uuid[], date, date);

CREATE FUNCTION public.get_daf_revenue_by_bus(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(
  bus_id uuid, registration_number text, model text,
  company_name text, trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric,
  fuel_enlev numeric, expense_reparation numeric, expense_autres numeric,
  expense_charge_stock numeric, vehicle_exp numeric,
  fuel_carburant_comptable numeric, total_expense numeric, margin numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_daf_user() THEN RETURN; END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      b.id AS bus_id,
      b.registration_number,
      b.model,
      c.name AS company_name,
      COUNT(DISTINCT s.id)::bigint AS trip_count,
      COALESCE(SUM(r.total_price), 0) + COALESCE((
        SELECT SUM(mb.unit_price * mb.seats_count)
        FROM mobile_bookings mb
        JOIN schedules s2 ON s2.id = mb.schedule_id
        WHERE s2.bus_id = b.id
          AND mb.status = 'confirmed'
          AND s2.departure_datetime::date BETWEEN p_date_from AND p_date_to
      ), 0) AS revenue,
      COALESCE((
        SELECT SUM(cc.amount) FROM counter_charges cc
        WHERE cc.bus_id = b.id AND cc.charge_type = 'carburant_complement'
          AND cc.charge_date BETWEEN p_date_from AND p_date_to
      ), 0) AS cc_carburant,
      COALESCE((
        SELECT SUM(cc.amount) FROM counter_charges cc
        WHERE cc.bus_id = b.id AND cc.charge_type = 'ration'
          AND cc.charge_date BETWEEN p_date_from AND p_date_to
      ), 0) AS cc_ration,
      COALESCE((
        SELECT SUM(cc.amount) FROM counter_charges cc
        WHERE cc.bus_id = b.id AND cc.charge_type = 'peage'
          AND cc.charge_date BETWEEN p_date_from AND p_date_to
      ), 0) AS cc_peage,
      COALESCE((
        SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
        WHERE fe.bus_id = b.id
          AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
      ), 0) AS fuel_enlev,
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
          AND ve.source = 'comptable'
          AND ve.description LIKE 'Sortie stock — %'
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
          AND ve.source = 'charge_achat'
          AND ve.expense_date BETWEEN p_date_from AND p_date_to
          AND ve.validation_status = 'validee'
      ), 0) AS vehicle_exp,
      COALESCE((
        SELECT SUM(cfw.total_amount)
        FROM comptable_fuel_withdrawals cfw
        WHERE cfw.bus_id = b.id
          AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to
      ), 0) AS fuel_carburant_comptable
    FROM buses b
    JOIN companies c ON c.id = b.company_id
    JOIN schedules s ON s.bus_id = b.id
      AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
    LEFT JOIN reservations r ON r.schedule_id = s.id
      AND r.status IN ('confirmee', 'utilisee')
    WHERE b.company_id = ANY(p_company_ids)
    GROUP BY b.id, b.registration_number, b.model, c.name
  )
  SELECT
    base.bus_id,
    base.registration_number,
    base.model,
    base.company_name,
    base.trip_count,
    base.revenue,
    base.cc_carburant,
    base.cc_ration,
    base.cc_peage,
    base.fuel_enlev,
    base.expense_reparation,
    base.expense_autres,
    base.expense_charge_stock,
    base.vehicle_exp,
    base.fuel_carburant_comptable,
    (base.cc_carburant + base.cc_ration + base.cc_peage
      + base.fuel_enlev + base.expense_reparation + base.expense_autres
      + base.expense_charge_stock + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
    (base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage
      - base.fuel_enlev - base.expense_reparation - base.expense_autres
      - base.expense_charge_stock - base.vehicle_exp - base.fuel_carburant_comptable) AS margin
  FROM base;
END;
$$;
