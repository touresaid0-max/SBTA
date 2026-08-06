/*
# Backfill routes.destination_station_id from destination city

## Context
Les routes utilisent origin_city_id / destination_city_id mais la colonne
destination_station_id est restée NULL pour toutes les routes actives.
Conséquence : le flux Ramassage ne trouve jamais la gare de destination
(arrival_station_id = null à la création du départ), donc aucune notification
n'est envoyée à la gare d'arrivée.

## Changement
Met à jour routes.destination_station_id avec l'ID de la station active dont
city_id correspond à routes.destination_city_id. Ne touche pas aux lignes déjà
renseignées. Idempotent.

## Sécurité
Aucune nouvelle table, aucune politique RLS modifiée.
*/

UPDATE routes r
SET destination_station_id = sq.station_id
FROM (
  SELECT DISTINCT ON (s.city_id) s.city_id, s.id AS station_id
  FROM stations s
  WHERE s.is_active = true
  ORDER BY s.city_id, s.name
) sq
WHERE r.destination_station_id IS NULL
  AND r.destination_city_id IS NOT NULL
  AND r.destination_city_id = sq.city_id;
