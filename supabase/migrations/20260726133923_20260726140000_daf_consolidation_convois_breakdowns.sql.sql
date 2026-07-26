/*
# DAF — consolidation des recettes et charges (convois + répartitions de panne)

## Problème
Les 4 RPCs DAF utilisaient des calculs propres (reservations + mobile_bookings
pour les recettes, counter_charges pour les charges) qui ignoraient :
  - les recettes de convois
  - les recettes de répartition de panne (breakdown redistribution)
  - les charges de convois (ratio, carburant, péage, autres)
  - les charges de répartition de panne

## Correction
Utiliser les helpers schedule_company_revenue et schedule_company_charges qui
gèrent déjà tous ces cas. Les charges hors-schedule (fuel_enlevements,
vehicle_expenses, comptable_fuel) restent en sous-requêtes (inchangées).

## RPCs modifiés
  1. get_daf_consolidated_kpis  (CREATE OR REPLACE — jsonb, pas de changement de signature)
  2. get_daf_daily_series       (CREATE OR REPLACE — pas de changement de signature)
  3. get_daf_kpis_by_company    (DROP + CREATE — ajout colonnes)
  4. get_daf_revenue_by_bus     (DROP + CREATE — ajout cc_autres)
*/

-- ═══════════════════════════════════════════════════════════════════
-- 1. get_daf_consolidated_kpis
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_daf_consolidated_kpis(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
IF NOT is_daf_user() THEN RETURN '{}'::jsonb; END IF;

WITH scr AS (
  SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
  WHERE company_id = ANY(p_company_ids)
)
SELECT jsonb_build_object(
  'total_revenue',           COALESCE(SUM(scr.revenue), 0),
  'trip_count',              COUNT(DISTINCT scr.schedule_id),
  'active_bus_count',        COUNT(DISTINCT scr.bus_id),
  'driver_count',            COUNT(DISTINCT scr.driver_id),
  'company_count',           COUNT(DISTINCT scr.company_id),

  -- cc_* from schedule_company_charges (counter_charges + convoi + breakdown)
  'cc_carburant_complement', COALESCE((SELECT SUM(cc_carburant) FROM schedule_company_charges(p_date_from, p_date_to) WHERE company_id = ANY(p_company_ids)), 0),
  'cc_ration',               COALESCE((SELECT SUM(cc_ration)     FROM schedule_company_charges(p_date_from, p_date_to) WHERE company_id = ANY(p_company_ids)), 0),
  'cc_peage',                COALESCE((SELECT SUM(cc_peage)      FROM schedule_company_charges(p_date_from, p_date_to) WHERE company_id = ANY(p_company_ids)), 0),
  'cc_autres',               COALESCE((SELECT SUM(cc_autres)     FROM schedule_company_charges(p_date_from, p_date_to) WHERE company_id = ANY(p_company_ids)), 0),

  -- charges hors-schedule (inchangées)
  'fuel_enlevements_amount', COALESCE((
    SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
    WHERE fe.company_id = ANY(p_company_ids)
    AND fe.enlevement_date BETWEEN p_date_from AND p_date_to
  ), 0),

  'expense_reparation', COALESCE((
    SELECT SUM(ve.amount)
    FROM vehicle_expenses ve
    LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
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
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
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
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
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
    LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
    WHERE COALESCE(fv_d.company_id, fv_r.company_id) = ANY(p_company_ids)
    AND ve.source = 'stock_gerant'
    AND ve.expense_date BETWEEN p_date_from AND p_date_to
    AND ve.validation_status = 'validee'
  ), 0)
)
INTO v_result
FROM scr;

RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 2. get_daf_daily_series — expenses incluent maintenant convoi + breakdown
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_daf_daily_series(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(day date, revenue numeric, expenses numeric, trip_count bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
IF NOT is_daf_user() THEN RETURN; END IF;

RETURN QUERY
WITH days AS (
  SELECT generate_series(p_date_from, p_date_to, '1 day'::interval)::date AS d
),
scr AS (
  SELECT * FROM schedule_company_revenue(p_date_from, p_date_to)
  WHERE company_id = ANY(p_company_ids)
),
rev AS (
  SELECT scr.schedule_date AS d,
    SUM(scr.revenue) AS rev,
    COUNT(DISTINCT scr.schedule_id)::bigint AS cnt
  FROM scr GROUP BY scr.schedule_date
),
-- schedule_company_charges : counter_charges + convoi + breakdown charges
scc AS (
  SELECT * FROM schedule_company_charges(p_date_from, p_date_to)
  WHERE company_id = ANY(p_company_ids)
),
exp AS (
  SELECT s.departure_datetime::date AS d, SUM(scc2.cc_total) AS exp
  FROM scc scc2
  JOIN schedules s ON s.id = scc2.schedule_id
  GROUP BY s.departure_datetime::date
)
SELECT
  days.d AS day,
  COALESCE(rev.rev, 0) AS revenue,
  COALESCE(exp.exp, 0) AS expenses,
  COALESCE(rev.cnt, 0) AS trip_count
FROM days
LEFT JOIN rev ON rev.d = days.d
LEFT JOIN exp ON exp.d = days.d
WHERE COALESCE(rev.rev, 0) > 0 OR COALESCE(exp.exp, 0) > 0
ORDER BY days.d;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 3. get_daf_kpis_by_company — ajout colonnes + helpers revenue/charges
-- ═══════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS get_daf_kpis_by_company(uuid[], date, date);

CREATE FUNCTION get_daf_kpis_by_company(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(
  company_id uuid, company_name text, company_code text, parent_id uuid, is_group boolean,
  revenue numeric, breakdown_received numeric, breakdown_transferred numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric, expense_reparation numeric, expense_autres numeric, expense_charge_stock numeric,
  vehicle_exp numeric, fuel_carburant_comptable numeric,
  total_expense numeric, margin numeric,
  trip_count bigint, bus_count bigint, driver_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
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
rev_by_co AS (
  SELECT company_id,
    COALESCE(SUM(revenue), 0) AS revenue,
    COALESCE(SUM(transferred_amount) FILTER (WHERE is_beneficiary), 0) AS breakdown_received,
    COALESCE(SUM(transferred_amount) FILTER (WHERE NOT is_beneficiary AND breakdown_id IS NOT NULL), 0) AS breakdown_transferred,
    COUNT(DISTINCT schedule_id)::bigint AS trip_count,
    COUNT(DISTINCT bus_id)::bigint AS bus_count,
    COUNT(DISTINCT driver_id)::bigint AS driver_count
  FROM scr GROUP BY company_id
),
chg_by_co AS (
  SELECT company_id,
    COALESCE(SUM(cc_carburant), 0) AS cc_carburant,
    COALESCE(SUM(cc_ration), 0)    AS cc_ration,
    COALESCE(SUM(cc_peage), 0)     AS cc_peage,
    COALESCE(SUM(cc_autres), 0)    AS cc_autres
  FROM scc GROUP BY company_id
),
base AS (
  SELECT
    co.id AS company_id,
    co.name AS company_name,
    co.code AS company_code,
    co.parent_id,
    COALESCE(co.is_group, false) AS is_group,
    COALESCE(rvc.revenue, 0) AS revenue,
    COALESCE(rvc.breakdown_received, 0) AS breakdown_received,
    COALESCE(rvc.breakdown_transferred, 0) AS breakdown_transferred,
    COALESCE(cgc.cc_carburant, 0) AS cc_carburant,
    COALESCE(cgc.cc_ration, 0)    AS cc_ration,
    COALESCE(cgc.cc_peage, 0)     AS cc_peage,
    COALESCE(cgc.cc_autres, 0)    AS cc_autres,
    COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.company_id = co.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_enlev,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
      AND ve.source = 'comptable'
      AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS expense_reparation,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
      AND ve.source = 'comptable'
      AND ve.description LIKE 'Sortie stock — %'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS expense_autres,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
      AND ve.source = 'stock_gerant'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS expense_charge_stock,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.company_id, fv_r.company_id) = co.id
      AND ve.source = 'charge_achat'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS vehicle_exp,
    COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw
      WHERE cfw.company_id = co.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_carburant_comptable,
    COALESCE(rvc.trip_count, 0)::bigint AS trip_count,
    COALESCE(rvc.bus_count, 0)::bigint AS bus_count,
    COALESCE(rvc.driver_count, 0)::bigint AS driver_count
  FROM companies co
  LEFT JOIN rev_by_co rvc ON rvc.company_id = co.id
  LEFT JOIN chg_by_co cgc ON cgc.company_id = co.id
  WHERE co.id = ANY(p_company_ids)
  AND COALESCE(co.is_active, true) = true
)
SELECT
  base.company_id, base.company_name, base.company_code, base.parent_id, base.is_group,
  base.revenue, base.breakdown_received, base.breakdown_transferred,
  base.cc_carburant, base.cc_ration, base.cc_peage, base.cc_autres,
  base.fuel_enlev, base.expense_reparation, base.expense_autres, base.expense_charge_stock,
  base.vehicle_exp, base.fuel_carburant_comptable,
  (base.cc_carburant + base.cc_ration + base.cc_peage + base.cc_autres
   + base.fuel_enlev + base.expense_reparation + base.expense_autres
   + base.expense_charge_stock + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
  (base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage - base.cc_autres
   - base.fuel_enlev - base.expense_reparation - base.expense_autres
   - base.expense_charge_stock - base.vehicle_exp - base.fuel_carburant_comptable) AS margin,
  base.trip_count, base.bus_count, base.driver_count
FROM base
ORDER BY base.company_name;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 4. get_daf_revenue_by_bus — helpers revenue/charges + cc_autres
-- ═══════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS get_daf_revenue_by_bus(uuid[], date, date);

CREATE FUNCTION get_daf_revenue_by_bus(p_company_ids uuid[], p_date_from date, p_date_to date)
RETURNS TABLE(
  bus_id uuid, registration_number text, model text, company_name text,
  trip_count bigint, revenue numeric,
  cc_carburant numeric, cc_ration numeric, cc_peage numeric, cc_autres numeric,
  fuel_enlev numeric, expense_reparation numeric, expense_autres numeric,
  expense_charge_stock numeric, vehicle_exp numeric, fuel_carburant_comptable numeric,
  total_expense numeric, margin numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
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
rev_by_bus AS (
  SELECT bus_id,
    COALESCE(SUM(revenue), 0) AS revenue,
    COUNT(DISTINCT schedule_id)::bigint AS trip_count
  FROM scr GROUP BY bus_id
),
chg_by_bus AS (
  SELECT bus_id,
    COALESCE(SUM(cc_carburant), 0) AS cc_carburant,
    COALESCE(SUM(cc_ration), 0)    AS cc_ration,
    COALESCE(SUM(cc_peage), 0)     AS cc_peage,
    COALESCE(SUM(cc_autres), 0)    AS cc_autres
  FROM scc GROUP BY bus_id
),
base AS (
  SELECT
    b.id AS bus_id,
    b.registration_number,
    b.model,
    c.name AS company_name,
    COALESCE(rvb.trip_count, 0)::bigint AS trip_count,
    COALESCE(rvb.revenue, 0) AS revenue,
    COALESCE(cgb.cc_carburant, 0) AS cc_carburant,
    COALESCE(cgb.cc_ration, 0)    AS cc_ration,
    COALESCE(cgb.cc_peage, 0)     AS cc_peage,
    COALESCE(cgb.cc_autres, 0)    AS cc_autres,
    COALESCE((SELECT SUM(fe.total_amount) FROM fuel_enlevements fe
      WHERE fe.bus_id = b.id AND fe.enlevement_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_enlev,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
      AND ve.source = 'comptable'
      AND (ve.description IS NULL OR ve.description NOT LIKE 'Sortie stock — %')
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS expense_reparation,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
      AND ve.source = 'comptable'
      AND ve.description LIKE 'Sortie stock — %'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS expense_autres,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
      AND ve.source = 'stock_gerant'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS expense_charge_stock,
    COALESCE((SELECT SUM(ve.amount) FROM vehicle_expenses ve
      LEFT JOIN fleet_vehicles fv_d ON fv_d.id = ve.vehicle_id
      LEFT JOIN fleet_vehicles fv_r ON fv_r.registration_number = ve.registration_number AND ve.vehicle_id IS NULL
      WHERE COALESCE(fv_d.registration_number, fv_r.registration_number) = b.registration_number
      AND ve.source = 'charge_achat'
      AND ve.expense_date BETWEEN p_date_from AND p_date_to
      AND ve.validation_status = 'validee'), 0) AS vehicle_exp,
    COALESCE((SELECT SUM(cfw.total_amount) FROM comptable_fuel_withdrawals cfw
      WHERE cfw.bus_id = b.id AND cfw.withdrawal_date BETWEEN p_date_from AND p_date_to), 0) AS fuel_carburant_comptable
  FROM buses b
  JOIN companies c ON c.id = b.company_id
  LEFT JOIN rev_by_bus rvb ON rvb.bus_id = b.id
  LEFT JOIN chg_by_bus cgb ON cgb.bus_id = b.id
  WHERE b.company_id = ANY(p_company_ids)
  AND EXISTS (
    SELECT 1 FROM schedules s
    WHERE s.bus_id = b.id
    AND s.departure_datetime::date BETWEEN p_date_from AND p_date_to
  )
)
SELECT
  base.bus_id, base.registration_number, base.model, base.company_name,
  base.trip_count, base.revenue,
  base.cc_carburant, base.cc_ration, base.cc_peage, base.cc_autres,
  base.fuel_enlev, base.expense_reparation, base.expense_autres,
  base.expense_charge_stock, base.vehicle_exp, base.fuel_carburant_comptable,
  (base.cc_carburant + base.cc_ration + base.cc_peage + base.cc_autres
   + base.fuel_enlev + base.expense_reparation + base.expense_autres
   + base.expense_charge_stock + base.vehicle_exp + base.fuel_carburant_comptable) AS total_expense,
  (base.revenue - base.cc_carburant - base.cc_ration - base.cc_peage - base.cc_autres
   - base.fuel_enlev - base.expense_reparation - base.expense_autres
   - base.expense_charge_stock - base.vehicle_exp - base.fuel_carburant_comptable) AS margin
FROM base;
END;
$$;

NOTIFY pgrst, 'reload schema';
