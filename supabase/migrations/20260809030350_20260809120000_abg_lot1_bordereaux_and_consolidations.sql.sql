/*
# Gestion Agboville — LOT 1/2/3: Bordereaux, vérification, consolidations

## Objectif
Alimentation automatique des bordereaux depuis les guichets "ligne Agboville",
vérification avec contrôles de cohérence, et consolidations jour/semaine/mois/année.

## 1. Nouvelles tables
### abg_bordereaux — bordereaux reçus (auto ou import)
### abg_bordereau_lignes — lignes détaillées par car

## 2. Trigger: auto-génération de bordereau à la clôture d'un départ (schedule status → termine)

## 3. RPC: import d'appoint + vérification

## 4. Vues: daily/weekly/monthly/annual consolidations

## 5. Sécurité (RLS)
Accès limité aux rôles gestion_agboville et admin. Aucune écriture dans les tables sources.
*/

-- ============================================================
-- 1. Table: abg_bordereaux
-- ============================================================
CREATE TABLE IF NOT EXISTS abg_bordereaux (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bordereau_date  date NOT NULL,
  guichet_src_id  uuid REFERENCES public.abg_guichet_srcs(id) ON DELETE SET NULL,
  gare_label      text NOT NULL,
  segment_code    text,
  societe_code    text NOT NULL,
  source          text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'import')),
  schedule_id     uuid,
  total_tickets   integer NOT NULL DEFAULT 0,
  total_seats     integer NOT NULL DEFAULT 0,
  total_mt_ticket numeric NOT NULL DEFAULT 0,
  total_depense_pr numeric NOT NULL DEFAULT 0,
  total_solde     numeric NOT NULL DEFAULT 0,
  total_baggage   numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'recu' CHECK (status IN ('recu', 'verifie', 'ecart')),
  ecart_comment   text,
  verified_by     uuid,
  verified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abg_bordereaux_date ON abg_bordereaux(bordereau_date);
CREATE INDEX IF NOT EXISTS idx_abg_bordereaux_schedule ON abg_bordereaux(schedule_id);
CREATE INDEX IF NOT EXISTS idx_abg_bordereaux_status ON abg_bordereaux(status);
CREATE INDEX IF NOT EXISTS idx_abg_bordereaux_societe ON abg_bordereaux(societe_code);
CREATE INDEX IF NOT EXISTS idx_abg_bordereaux_guichet ON abg_bordereaux(guichet_src_id);

ALTER TABLE abg_bordereaux ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abg_bordereaux_select" ON abg_bordereaux;
CREATE POLICY "abg_bordereaux_select" ON abg_bordereaux FOR SELECT
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_bordereaux_insert" ON abg_bordereaux;
CREATE POLICY "abg_bordereaux_insert" ON abg_bordereaux FOR INSERT
  TO authenticated WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_bordereaux_update" ON abg_bordereaux;
CREATE POLICY "abg_bordereaux_update" ON abg_bordereaux FOR UPDATE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'))
  WITH CHECK (public.get_my_role() IN ('gestion_agboville', 'admin'));

DROP POLICY IF EXISTS "abg_bordereaux_delete" ON abg_bordereaux;
CREATE POLICY "abg_bordereaux_delete" ON abg_bordereaux FOR DELETE
  TO authenticated USING (public.get_my_role() IN ('gestion_agboville', 'admin'));

-- ============================================================
-- 2. Table: abg_bordereau_lignes
-- ============================================================
CREATE TABLE IF NOT EXISTS abg_bordereau_lignes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bordereau_id     uuid NOT NULL REFERENCES public.abg_bordereaux(id) ON DELETE CASCADE,
  car_matricule    text NOT NULL,
  departure_number integer,
  seats            integer NOT NULL DEFAULT 0,
  mt_ticket        numeric NOT NULL DEFAULT 0,
  depense_pr       numeric NOT NULL DEFAULT 0,
  solde_ticket     numeric NOT NULL DEFAULT 0,
  bagage           numeric NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abg_bordereau_lignes_bordereau ON abg_bordereau_lignes(bordereau_id);

ALTER TABLE abg_bordereau_lignes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abg_bordereau_lignes_select" ON abg_bordereau_lignes;
CREATE POLICY "abg_bordereau_lignes_select" ON abg_bordereau_lignes FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM abg_bordereaux b WHERE b.id = abg_bordereau_lignes.bordereau_id
            AND public.get_my_role() IN ('gestion_agboville', 'admin'))
  );

DROP POLICY IF EXISTS "abg_bordereau_lignes_insert" ON abg_bordereau_lignes;
CREATE POLICY "abg_bordereau_lignes_insert" ON abg_bordereau_lignes FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM abg_bordereaux b WHERE b.id = abg_bordereau_lignes.bordereau_id
            AND public.get_my_role() IN ('gestion_agboville', 'admin'))
  );

DROP POLICY IF EXISTS "abg_bordereau_lignes_update" ON abg_bordereau_lignes;
CREATE POLICY "abg_bordereau_lignes_update" ON abg_bordereau_lignes FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM abg_bordereaux b WHERE b.id = abg_bordereau_lignes.bordereau_id
            AND public.get_my_role() IN ('gestion_agboville', 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM abg_bordereaux b WHERE b.id = abg_bordereau_lignes.bordereau_id
            AND public.get_my_role() IN ('gestion_agboville', 'admin'))
  );

DROP POLICY IF EXISTS "abg_bordereau_lignes_delete" ON abg_bordereau_lignes;
CREATE POLICY "abg_bordereau_lignes_delete" ON abg_bordereau_lignes FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM abg_bordereaux b WHERE b.id = abg_bordereau_lignes.bordereau_id
            AND public.get_my_role() IN ('gestion_agboville', 'admin'))
  );

-- ============================================================
-- 3. Trigger function: auto-génération de bordereau
-- ============================================================
CREATE OR REPLACE FUNCTION public.abg_auto_generate_bordereau()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guichet       record;
  v_societe_code  text;
  v_segment_code  text;
  v_total_seats   integer := 0;
  v_total_tickets integer := 0;
  v_total_mt      numeric := 0;
  v_total_dep_pr  numeric := 0;
  v_total_baggage numeric := 0;
  v_solde         numeric := 0;
  v_bus_mat       text;
  v_dept_num      integer;
  v_line_seats    integer;
  v_line_mt       numeric;
  v_line_dep_pr   numeric;
  v_line_baggage  numeric;
  v_bordereau_id  uuid;
  v_existing_id   uuid;
  v_line_count    integer := 0;
BEGIN
  IF NEW.status <> 'termine' OR (OLD.status = NEW.status) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing_id FROM abg_bordereaux WHERE schedule_id = NEW.id LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT gs.id, gs.gare_label, gs.societe_id, s.code as soc_code
  INTO v_guichet
  FROM abg_guichet_srcs gs
  JOIN abg_societes s ON s.id = gs.societe_id
  WHERE gs.station_id = NEW.departure_station_id AND gs.is_active = true
  LIMIT 1;

  IF v_guichet IS NULL THEN
    RETURN NEW;
  END IF;

  v_societe_code := v_guichet.soc_code;

  SELECT COALESCE(
    (SELECT seg.code FROM abg_segments seg
     WHERE seg.is_active = true
       AND NEW.route_name ILIKE '%' || seg.origin_city || '%'
       AND NEW.route_name ILIKE '%' || seg.destination_city || '%'
     LIMIT 1),
    (SELECT seg.code FROM abg_segments seg
     WHERE seg.is_active = true
       AND (NEW.route_name ILIKE '%' || seg.origin_city || '%'
            OR NEW.route_name ILIKE '%' || seg.destination_city || '%')
     LIMIT 1)
  ) INTO v_segment_code;

  SELECT
    COALESCE(SUM(r.total_seats), 0),
    COUNT(r.id),
    COALESCE(SUM(r.total_price), 0),
    COALESCE(SUM(r.baggage_fee), 0)
  INTO v_total_seats, v_total_tickets, v_total_mt, v_total_baggage
  FROM reservations r
  WHERE r.schedule_id = NEW.id
    AND r.status IN ('confirmee', 'embarquee', 'termine');

  SELECT COALESCE(SUM(cc.amount), 0)
  INTO v_total_dep_pr
  FROM counter_charges cc
  WHERE cc.schedule_id = NEW.id
    AND cc.charge_type IN ('ration', 'peage')
    AND cc.status = 'valide';

  v_solde := v_total_mt - v_total_dep_pr;

  INSERT INTO abg_bordereaux (
    bordereau_date, guichet_src_id, gare_label, segment_code,
    societe_code, source, schedule_id,
    total_tickets, total_seats, total_mt_ticket,
    total_depense_pr, total_solde, total_baggage, status
  ) VALUES (
    NEW.departure_datetime::date, v_guichet.id, v_guichet.gare_label, v_segment_code,
    v_societe_code, 'auto', NEW.id,
    v_total_tickets, v_total_seats, v_total_mt,
    v_total_dep_pr, v_solde, v_total_baggage, 'recu'
  )
  RETURNING id INTO v_bordereau_id;

  SELECT b.registration_number INTO v_bus_mat FROM buses b WHERE b.id = NEW.bus_id LIMIT 1;

  INSERT INTO abg_bordereau_lignes (
    bordereau_id, car_matricule, departure_number,
    seats, mt_ticket, depense_pr, solde_ticket, bagage
  ) VALUES (
    v_bordereau_id, COALESCE(v_bus_mat, 'N/A'), NEW.departure_number,
    v_total_seats, v_total_mt, v_total_dep_pr,
    v_solde, v_total_baggage
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS abg_schedule_completed_bordereau ON public.schedules;
CREATE TRIGGER abg_schedule_completed_bordereau
  AFTER UPDATE ON public.schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.abg_auto_generate_bordereau();

-- ============================================================
-- 4. RPC: import d'appoint
-- ============================================================
CREATE OR REPLACE FUNCTION public.abg_import_bordereau(p_data jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bordereau_id uuid;
  v_line         jsonb;
  v_guichet_id   uuid;
BEGIN
  v_guichet_id := NULLIF(p_data->>'guichet_src_id', '')::uuid;

  INSERT INTO abg_bordereaux (
    bordereau_date, guichet_src_id, gare_label, segment_code,
    societe_code, source,
    total_tickets, total_seats, total_mt_ticket,
    total_depense_pr, total_solde, total_baggage, status
  ) VALUES (
    (p_data->>'bordereau_date')::date,
    v_guichet_id,
    p_data->>'gare_label',
    NULLIF(p_data->>'segment_code', ''),
    p_data->>'societe_code',
    'import',
    COALESCE(NULLIF(p_data->>'total_tickets','')::integer, 0),
    COALESCE(NULLIF(p_data->>'total_seats','')::integer, 0),
    COALESCE(NULLIF(p_data->>'total_mt_ticket','')::numeric, 0),
    COALESCE(NULLIF(p_data->>'total_depense_pr','')::numeric, 0),
    COALESCE(NULLIF(p_data->>'total_mt_ticket','')::numeric, 0) - COALESCE(NULLIF(p_data->>'total_depense_pr','')::numeric, 0),
    COALESCE(NULLIF(p_data->>'total_baggage','')::numeric, 0),
    'recu'
  )
  RETURNING id INTO v_bordereau_id;

  FOR v_line IN SELECT jsonb_array_elements(p_data->'lignes')
  LOOP
    INSERT INTO abg_bordereau_lignes (
      bordereau_id, car_matricule, departure_number,
      seats, mt_ticket, depense_pr, solde_ticket, bagage
    ) VALUES (
      v_bordereau_id,
      v_line->>'car_matricule',
      NULLIF(v_line->>'departure_number','')::integer,
      COALESCE(NULLIF(v_line->>'seats','')::integer, 0),
      COALESCE(NULLIF(v_line->>'mt_ticket','')::numeric, 0),
      COALESCE(NULLIF(v_line->>'depense_pr','')::numeric, 0),
      COALESCE(NULLIF(v_line->>'mt_ticket','')::numeric, 0) - COALESCE(NULLIF(v_line->>'depense_pr','')::numeric, 0),
      COALESCE(NULLIF(v_line->>'bagage','')::numeric, 0)
    );
  END LOOP;

  RETURN v_bordereau_id;
END;
$$;

-- ============================================================
-- 5. RPC: vérification de bordereau
-- ============================================================
CREATE OR REPLACE FUNCTION public.abg_verify_bordereau(
  p_bordereau_id uuid,
  p_action text,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bordereau  record;
  v_line_sum_seats   integer;
  v_line_sum_mt      numeric;
  v_line_sum_dep     numeric;
  v_line_sum_solde   numeric;
  v_line_sum_bag     numeric;
  v_calc_solde       numeric;
  v_ecarts           text[] := '{}';
BEGIN
  SELECT * INTO v_bordereau FROM abg_bordereaux WHERE id = p_bordereau_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Bordereau non trouvé');
  END IF;

  SELECT
    COALESCE(SUM(l.seats), 0),
    COALESCE(SUM(l.mt_ticket), 0),
    COALESCE(SUM(l.depense_pr), 0),
    COALESCE(SUM(l.solde_ticket), 0),
    COALESCE(SUM(l.bagage), 0)
  INTO v_line_sum_seats, v_line_sum_mt, v_line_sum_dep, v_line_sum_solde, v_line_sum_bag
  FROM abg_bordereau_lignes l WHERE l.bordereau_id = p_bordereau_id;

  IF v_line_sum_seats != v_bordereau.total_seats THEN
    v_ecarts := array_append(v_ecarts, 'Somme sièges lignes (' || v_line_sum_seats || ') ≠ total (' || v_bordereau.total_seats || ')');
  END IF;
  IF v_line_sum_mt != v_bordereau.total_mt_ticket THEN
    v_ecarts := array_append(v_ecarts, 'Somme MT ticket lignes ≠ total');
  END IF;
  IF v_line_sum_dep != v_bordereau.total_depense_pr THEN
    v_ecarts := array_append(v_ecarts, 'Somme dépense P/R lignes ≠ total');
  END IF;

  v_calc_solde := v_bordereau.total_mt_ticket - v_bordereau.total_depense_pr;
  IF v_calc_solde != v_bordereau.total_solde THEN
    v_ecarts := array_append(v_ecarts, 'Solde calculé (' || v_calc_solde || ') ≠ solde annoncé (' || v_bordereau.total_solde || ')');
  END IF;

  IF v_bordereau.total_tickets > 0 AND v_bordereau.total_seats = 0 THEN
    v_ecarts := array_append(v_ecarts, 'Tickets sans sièges');
  END IF;

  IF p_action = 'verify' THEN
    IF array_length(v_ecarts, 1) > 0 THEN
      UPDATE abg_bordereaux SET status = 'ecart', ecart_comment = array_to_string(v_ecarts, '; '),
        updated_at = now()
      WHERE id = p_bordereau_id;
      RETURN jsonb_build_object('error', 'Écarts détectés, bordereau marqué en écart', 'ecarts', to_jsonb(v_ecarts));
    ELSE
      UPDATE abg_bordereaux SET status = 'verifie', verified_by = auth.uid(), verified_at = now(),
        ecart_comment = NULL, updated_at = now()
      WHERE id = p_bordereau_id;
      RETURN jsonb_build_object('success', true, 'status', 'verifie');
    END IF;
  ELSIF p_action = 'dispute' THEN
    UPDATE abg_bordereaux SET status = 'ecart', ecart_comment = p_comment,
      verified_by = auth.uid(), verified_at = now(), updated_at = now()
    WHERE id = p_bordereau_id;
    RETURN jsonb_build_object('success', true, 'status', 'ecart');
  ELSE
    RETURN jsonb_build_object('error', 'Action non reconnue: ' || p_action);
  END IF;
END;
$$;

-- ============================================================
-- 6. Vue: consolidation journalière
-- ============================================================
CREATE OR REPLACE VIEW public.abg_daily_consolidation AS
SELECT
  b.bordereau_date::text as date,
  b.gare_label,
  b.societe_code,
  b.segment_code,
  COUNT(DISTINCT b.id) as nb_bordereaux,
  COALESCE(SUM(l.seats), 0) as total_seats,
  COALESCE(SUM(l.mt_ticket), 0) as recettes_totales,
  COALESCE(SUM(l.depense_pr), 0) as depense_pr,
  0 as rations,
  0 as gasoil,
  0 as peages,
  0 as autres_depenses,
  COALESCE(SUM(l.solde_ticket), 0) as resultats,
  COALESCE(SUM(l.bagage), 0) as bagage_total,
  string_agg(DISTINCT l.car_matricule, ', ') as cars_liste
FROM abg_bordereaux b
LEFT JOIN abg_bordereau_lignes l ON l.bordereau_id = b.id
WHERE b.status IN ('recu', 'verifie', 'ecart')
GROUP BY b.bordereau_date, b.gare_label, b.societe_code, b.segment_code
ORDER BY b.bordereau_date DESC, b.gare_label;

-- ============================================================
-- 7. Vue: consolidation hebdomadaire
-- ============================================================
CREATE OR REPLACE VIEW public.abg_weekly_consolidation AS
SELECT
  to_char(date_trunc('week', b.bordereau_date::timestamp), 'IYYY-IW') as semaine,
  b.societe_code,
  l.car_matricule as libelle,
  COALESCE(SUM(l.seats), 0) as total_seats,
  COALESCE(SUM(l.mt_ticket), 0) as recettes,
  COALESCE(SUM(l.depense_pr), 0) as depense_pr,
  0 as rations,
  0 as gasoil,
  0 as peages,
  0 as autres_depenses,
  COALESCE(SUM(l.solde_ticket), 0) as resultats,
  COALESCE(SUM(l.bagage), 0) as bagage_total
FROM abg_bordereaux b
JOIN abg_bordereau_lignes l ON l.bordereau_id = b.id
WHERE b.status IN ('recu', 'verifie')
GROUP BY to_char(date_trunc('week', b.bordereau_date::timestamp), 'IYYY-IW'),
         b.societe_code, l.car_matricule
ORDER BY semaine DESC, b.societe_code, l.car_matricule;

-- ============================================================
-- 8. Vue: consolidation mensuelle (S1-S4)
-- ============================================================
CREATE OR REPLACE VIEW public.abg_monthly_consolidation AS
SELECT
  to_char(b.bordereau_date, 'YYYY-MM') as mois,
  b.societe_code,
  b.segment_code,
  CASE
    WHEN EXTRACT(day FROM b.bordereau_date) BETWEEN 1 AND 7 THEN 'S1'
    WHEN EXTRACT(day FROM b.bordereau_date) BETWEEN 8 AND 14 THEN 'S2'
    WHEN EXTRACT(day FROM b.bordereau_date) BETWEEN 15 AND 21 THEN 'S3'
    WHEN EXTRACT(day FROM b.bordereau_date) >= 22 THEN 'S4'
  END as semaine_mois,
  COALESCE(SUM(l.mt_ticket), 0) as recettes,
  COALESCE(SUM(l.depense_pr), 0) as depenses,
  COALESCE(SUM(l.solde_ticket), 0) as resultats,
  COALESCE(SUM(l.bagage), 0) as bagage_total,
  COALESCE(SUM(l.seats), 0) as total_seats
FROM abg_bordereaux b
JOIN abg_bordereau_lignes l ON l.bordereau_id = b.id
WHERE b.status IN ('recu', 'verifie')
GROUP BY to_char(b.bordereau_date, 'YYYY-MM'), b.societe_code, b.segment_code,
  CASE
    WHEN EXTRACT(day FROM b.bordereau_date) BETWEEN 1 AND 7 THEN 'S1'
    WHEN EXTRACT(day FROM b.bordereau_date) BETWEEN 8 AND 14 THEN 'S2'
    WHEN EXTRACT(day FROM b.bordereau_date) BETWEEN 15 AND 21 THEN 'S3'
    WHEN EXTRACT(day FROM b.bordereau_date) >= 22 THEN 'S4'
  END
ORDER BY mois DESC, b.societe_code;

-- ============================================================
-- 9. Vue: consolidation annuelle
-- ============================================================
CREATE OR REPLACE VIEW public.abg_annual_consolidation AS
SELECT
  EXTRACT(year FROM b.bordereau_date)::text as annee,
  EXTRACT(month FROM b.bordereau_date)::text as mois_num,
  to_char(b.bordereau_date, 'Month') as mois_label,
  b.societe_code,
  b.segment_code,
  COALESCE(SUM(l.mt_ticket), 0) as recettes,
  COALESCE(SUM(l.depense_pr), 0) as depenses,
  COALESCE(SUM(l.solde_ticket), 0) as resultats,
  COALESCE(SUM(l.bagage), 0) as bagage_total,
  COALESCE(SUM(l.seats), 0) as total_seats
FROM abg_bordereaux b
JOIN abg_bordereau_lignes l ON l.bordereau_id = b.id
WHERE b.status IN ('recu', 'verifie')
GROUP BY EXTRACT(year FROM b.bordereau_date), EXTRACT(month FROM b.bordereau_date),
  to_char(b.bordereau_date, 'Month'), b.societe_code, b.segment_code
ORDER BY annee DESC, mois_num, b.societe_code;

-- ============================================================
-- 10. Droits sur les vues
-- ============================================================
GRANT SELECT ON abg_daily_consolidation TO authenticated;
GRANT SELECT ON abg_weekly_consolidation TO authenticated;
GRANT SELECT ON abg_monthly_consolidation TO authenticated;
GRANT SELECT ON abg_annual_consolidation TO authenticated;

-- ============================================================
-- 11. Seed: guichets source par défaut
-- ============================================================
INSERT INTO abg_guichet_srcs (station_id, societe_id, gare_label)
SELECT s.id, soc.id, 'Yopougon'
FROM stations s, abg_societes soc
WHERE s.name = 'Gare Yopougon' AND soc.code = 'SBTA'
AND NOT EXISTS (SELECT 1 FROM abg_guichet_srcs g WHERE g.station_id = s.id AND g.societe_id = soc.id)
ON CONFLICT DO NOTHING;

INSERT INTO abg_guichet_srcs (station_id, societe_id, gare_label)
SELECT s.id, soc.id, 'Agboville'
FROM stations s, abg_societes soc
WHERE s.name = 'Gare SBTA Agboville' AND soc.code = 'SBTA'
AND NOT EXISTS (SELECT 1 FROM abg_guichet_srcs g WHERE g.station_id = s.id AND g.societe_id = soc.id)
ON CONFLICT DO NOTHING;

INSERT INTO abg_guichet_srcs (station_id, societe_id, gare_label)
SELECT s.id, soc.id, 'Gagnoa'
FROM stations s, abg_societes soc
WHERE s.name = 'Gare SBTA Gagnoa' AND soc.code = 'SBTA'
AND NOT EXISTS (SELECT 1 FROM abg_guichet_srcs g WHERE g.station_id = s.id AND g.societe_id = soc.id)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 12. Reload PostgREST schema cache
-- ============================================================
NOTIFY pgrst, 'reload schema';
