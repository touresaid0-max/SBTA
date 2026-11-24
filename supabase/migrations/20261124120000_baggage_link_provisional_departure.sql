/*
# Bagagiste sans réseau : bagage rattaché au départ du guichet par son numéro (24/11/2026)

Sans réseau, le bagagiste tape le N° de départ écrit sur le ticket du voyageur. Un départ pas
encore connu est créé sur son poste comme départ provisoire : le bagage arrive au serveur sans
départ (schedule_id vide), avec sa gare, son jour (created_at) et le numéro du départ.

1. baggage_schedule_for(gare, jour, numéro) : le départ du guichet de cette gare, ce jour-là, de ce
   numéro (numéro du départ au guichet, ou son ordre dans la journée).
2. À l'arrivée d'un tel bagage, il est rattaché à ce départ s'il existe déjà.
3. À la création (ou au changement de numéro) d'un départ, les bagages sans départ de sa gare, de son
   jour et de son numéro lui sont rattachés.
4. Les bagages déjà dans ce cas sont rattachés tout de suite.
Un problème de rattachement n'empêche jamais l'enregistrement du bagage ni du départ.
*/

CREATE OR REPLACE FUNCTION public.baggage_schedule_for(p_station_id uuid, p_day date, p_number integer)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id
  FROM schedules s
  LEFT JOIN departure_sequence ds ON ds.schedule_id = s.id
  WHERE s.departure_station_id = p_station_id
    AND s.departure_datetime::date = p_day
    AND coalesce(s.status, '') <> 'annule'
    AND p_number IN (s.route_number, s.departure_number, ds.departure_order)
  ORDER BY (s.route_number = p_number) DESC NULLS LAST, s.created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.baggage_schedule_for(uuid, date, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_baggage_link_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.schedule_id IS NULL AND NEW.departure_number IS NOT NULL AND NEW.station_id IS NOT NULL THEN
    BEGIN
      NEW.schedule_id := baggage_schedule_for(NEW.station_id, coalesce(NEW.created_at, now())::date, NEW.departure_number);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_baggage_tickets_link_schedule ON public.baggage_tickets;
CREATE TRIGGER trg_baggage_tickets_link_schedule
  BEFORE INSERT ON public.baggage_tickets
  FOR EACH ROW EXECUTE FUNCTION public.trg_baggage_link_schedule();

CREATE OR REPLACE FUNCTION public.trg_schedule_link_baggage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE baggage_tickets b
       SET schedule_id = NEW.id
     WHERE b.schedule_id IS NULL
       AND b.station_id = NEW.departure_station_id
       AND b.departure_number IN (NEW.route_number, NEW.departure_number)
       AND b.created_at::date = NEW.departure_datetime::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Bagages non rattachés au départ % : %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedules_link_baggage ON public.schedules;
CREATE TRIGGER trg_schedules_link_baggage
  AFTER INSERT OR UPDATE OF route_number, departure_number, departure_datetime ON public.schedules
  FOR EACH ROW
  WHEN (coalesce(NEW.status, '') <> 'annule')
  EXECUTE FUNCTION public.trg_schedule_link_baggage();

-- 4. Les bagages déjà sans départ, avec un numéro
UPDATE baggage_tickets b
   SET schedule_id = baggage_schedule_for(b.station_id, b.created_at::date, b.departure_number)
 WHERE b.schedule_id IS NULL
   AND b.departure_number IS NOT NULL
   AND b.station_id IS NOT NULL
   AND baggage_schedule_for(b.station_id, b.created_at::date, b.departure_number) IS NOT NULL;

NOTIFY pgrst, 'reload schema';
