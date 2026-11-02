-- Audit read-only (SELECT uniquement). Cartographie du schéma public.

SHOW timezone;

-- Tables avec colonne de rattachement à une gare
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('station_id', 'departure_station_id', 'origin_station_id', 'destination_station_id', 'schedule_id', 'reservation_id', 'parcel_id')
ORDER BY table_name, column_name;

-- Colonnes de date de création et utilisateur saisissant
SELECT table_name,
       bool_or(column_name = 'created_at') AS has_created_at,
       string_agg(column_name, ', ') FILTER (WHERE column_name IN ('created_by', 'booked_by', 'sold_by', 'registered_by', 'user_id', 'processed_by', 'paid_by')) AS user_columns
FROM information_schema.columns
WHERE table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;

-- Clés étrangères et règles ON DELETE
SELECT c.conrelid::regclass AS table_enfant,
       string_agg(DISTINCT a.attname, ', ') AS colonnes,
       c.confrelid::regclass AS table_parent,
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND c.connamespace = 'public'::regnamespace
GROUP BY c.conrelid, c.confrelid, c.confdeltype
ORDER BY 3, 1;

-- Tables sans colonne de gare ni de date de création (difficiles à nettoyer)
SELECT t.table_name
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = t.table_name
      AND c.column_name IN ('station_id', 'departure_station_id', 'origin_station_id', 'destination_station_id', 'schedule_id', 'reservation_id', 'parcel_id')
  )
ORDER BY t.table_name;
