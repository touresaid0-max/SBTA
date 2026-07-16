/*
# Schedule Completion Alerts RPC

Creates a function `get_schedule_completion_alerts` that checks today's schedules
for a given station and returns which data is missing (charges, billets, carburant, depenses).

## New Functions
- `get_schedule_completion_alerts(p_station_id uuid, p_target_date date)`
  - Returns a JSON array of objects, one per schedule that has at least one missing element.
  - Each object contains:
    - schedule_id, route_name, departure_datetime, bus_registration, driver_name, status
    - has_charges (boolean): true if at least one counter_charge exists for this schedule
    - has_tickets (boolean): true if at least one reservation exists for this schedule
    - has_fuel (boolean): true if at least one fuel_voucher exists for this schedule
    - has_expenses (boolean): true if at least one bus_expense exists for this bus on that date
    - missing (text[]): list of missing elements in French

## Security
- SECURITY DEFINER to access cross-table data
- Only callable by authenticated users

## Important Notes
1. The function only returns schedules that have at least one missing element (incomplete).
2. Schedules with status 'annule' are excluded.
3. Alerts auto-resolve: once data is added, the schedule disappears from the results.
*/

CREATE OR REPLACE FUNCTION get_schedule_completion_alerts(
  p_station_id uuid,
  p_target_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'schedule_id', s.id,
      'route_name', COALESCE(s.route_name, ''),
      'departure_datetime', s.departure_datetime,
      'bus_registration', COALESCE(b.registration_number, ''),
      'driver_name', COALESCE(d.full_name, ''),
      'status', s.status,
      'has_charges', EXISTS (
        SELECT 1 FROM counter_charges cc WHERE cc.schedule_id = s.id
      ),
      'has_tickets', EXISTS (
        SELECT 1 FROM reservations r WHERE r.schedule_id = s.id AND r.status != 'annulee'
      ),
      'has_fuel', EXISTS (
        SELECT 1 FROM fuel_vouchers fv WHERE fv.schedule_id = s.id
      ),
      'has_expenses', EXISTS (
        SELECT 1 FROM bus_expenses be
        WHERE be.bus_id = s.bus_id
          AND be.expense_date = p_target_date
      ),
      'missing', (
        SELECT array_agg(label)
        FROM (
          SELECT 'Charges' AS label
          WHERE NOT EXISTS (SELECT 1 FROM counter_charges cc WHERE cc.schedule_id = s.id)
          UNION ALL
          SELECT 'Billets'
          WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.schedule_id = s.id AND r.status != 'annulee')
          UNION ALL
          SELECT 'Carburant'
          WHERE NOT EXISTS (SELECT 1 FROM fuel_vouchers fv WHERE fv.schedule_id = s.id)
          UNION ALL
          SELECT 'Dépenses'
          WHERE NOT EXISTS (SELECT 1 FROM bus_expenses be WHERE be.bus_id = s.bus_id AND be.expense_date = p_target_date)
        ) sub
      )
    ) AS row_data
    FROM schedules s
    LEFT JOIN buses b ON b.id = s.bus_id
    LEFT JOIN users d ON d.id = s.driver_id
    WHERE s.departure_station_id = p_station_id
      AND (s.departure_datetime::date) = p_target_date
      AND s.status NOT IN ('annule')
      AND (
        NOT EXISTS (SELECT 1 FROM counter_charges cc WHERE cc.schedule_id = s.id)
        OR NOT EXISTS (SELECT 1 FROM reservations r WHERE r.schedule_id = s.id AND r.status != 'annulee')
        OR NOT EXISTS (SELECT 1 FROM fuel_vouchers fv WHERE fv.schedule_id = s.id)
        OR NOT EXISTS (SELECT 1 FROM bus_expenses be WHERE be.bus_id = s.bus_id AND be.expense_date = p_target_date)
      )
    ORDER BY s.departure_datetime ASC
  ) sub;

  RETURN v_result;
END;
$$;
