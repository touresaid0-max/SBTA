/*
# Dépenses du guichet : une seule par départ et par type, modifiable, jamais cumulée (audit M3)

Règle : pour un départ, le guichet enregistre UNE dépense de chaque type (ratio, carburant,
péage, autres). Il peut la modifier ; il ne peut pas en ajouter une deuxième qui s'additionnerait
à la première.

Avant : le serveur gardait une ligne par départ pour ratio, carburant et péage, le poste
additionnait les saisies, et une dépense déjà validée (ou rejetée) ne pouvait plus être modifiée
par le guichetier (règle d'accès « en_attente » seulement) : sa modification était refusée.

## Changements
1. `save_counter_charge` : enregistre la dépense d'un type pour un départ.
   - pas encore de dépense de ce type : elle est créée ;
   - déjà une dépense : son montant, son libellé et sa date sont REMPLACÉS (pas additionnés) ;
   - montant changé sur une dépense validée ou rejetée : elle repasse « en attente »
     (validation, date et motif de rejet effacés) et doit être validée à nouveau ;
   - anciennes saisies en double de ce type sur ce départ (cumul d'avant cette règle) : retirées,
     le montant enregistré est le seul qui compte ;
   - droits : le guichetier du guichet du départ (ou l'auteur de la dépense) ;
   - même appel envoyé deux fois (coupure, nouvel essai) : même résultat.
2. Déclencheur `trg_counter_charges_one_per_type` : refuse une deuxième dépense du même type
   pour un départ (code 23505), y compris « autres », y compris si deux postes l'envoient en même
   temps. Les doublons « autres » déjà en base ne sont pas touchés tant qu'on ne les modifie pas.

Les contrôles de montant et de date (migration du 04/11/2026, M10) s'appliquent toujours.
*/

-- ── 1. Une seule dépense par départ et par type ───────────────────────────────

CREATE OR REPLACE FUNCTION public.counter_charges_one_per_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.schedule_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- One check at a time per departure and type (two devices sending at the same moment)
  PERFORM pg_advisory_xact_lock(hashtext('counter_charge:' || NEW.schedule_id::text || ':' || NEW.charge_type));
  IF EXISTS (
    SELECT 1 FROM counter_charges
    WHERE schedule_id = NEW.schedule_id
      AND charge_type = NEW.charge_type
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = format('Une dépense « %s » est déjà enregistrée pour ce départ : modifiez-la au lieu d''en ajouter une autre.', NEW.charge_type);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_counter_charges_one_per_type ON public.counter_charges;
CREATE TRIGGER trg_counter_charges_one_per_type
  BEFORE INSERT ON public.counter_charges
  FOR EACH ROW EXECUTE FUNCTION public.counter_charges_one_per_type();

-- ── 2. Enregistrer ou modifier la dépense d'un type ───────────────────────────

CREATE OR REPLACE FUNCTION public.save_counter_charge(
  p_id          uuid,
  p_schedule_id uuid,
  p_charge_type text,
  p_amount      numeric,
  p_description text DEFAULT NULL,
  p_charge_date date DEFAULT NULL,
  p_counter_id  uuid DEFAULT NULL,
  p_station_id  uuid DEFAULT NULL,
  p_bus_id      uuid DEFAULT NULL,
  p_created_at  timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_row     counter_charges%ROWTYPE;
  v_counter uuid;
  v_station uuid;
  v_bus     uuid;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Connexion requise pour enregistrer une dépense.';
  END IF;
  IF p_schedule_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Départ manquant pour la dépense.';
  END IF;
  IF p_charge_type IS NULL OR p_charge_type NOT IN ('ration', 'carburant_complement', 'peage', 'autres') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('Type de dépense inconnu : %s.', p_charge_type);
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Le montant de la dépense doit être supérieur à 0.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('counter_charge:' || p_schedule_id::text || ':' || p_charge_type));

  -- The device's expense, or the one already recorded for this departure and type
  SELECT * INTO v_row FROM counter_charges WHERE id = p_id;
  IF FOUND AND (v_row.schedule_id IS DISTINCT FROM p_schedule_id OR v_row.charge_type IS DISTINCT FROM p_charge_type) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Cette dépense appartient à un autre départ ou à un autre type.';
  END IF;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM counter_charges
    WHERE schedule_id = p_schedule_id AND charge_type = p_charge_type
    ORDER BY created_at, id
    LIMIT 1;
  END IF;

  IF v_row.id IS NOT NULL THEN
    IF NOT (
      v_row.created_by = v_uid
      OR EXISTS (SELECT 1 FROM counters c WHERE c.id = v_row.counter_id AND c.assigned_user_id = v_uid)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Modification refusée : cette dépense est celle d''un autre guichet.';
    END IF;

    -- Replaced, not added; a changed amount must be validated again
    UPDATE counter_charges SET
      amount           = p_amount,
      description      = COALESCE(p_description, description),
      charge_date      = COALESCE(p_charge_date, charge_date),
      status           = CASE WHEN amount IS DISTINCT FROM p_amount THEN 'en_attente' ELSE status END,
      validated_by     = CASE WHEN amount IS DISTINCT FROM p_amount THEN NULL ELSE validated_by END,
      validated_at     = CASE WHEN amount IS DISTINCT FROM p_amount THEN NULL ELSE validated_at END,
      rejection_reason = CASE WHEN amount IS DISTINCT FROM p_amount THEN NULL ELSE rejection_reason END,
      updated_at       = now()
    WHERE id = v_row.id;

    -- Former entries of the same type on this departure (added up before this rule)
    DELETE FROM counter_charges cc
    WHERE cc.schedule_id = p_schedule_id
      AND cc.charge_type = p_charge_type
      AND cc.id <> v_row.id
      AND (
        cc.created_by = v_uid
        OR EXISTS (SELECT 1 FROM counters c WHERE c.id = cc.counter_id AND c.assigned_user_id = v_uid)
      );

    RETURN v_row.id;
  END IF;

  -- First expense of this type for the departure: the counter's guichetier only
  SELECT s.counter_id, s.departure_station_id, s.bus_id INTO v_counter, v_station, v_bus
  FROM schedules s WHERE s.id = p_schedule_id;
  v_counter := COALESCE(p_counter_id, v_counter);
  IF NOT EXISTS (SELECT 1 FROM counters c WHERE c.id = v_counter AND c.assigned_user_id = v_uid) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Dépense refusée : ce départ n''est pas celui de votre guichet.';
  END IF;

  v_id := COALESCE(p_id, gen_random_uuid());
  INSERT INTO counter_charges (
    id, schedule_id, counter_id, station_id, bus_id, charge_type, description, amount,
    charge_date, status, created_by, created_at
  ) VALUES (
    v_id, p_schedule_id, v_counter, COALESCE(p_station_id, v_station), COALESCE(p_bus_id, v_bus),
    p_charge_type, COALESCE(p_description, ''), p_amount,
    COALESCE(p_charge_date, (now() AT TIME ZONE 'Africa/Abidjan')::date), 'en_attente', v_uid,
    COALESCE(p_created_at, now())
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_counter_charge(uuid, uuid, text, numeric, text, date, uuid, uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_counter_charge(uuid, uuid, text, numeric, text, date, uuid, uuid, uuid, timestamptz) TO authenticated;
