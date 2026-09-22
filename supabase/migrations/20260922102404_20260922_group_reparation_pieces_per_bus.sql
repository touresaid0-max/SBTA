/*
# Regrouper les pièces sorties par bus dans une seule réparation

## Problème
Le trigger précédent créait une réparation séparée pour chaque sortie de pièce.
L'utilisateur veut qu'il n'y ait qu'une seule réparation par bus, regroupant
toutes les pièces sorties pour ce bus, avec chaque pièce listée dans la description.

## Solution
1. Créer une table de liaison `garage_reparation_pieces` qui stocke toutes les
   pièces rattachées à une réparation (pièce, quantité, prix, montant, source_sortie_id).
2. Modifier le trigger `auto_create_reparation_from_sortie` :
   - Trouver la réparation active existante pour ce bus (statut != 'LIBÉRÉ')
   - Si elle existe, ajouter la pièce à la table de liaison
   - Sinon, créer une nouvelle réparation BROUILLON et ajouter la pièce
   - Mettre à jour la description de la réparation avec la liste de toutes les pièces
3. Nettoyer les doublons : pour les bus qui ont plusieurs réparations auto-créées
   (source_sortie_id IS NOT NULL), consolider en une seule et déplacer les pièces
   vers la table de liaison.
4. Mettre à jour les descriptions des réparations consolidées.

## Sécurité
- RLS activée sur garage_reparation_pieces.
- Policies CRUD pour authenticated.
*/

-- ===========================================================================
-- 1. Créer la table de liaison garage_reparation_pieces
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.garage_reparation_pieces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reparation_id   uuid NOT NULL REFERENCES public.garage_reparations(id) ON DELETE CASCADE,
  piece_id        uuid REFERENCES public.garage_pieces(id) ON DELETE SET NULL,
  sortie_id       uuid REFERENCES public.garage_sorties_pieces(id) ON DELETE SET NULL,
  quantite        integer NOT NULL DEFAULT 1,
  prix_unitaire   numeric,
  montant         numeric,
  date_sortie     date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garage_reparation_pieces_reparation
  ON public.garage_reparation_pieces(reparation_id);
CREATE INDEX IF NOT EXISTS idx_garage_reparation_pieces_sortie
  ON public.garage_reparation_pieces(sortie_id);

ALTER TABLE public.garage_reparation_pieces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_reparation_pieces" ON public.garage_reparation_pieces;
CREATE POLICY "select_reparation_pieces"
  ON public.garage_reparation_pieces FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_reparation_pieces" ON public.garage_reparation_pieces;
CREATE POLICY "insert_reparation_pieces"
  ON public.garage_reparation_pieces FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_reparation_pieces" ON public.garage_reparation_pieces;
CREATE POLICY "update_reparation_pieces"
  ON public.garage_reparation_pieces FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_reparation_pieces" ON public.garage_reparation_pieces;
CREATE POLICY "delete_reparation_pieces"
  ON public.garage_reparation_pieces FOR DELETE
  TO authenticated USING (true);

-- ===========================================================================
-- 2. Fonction utilitaire : regénérer la description d'une réparation
--    à partir des pièces rattachées dans garage_reparation_pieces
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.regenerate_reparation_description(p_reparation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines text[];
  v_description text;
  v_piece_nom text;
  v_quantite integer;
BEGIN
  SELECT array_agg(
    COALESCE(p.nom, 'pièce inconnue') || ' — Qté : ' || rp.quantite
    ORDER BY rp.created_at
  ) INTO v_lines
  FROM public.garage_reparation_pieces rp
  LEFT JOIN public.garage_pieces p ON p.id = rp.piece_id
  WHERE rp.reparation_id = p_reparation_id;

  IF v_lines IS NOT NULL AND array_length(v_lines, 1) > 0 THEN
    v_description := array_to_string(v_lines, E'\n');
    UPDATE public.garage_reparations
    SET description = v_description
    WHERE id = p_reparation_id;
  END IF;
END;
$$;

-- ===========================================================================
-- 3. Remplacer le trigger : regrouper par bus au lieu d'une réparation par sortie
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.auto_create_reparation_from_sortie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus_id uuid;
  v_existing_reparation_id uuid;
  v_piece_nom text;
  v_already_linked integer;
BEGIN
  -- Résoudre bus_id
  SELECT id INTO v_bus_id FROM public.buses WHERE id = NEW.car_id LIMIT 1;

  IF v_bus_id IS NULL THEN
    SELECT b.id INTO v_bus_id
    FROM public.buses b
    JOIN public.garage_cars gc ON gc.immatriculation = b.registration_number
    WHERE gc.id = NEW.car_id
    LIMIT 1;
  END IF;

  IF v_bus_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Vérifier si cette sortie est déjà liée à une réparation
  SELECT count(*) INTO v_already_linked
  FROM public.garage_reparation_pieces
  WHERE sortie_id = NEW.id;

  IF v_already_linked > 0 THEN
    -- Mettre à jour les quantités si la sortie a été modifiée
    UPDATE public.garage_reparation_pieces
    SET quantite = NEW.quantite, prix_unitaire = NEW.prix_unitaire,
        montant = NEW.montant, date_sortie = NEW.date
    WHERE sortie_id = NEW.id;
    -- Régénérer la description
    PERFORM public.regenerate_reparation_description(
      (SELECT reparation_id FROM public.garage_reparation_pieces WHERE sortie_id = NEW.id LIMIT 1)
    );
    RETURN NEW;
  END IF;

  -- Trouver une réparation active existante pour ce bus
  SELECT id INTO v_existing_reparation_id
  FROM public.garage_reparations
  WHERE bus_id = v_bus_id AND statut != 'LIBÉRÉ'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Si aucune réparation active, en créer une nouvelle
  IF v_existing_reparation_id IS NULL THEN
    INSERT INTO public.garage_reparations (bus_id, car_id, date, statut, description, source_sortie_id)
    VALUES (v_bus_id, NULL, NEW.date, 'BROUILLON', '', NEW.id)
    RETURNING id INTO v_existing_reparation_id;
  END IF;

  -- Récupérer le nom de la pièce
  SELECT p.nom INTO v_piece_nom FROM public.garage_pieces p WHERE p.id = NEW.piece_id LIMIT 1;

  -- Ajouter la pièce à la table de liaison
  INSERT INTO public.garage_reparation_pieces (reparation_id, piece_id, sortie_id, quantite, prix_unitaire, montant, date_sortie)
  VALUES (v_existing_reparation_id, NEW.piece_id, NEW.id, NEW.quantite, NEW.prix_unitaire, NEW.montant, NEW.date);

  -- Régénérer la description
  PERFORM public.regenerate_reparation_description(v_existing_reparation_id);

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 4. Nettoyer les doublons existants : consolider les réparations auto-créées
--    par bus en une seule, et déplacer les pièces vers la table de liaison
-- ===========================================================================

-- D'abord, insérer les entrées dans garage_reparation_pieces pour toutes les
-- réparations existantes qui ont un source_sortie_id
INSERT INTO public.garage_reparation_pieces (reparation_id, piece_id, sortie_id, quantite, prix_unitaire, montant, date_sortie)
SELECT r.id, r.piece_id, r.source_sortie_id, sp.quantite, sp.prix_unitaire, sp.montant, sp.date
FROM public.garage_reparations r
JOIN public.garage_sorties_pieces sp ON sp.id = r.source_sortie_id
WHERE r.source_sortie_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.garage_reparation_pieces rp WHERE rp.sortie_id = r.source_sortie_id
  )
ON CONFLICT DO NOTHING;

-- Pour chaque bus, choisir une réparation "principale" (la plus ancienne avec
-- source_sortie_id, sinon la plus ancienne) et consolider les pièces des autres
-- réparations auto-créées vers celle-ci
DO $$
DECLARE
  v_bus record;
  v_main_reparation_id uuid;
  v_reparation record;
BEGIN
  FOR v_bus IN
    SELECT DISTINCT bus_id FROM public.garage_reparations WHERE bus_id IS NOT NULL
  LOOP
    -- Trouver la réparation principale : préférence à celle avec source_sortie_id la plus ancienne
    SELECT id INTO v_main_reparation_id
    FROM public.garage_reparations
    WHERE bus_id = v_bus.bus_id AND statut != 'LIBÉRÉ'
    ORDER BY (source_sortie_id IS NOT NULL) DESC, created_at ASC
    LIMIT 1;

    IF v_main_reparation_id IS NULL THEN
      -- Toutes les réparations sont LIBÉRÉ pour ce bus, prendre la plus ancienne
      SELECT id INTO v_main_reparation_id
      FROM public.garage_reparations
      WHERE bus_id = v_bus.bus_id
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF v_main_reparation_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Déplacer les pièces des autres réparations vers la principale
    -- D'abord les pièces qui sont dans garage_reparation_pieces
    FOR v_reparation IN
      SELECT id, piece_id, source_sortie_id FROM public.garage_reparations
      WHERE bus_id = v_bus.bus_id AND id != v_main_reparation_id
        AND source_sortie_id IS NOT NULL
    LOOP
      -- Insérer dans la table de liaison si pas déjà là
      INSERT INTO public.garage_reparation_pieces (reparation_id, piece_id, sortie_id, quantite, prix_unitaire, montant, date_sortie)
      SELECT v_main_reparation_id, v_reparation.piece_id, v_reparation.source_sortie_id,
             sp.quantite, sp.prix_unitaire, sp.montant, sp.date
      FROM public.garage_sorties_pieces sp
      WHERE sp.id = v_reparation.source_sortie_id
        AND NOT EXISTS (
          SELECT 1 FROM public.garage_reparation_pieces rp
          WHERE rp.sortie_id = v_reparation.source_sortie_id
        )
      ON CONFLICT DO NOTHING;

      -- Supprimer la réparation doublon
      DELETE FROM public.garage_reparations WHERE id = v_reparation.id;
    END LOOP;

    -- Régénérer la description de la réparation principale
    PERFORM public.regenerate_reparation_description(v_main_reparation_id);
  END LOOP;
END $$;

-- ===========================================================================
-- 5. Realtime sur garage_reparation_pieces
-- ===========================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.garage_reparation_pieces;

-- ===========================================================================
-- 6. Reload schema cache
-- ===========================================================================
NOTIFY pgrst, 'reload schema';
