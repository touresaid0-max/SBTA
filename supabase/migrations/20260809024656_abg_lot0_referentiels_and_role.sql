/*
# Gestion Agboville — LOT 0: Référentiels additifs + rôle

## Objectif
Pose le poste "Gestion Agboville" et les référentiels additives (sociétés, segments directionnels, guichets source) sans modifier aucune table, route ou logique SBTA existante.

## 1. Nouvelles tables

### abg_societes
Référentiel des sociétés de la ligne Agboville.
- id (uuid, PK)
- code (text, unique, not null) — valeurs: SBTA, ETL, SNT, TST, GROUP_OUME, AUTRES
- name (text, not null) — libellé affiché
- sub_group (text, nullable) — sous-groupe optionnel
- is_active (boolean, default true)
- created_at (timestamptz, default now())

### abg_segments
Segments directionnels de la ligne Agboville.
- id (uuid, PK)
- code (text, unique, not null) — ex: YOPOUGON_AGBOVILLE
- label (text, not null) — libellé affiché
- origin_city (text, not null)
- destination_city (text, not null)
- is_active (boolean, default true)
- created_at (timestamptz, default now())

### abg_guichet_srcs
Guichets "ligne Agboville" par gare, rattachés à une société.
Réutilise en lecture les gares SBTA existantes via station_id (FK vers stations.id).
- id (uuid, PK)
- station_id (uuid, FK vers stations.id, not null) — gare SBTA existante
- societe_id (uuid, FK vers abg_societes.id, not null) — société de rattachement
- gare_label (text, not null) — libellé du guichet (Yopougon, Adjamé Mirador, Agboville, Gagnoa)
- is_active (boolean, default true)
- created_at (timestamptz, default now())

## 2. Sécurité (RLS)

Les 3 tables sont accessibles en lecture/écriture uniquement aux rôles `gestion_agboville` et `admin`.
Aucun autre rôle ne peut accéder à ces tables.
Les référentiels SBTA existants (stations, buses, routes) restent en lecture pour tous les authenticated — pas de modification.

## 3. Rôle

Insertion du rôle `gestion_agboville` dans la table `roles` (display_name = 'Gestion Agboville').

## 4. Notes importantes

- Aucune table existante n'est modifiée.
- Aucune politique RLS existante n'est modifiée.
- Les FK vers stations.id réutilisent le référentiel SBTA en lecture seule.
- Toutes les opérations sont idempotentes (IF NOT EXISTS / ON CONFLICT).
*/

-- ============================================================
-- 1. Table: abg_societes
-- ============================================================
CREATE TABLE IF NOT EXISTS abg_societes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text UNIQUE NOT NULL,
  name       text NOT NULL,
  sub_group  text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE abg_societes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abg_societes_select" ON abg_societes;
CREATE POLICY "abg_societes_select" ON abg_societes FOR SELECT
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_societes_insert" ON abg_societes;
CREATE POLICY "abg_societes_insert" ON abg_societes FOR INSERT
  TO authenticated WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_societes_update" ON abg_societes;
CREATE POLICY "abg_societes_update" ON abg_societes FOR UPDATE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'))
  WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_societes_delete" ON abg_societes;
CREATE POLICY "abg_societes_delete" ON abg_societes FOR DELETE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

-- ============================================================
-- 2. Table: abg_segments
-- ============================================================
CREATE TABLE IF NOT EXISTS abg_segments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,
  label           text NOT NULL,
  origin_city     text NOT NULL,
  destination_city text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE abg_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abg_segments_select" ON abg_segments;
CREATE POLICY "abg_segments_select" ON abg_segments FOR SELECT
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_segments_insert" ON abg_segments;
CREATE POLICY "abg_segments_insert" ON abg_segments FOR INSERT
  TO authenticated WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_segments_update" ON abg_segments;
CREATE POLICY "abg_segments_update" ON abg_segments FOR UPDATE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'))
  WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_segments_delete" ON abg_segments;
CREATE POLICY "abg_segments_delete" ON abg_segments FOR DELETE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

-- ============================================================
-- 3. Table: abg_guichet_srcs
-- ============================================================
CREATE TABLE IF NOT EXISTS abg_guichet_srcs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id  uuid NOT NULL REFERENCES public.stations(id) ON DELETE RESTRICT,
  societe_id  uuid NOT NULL REFERENCES public.abg_societes(id) ON DELETE RESTRICT,
  gare_label  text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abg_guichet_srcs_station ON abg_guichet_srcs(station_id);
CREATE INDEX IF NOT EXISTS idx_abg_guichet_srcs_societe ON abg_guichet_srcs(societe_id);

ALTER TABLE abg_guichet_srcs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abg_guichet_srcs_select" ON abg_guichet_srcs;
CREATE POLICY "abg_guichet_srcs_select" ON abg_guichet_srcs FOR SELECT
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_guichet_srcs_insert" ON abg_guichet_srcs;
CREATE POLICY "abg_guichet_srcs_insert" ON abg_guichet_srcs FOR INSERT
  TO authenticated WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_guichet_srcs_update" ON abg_guichet_srcs;
CREATE POLICY "abg_guichet_srcs_update" ON abg_guichet_srcs FOR UPDATE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'))
  WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_guichet_srcs_delete" ON abg_guichet_srcs;
CREATE POLICY "abg_guichet_srcs_delete" ON abg_guichet_srcs FOR DELETE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

-- ============================================================
-- 4. Rôle: gestion_agboville
-- ============================================================
INSERT INTO roles (name, display_name, description, level, is_system)
VALUES ('gestion_agboville', 'Gestion Agboville', 'Gestionnaire de la ligne Agboville', 30, false)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 5. Seed: sociétés par défaut
-- ============================================================
INSERT INTO abg_societes (code, name, sub_group) VALUES
  ('SBTA',        'SBTA',        NULL),
  ('ETL',         'ETL',         NULL),
  ('SNT',         'SNT',         NULL),
  ('TST',         'TST',         NULL),
  ('GROUP_OUME',  'GROUP OUME',  NULL),
  ('AUTRES',      'AUTRES',      NULL)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 6. Seed: segments directionnels
-- ============================================================
INSERT INTO abg_segments (code, label, origin_city, destination_city) VALUES
  ('YOPOUGON_AGBOVILLE',       'Yopougon → Agboville',         'Yopougon',   'Agboville'),
  ('AGBOVILLE_YOPOUGON',       'Agboville → Yopougon',         'Agboville',  'Yopougon'),
  ('ADJAME_MIRADOR_AGBOVILLE', 'Adjamé Mirador → Agboville',   'Adjamé Mirador', 'Agboville'),
  ('AGBOVILLE_ADJAME',         'Agboville → Adjamé',           'Agboville',  'Adjamé'),
  ('AGBOVILLE_GAGNOA_AGBOVILLE','Agboville → Gagnoa → Agboville','Agboville', 'Gagnoa')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 7. Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
