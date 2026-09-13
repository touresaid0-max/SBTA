/*
# Fix sortie correction with generated amount

1. Purpose
- Fix the error raised when validating a stock sortie correction.
- The `montant` column of `garage_sorties_pieces` is database-generated and cannot be assigned a calculated value directly.

2. Modified database object
- Replace `garage_correct_sortie` so it updates only `quantite`.
- The database continues to calculate `montant` automatically from the updated quantity and unit price.
- Stock adjustment and correction audit logging remain unchanged.

3. Security
- Preserve SECURITY DEFINER and the fixed `public` search path.
- Preserve the existing authenticated execution grant.

4. Data safety
- No rows are deleted.
- Existing sortie history and correction audit records are preserved.
*/

CREATE OR REPLACE FUNCTION public.garage_correct_sortie(
  p_sortie_id         uuid,
  p_nouvelle_quantite integer,
  p_motif             text,
  p_modifie_par_nom   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sortie       garage_sorties_pieces%ROWTYPE;
  v_ancienne_qte integer;
  v_diff         integer;
  v_user_id      uuid := auth.uid();
BEGIN
  SELECT * INTO v_sortie
  FROM garage_sorties_pieces
  WHERE id = p_sortie_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sortie introuvable';
  END IF;

  v_ancienne_qte := v_sortie.quantite;
  v_diff := p_nouvelle_quantite - v_ancienne_qte;

  IF p_nouvelle_quantite <= 0 THEN
    RAISE EXCEPTION 'La nouvelle quantité doit être supérieure à 0';
  END IF;

  IF v_diff = 0 THEN
    RAISE EXCEPTION 'La nouvelle quantité est identique à l''ancienne';
  END IF;

  UPDATE garage_sorties_pieces
  SET quantite = p_nouvelle_quantite
  WHERE id = p_sortie_id;

  INSERT INTO garage_stock (piece_id, quantite, date_maj)
  VALUES (v_sortie.piece_id, -v_diff, now())
  ON CONFLICT (piece_id) DO UPDATE
  SET quantite = garage_stock.quantite - v_diff,
      date_maj = now();

  INSERT INTO garage_sorties_corrections (
    sortie_id,
    piece_id,
    ancienne_quantite,
    nouvelle_quantite,
    difference,
    motif,
    modifie_par,
    modifie_par_nom
  ) VALUES (
    p_sortie_id,
    v_sortie.piece_id,
    v_ancienne_qte,
    p_nouvelle_quantite,
    v_diff,
    p_motif,
    v_user_id,
    p_modifie_par_nom
  );

  RETURN jsonb_build_object(
    'success', true,
    'sortie_id', p_sortie_id,
    'ancienne_quantite', v_ancienne_qte,
    'nouvelle_quantite', p_nouvelle_quantite,
    'difference', v_diff
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.garage_correct_sortie(uuid, integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';