-- Audit read-only (SELECT uniquement). Détail de la gare Divo (production).
-- Gare retenue : « Gare SBTA Divo ». Voir « Gare SBTA Adjamé Divo » à confirmer.

-- Réservations par jour et par compte ayant saisi (identifiants masqués)
SELECT (r.created_at AT TIME ZONE 'UTC')::date AS jour,
       left(coalesce(u.email, '<null>'), 2) || '***' AS compte_masque,
       count(*) AS nb_reservations
FROM reservations r
JOIN schedules sc ON sc.id = r.schedule_id
JOIN stations s ON s.id = sc.departure_station_id
LEFT JOIN users u ON u.id = r.booked_by
WHERE s.name = 'Gare SBTA Divo'
GROUP BY 1, 2
ORDER BY 1, 2;

-- Charges de guichet, bagages et équipes de caisse par jour et par compte
SELECT 'counter_charges' AS table_src, (c.created_at AT TIME ZONE 'UTC')::date AS jour,
       left(coalesce(u.email, '<null>'), 2) || '***' AS compte_masque, count(*) AS nb
FROM counter_charges c
JOIN stations s ON s.id = c.station_id AND s.name = 'Gare SBTA Divo'
LEFT JOIN users u ON u.id = c.created_by
GROUP BY 1, 2, 3
UNION ALL
SELECT 'baggage_tickets', (b.created_at AT TIME ZONE 'UTC')::date,
       left(coalesce(u.email, '<null>'), 2) || '***', count(*)
FROM baggage_tickets b
JOIN stations s ON s.id = b.station_id AND s.name = 'Gare SBTA Divo'
LEFT JOIN users u ON u.id = b.sold_by
GROUP BY 1, 2, 3
UNION ALL
SELECT 'counter_shifts', (cs.created_at AT TIME ZONE 'UTC')::date,
       left(coalesce(u.email, '<null>'), 2) || '***', count(*)
FROM counter_shifts cs
JOIN stations s ON s.id = cs.station_id AND s.name = 'Gare SBTA Divo'
LEFT JOIN users u ON u.id = cs.user_id
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- Départs de Divo : dépendances créées avant la coupure (bus, chauffeurs, lignes)
WITH d AS (SELECT id FROM stations WHERE name = 'Gare SBTA Divo'),
ds AS (
  SELECT sc.* FROM schedules sc JOIN d ON sc.departure_station_id = d.id
  WHERE sc.created_at >= timestamptz '2026-10-28 00:00:00+00'
)
SELECT count(*) AS departs_apres_coupure,
       count(*) FILTER (WHERE b.created_at < timestamptz '2026-10-28 00:00:00+00') AS bus_crees_avant,
       count(*) FILTER (WHERE u.created_at < timestamptz '2026-10-28 00:00:00+00') AS chauffeurs_crees_avant,
       count(*) FILTER (WHERE r.created_at < timestamptz '2026-10-28 00:00:00+00') AS lignes_creees_avant,
       count(*) FILTER (WHERE ds.bus_id IS NULL) AS sans_bus,
       count(*) FILTER (WHERE ds.driver_id IS NULL) AS sans_chauffeur,
       count(*) FILTER (WHERE ds.route_id IS NULL) AS sans_ligne
FROM ds
LEFT JOIN buses b ON b.id = ds.bus_id
LEFT JOIN users u ON u.id = ds.driver_id
LEFT JOIN routes r ON r.id = ds.route_id;

-- Lignes utilisées par Divo : gares d'origine et de destination
SELECT r.name AS ligne, so.name AS gare_origine, sd.name AS gare_destination,
       r.created_at::date AS creee_le, count(DISTINCT sc.id) AS nb_departs
FROM schedules sc
JOIN stations d ON d.id = sc.departure_station_id AND d.name = 'Gare SBTA Divo'
JOIN routes r ON r.id = sc.route_id
LEFT JOIN stations so ON so.id = r.origin_station_id
LEFT JOIN stations sd ON sd.id = r.destination_station_id
GROUP BY 1, 2, 3, 4
ORDER BY 5 DESC;

-- Gares « Divo » : comparaison des deux candidates
SELECT s.name, s.id, s.created_at::date AS creee_le, s.agency_code,
       (SELECT count(*) FROM schedules sc WHERE sc.departure_station_id = s.id) AS nb_departs,
       (SELECT count(*) FROM users u WHERE u.station_id = s.id) AS nb_utilisateurs
FROM stations s
WHERE s.name ILIKE '%divo%';
