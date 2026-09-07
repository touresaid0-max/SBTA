/*
# Fix auto-terminate: only close departures from past days (not same-day)

## Problem
The existing `auto_terminate_past_schedules` function had two conditions:
  a) departure_datetime < date_trunc('day', now()) — past date (correct)
  b) arrival_datetime + 1h < now() — arrival + 1h passed (PROBLEM: closes same-day trips)

Condition (b) caused departures from day J to be auto-closed during day J
as soon as their estimated arrival + 1h passed, violating the business rule
that all departures from day J must remain open until 00:00 of day J+1.

Additionally, the function only targeted statuses 'en_cours' and 'retard',
missing 'planifie' (planned) departures that also need closure when the day ends.

## Changes
1. Modified function `auto_terminate_past_schedules`:
   - REMOVED the arrival_datetime + 1h condition entirely.
   - Now ONLY closes departures whose departure date is strictly before today
     (i.e., the entire day J has passed and we are now in day J+1 or later).
   - Expanded target statuses from ('en_cours', 'retard') to include all
     non-closed, non-cancelled active statuses: 'planifie', 'en_cours',
     'retard', 'convoi', 'panne'. Statuses 'termine' (already closed) and
     'annule' (cancelled) are excluded.
   - Keeps the admin_reactivated_at protection: admin-reactivated trips
     are still skipped.
   - Keeps the mandatory charges (péage + ration) check and alert generation.
   - Uses server UTC time (now() / date_trunc) as the reference timezone
     to avoid client-side timezone drift.

## Important Notes
- A departure dated 05/09/2026 stays open all of 05/09 and is only closed
  when the server UTC date rolls over to 06/09/2026 at 00:00.
- Closed departures remain visible in history and reports (status='termine').
- Existing locking rules for closed departures remain unchanged.
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
    SELECT s.id, s.route_id, s.bus_id, s.departure_datetime, s.arrival_datetime, s.status,
           r.name as route_name,
           b.registration_number as plate_number
    FROM schedules s
    LEFT JOIN routes r ON r.id = s.route_id
    LEFT JOIN buses b ON b.id = s.bus_id
    WHERE s.status IN ('planifie', 'en_cours', 'retard', 'convoi', 'panne')
      AND s.admin_reactivated_at IS NULL
      AND s.departure_datetime < date_trunc('day', now())
      AND (p_station_id IS NULL OR s.departure_station_id = p_station_id)
    ORDER BY s.departure_datetime ASC
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM counter_charges
      WHERE schedule_id = rec.id AND charge_type = 'peage' AND status != 'rejete'
    ) INTO has_peage;

    SELECT EXISTS(
      SELECT 1 FROM counter_charges
      WHERE schedule_id = rec.id AND charge_type = 'ration' AND status != 'rejete'
    ) INTO has_ration;

    UPDATE schedules
    SET status = 'termine',
        updated_at = now()
    WHERE id = rec.id;

    IF NOT has_peage OR NOT has_ration THEN
      alert_msg := 'Voyage ' || COALESCE(rec.route_name, '') || ' (' ||
                   COALESCE(rec.plate_number, '') || ') du ' ||
                   to_char(rec.departure_datetime, 'DD/MM/YYYY HH24:MI') ||
                   ' - OBLIGATOIRE manquant : ' ||
                   CASE WHEN NOT has_peage AND NOT has_ration THEN 'Peage + Ratios'
                        WHEN NOT has_peage THEN 'Peage'
                        ELSE 'Ratios'
                   END;
      alert_type_val := 'missing_mandatory_charges';

      INSERT INTO schedule_auto_close_alerts (schedule_id, station_id, alert_type, message)
      VALUES (rec.id, p_station_id, alert_type_val, alert_msg)
      ON CONFLICT DO NOTHING;

      results := results || jsonb_build_object(
        'schedule_id', rec.id,
        'route_name', COALESCE(rec.route_name, ''),
        'plate_number', COALESCE(rec.plate_number, ''),
        'departure', rec.departure_datetime,
        'missing_charges', true,
        'missing_peage', NOT has_peage,
        'missing_ration', NOT has_ration
      );
    ELSE
      results := results || jsonb_build_object(
        'schedule_id', rec.id,
        'route_name', COALESCE(rec.route_name, ''),
        'plate_number', COALESCE(rec.plate_number, ''),
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
