/*
# Garage SBTA — Gérant Principal module (new business logic)

## Context
The Gérant Principal profile is being rebuilt as a dedicated garage management system
("Logiciel GARAGE SBTA"). This migration creates the full data model for that module,
replacing the old generic gp_stock_* tables with a proper garage schema.

## New tables
1. `garage_groupes` — vehicle groups (SBTA, TST, SNT, OUME/ISSIA, ETL, MARCEL, MOUMOUNI, OUME, OUME(AGBOVILLE), BURKINA)
2. `garage_cars` — vehicles with registration number linked to a group
3. `garage_familles` — part families (AIR, CLIMATISATION, ELECTRICITE, MECANIQUE, PNEU LONG MARCH, PNEU MICHELIN, TOLERIE)
4. `garage_sous_familles` — sub-families linked to a family
5. `garage_fournisseurs` — suppliers with contact info
6. `garage_types_techniciens` — technician types
7. `garage_pieces` — spare parts catalog (reference, name, brand, model, alert threshold, family, sub-family, unit price)
8. `garage_stock` — current stock per part (quantity can be negative, alert when <= threshold)
9. `garage_entrees_stock` — stock entry records (increment stock)
10. `garage_sorties_pieces` — part exit records (decrement stock, compute montant server-side)
11. `garage_reparations` — repair records with status (en cours / terminée)
12. `garage_commandes_pieces` — new parts ordered
13. `garage_pneus` — tire exits with type (MICHELIN / LONG-MARCH) and configurable prices

## Security
- RLS enabled on all tables.
- gerant_principal and admin can CRUD all tables.
- All other authenticated roles can SELECT (read-only) for reporting.
- Stock decrements and montant calculations happen via SECURITY DEFINER triggers (server-side).

## Important notes
- Stock quantity allows negative values (per spec: ex. -8).
- `garage_sorties_pieces.montant` and `garage_commandes_pieces.montant` and `garage_pneus.montant`
  are GENERATED ALWAYS AS (quantite * prix_unitaire) STORED — computed server-side.
- Triggers auto-increment / decrement `garage_stock.quantite` on entry/exit.
- Tire reference prices are stored in a `garage_settings` table for configurability.
*/

-- ============================================================
-- 1. garage_groupes
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_groupes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_groupes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "garage_groupes_select" ON garage_groupes;
CREATE POLICY "garage_groupes_select" ON garage_groupes FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "garage_groupes_insert" ON garage_groupes;
CREATE POLICY "garage_groupes_insert" ON garage_groupes FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

DROP POLICY IF EXISTS "garage_groupes_update" ON garage_groupes;
CREATE POLICY "garage_groupes_update" ON garage_groupes FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

DROP POLICY IF EXISTS "garage_groupes_delete" ON garage_groupes;
CREATE POLICY "garage_groupes_delete" ON garage_groupes FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 2. garage_cars
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_cars (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  immatriculation text NOT NULL,
  groupe_id    uuid REFERENCES garage_groupes(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_cars ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_cars_groupe ON garage_cars(groupe_id);
CREATE INDEX IF NOT EXISTS idx_garage_cars_immat ON garage_cars(immatriculation);

DROP POLICY IF EXISTS "garage_cars_select" ON garage_cars;
CREATE POLICY "garage_cars_select" ON garage_cars FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_cars_insert" ON garage_cars;
CREATE POLICY "garage_cars_insert" ON garage_cars FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_cars_update" ON garage_cars;
CREATE POLICY "garage_cars_update" ON garage_cars FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_cars_delete" ON garage_cars;
CREATE POLICY "garage_cars_delete" ON garage_cars FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 3. garage_familles
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_familles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_familles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "garage_familles_select" ON garage_familles;
CREATE POLICY "garage_familles_select" ON garage_familles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_familles_insert" ON garage_familles;
CREATE POLICY "garage_familles_insert" ON garage_familles FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_familles_update" ON garage_familles;
CREATE POLICY "garage_familles_update" ON garage_familles FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_familles_delete" ON garage_familles;
CREATE POLICY "garage_familles_delete" ON garage_familles FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 4. garage_sous_familles
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_sous_familles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        text NOT NULL,
  famille_id uuid NOT NULL REFERENCES garage_familles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_sous_familles ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_sous_familles_famille ON garage_sous_familles(famille_id);

DROP POLICY IF EXISTS "garage_sous_familles_select" ON garage_sous_familles;
CREATE POLICY "garage_sous_familles_select" ON garage_sous_familles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_sous_familles_insert" ON garage_sous_familles;
CREATE POLICY "garage_sous_familles_insert" ON garage_sous_familles FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_sous_familles_update" ON garage_sous_familles;
CREATE POLICY "garage_sous_familles_update" ON garage_sous_familles FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_sous_familles_delete" ON garage_sous_familles;
CREATE POLICY "garage_sous_familles_delete" ON garage_sous_familles FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 5. garage_fournisseurs
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_fournisseurs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        text NOT NULL,
  telephone  text DEFAULT '',
  adresse    text DEFAULT '',
  email      text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_fournisseurs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "garage_fournisseurs_select" ON garage_fournisseurs;
CREATE POLICY "garage_fournisseurs_select" ON garage_fournisseurs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_fournisseurs_insert" ON garage_fournisseurs;
CREATE POLICY "garage_fournisseurs_insert" ON garage_fournisseurs FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_fournisseurs_update" ON garage_fournisseurs;
CREATE POLICY "garage_fournisseurs_update" ON garage_fournisseurs FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_fournisseurs_delete" ON garage_fournisseurs;
CREATE POLICY "garage_fournisseurs_delete" ON garage_fournisseurs FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 6. garage_types_techniciens
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_types_techniciens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_types_techniciens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "garage_types_techniciens_select" ON garage_types_techniciens;
CREATE POLICY "garage_types_techniciens_select" ON garage_types_techniciens FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_types_techniciens_insert" ON garage_types_techniciens;
CREATE POLICY "garage_types_techniciens_insert" ON garage_types_techniciens FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_types_techniciens_update" ON garage_types_techniciens;
CREATE POLICY "garage_types_techniciens_update" ON garage_types_techniciens FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_types_techniciens_delete" ON garage_types_techniciens;
CREATE POLICY "garage_types_techniciens_delete" ON garage_types_techniciens FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 7. garage_pieces
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_pieces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL,
  nom              text NOT NULL,
  modele_serie     text DEFAULT '',
  marque           text DEFAULT '',
  seuil_alerte     integer NOT NULL DEFAULT 5,
  famille_id       uuid REFERENCES garage_familles(id) ON DELETE SET NULL,
  sous_famille_id  uuid REFERENCES garage_sous_familles(id) ON DELETE SET NULL,
  prix_unitaire    numeric(12,2) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_pieces ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_pieces_famille ON garage_pieces(famille_id);
CREATE INDEX IF NOT EXISTS idx_garage_pieces_sous_famille ON garage_pieces(sous_famille_id);
CREATE INDEX IF NOT EXISTS idx_garage_pieces_reference ON garage_pieces(reference);

DROP POLICY IF EXISTS "garage_pieces_select" ON garage_pieces;
CREATE POLICY "garage_pieces_select" ON garage_pieces FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_pieces_insert" ON garage_pieces;
CREATE POLICY "garage_pieces_insert" ON garage_pieces FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_pieces_update" ON garage_pieces;
CREATE POLICY "garage_pieces_update" ON garage_pieces FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_pieces_delete" ON garage_pieces;
CREATE POLICY "garage_pieces_delete" ON garage_pieces FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 8. garage_stock
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_stock (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id   uuid NOT NULL UNIQUE REFERENCES garage_pieces(id) ON DELETE CASCADE,
  quantite   integer NOT NULL DEFAULT 0,
  date_maj   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_stock ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_stock_piece ON garage_stock(piece_id);

DROP POLICY IF EXISTS "garage_stock_select" ON garage_stock;
CREATE POLICY "garage_stock_select" ON garage_stock FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_stock_insert" ON garage_stock;
CREATE POLICY "garage_stock_insert" ON garage_stock FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_stock_update" ON garage_stock;
CREATE POLICY "garage_stock_update" ON garage_stock FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_stock_delete" ON garage_stock;
CREATE POLICY "garage_stock_delete" ON garage_stock FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 9. garage_entrees_stock
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_entrees_stock (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id       uuid NOT NULL REFERENCES garage_pieces(id) ON DELETE CASCADE,
  quantite       integer NOT NULL CHECK (quantite > 0),
  date           date NOT NULL DEFAULT CURRENT_DATE,
  fournisseur_id uuid REFERENCES garage_fournisseurs(id) ON DELETE SET NULL,
  effectue_par   text DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_entrees_stock ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_entrees_piece ON garage_entrees_stock(piece_id);
CREATE INDEX IF NOT EXISTS idx_garage_entrees_date ON garage_entrees_stock(date);

DROP POLICY IF EXISTS "garage_entrees_select" ON garage_entrees_stock;
CREATE POLICY "garage_entrees_select" ON garage_entrees_stock FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_entrees_insert" ON garage_entrees_stock;
CREATE POLICY "garage_entrees_insert" ON garage_entrees_stock FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_entrees_update" ON garage_entrees_stock;
CREATE POLICY "garage_entrees_update" ON garage_entrees_stock FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_entrees_delete" ON garage_entrees_stock;
CREATE POLICY "garage_entrees_delete" ON garage_entrees_stock FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 10. garage_sorties_pieces
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_sorties_pieces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date NOT NULL DEFAULT CURRENT_DATE,
  car_id        uuid REFERENCES garage_cars(id) ON DELETE SET NULL,
  groupe_id     uuid REFERENCES garage_groupes(id) ON DELETE SET NULL,
  demandeur     text DEFAULT '',
  piece_id      uuid NOT NULL REFERENCES garage_pieces(id) ON DELETE CASCADE,
  quantite      integer NOT NULL,
  prix_unitaire numeric(12,2) NOT NULL DEFAULT 0,
  montant       numeric(14,2) GENERATED ALWAYS AS (quantite * prix_unitaire) STORED,
  effectue_par  text DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_sorties_pieces ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_sorties_piece ON garage_sorties_pieces(piece_id);
CREATE INDEX IF NOT EXISTS idx_garage_sorties_car ON garage_sorties_pieces(car_id);
CREATE INDEX IF NOT EXISTS idx_garage_sorties_groupe ON garage_sorties_pieces(groupe_id);
CREATE INDEX IF NOT EXISTS idx_garage_sorties_date ON garage_sorties_pieces(date);

DROP POLICY IF EXISTS "garage_sorties_select" ON garage_sorties_pieces;
CREATE POLICY "garage_sorties_select" ON garage_sorties_pieces FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_sorties_insert" ON garage_sorties_pieces;
CREATE POLICY "garage_sorties_insert" ON garage_sorties_pieces FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_sorties_update" ON garage_sorties_pieces;
CREATE POLICY "garage_sorties_update" ON garage_sorties_pieces FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_sorties_delete" ON garage_sorties_pieces;
CREATE POLICY "garage_sorties_delete" ON garage_sorties_pieces FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 11. garage_reparations
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_reparations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id              uuid NOT NULL REFERENCES garage_cars(id) ON DELETE CASCADE,
  date                date NOT NULL DEFAULT CURRENT_DATE,
  statut              text NOT NULL DEFAULT 'en cours' CHECK (statut IN ('en cours','terminée')),
  type_technicien_id  uuid REFERENCES garage_types_techniciens(id) ON DELETE SET NULL,
  description         text DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_reparations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_reparations_car ON garage_reparations(car_id);
CREATE INDEX IF NOT EXISTS idx_garage_reparations_date ON garage_reparations(date);
CREATE INDEX IF NOT EXISTS idx_garage_reparations_statut ON garage_reparations(statut);

DROP POLICY IF EXISTS "garage_reparations_select" ON garage_reparations;
CREATE POLICY "garage_reparations_select" ON garage_reparations FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_reparations_insert" ON garage_reparations;
CREATE POLICY "garage_reparations_insert" ON garage_reparations FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_reparations_update" ON garage_reparations;
CREATE POLICY "garage_reparations_update" ON garage_reparations FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_reparations_delete" ON garage_reparations;
CREATE POLICY "garage_reparations_delete" ON garage_reparations FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 12. garage_commandes_pieces
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_commandes_pieces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date NOT NULL DEFAULT CURRENT_DATE,
  designation   text NOT NULL,
  car_id        uuid REFERENCES garage_cars(id) ON DELETE SET NULL,
  groupe_id     uuid REFERENCES garage_groupes(id) ON DELETE SET NULL,
  quantite      integer NOT NULL,
  prix_unitaire numeric(12,2) NOT NULL DEFAULT 0,
  montant       numeric(14,2) GENERATED ALWAYS AS (quantite * prix_unitaire) STORED,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_commandes_pieces ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_commandes_groupe ON garage_commandes_pieces(groupe_id);
CREATE INDEX IF NOT EXISTS idx_garage_commandes_date ON garage_commandes_pieces(date);

DROP POLICY IF EXISTS "garage_commandes_select" ON garage_commandes_pieces;
CREATE POLICY "garage_commandes_select" ON garage_commandes_pieces FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_commandes_insert" ON garage_commandes_pieces;
CREATE POLICY "garage_commandes_insert" ON garage_commandes_pieces FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_commandes_update" ON garage_commandes_pieces;
CREATE POLICY "garage_commandes_update" ON garage_commandes_pieces FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_commandes_delete" ON garage_commandes_pieces;
CREATE POLICY "garage_commandes_delete" ON garage_commandes_pieces FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 13. garage_pneus
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_pneus (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date          date NOT NULL DEFAULT CURRENT_DATE,
  car_id        uuid REFERENCES garage_cars(id) ON DELETE SET NULL,
  groupe_id     uuid REFERENCES garage_groupes(id) ON DELETE SET NULL,
  type_pneu     text NOT NULL CHECK (type_pneu IN ('MICHELIN','LONG-MARCH')),
  quantite      integer NOT NULL,
  prix_unitaire numeric(12,2) NOT NULL DEFAULT 0,
  montant       numeric(14,2) GENERATED ALWAYS AS (quantite * prix_unitaire) STORED,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE garage_pneus ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_garage_pneus_groupe ON garage_pneus(groupe_id);
CREATE INDEX IF NOT EXISTS idx_garage_pneus_date ON garage_pneus(date);
CREATE INDEX IF NOT EXISTS idx_garage_pneus_type ON garage_pneus(type_pneu);

DROP POLICY IF EXISTS "garage_pneus_select" ON garage_pneus;
CREATE POLICY "garage_pneus_select" ON garage_pneus FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_pneus_insert" ON garage_pneus;
CREATE POLICY "garage_pneus_insert" ON garage_pneus FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_pneus_update" ON garage_pneus;
CREATE POLICY "garage_pneus_update" ON garage_pneus FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_pneus_delete" ON garage_pneus;
CREATE POLICY "garage_pneus_delete" ON garage_pneus FOR DELETE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

-- ============================================================
-- 14. garage_settings — configurable tire prices
-- ============================================================
CREATE TABLE IF NOT EXISTS garage_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  value       numeric(12,2) NOT NULL DEFAULT 0
);
ALTER TABLE garage_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "garage_settings_select" ON garage_settings;
CREATE POLICY "garage_settings_select" ON garage_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "garage_settings_insert" ON garage_settings;
CREATE POLICY "garage_settings_insert" ON garage_settings FOR INSERT
  TO authenticated WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));
DROP POLICY IF EXISTS "garage_settings_update" ON garage_settings;
CREATE POLICY "garage_settings_update" ON garage_settings FOR UPDATE
  TO authenticated USING ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'))
  WITH CHECK ((auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal','admin'));

INSERT INTO garage_settings (key, value) VALUES
  ('prix_michelin', 325000),
  ('prix_long_march', 135000)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- TRIGGERS: auto-update stock on entry (increment)
-- ============================================================
CREATE OR REPLACE FUNCTION garage_entry_update_stock()
RETURNS trigger AS $$
BEGIN
  INSERT INTO garage_stock (piece_id, quantite, date_maj)
  VALUES (NEW.piece_id, NEW.quantite, now())
  ON CONFLICT (piece_id) DO UPDATE
    SET quantite = garage_stock.quantite + NEW.quantite,
        date_maj = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_garage_entry_stock ON garage_entrees_stock;
CREATE TRIGGER trg_garage_entry_stock
  AFTER INSERT ON garage_entrees_stock
  FOR EACH ROW EXECUTE FUNCTION garage_entry_update_stock();

-- ============================================================
-- TRIGGERS: auto-update stock on exit (decrement, allows negative)
-- ============================================================
CREATE OR REPLACE FUNCTION garage_exit_update_stock()
RETURNS trigger AS $$
BEGIN
  INSERT INTO garage_stock (piece_id, quantite, date_maj)
  VALUES (NEW.piece_id, -NEW.quantite, now())
  ON CONFLICT (piece_id) DO UPDATE
    SET quantite = garage_stock.quantite - NEW.quantite,
        date_maj = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_garage_exit_stock ON garage_sorties_pieces;
CREATE TRIGGER trg_garage_exit_stock
  AFTER INSERT ON garage_sorties_pieces
  FOR EACH ROW EXECUTE FUNCTION garage_exit_update_stock();

-- ============================================================
-- SEED: initial groupes and familles
-- ============================================================
INSERT INTO garage_groupes (nom) VALUES
  ('SBTA'), ('TST'), ('SNT'), ('OUME/ISSIA'), ('ETL'),
  ('MARCEL'), ('MOUMOUNI'), ('OUME'), ('OUME(AGBOVILLE)'), ('BURKINA')
ON CONFLICT (nom) DO NOTHING;

INSERT INTO garage_familles (nom) VALUES
  ('AIR'), ('CLIMATISATION'), ('ELECTRICITE'), ('MECANIQUE'),
  ('PNEU LONG MARCH'), ('PNEU MICHELIN'), ('TOLERIE')
ON CONFLICT (nom) DO NOTHING;
