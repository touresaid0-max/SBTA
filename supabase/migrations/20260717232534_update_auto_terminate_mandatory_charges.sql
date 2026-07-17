/*
# Update auto_terminate_past_schedules to distinguish mandatory vs optional charges

1. Modified Functions
   - `auto_terminate_past_schedules`: Now checks specifically for mandatory charges
     (peage and ration). Other charges (carburant_complement, autres) are optional.
     - If mandatory charges are missing: alert is created with type 'missing_mandatory_charges'
     - If only optional charges are missing: alert is informational ('missing_optional_charges')
     - Schedules are still auto-terminated regardless, but alerts differentiate severity

2. Important Notes
   - Only Peage and Ratios are considered mandatory for completeness
   - carburant_complement and autres remain optional and informational
   - No other business logic is modified
*/

CREATE OR REPLACE FUNCTION auto_terminate_past_schedules(p_station_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  results jsonb := '[]'::jsonb;
  has_peage boolean;
  has_ration boolean;
  alert_msg text;
  alert_type_val text;
BEGIN
  FOR rec IN
    SELECT s.id, s.route_id, s.bus_id, s.departure_datetime, s.status,
           r.name as route_name,
           b.plate_number
    FROM schedules s
    LEFT JOIN routes r ON r.id = s.route_id
    LEFT JOIN buses b ON b.id = s.bus_id
    WHERE s.status IN ('en_cours', 'retard')
      AND s.departure_datetime < date_trunc('day', now())
      AND (p_station_id IS NULL OR s.departure_station_id = p_station_id)
    ORDER BY s.departure_datetime ASC
  LOOP
    -- Check mandatory charges
    SELECT EXISTS(
      SELECT 1 FROM counter_charges
      WHERE schedule_id = rec.id AND charge_type = 'peage' AND status != 'rejete'
    ) INTO has_peage;

    SELECT EXISTS(
      SELECT 1 FROM counter_charges
      WHERE schedule_id = rec.id AND charge_type = 'ration' AND status != 'rejete'
    ) INTO has_ration;

    -- Auto-terminate the schedule
    UPDATE schedules
    SET status = 'termine',
        updated_at = now()
    WHERE id = rec.id;

    -- Create alert if mandatory charges are missing
    IF NOT has_peage OR NOT has_ration THEN
      alert_msg := 'Voyage ' || COALESCE(rec.route_name, '') || ' (' ||
                   COALESCE(rec.plate_number, '') || ') du ' ||
                   to_char(rec.departure_datetime, 'DD/MM/YYYY HH24:MI') ||
                   ' - OBLIGATOIRE manquant : ' ||
                   CASE WHEN NOT has_peage AND NOT has_ration THEN 'Péage + Ratios'
                        WHEN NOT has_peage THEN 'Péage'
                        ELSE 'Ratios'
                   END;
      alert_type_val := 'missing_mandatory_charges';

      INSERT INTO schedule_auto_close_alerts (schedule_id, station_id, alert_type, message)
      VALUES (rec.id, p_station_id, alert_type_val, alert_msg)
      ON CONFLICT DO NOTHING;

      results := results || jsonb_build_object(
        'schedule_id', rec.id,
        'route_name', rec.route_name,
        'plate_number', rec.plate_number,
        'departure', rec.departure_datetime,
        'missing_charges', true,
        'missing_peage', NOT has_peage,
        'missing_ration', NOT has_ration
      );
    ELSE
      results := results || jsonb_build_object(
        'schedule_id', rec.id,
        'route_name', rec.route_name,
        'plate_number', rec.plate_number,
        'departure', rec.departure_datetime,
        'missing_charges', false,
        'missing_peage', false,
        'missing_ration', false
      );
    END IF;
  END LOOP;

  RETURN results;
END;
$$;
