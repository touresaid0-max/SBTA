-- Audit read-only (SELECT uniquement). Anomalies et comptes au profil test.
-- Les e-mails sont masqués (2 premiers caractères + domaine).

-- Comptes au profil test ou suspect (motif large, à confirmer manuellement)
SELECT left(u.id::text, 8) AS id_court,
       left(u.email, 2) || '***@' || split_part(u.email, '@', 2) AS email_masque,
       left(u.full_name, 3) || '***' AS nom_masque,
       u.role, st.name AS gare, u.is_active,
       u.created_at::date AS cree_le, u.last_seen_at::date AS vu_le,
       (SELECT count(*) FROM schedules s WHERE s.created_by = u.id) AS departs_crees,
       (SELECT count(*) FROM reservations r WHERE r.booked_by = u.id) AS reservations_saisies,
       (SELECT count(*) FROM counter_charges c WHERE c.created_by = u.id) AS charges,
       (SELECT count(*) FROM baggage_tickets b WHERE b.sold_by = u.id) AS bagages
FROM users u
LEFT JOIN stations st ON st.id = u.station_id
WHERE u.email ~* '(test|demo|admin1|essai|fake|exemple|sample)'
   OR u.full_name ~* '(test|demo|admin1|essai|fake|exemple|sample)'
ORDER BY u.created_at;

-- Lignes sans gare ou avec une gare incohérente
SELECT 'schedules sans gare de départ' AS anomalie, count(*) AS nb,
       count(*) FILTER (WHERE created_at < timestamptz '2026-10-28 00:00:00+00') AS avant,
       count(*) FILTER (WHERE created_at >= timestamptz '2026-10-28 00:00:00+00') AS apres
FROM schedules WHERE departure_station_id IS NULL
UNION ALL
SELECT 'baggage_tickets sans gare', count(*),
       count(*) FILTER (WHERE created_at < timestamptz '2026-10-28 00:00:00+00'),
       count(*) FILTER (WHERE created_at >= timestamptz '2026-10-28 00:00:00+00')
FROM baggage_tickets WHERE station_id IS NULL
UNION ALL
SELECT 'mobile_bookings sans départ', count(*),
       count(*) FILTER (WHERE mb.created_at < timestamptz '2026-10-28 00:00:00+00'),
       count(*) FILTER (WHERE mb.created_at >= timestamptz '2026-10-28 00:00:00+00')
FROM mobile_bookings mb LEFT JOIN schedules sc ON sc.id = mb.schedule_id WHERE sc.id IS NULL
UNION ALL
SELECT 'routes sans gare d origine', count(*), 0, 0
FROM routes WHERE origin_station_id IS NULL
UNION ALL
SELECT 'parcel_tracking_events dont le colis n est pas de la même gare', count(*), 0, 0
FROM parcel_tracking_events e JOIN parcels p ON p.id = e.parcel_id
WHERE e.station_id IS DISTINCT FROM p.origin_station_id
UNION ALL
SELECT 'réservations sans départ', count(*), 0, 0
FROM reservations r LEFT JOIN schedules sc ON sc.id = r.schedule_id WHERE sc.id IS NULL;

-- Numérotation : doublons de références et de bagages
SELECT 'booking_reference en double' AS controle, count(*) AS nb
FROM (SELECT booking_reference FROM reservations GROUP BY 1 HAVING count(*) > 1) x
UNION ALL
SELECT 'baggage_number en double', count(*)
FROM (SELECT baggage_number FROM baggage_tickets GROUP BY 1 HAVING count(*) > 1) x
UNION ALL
SELECT 'parcel_code en double', count(*)
FROM (SELECT parcel_code FROM parcels GROUP BY 1 HAVING count(*) > 1) x;

-- Numéros de guichet en double au sein d une même gare
SELECT st.name AS gare, c.counter_number, count(*) AS nb
FROM counters c JOIN stations st ON st.id = c.station_id
GROUP BY 1, 2 HAVING count(*) > 1
ORDER BY 1, 2;

-- Départs de Divo dont les bus ou chauffeurs sont aussi utilisés par d autres gares
WITH d AS (SELECT id FROM stations WHERE name = 'Gare SBTA Divo')
SELECT count(DISTINCT sc.bus_id) AS bus_divo_apres,
       count(DISTINCT sc.bus_id) FILTER (WHERE sc.bus_id IN (
         SELECT bus_id FROM schedules WHERE departure_station_id IS DISTINCT FROM (SELECT id FROM d))) AS bus_partages,
       count(DISTINCT sc.driver_id) AS chauffeurs_divo_apres,
       count(DISTINCT sc.driver_id) FILTER (WHERE sc.driver_id IN (
         SELECT driver_id FROM schedules WHERE departure_station_id IS DISTINCT FROM (SELECT id FROM d))) AS chauffeurs_partages
FROM schedules sc
JOIN d ON sc.departure_station_id = d.id
WHERE sc.created_at >= timestamptz '2026-10-28 00:00:00+00';
