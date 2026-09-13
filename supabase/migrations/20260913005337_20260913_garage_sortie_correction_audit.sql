-- ── Audit table for sortie corrections ─────────────────────────
CREATE TABLE IF NOT EXISTS garage_sorties_corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sortie_id        uuid NOT NULL REFERENCES garage_sorties_pieces(id) ON DELETE CASCADE,
  piece_id         uuid NOT NULL REFERENCES garage_pieces(id),
  ancienne_quantite integer NOT NULL,
  nouvelle_quantite integer NOT NULL,
  difference       integer NOT NULL,
  motif            text NOT NULL DEFAULT '',
  modifie_par      uuid REFERENCES auth.users(id),
  modifie_par_nom  text DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_garage_sorties_corr_sortie
  ON garage_sorties_corrections(sortie_id);
CREATE INDEX IF NOT EXISTS idx_garage_sorties_corr_piece
  ON garage_sorties_corrections(piece_id);
CREATE INDEX IF NOT EXISTS idx_garage_sorties_corr_date
  ON garage_sorties_corrections(created_at);

-- RLS: any authenticated can read, only gerant_principal/admin can insert
ALTER TABLE garage_sorties_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "garage_sorties_corr_select"
  ON garage_sorties_corrections FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "garage_sorties_corr_insert"
  ON garage_sorties_corrections FOR INSERT
  TO authenticated
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('gerant_principal', 'admin'));

-- ── SECURITY DEFINER function to correct a sortie ──────────────
-- Updates the sortie quantity, adjusts garage_stock, logs the correction.
CREATE OR REPLACE FUNCTION public.garage_correct_sortie(
  p_sortie_id        uuid,
  p_nouvelle_quantite integer,
  p_motif            text,
  p_modifie_par_nom  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sortie          garage_sorties_pieces%ROWTYPE;
  v_ancienne_qte    integer;
  v_diff            integer;
  v_user_id         uuid := auth.uid();
BEGIN
  SELECT * INTO v_sortie FROM garage_sorties_pieces WHERE id = p_sortie_id;
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

  -- Update the sortie row (keeps original row, just updates quantity)
  UPDATE garage_sorties_pieces
  SET quantite = p_nouvelle_quantite,
      montant  = p_nouvelle_quantite * prix_unitaire
  WHERE id = p_sortie_id;

  -- Adjust garage_stock by the difference
  -- If diff < 0 (quantity reduced), we add stock back; if diff > 0, we subtract more
  INSERT INTO garage_stock (piece_id, quantite, date_maj)
  VALUES (v_sortie.piece_id, -v_diff, now())
  ON CONFLICT (piece_id) DO UPDATE
  SET quantite = garage_stock.quantite - v_diff,
      date_maj = now();

  -- Log the correction
  INSERT INTO garage_sorties_corrections (
    sortie_id, piece_id, ancienne_quantite, nouvelle_quantite,
    difference, motif, modifie_par, modifie_par_nom
  ) VALUES (
    p_sortie_id, v_sortie.piece_id, v_ancienne_qte, p_nouvelle_quantite,
    v_diff, p_motif, v_user_id, p_modifie_par_nom
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

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION public.garage_correct_sortie(uuid, integer, text, text) TO authenticated;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';