/*
# Corriger la remontée complète des sorties de stock vers les réparations

## Problème
3 sorties de pièces avec car_id valide ne sont pas liées à garage_reparation_pieces.
Elles n'apparaissent pas dans Gestion des réparations.

## Correctif
1. Pour chaque sortie orpheline avec un car_id valide, trouver ou créer une
   réparation active pour ce bus et lier la sortie.
2. Régénérer les descriptions de toutes les réparations.
3. Aucune donnée existante n'est supprimée ni modifiée.
*/

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
      AND sp.car_id IS NOT NULL
    ORDER BY sp.date
  LOOP
    -- Vérifier que le car_id correspond à un bus réel
    SELECT id INTO v_bus_id FROM public.buses WHERE id = v_sortie.car_id LIMIT 1;
    IF v_bus_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Trouver une réparation active existante pour ce bus
    SELECT id INTO v_reparation_id
    FROM public.garage_reparations
    WHERE bus_id = v_bus_id AND statut != 'LIBÉRÉ'
    ORDER BY created_at DESC
    LIMIT 1;

    -- Si aucune, en créer une nouvelle
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

-- Régénérer toutes les descriptions
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
