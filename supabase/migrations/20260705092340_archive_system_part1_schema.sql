/*
# Système d'archivage intelligent SBTA/EAFRIBUS — Partie 1: Schéma

## Résumé
Met en place l'infrastructure de stockage du système d'archivage automatique.
L'objectif est de conserver toutes les données historiques tout en gardant les
tables actives légères et rapides. Le système est piloté par configuration:
un administrateur peut ajouter à la demande de nouveaux types de données à
archiver, à purger, ou à conserver de façon permanente.

## Nouvelles tables
1. `archive_policies` — Configuration (extensible) de chaque type de donnée:
   - `source_table` (text, unique) table source (ex: reservations)
   - `label` (text) libellé affiché (ex: Réservations)
   - `category` (text) 'metier' | 'temporaire' | 'log'
   - `date_column` (text) colonne d'ancienneté (ex: created_at)
   - `retention_months` (int) durée de conservation avant archivage/purge
   - `action` (text) 'archive' (déplacer vers archives) | 'purge' (supprimer) | 'keep' (jamais toucher)
   - `reference_column`, `client_name_column`, `phone_column`, `amount_column`,
     `company_column`, `station_column`, `bus_column`, `driver_column` — colonnes
     extraites pour rendre les archives consultables comme les données actives
   - `is_active` (bool), `sort_order` (int) ordre de traitement (enfants avant parents)
2. `archived_records` — Entrepôt générique des données archivées:
   - snapshot complet `data` (jsonb) + colonnes de recherche extraites
   - `source_table`, `source_id`, `reference`, `client_name`, `client_phone`,
     `amount`, `record_date`, `company_id`, `station_id`, `bus_id`, `driver_id`
   - unicité (source_table, source_id) pour éviter les doublons
3. `archive_runs` — Journal des exécutions d'archivage (manuel/auto) avec compteurs.
4. `archive_settings` — Réglages (ligne unique): activation, planification, dernier run.

## Sécurité (RLS)
- RLS activée sur les 4 tables.
- Fonctions SECURITY DEFINER `archive_role()`, `archive_can_view()`, `archive_is_admin()`
  pour lire le rôle sans dépendre de la RLS de `users`.
- Consultation des archives et du tableau de bord: admin, daf, gestionnaire
  (permet au DAF et au gestionnaire de toujours consulter l'historique).
- Écriture/configuration: admin uniquement.

## Notes importantes
1. Aucune table métier existante n'est modifiée: le système est additif.
2. Aucune donnée n'est supprimée par cette migration.
*/

-- 1. Helper functions (bypass users RLS safely)
CREATE OR REPLACE FUNCTION archive_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role::text FROM users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION archive_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role::text = 'admin');
$$;

CREATE OR REPLACE FUNCTION archive_can_view()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND role::text IN ('admin','daf','gestionnaire','gerant_principal')
  );
$$;

-- 2. Configuration table
CREATE TABLE IF NOT EXISTS archive_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL UNIQUE,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'metier' CHECK (category IN ('metier','temporaire','log')),
  date_column text NOT NULL DEFAULT 'created_at',
  retention_months integer NOT NULL DEFAULT 12 CHECK (retention_months >= 0),
  action text NOT NULL DEFAULT 'archive' CHECK (action IN ('archive','purge','keep')),
  reference_column text,
  client_name_column text,
  phone_column text,
  amount_column text,
  company_column text,
  station_column text,
  bus_column text,
  driver_column text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE archive_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "archive_policies_select" ON archive_policies;
CREATE POLICY "archive_policies_select" ON archive_policies FOR SELECT
  TO authenticated USING (archive_can_view());

DROP POLICY IF EXISTS "archive_policies_insert" ON archive_policies;
CREATE POLICY "archive_policies_insert" ON archive_policies FOR INSERT
  TO authenticated WITH CHECK (archive_is_admin());

DROP POLICY IF EXISTS "archive_policies_update" ON archive_policies;
CREATE POLICY "archive_policies_update" ON archive_policies FOR UPDATE
  TO authenticated USING (archive_is_admin()) WITH CHECK (archive_is_admin());

DROP POLICY IF EXISTS "archive_policies_delete" ON archive_policies;
CREATE POLICY "archive_policies_delete" ON archive_policies FOR DELETE
  TO authenticated USING (archive_is_admin());

-- 3. Archive runs log
CREATE TABLE IF NOT EXISTS archive_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL DEFAULT 'manual' CHECK (run_type IN ('manual','auto')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  triggered_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_archived integer NOT NULL DEFAULT 0,
  total_purged integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text
);

ALTER TABLE archive_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "archive_runs_select" ON archive_runs;
CREATE POLICY "archive_runs_select" ON archive_runs FOR SELECT
  TO authenticated USING (archive_can_view());

-- 4. Archived records store
CREATE TABLE IF NOT EXISTS archived_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  reference text,
  client_name text,
  client_phone text,
  amount numeric,
  record_date timestamptz,
  company_id uuid,
  station_id uuid,
  bus_id uuid,
  driver_id uuid,
  data jsonb NOT NULL,
  archive_run_id uuid,
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);

ALTER TABLE archived_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "archived_records_select" ON archived_records;
CREATE POLICY "archived_records_select" ON archived_records FOR SELECT
  TO authenticated USING (archive_can_view());

-- 5. Settings (single row)
CREATE TABLE IF NOT EXISTS archive_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_enabled boolean NOT NULL DEFAULT true,
  schedule_cron text NOT NULL DEFAULT '0 2 * * *',
  schedule_label text NOT NULL DEFAULT 'Chaque nuit à 02h00',
  retention_default integer NOT NULL DEFAULT 12,
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE archive_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "archive_settings_select" ON archive_settings;
CREATE POLICY "archive_settings_select" ON archive_settings FOR SELECT
  TO authenticated USING (archive_can_view());

DROP POLICY IF EXISTS "archive_settings_update" ON archive_settings;
CREATE POLICY "archive_settings_update" ON archive_settings FOR UPDATE
  TO authenticated USING (archive_is_admin()) WITH CHECK (archive_is_admin());

INSERT INTO archive_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 6. Search & performance indexes on the archive store
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_archived_source ON archived_records (source_table);
CREATE INDEX IF NOT EXISTS idx_archived_record_date ON archived_records (record_date);
CREATE INDEX IF NOT EXISTS idx_archived_company ON archived_records (company_id);
CREATE INDEX IF NOT EXISTS idx_archived_station ON archived_records (station_id);
CREATE INDEX IF NOT EXISTS idx_archived_bus ON archived_records (bus_id);
CREATE INDEX IF NOT EXISTS idx_archived_driver ON archived_records (driver_id);
CREATE INDEX IF NOT EXISTS idx_archived_ref_trgm ON archived_records USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_archived_client_trgm ON archived_records USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_archived_phone_trgm ON archived_records USING gin (client_phone gin_trgm_ops);
