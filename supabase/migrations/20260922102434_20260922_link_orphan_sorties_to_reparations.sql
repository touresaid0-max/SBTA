/*
# Nettoyer et lier toutes les sorties orphelines aux réparations principales

## Contexte
Après la migration précédente, certaines sorties n'ont pas été liées à
garage_reparation_pieces car leurs réparations auto-créées avaient déjà été
consolidées ou supprimées. Cette migration :
1. Pour chaque sortie non liée, trouve la réparation active du bus correspondant
   (ou en crée une si aucune n'existe).
2. Insère la sortie dans garage_reparation_pieces.
3. Supprime les réparations doublons restantes (source_sortie_id IS NOT NULL et
   sans pièces dans la table de liaison).
4. Régénère les descriptions.
*/

-- ===========================================================================
-- 1. Lier toutes les sorties orphelines
-- ===========================================================================
DO $$
DECLARE
  v_sortie record;
  v_bus_id uuid;
  v_reparation_id uuid;
BEGIN
  FOR v_sortie IN
    SELECT sp.id, sp.car_id, sp.piece_id, sp.quantite, sp.prix_unitaire, sp.montant, sp.date
    FROM public.garage_sorties_pieces sp
    LEFT JOIN public.garage_reparation_pieces rp ON rp.sortie_id = sp.id
    WHERE rp.id IS NULL
    ORDER BY sp.date
  LOOP
    -- Résoudre bus_id
    SELECT id INTO v_bus_id FROM public.buses WHERE id = v_sortie.car_id LIMIT 1;
    IF v_bus_id IS NULL THEN
      SELECT b.id INTO v_bus_id
      FROM public.buses b
      JOIN public.garage_cars gc ON gc.immatriculation = b.registration_number
      WHERE gc.id = v_sortie.car_id LIMIT 1;
    END IF;

    IF v_bus_id IS NULL THEN CONTINUE; END IF;

    -- Trouver une réparation active existante
    SELECT id INTO v_reparation_id
    FROM public.garage_reparations
    WHERE bus_id = v_bus_id AND statut != 'LIBÉRÉ'
    ORDER BY created_at ASC
    LIMIT 1;

    -- Si aucune, en créer une
    IF v_reparation_id IS NULL THEN
      INSERT INTO public.garage_reparations (bus_id, car_id, date, statut, description)
      VALUES (v_bus_id, NULL, v_sortie.date, 'BROUILLON', '')
      RETURNING id INTO v_reparation_id;
    END IF;

    -- Insérer dans la table de liaison
    INSERT INTO public.garage_reparation_pieces (reparation_id, piece_id, sortie_id, quantite, prix_unitaire, montant, date_sortie)
    VALUES (v_reparation_id, v_sortie.piece_id, v_sortie.id, v_sortie.quantite, v_sortie.prix_unitaire, v_sortie.montant, v_sortie.date)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ===========================================================================
-- 2. Supprimer les réparations doublons auto-créées sans pièces liées
--    (celles dont source_sortie_id IS NOT NULL mais qui n'ont plus de pièces
--     dans garage_reparation_pieces, car elles ont été consolidées)
-- ===========================================================================
DELETE FROM public.garage_reparations
WHERE source_sortie_id IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT reparation_id FROM public.garage_reparation_pieces
  )
  AND statut = 'BROUILLON'
  AND description LIKE 'Sortie de pièces%';

-- ===========================================================================
-- 3. Régénérer toutes les descriptions
-- ===========================================================================
DO $$
DECLARE
  v_rep record;
BEGIN
  FOR v_rep IN
    SELECT DISTINCT rp.reparation_id FROM public.garage_reparation_pieces rp
  LOOP
    PERFORM public.regenerate_reparation_description(v_rep.reparation_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
