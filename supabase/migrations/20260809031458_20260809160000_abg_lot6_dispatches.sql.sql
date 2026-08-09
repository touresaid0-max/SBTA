/*
# Gestion Agboville — LOT 6: Dispatch (état de répartition du résultat net)

## Objectif
Génération et suivi d'états de dispatch par société / sous-groupe, destinés
aux responsables et comptables correspondants, avec statut d'envoi.

## 1. Nouvelle table: abg_dispatches
- id (uuid, PK)
- periode_type (text) — 'hebdo', 'mensuel', 'annuel'
- periode_value (text) — ex: '2026-08', '2026-S33', '2026'
- societe_code (text, not null)
- sous_groupe (text, nullable) — sous-groupe optionnel
- responsable_nom (text, nullable) — nom du responsable
- comptable_nom (text, nullable) — nom du comptable
- recettes (numeric, default 0)
- depense_pr (numeric, default 0)
- total_ao (numeric, default 0)
- total_hao (numeric, default 0)
- resultat_net (numeric, default 0) — résultats d'exploitation - total AO - total HAO
- statut (text, default 'genere') — 'genere', 'envoye', 'recu'
- envoye_at (timestamptz, nullable)
- envoye_par (uuid, nullable)
- note (text, nullable)
- created_by (uuid, nullable)
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())

## 2. RPC: abg_generate_dispatch
Génère ou met à jour un état de dispatch pour une période/société donnée.
Calcule automatiquement: recettes, dépense P/R, AO, HAO, résultat net.

## 3. Sécurité (RLS)
Accès limité aux rôles gestion_agboville et admin.
*/

-- ============================================================
-- 1. Table: abg_dispatches
-- ============================================================
CREATE TABLE IF NOT EXISTS abg_dispatches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periode_type    text NOT NULL CHECK (periode_type IN ('hebdo', 'mensuel', 'annuel')),
  periode_value   text NOT NULL,
  societe_code    text NOT NULL,
  sous_groupe     text,
  responsable_nom text,
  comptable_nom   text,
  recettes        numeric NOT NULL DEFAULT 0,
  depense_pr      numeric NOT NULL DEFAULT 0,
  total_ao        numeric NOT NULL DEFAULT 0,
  total_hao       numeric NOT NULL DEFAULT 0,
  resultat_net    numeric NOT NULL DEFAULT 0,
  statut          text NOT NULL DEFAULT 'genere' CHECK (statut IN ('genere', 'envoye', 'recu')),
  envoye_at       timestamptz,
  envoye_par      uuid,
  note            text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_abg_dispatches_unique
  ON abg_dispatches(periode_type, periode_value, societe_code);

CREATE INDEX IF NOT EXISTS idx_abg_dispatches_statut ON abg_dispatches(statut);
CREATE INDEX IF NOT EXISTS idx_abg_dispatches_periode ON abg_dispatches(periode_type, periode_value);

ALTER TABLE abg_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abg_dispatches_select" ON abg_dispatches;
CREATE POLICY "abg_dispatches_select" ON abg_dispatches FOR SELECT
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_dispatches_insert" ON abg_dispatches;
CREATE POLICY "abg_dispatches_insert" ON abg_dispatches FOR INSERT
  TO authenticated WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_dispatches_update" ON abg_dispatches;
CREATE POLICY "abg_dispatches_update" ON abg_dispatches FOR UPDATE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'))
  WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_dispatches_delete" ON abg_dispatches;
CREATE POLICY "abg_dispatches_delete" ON abg_dispatches FOR DELETE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

-- ============================================================
-- 2. Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
