/*
# Pompiste : dépotage mesuré en cuve (écart annoncé / réel)

Demande (responsable carburant et DG, 17/11/2026) : la quantité dépotée enregistrée était celle
annoncée par le fournisseur, et c'est elle qui s'ajoutait à la cuve. Le volume réellement reçu
peut être différent. Une heure après le dépotage, le pompiste mesure la cuve à la règle : c'est
ce niveau qui fait foi, et l'écart (en plus ou en moins) doit être enregistré, séparé et imprimé
sur le bordereau.

Exemple du document du DG : stock de départ 5 000 L + dépoté théorique 15 000 L = 20 000 L
attendus ; mesuré en cuve 19 900 L ; dépotage réel 14 900 L ; écart total −100 L, dont −50 L
constatés sur la citerne avant dépotage (contrôle « contre-plein », différence de chargement au
dépôt) et −50 L d'écart réel au dépotage.

## Deux étapes
1. Arrivée de la citerne (écran Dépotages) : quantité annoncée (`announced_quantity`), stock de
   départ (`stock_before`), écart constaté sur la citerne (`citerne_variance`, signé), n° du bon
   de livraison. Statut « en_attente_mesure ». La cuve reçoit provisoirement la quantité annoncée
   (`quantity_liters` = annoncé), pour que les pleins restent possibles en attendant.
2. Mesure, une heure après : `record_depotage_measure()` enregistre le niveau lu à la règle,
   calcule le dépotage réel (`quantity_liters` = mesuré − stock de départ + pleins faits sur cette
   cuve pendant l'attente) et met la cuve au niveau mesuré (moins les pleins faits depuis la
   mesure). Statut « mesure ».

Écarts (colonnes calculées par la base, une fois mesuré) :
- `variance_total`     = dépotage réel − annoncé                      (−100 L)
- `citerne_variance`   = écart au chargement, saisi à l'arrivée       (−50 L)
- `variance_unloading` = écart total − écart au chargement            (−50 L)
`total_amount` (quantité × prix) suit le dépotage réel.

## Compatibilité
L'écran actuel (production) n'envoie pas `announced_quantity` : ses dépotages restent comme avant
(quantité ajoutée telle quelle, statut « sans_mesure »). Les dépotages existants sont marqués
« sans_mesure », avec annoncé = quantité enregistrée. Aucune autre donnée n'est modifiée.

## Contrôles faits par la base (nouvelle saisie)
Quantité annoncée positive, stock de départ positif, cuve ne débordant pas, une seule mesure en
attente par cuve, mesure ni négative ni au-delà de la capacité, ni antérieure à l'arrivée.
Seuls le pompiste de la cuve, l'agent carburant, l'admin et le DAF peuvent enregistrer la mesure.
*/

-- ── 1. Colonnes ─────────────────────────────────────────────────────────────
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS delivery_note_number text;
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS arrival_at timestamptz;
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS announced_quantity numeric(12,2);
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS citerne_variance numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS measured_level_after numeric(12,2);
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS withdrawn_during_rest numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS measured_at timestamptz;
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS measured_by uuid REFERENCES auth.users(id);
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS measure_observation text;
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS measure_status text NOT NULL DEFAULT 'sans_mesure';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuel_depotages_measure_status_check') THEN
    ALTER TABLE public.fuel_depotages ADD CONSTRAINT fuel_depotages_measure_status_check
      CHECK (measure_status IN ('en_attente_mesure', 'mesure', 'sans_mesure'));
  END IF;
END $$;

-- Existing deliveries: announced = what was recorded, arrival = recording time
UPDATE public.fuel_depotages SET announced_quantity = quantity_liters WHERE announced_quantity IS NULL;
UPDATE public.fuel_depotages SET arrival_at = created_at WHERE arrival_at IS NULL;
ALTER TABLE public.fuel_depotages ALTER COLUMN arrival_at SET DEFAULT now();

ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS variance_total numeric(12,2)
  GENERATED ALWAYS AS (CASE WHEN measure_status = 'mesure' THEN quantity_liters - announced_quantity END) STORED;
ALTER TABLE public.fuel_depotages ADD COLUMN IF NOT EXISTS variance_unloading numeric(12,2)
  GENERATED ALWAYS AS (CASE WHEN measure_status = 'mesure' THEN quantity_liters - announced_quantity - citerne_variance END) STORED;

CREATE INDEX IF NOT EXISTS idx_fuel_depotages_pending
  ON public.fuel_depotages (tank_id) WHERE measure_status = 'en_attente_mesure';

-- ── 2. Arrivée de la citerne : contrôles et valeurs provisoires ─────────────
CREATE OR REPLACE FUNCTION public.before_depotage_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tank fuel_tanks%ROWTYPE;
BEGIN
  NEW.pompiste_id := coalesce(NEW.pompiste_id, auth.uid());
  NEW.arrival_at := coalesce(NEW.arrival_at, now());

  -- Former screen (no announced quantity): recorded as before, without measurement
  IF NEW.announced_quantity IS NULL THEN
    NEW.announced_quantity := NEW.quantity_liters;
    NEW.measure_status := 'sans_mesure';
    RETURN NEW;
  END IF;

  SELECT * INTO v_tank FROM fuel_tanks WHERE id = NEW.tank_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuve introuvable' USING ERRCODE = '23503';
  END IF;
  IF NEW.announced_quantity <= 0 THEN
    RAISE EXCEPTION 'La quantité annoncée doit être positive' USING ERRCODE = '23514';
  END IF;
  NEW.citerne_variance := coalesce(NEW.citerne_variance, 0);
  IF abs(NEW.citerne_variance) >= NEW.announced_quantity THEN
    RAISE EXCEPTION 'Écart citerne impossible : % L pour % L annoncés', NEW.citerne_variance, NEW.announced_quantity USING ERRCODE = '23514';
  END IF;
  NEW.stock_before := coalesce(NEW.stock_before, v_tank.current_level_liters);
  IF NEW.stock_before < 0 THEN
    RAISE EXCEPTION 'Le stock de départ ne peut pas être négatif' USING ERRCODE = '23514';
  END IF;
  IF v_tank.capacity_liters > 0 AND NEW.stock_before + NEW.announced_quantity > v_tank.capacity_liters THEN
    RAISE EXCEPTION 'Dépassement de la capacité de la cuve : % L + % L pour % L', NEW.stock_before, NEW.announced_quantity, v_tank.capacity_liters USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM fuel_depotages d WHERE d.tank_id = NEW.tank_id AND d.measure_status = 'en_attente_mesure') THEN
    RAISE EXCEPTION 'Un dépotage de cette cuve attend encore sa mesure : saisissez-la avant d''en enregistrer un autre' USING ERRCODE = '23514';
  END IF;

  -- Until the measurement, the tank holds the announced quantity
  NEW.quantity_liters := NEW.announced_quantity;
  NEW.measure_status := 'en_attente_mesure';
  NEW.measured_level_after := NULL;
  NEW.measured_at := NULL;
  NEW.measured_by := NULL;
  NEW.withdrawn_during_rest := 0;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_before_depotage_insert ON public.fuel_depotages;
CREATE TRIGGER trg_before_depotage_insert
  BEFORE INSERT ON public.fuel_depotages
  FOR EACH ROW EXECUTE FUNCTION public.before_depotage_insert();

-- ── 3. Mesure à la règle ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_depotage_measure(
  p_depotage_id    uuid,
  p_measured_level numeric,
  p_measured_at    timestamptz DEFAULT NULL,
  p_observation    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role     text;
  v_dep      fuel_depotages%ROWTYPE;
  v_tank     fuel_tanks%ROWTYPE;
  v_at       timestamptz := coalesce(p_measured_at, now());
  v_rest     numeric := 0;
  v_after    numeric := 0;
  v_received numeric;
BEGIN
  SELECT role INTO v_role FROM users WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('pompiste', 'carburant', 'admin', 'daf') THEN
    RAISE EXCEPTION 'Mesure réservée au pompiste, à l''agent carburant, à l''administrateur et au DAF' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_dep FROM fuel_depotages WHERE id = p_depotage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dépotage introuvable' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_tank FROM fuel_tanks WHERE id = v_dep.tank_id FOR UPDATE;
  IF v_role = 'pompiste' AND v_tank.pompiste_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cette cuve ne vous est pas affectée' USING ERRCODE = '42501';
  END IF;
  IF v_dep.measure_status <> 'en_attente_mesure' THEN
    RAISE EXCEPTION 'Ce dépotage n''attend pas de mesure' USING ERRCODE = '23514';
  END IF;
  IF p_measured_level IS NULL OR p_measured_level < 0 THEN
    RAISE EXCEPTION 'Niveau mesuré invalide' USING ERRCODE = '23514';
  END IF;
  IF v_tank.capacity_liters > 0 AND p_measured_level > v_tank.capacity_liters THEN
    RAISE EXCEPTION 'Le niveau mesuré (% L) dépasse la capacité de la cuve (% L)', p_measured_level, v_tank.capacity_liters USING ERRCODE = '23514';
  END IF;
  IF v_at < v_dep.arrival_at OR v_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'L''heure de la mesure doit être après l''arrivée de la citerne et pas dans le futur' USING ERRCODE = '23514';
  END IF;

  -- Fills made from this tank while the fuel was settling, and since the measurement
  SELECT coalesce(sum(e.quantity_liters) FILTER (WHERE e.created_at <= v_at), 0),
         coalesce(sum(e.quantity_liters) FILTER (WHERE e.created_at > v_at), 0)
    INTO v_rest, v_after
    FROM fuel_enlevements e
   WHERE e.tank_id = v_dep.tank_id AND e.created_at > v_dep.created_at;

  v_received := p_measured_level - v_dep.stock_before + v_rest;
  IF v_received < 0 THEN
    RAISE EXCEPTION 'Mesure incohérente : % L mesurés pour un stock de départ de % L', p_measured_level, v_dep.stock_before USING ERRCODE = '23514';
  END IF;

  UPDATE fuel_depotages
     SET quantity_liters = v_received,
         measured_level_after = p_measured_level,
         withdrawn_during_rest = v_rest,
         measured_at = v_at,
         measured_by = auth.uid(),
         measure_observation = nullif(btrim(coalesce(p_observation, '')), ''),
         measure_status = 'mesure'
   WHERE id = p_depotage_id;

  -- The tank takes the measured level (less what was pumped since the measurement)
  UPDATE fuel_tanks SET current_level_liters = p_measured_level - v_after WHERE id = v_dep.tank_id;

  RETURN jsonb_build_object(
    'received', v_received,
    'variance_total', v_received - v_dep.announced_quantity,
    'variance_loading', v_dep.citerne_variance,
    'variance_unloading', v_received - v_dep.announced_quantity - v_dep.citerne_variance,
    'tank_level', p_measured_level - v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_depotage_measure(uuid, numeric, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_depotage_measure(uuid, numeric, timestamptz, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
