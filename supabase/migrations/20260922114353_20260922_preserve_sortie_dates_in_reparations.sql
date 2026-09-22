/*
# Conserver les dates individuelles des sorties dans les réparations regroupées

## Objectif
Les pièces sorties pour un même bus restent regroupées dans une seule réparation,
mais chaque ligne doit conserver et afficher la date réelle de sa sortie.

## Modifications
1. Fonction modifiée
- `regenerate_reparation_description` inclut désormais `date_sortie` pour chaque
  pièce, au format `JJ/MM/AAAA — Nom de la pièce — Qté : N`.
- La date enregistrée dans `garage_reparation_pieces.date_sortie` n'est pas
  remplacée par la date de la réparation principale.

2. Données existantes
- Les descriptions des réparations qui contiennent déjà des pièces liées sont
  régénérées avec les dates individuelles actuellement enregistrées.
- Aucun montant, prix unitaire, quantité, statut ou lien de sortie n'est modifié.

3. Sécurité
- Aucune nouvelle table, colonne, permission ou policy n'est créée.
- Aucun enregistrement n'est supprimé.
*/

CREATE OR REPLACE FUNCTION public.regenerate_reparation_description(p_reparation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines text[];
  v_description text;
BEGIN
  SELECT array_agg(
    CASE
      WHEN rp.date_sortie IS NOT NULL THEN to_char(rp.date_sortie, 'DD/MM/YYYY') || ' — '
      ELSE ''
    END
    || COALESCE(p.nom, 'pièce inconnue') || ' — Qté : ' || rp.quantite
    ORDER BY rp.date_sortie NULLS LAST, rp.created_at
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

DO $$
DECLARE
  v_rep record;
BEGIN
  FOR v_rep IN
    SELECT DISTINCT reparation_id
    FROM public.garage_reparation_pieces
  LOOP
    PERFORM public.regenerate_reparation_description(v_rep.reparation_id);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
