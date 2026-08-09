/*
# Gestion Agboville — LOT 5: Dépenses AO / HAO

## Objectif
Registre des dépenses AO (Acquisition d'Ordinaire = charges d'exploitation récurrentes)
et HAO (Hors Acquisition d'Ordinaire = exceptionnelles) pour la gare d'Agboville ville.
C'est la seule zone de saisie manuelle du module Gestion Agboville.

## 1. Nouvelle table: abg_depenses
- id (uuid, PK)
- date_depense (date, not null) — date de la dépense
- source_libelle (text, not null) — source: GARE SBTA, BUREAU, MECANO, MOTO, 4x4, ou matricule
- nature (text, not null) — nature: carburant, essence, maçonnerie, électricité gare, SODECI, etc.
- montant (numeric, not null) — montant de la dépense
- type_depense (text, not null) — 'AO' ou 'HAO'
- categorie (text, nullable) — catégorie optionnelle
- societe_code (text, nullable) — société optionnelle
- car_matricule (text, nullable) — matricule optionnel
- gare_label (text, nullable) — gare optionnelle
- description (text, nullable) — description libre
- created_by (uuid, nullable)
- created_at (timestamptz, default now())

## 2. Seed: catégories par défaut
Catégories AO: carburant, essence, électricité gare, SODECI, garniture, lavage clim, courroies, caoutchouc, roulements, vulganisation, tuyaux de clim, câble de vitesse
Catégories HAO: dons, maçonnerie/portail, transport de gravier, autres exceptionnels

## 3. Sécurité (RLS)
Accès limité aux rôles gestion_agboville et admin.

## 4. Notes
- Aucune table existante modifiée
- La déduction AO/HAO est paramétrable par catégorie mais l'utilisateur peut forcer le type
*/

-- ============================================================
-- 1. Table: abg_depenses
-- ============================================================
CREATE TABLE IF NOT EXISTS abg_depenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_depense  date NOT NULL,
  source_libelle text NOT NULL,
  nature        text NOT NULL,
  montant       numeric NOT NULL DEFAULT 0,
  type_depense  text NOT NULL DEFAULT 'AO' CHECK (type_depense IN ('AO', 'HAO')),
  categorie     text,
  societe_code  text,
  car_matricule text,
  gare_label    text,
  description   text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abg_depenses_date ON abg_depenses(date_depense);
CREATE INDEX IF NOT EXISTS idx_abg_depenses_type ON abg_depenses(type_depense);
CREATE INDEX IF NOT EXISTS idx_abg_depenses_source ON abg_depenses(source_libelle);
CREATE INDEX IF NOT EXISTS idx_abg_depenses_categorie ON abg_depenses(categorie);

ALTER TABLE abg_depenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abg_depenses_select" ON abg_depenses;
CREATE POLICY "abg_depenses_select" ON abg_depenses FOR SELECT
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_depenses_insert" ON abg_depenses;
CREATE POLICY "abg_depenses_insert" ON abg_depenses FOR INSERT
  TO authenticated WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_depenses_update" ON abg_depenses;
CREATE POLICY "abg_depenses_update" ON abg_depenses FOR UPDATE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'))
  WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_depenses_delete" ON abg_depenses;
CREATE POLICY "abg_depenses_delete" ON abg_depenses FOR DELETE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

-- ============================================================
-- 2. Seed: référentiel de catégories (table utilitaire)
-- ============================================================
CREATE TABLE IF NOT EXISTS abg_depense_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text UNIQUE NOT NULL,
  label      text NOT NULL,
  type_depense text NOT NULL CHECK (type_depense IN ('AO', 'HAO')),
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

ALTER TABLE abg_depense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abg_depense_categories_select" ON abg_depense_categories;
CREATE POLICY "abg_depense_categories_select" ON abg_depense_categories FOR SELECT
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_depense_categories_insert" ON abg_depense_categories;
CREATE POLICY "abg_depense_categories_insert" ON abg_depense_categories FOR INSERT
  TO authenticated WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_depense_categories_update" ON abg_depense_categories;
CREATE POLICY "abg_depense_categories_update" ON abg_depense_categories FOR UPDATE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'))
  WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_depense_categories_delete" ON abg_depense_categories;
CREATE POLICY "abg_depense_categories_delete" ON abg_depense_categories FOR DELETE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

INSERT INTO abg_depense_categories (code, label, type_depense, sort_order) VALUES
  ('carburant',         'Carburant',           'AO',  1),
  ('essence',           'Essence',             'AO',  2),
  ('electricite_gare',  'Électricité gare',    'AO',  3),
  ('sodeci',            'SODECI',              'AO',  4),
  ('garniture',         'Garniture',           'AO',  5),
  ('lavage_clim',       'Lavage clim',         'AO',  6),
  ('courroies',         'Courroies',           'AO',  7),
  ('caoutchouc',        'Caoutchouc',          'AO',  8),
  ('roulements',        'Roulements',          'AO',  9),
  ('vulganisation',     'Vulganisation',       'AO', 10),
  ('tuyaux_clim',       'Tuyaux de clim',      'AO', 11),
  ('cable_vitesse',     'Câble de vitesse',    'AO', 12),
  ('dons',              'Dons',                'HAO', 1),
  ('maconnerie_portail','Maçonnerie / Portail','HAO', 2),
  ('transport_gravier', 'Transport de gravier','HAO', 3),
  ('autres_exceptionnels','Autres exceptionnels','HAO', 4)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
