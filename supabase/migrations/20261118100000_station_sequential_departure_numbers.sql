/*
# Gare : numérotation continue des départs (ADJAME-DIVO)

Demande (18/11/2026) : à la gare ADJAME-DIVO, les numéros de départ doivent se suivre (#1, #2,
#3…) pour tous les départs de la journée, toutes lignes confondues. Jusqu'ici chaque ligne avait
ses propres numéros (Daoukro - Abidjan #1, Daoukro - Bouake #1…) : plusieurs départs portaient
le n° 1 le même jour.

## Changements
- stations.sequential_departure_numbers (faux par défaut) : réglage par gare, dans Admin › Gares
  (« Numérotation continue des départs »). Coché pour ADJAME-DIVO ; les autres gares gardent la
  numérotation par ligne.
- Déclencheur auto_create_departure_sequence (repris de 20261104150000) : pour une gare en
  numérotation continue, un n° de départ (schedules.route_number) déjà pris par un autre départ
  de la gare ce jour-là, quelle que soit la ligne ou le guichet, est remplacé par le suivant
  libre. Un verrou par gare et par jour attribue les numéros l'un après l'autre. Pour les autres
  gares, rien ne change.

Les départs existants gardent leur numéro (numéros imprimés sur les tickets). Aucune règle
d'accès ne change, RLS reste activé.
*/

ALTER TABLE public.stations
  ADD COLUMN IF NOT EXISTS sequential_departure_numbers boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stations.sequential_departure_numbers IS
  'Numérotation continue des départs du jour (toutes lignes et tous guichets de la gare) au lieu d''une numérotation par ligne';

UPDATE public.stations SET sequential_departure_numbers = true
WHERE upper(btrim(name)) = 'ADJAME-DIVO' AND NOT sequential_departure_numbers;

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
  v_sequential   boolean := false;
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

  SELECT coalesce(st.sequential_departure_numbers, false) INTO v_sequential
  FROM stations st WHERE st.id = v_station_id;
  v_sequential := coalesce(v_sequential, false);

  v_route_id := NEW.route_id;
  v_dep_date := (NEW.departure_datetime AT TIME ZONE 'UTC')::date;

  -- One numbering at a time per counter and day, and per station, day and line
  PERFORM pg_advisory_xact_lock(hashtext('departure_number:' || NEW.counter_id::text || ':' || v_dep_date::text));
  PERFORM pg_advisory_xact_lock(hashtext('departure_order:' || v_station_id::text || ':' || v_dep_date::text || ':' || COALESCE(v_route_id::text, '-')));
  -- Continuous numbering: one at a time for the whole station and day
  IF v_sequential THEN
    PERFORM pg_advisory_xact_lock(hashtext('departure_route_number:' || v_station_id::text || ':' || v_dep_date::text));
  END IF;

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

  v_route_number := NEW.route_number;
  IF v_sequential THEN
    -- Continuous numbering: the number shown (route_number) is unique among all the station's
    -- departures of the day, whatever the line or the counter
    IF v_route_number IS NOT NULL AND v_route_number > 0 AND EXISTS (
      SELECT 1 FROM schedules s
      WHERE s.id <> NEW.id
        AND s.departure_station_id = v_station_id
        AND (s.departure_datetime AT TIME ZONE 'UTC')::date = v_dep_date
        AND s.route_number = v_route_number
        AND s.status IS DISTINCT FROM 'annule'
    ) THEN
      SELECT COALESCE(MAX(s.route_number), 0) + 1 INTO v_route_number
      FROM schedules s
      WHERE s.id <> NEW.id
        AND s.departure_station_id = v_station_id
        AND (s.departure_datetime AT TIME ZONE 'UTC')::date = v_dep_date;
    END IF;
  ELSE
    -- N° de ligne: same rule among this counter's departures of the day on this line
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

NOTIFY pgrst, 'reload schema';
