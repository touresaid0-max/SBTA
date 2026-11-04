/*
# Numéros de départ : jamais de départ refusé pour un numéro déjà pris (audit m6)

Chaque guichet numérote ses départs du jour (n° de départ) et, par ligne, ses départs de
ligne (n° de ligne). Le poste calculait ces numéros avec les seuls départs qu'il avait :
un deuxième poste sur le même guichet, ou un poste neuf, redonnait un numéro déjà pris.

Le déclencheur `auto_create_departure_sequence` (migration du 04/09/2026) recopiait ce
numéro dans `departure_sequence`, qui interdit le même numéro deux fois pour un guichet et
un jour (UNIQUE counter_id, departure_date, departure_number) : l'insertion échouait, et
avec elle le départ entier, puis les tickets vendus sur ce départ.
Deux départs créés au même instant pouvaient aussi recevoir le même « ordre » (MAX + 1
calculé en parallèle) et être refusés de la même façon.

## Changements
- Verrous de transaction (pg_advisory_xact_lock) par guichet et jour, et par gare, jour et
  ligne : les numéros sont attribués l'un après l'autre.
- N° de départ déjà pris par un autre départ du même guichet ce jour-là : le suivant libre
  est attribué, et `schedules.departure_number` est corrigé. Même chose pour le n° de ligne
  (`schedules.route_number`) parmi les départs du même guichet, du même jour et de la même
  ligne. Le poste reçoit le numéro corrigé à sa synchronisation suivante.
- Le reste ne change pas : rien n'est fait si le départ n'a pas de guichet ou a déjà sa ligne
  dans `departure_sequence` (affectation manuelle par le chef de gare conservée).

Le déclencheur `trg_auto_departure_sequence` (AFTER INSERT OR UPDATE OF counter_id) reste
le même ; la mise à jour des numéros qu'il fait ne le relance pas.
*/

CREATE OR REPLACE FUNCTION auto_create_departure_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station_id   uuid;
  v_route_id     uuid;
  v_dep_date     date;
  v_dep_number   int;
  v_route_number int;
  v_next_order   int;
  v_existing     uuid;
BEGIN
  IF NEW.counter_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Already numbered (manual assignment by the chef de gare, or earlier run)
  SELECT id INTO v_existing FROM departure_sequence WHERE schedule_id = NEW.id;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.station_id INTO v_station_id FROM counters c WHERE c.id = NEW.counter_id;
  IF v_station_id IS NULL THEN
    v_station_id := NEW.departure_station_id;
  END IF;
  IF v_station_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_route_id := NEW.route_id;
  v_dep_date := (NEW.departure_datetime AT TIME ZONE 'UTC')::date;

  -- One numbering at a time per counter and day, and per station, day and line
  PERFORM pg_advisory_xact_lock(hashtext('departure_number:' || NEW.counter_id::text || ':' || v_dep_date::text));
  PERFORM pg_advisory_xact_lock(hashtext('departure_order:' || v_station_id::text || ':' || v_dep_date::text || ':' || COALESCE(v_route_id::text, '-')));

  -- N° de départ: the device's number unless another departure of this counter has it today
  v_dep_number := NEW.departure_number;
  IF v_dep_number IS NULL OR v_dep_number <= 0 OR EXISTS (
    SELECT 1 FROM departure_sequence
    WHERE counter_id = NEW.counter_id AND departure_date = v_dep_date AND departure_number = v_dep_number
  ) THEN
    SELECT COALESCE(MAX(departure_number), 0) + 1 INTO v_dep_number
    FROM departure_sequence
    WHERE counter_id = NEW.counter_id AND departure_date = v_dep_date;
  END IF;

  -- N° de ligne: same rule among this counter's departures of the day on this line
  v_route_number := NEW.route_number;
  IF v_route_number IS NOT NULL AND v_route_number > 0 AND EXISTS (
    SELECT 1 FROM schedules s
    WHERE s.id <> NEW.id
      AND s.counter_id = NEW.counter_id
      AND s.route_id IS NOT DISTINCT FROM v_route_id
      AND (s.departure_datetime AT TIME ZONE 'UTC')::date = v_dep_date
      AND s.route_number = v_route_number
      AND s.status IS DISTINCT FROM 'annule'
  ) THEN
    SELECT COALESCE(MAX(s.route_number), 0) + 1 INTO v_route_number
    FROM schedules s
    WHERE s.id <> NEW.id
      AND s.counter_id = NEW.counter_id
      AND s.route_id IS NOT DISTINCT FROM v_route_id
      AND (s.departure_datetime AT TIME ZONE 'UTC')::date = v_dep_date;
  END IF;

  -- Corrected numbers written back on the departure (the device gets them at its next sync)
  IF v_dep_number IS DISTINCT FROM NEW.departure_number OR v_route_number IS DISTINCT FROM NEW.route_number THEN
    UPDATE schedules
    SET departure_number = v_dep_number,
        route_number = v_route_number
    WHERE id = NEW.id;
  END IF;

  SELECT COALESCE(MAX(departure_order), 0) + 1 INTO v_next_order
  FROM departure_sequence
  WHERE station_id = v_station_id
    AND departure_date = v_dep_date
    AND route_id IS NOT DISTINCT FROM v_route_id;

  INSERT INTO departure_sequence
    (counter_id, schedule_id, departure_date, departure_number, station_id, departure_order, route_id)
  VALUES
    (NEW.counter_id, NEW.id, v_dep_date, v_dep_number, v_station_id, v_next_order, v_route_id)
  ON CONFLICT (schedule_id) DO NOTHING;

  RETURN NEW;
END;
$$;
