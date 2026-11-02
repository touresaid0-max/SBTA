-- Audit read-only (SELECT uniquement). Volumes par gare avant / après la coupure.
-- Coupure : 2026-10-28 00:00:00 Africa/Abidjan = 2026-10-28 00:00:00+00 (base en UTC).

WITH cut AS (SELECT timestamptz '2026-10-28 00:00:00+00' AS c),
rows_ AS (
  SELECT 'schedules' AS t, departure_station_id AS s, created_at AS ts FROM schedules
  UNION ALL SELECT 'reservations', sc.departure_station_id, r.created_at
    FROM reservations r JOIN schedules sc ON sc.id = r.schedule_id
  UNION ALL SELECT 'baggage_tickets', station_id, created_at FROM baggage_tickets
  UNION ALL SELECT 'parcels', origin_station_id, created_at FROM parcels
  UNION ALL SELECT 'counter_charges', station_id, created_at FROM counter_charges
  UNION ALL SELECT 'convoys', sc.departure_station_id, cv.created_at
    FROM convoys cv JOIN schedules sc ON sc.id = cv.schedule_id
  UNION ALL SELECT 'mobile_bookings', sc.departure_station_id, mb.created_at
    FROM mobile_bookings mb JOIN schedules sc ON sc.id = mb.schedule_id
  UNION ALL SELECT 'counter_shifts', station_id, created_at FROM counter_shifts
  UNION ALL SELECT 'ramassage_collections', station_id, created_at FROM ramassage_collections
  UNION ALL SELECT 'station_daily_reports', station_id, created_at FROM station_daily_reports
  UNION ALL SELECT 'kiosk_tickets', station_id, created_at FROM kiosk_tickets
  UNION ALL SELECT 'parcel_tracking_events', station_id, event_at FROM parcel_tracking_events
  UNION ALL SELECT 'sms_logs', station_id, created_at FROM sms_logs
  UNION ALL SELECT 'payments', sc.departure_station_id, p.created_at
    FROM payments p JOIN reservations r ON r.id = p.reservation_id
    JOIN schedules sc ON sc.id = r.schedule_id
)
SELECT t AS table_transactionnelle,
       coalesce(st.name, '<NULL>') AS gare,
       count(*) FILTER (WHERE ts < c) AS avant_coupure,
       count(*) FILTER (WHERE ts >= c) AS apres_coupure,
       min(ts) AS date_min,
       max(ts) AS date_max
FROM rows_
CROSS JOIN cut
LEFT JOIN stations st ON st.id = rows_.s
GROUP BY 1, 2
ORDER BY 1, 2;
