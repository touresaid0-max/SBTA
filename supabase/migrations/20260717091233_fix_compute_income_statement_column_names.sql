/*
# Fix compute_income_statement RPC - correct column names

Fixes the function to use correct column names:
- comptable_stock_movements: quantity * unit_price instead of total_amount, stock_item_id instead of item_id, notes instead of reason
- pay_slips: period_year / period_month instead of period_start / period_end / period_label
- Also adds company_id filter on comptable_stock_movements

## Modified Functions
- `compute_income_statement`: corrected column references
*/

CREATE OR REPLACE FUNCTION compute_income_statement(
  p_company_id uuid,
  p_fiscal_year integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_date date;
  v_end_date date;
  v_result jsonb := '[]'::jsonb;
  v_tc numeric := 0;
  v_tc_detail jsonb := '[]'::jsonb;
  v_re numeric := 0;
  v_re_detail jsonb := '[]'::jsonb;
  v_rf numeric := 0;
  v_rf_detail jsonb := '[]'::jsonb;
  v_rg numeric := 0;
  v_rg_detail jsonb := '[]'::jsonb;
  v_rh numeric := 0;
  v_rh_detail jsonb := '[]'::jsonb;
  v_rj numeric := 0;
  v_rj_detail jsonb := '[]'::jsonb;
  v_rk numeric := 0;
  v_rk_detail jsonb := '[]'::jsonb;
  v_tmp numeric;
  v_tmp_detail jsonb;
BEGIN
  v_start_date := make_date(p_fiscal_year, 1, 1);
  v_end_date := make_date(p_fiscal_year, 12, 31);

  -- ============================================================
  -- TC: Travaux, services vendus
  -- ============================================================

  -- 1. Ticket sales (reservations)
  SELECT COALESCE(SUM(r.total_price), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Billets',
           'date', r.created_at::date,
           'description', COALESCE(r.passenger_name, 'Passager') || ' - ' || COALESCE(r.booking_reference, ''),
           'amount', r.total_price
         )) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM reservations r
  JOIN schedules s ON s.id = r.schedule_id
  JOIN buses b ON b.id = s.bus_id
  WHERE b.company_id = p_company_id
    AND r.created_at::date BETWEEN v_start_date AND v_end_date
    AND r.status NOT IN ('annulee', 'cancelled');
  v_tc := v_tc + v_tmp;
  v_tc_detail := v_tc_detail || v_tmp_detail;

  -- 2. Parcels (courier revenue)
  SELECT COALESCE(SUM(p.total_amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Courrier',
           'date', p.created_at::date,
           'description', COALESCE(p.parcel_code,'') || ' - ' || COALESCE(p.sender_name,'') || ' -> ' || COALESCE(p.recipient_name,''),
           'amount', p.total_amount
         )) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM parcels p
  WHERE p.company_id = p_company_id
    AND p.created_at::date BETWEEN v_start_date AND v_end_date
    AND p.status NOT IN ('annule');
  v_tc := v_tc + v_tmp;
  v_tc_detail := v_tc_detail || v_tmp_detail;

  -- 3. Baggage tickets
  SELECT COALESCE(SUM(bt.price), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Bagages',
           'date', bt.created_at::date,
           'description', COALESCE(bt.baggage_number,'') || ' - ' || COALESCE(bt.owner_name, ''),
           'amount', bt.price
         )) FILTER (WHERE bt.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM baggage_tickets bt
  JOIN schedules s ON s.id = bt.schedule_id
  JOIN buses b ON b.id = s.bus_id
  WHERE b.company_id = p_company_id
    AND bt.created_at::date BETWEEN v_start_date AND v_end_date;
  v_tc := v_tc + v_tmp;
  v_tc_detail := v_tc_detail || v_tmp_detail;

  -- 4. Convoys
  SELECT COALESCE(SUM(c.amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Convois',
           'date', c.created_at::date,
           'description', 'Convoi #' || c.id::text,
           'amount', c.amount
         )) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM convoys c
  JOIN schedules s ON s.id = c.schedule_id
  JOIN buses b ON b.id = s.bus_id
  WHERE b.company_id = p_company_id
    AND c.created_at::date BETWEEN v_start_date AND v_end_date;
  v_tc := v_tc + v_tmp;
  v_tc_detail := v_tc_detail || v_tmp_detail;

  -- 5. Mobile bookings (paid only)
  SELECT COALESCE(SUM(mb.total), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Réservations en ligne',
           'date', mb.created_at::date,
           'description', COALESCE(mb.booking_ref,'') || ' - ' || COALESCE(mb.origin_city,'') || ' -> ' || COALESCE(mb.destination_city,''),
           'amount', mb.total
         )) FILTER (WHERE mb.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM mobile_bookings mb
  WHERE mb.company_id = p_company_id
    AND mb.created_at::date BETWEEN v_start_date AND v_end_date
    AND mb.status NOT IN ('cancelled','expired')
    AND mb.payment_status = 'paid';
  v_tc := v_tc + v_tmp;
  v_tc_detail := v_tc_detail || v_tmp_detail;

  -- ============================================================
  -- RE: Autres achats (Carburant Cuve + Agent + Charges Achat + Articles Stock)
  -- ============================================================

  -- Fuel from tanks (Carburant Cuve)
  SELECT COALESCE(SUM(fe.total_amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Carburant Cuve',
           'date', fe.enlevement_date,
           'description', COALESCE(fe.license_plate, '') || ' - ' || fe.quantity_liters || 'L',
           'amount', fe.total_amount
         )) FILTER (WHERE fe.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM fuel_enlevements fe
  WHERE fe.company_id = p_company_id
    AND fe.enlevement_date BETWEEN v_start_date AND v_end_date;
  v_re := v_re + v_tmp;
  v_re_detail := v_re_detail || v_tmp_detail;

  -- Fuel from agent (Carburant Agent)
  SELECT COALESCE(SUM(cfw.total_amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Carburant Agent',
           'date', cfw.withdrawal_date,
           'description', COALESCE(cfw.registration_number, '') || ' - ' || cfw.liters || 'L @ ' || COALESCE(cfw.station_name, ''),
           'amount', cfw.total_amount
         )) FILTER (WHERE cfw.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM comptable_fuel_withdrawals cfw
  WHERE cfw.company_id = p_company_id
    AND cfw.withdrawal_date BETWEEN v_start_date AND v_end_date;
  v_re := v_re + v_tmp;
  v_re_detail := v_re_detail || v_tmp_detail;

  -- Vehicle expenses / Charges Achat
  SELECT COALESCE(SUM(ve.amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Charges Achat',
           'date', ve.expense_date,
           'description', COALESCE(ve.description, '') || ' - ' || COALESCE(ve.registration_number, ''),
           'amount', ve.amount
         )) FILTER (WHERE ve.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM vehicle_expenses ve
  WHERE ve.company_id = p_company_id
    AND ve.expense_date BETWEEN v_start_date AND v_end_date
    AND (ve.source IS NULL OR ve.source != 'comptable_stock');
  v_re := v_re + v_tmp;
  v_re_detail := v_re_detail || v_tmp_detail;

  -- GP Stock exits (Articles Stock)
  SELECT COALESCE(SUM(gse.total_amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Articles Stock',
           'date', gse.exit_date,
           'description', COALESCE(gse.exit_reason, '') || ' - Qté: ' || gse.quantity,
           'amount', gse.total_amount
         )) FILTER (WHERE gse.id IS NOT NULL), '[]'::jsonb)
  INTO v_tmp, v_tmp_detail
  FROM gp_stock_exits gse
  WHERE gse.company_id = p_company_id
    AND gse.exit_date BETWEEN v_start_date AND v_end_date;
  v_re := v_re + v_tmp;
  v_re_detail := v_re_detail || v_tmp_detail;

  -- ============================================================
  -- RF: Variation de stocks (comptable_stock_movements)
  -- ============================================================
  SELECT COALESCE(SUM(
    CASE WHEN csm.movement_type = 'exit' THEN (csm.quantity * COALESCE(csm.unit_price, 0))
         WHEN csm.movement_type = 'entry' THEN -(csm.quantity * COALESCE(csm.unit_price, 0))
         ELSE 0 END
  ), 0),
  COALESCE(jsonb_agg(jsonb_build_object(
    'source', 'Charge Stock',
    'date', csm.movement_date,
    'description', csm.movement_type || ' - ' || COALESCE(csm.notes, '') || ' (' || csm.quantity || ' unités)',
    'amount', CASE WHEN csm.movement_type = 'exit' THEN (csm.quantity * COALESCE(csm.unit_price, 0))
                   ELSE -(csm.quantity * COALESCE(csm.unit_price, 0)) END
  )) FILTER (WHERE csm.id IS NOT NULL), '[]'::jsonb)
  INTO v_rf, v_rf_detail
  FROM comptable_stock_movements csm
  WHERE csm.company_id = p_company_id
    AND csm.movement_date BETWEEN v_start_date AND v_end_date;

  -- ============================================================
  -- RG: Transports (Péages + Carburant Complément)
  -- ============================================================
  SELECT COALESCE(SUM(cc.amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', CASE cc.charge_type WHEN 'peage' THEN 'Péage' ELSE 'Carburant Complément' END,
           'date', cc.charge_date,
           'description', COALESCE(cc.description, cc.charge_type),
           'amount', cc.amount
         )) FILTER (WHERE cc.id IS NOT NULL), '[]'::jsonb)
  INTO v_rg, v_rg_detail
  FROM counter_charges cc
  JOIN schedules s ON s.id = cc.schedule_id
  JOIN buses b ON b.id = s.bus_id
  WHERE b.company_id = p_company_id
    AND cc.charge_date BETWEEN v_start_date AND v_end_date
    AND cc.charge_type IN ('peage', 'carburant_complement');

  -- ============================================================
  -- RH: Services extérieurs (Fixed expenses)
  -- ============================================================
  SELECT COALESCE(SUM(fex.amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Charges Fixes',
           'date', fex.expense_date,
           'description', COALESCE(fet.name, '') || CASE WHEN fex.supplier IS NOT NULL THEN ' - ' || fex.supplier ELSE '' END,
           'amount', fex.amount
         )) FILTER (WHERE fex.id IS NOT NULL), '[]'::jsonb)
  INTO v_rh, v_rh_detail
  FROM fixed_expenses fex
  LEFT JOIN fixed_expense_types fet ON fet.id = fex.expense_type_id
  WHERE fex.expense_date BETWEEN v_start_date AND v_end_date;

  -- ============================================================
  -- RJ: Autres charges (Rations + Autres)
  -- ============================================================
  SELECT COALESCE(SUM(cc.amount), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', CASE cc.charge_type WHEN 'ration' THEN 'Ration' ELSE 'Autres' END,
           'date', cc.charge_date,
           'description', COALESCE(cc.description, cc.charge_type),
           'amount', cc.amount
         )) FILTER (WHERE cc.id IS NOT NULL), '[]'::jsonb)
  INTO v_rj, v_rj_detail
  FROM counter_charges cc
  JOIN schedules s ON s.id = cc.schedule_id
  JOIN buses b ON b.id = s.bus_id
  WHERE b.company_id = p_company_id
    AND cc.charge_date BETWEEN v_start_date AND v_end_date
    AND cc.charge_type IN ('ration', 'autres');

  -- ============================================================
  -- RK: Charges de personnel (pay_slips)
  -- ============================================================
  SELECT COALESCE(SUM(ps.net_salary), 0),
         COALESCE(jsonb_agg(jsonb_build_object(
           'source', 'Salaires',
           'date', make_date(ps.period_year, ps.period_month, 1),
           'description', COALESCE(ps.employee_name, '') || ' - ' || ps.period_month || '/' || ps.period_year,
           'amount', ps.net_salary
         )) FILTER (WHERE ps.id IS NOT NULL), '[]'::jsonb)
  INTO v_rk, v_rk_detail
  FROM pay_slips ps
  WHERE ps.company_id = p_company_id
    AND ps.period_year = p_fiscal_year
    AND ps.status IN ('validated','paid');

  -- ============================================================
  -- Build result (charges are negative by convention)
  -- ============================================================
  v_result := jsonb_build_array(
    jsonb_build_object('ref', 'TC', 'amount', v_tc, 'detail', v_tc_detail),
    jsonb_build_object('ref', 'RE', 'amount', -v_re, 'detail', v_re_detail),
    jsonb_build_object('ref', 'RF', 'amount', -v_rf, 'detail', v_rf_detail),
    jsonb_build_object('ref', 'RG', 'amount', -v_rg, 'detail', v_rg_detail),
    jsonb_build_object('ref', 'RH', 'amount', -v_rh, 'detail', v_rh_detail),
    jsonb_build_object('ref', 'RJ', 'amount', -v_rj, 'detail', v_rj_detail),
    jsonb_build_object('ref', 'RK', 'amount', -v_rk, 'detail', v_rk_detail)
  );

  RETURN v_result;
END;
$$;
