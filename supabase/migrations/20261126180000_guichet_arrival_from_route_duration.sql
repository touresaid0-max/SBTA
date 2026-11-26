/*
# Heure d'arrivée des départs du guichet (audit chef de gare G3, et suite de G1 — 26/11/2026)

Le guichet envoie un départ avec arrivée = départ + 8 h, quelle que soit la ligne
(« Yop - Divo » : 177 min en base, affiché 480 min). 6 989 départs du guichet en production.

1. Nouveaux départs du guichet : l'arrivée est calculée par le serveur, départ + durée de la
   ligne (routes.estimated_duration_minutes), à l'enregistrement et quand l'heure de départ, la
   ligne ou l'arrivée change. Une ligne sans durée : l'arrivée envoyée est gardée.
2. Départs existants : AUCUNE donnée n'est modifiée (une mise à jour de 7 000 départs
   recalculerait leurs places et serait refusée pour les bus hors service). L'écran
   d'affichage reçoit l'arrivée corrigée de get_station_departures : quand l'écart enregistré
   est de 8 h pile et que le départ porte une autre durée (celle de sa ligne,
   schedules.estimated_duration_minutes), arrivée = départ + cette durée. Même signature.
3. auto_transition_departed_schedules (appelée par l'écran d'affichage) passait « en cours »
   tout départ planifié dont l'heure est passée : un départ enregistré sans heure (00:00)
   passait « en cours » juste après minuit et l'écran affichait « EMBARQUEMENT » toute la
   journée. Un départ à 00:00 pile (heure inconnue) n'est plus changé.

Aucune donnée existante n'est modifiée par cette migration. Les policies RLS ne sont pas touchées.
*/

-- 1. Arrival of a guichet departure = departure + duration of its line
CREATE OR REPLACE FUNCTION public.schedules_guichet_arrival()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_duration integer;
BEGIN
  IF coalesce(NEW.source, '') <> 'guichet' OR NEW.route_id IS NULL OR NEW.departure_datetime IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT r.estimated_duration_minutes INTO v_duration FROM routes r WHERE r.id = NEW.route_id;
  IF coalesce(v_duration, 0) > 0 THEN
    NEW.arrival_datetime := NEW.departure_datetime + make_interval(mins => v_duration);
    NEW.estimated_duration_minutes := v_duration;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedules_guichet_arrival ON public.schedules;
CREATE TRIGGER trg_schedules_guichet_arrival
  BEFORE INSERT OR UPDATE OF departure_datetime, arrival_datetime, route_id ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.schedules_guichet_arrival();

-- 2. Display screen: arrival corrected for the departures saved with + 8 h (same signature)
CREATE OR REPLACE FUNCTION public.get_station_departures(p_station_id uuid, p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(id uuid, route_name text, departure_datetime timestamp with time zone, arrival_datetime timestamp with time zone, status text, seats_available integer, seats_reserved integer, bus_capacity integer, fill_rate numeric, notes text, transit_stops jsonb, bus_registration text, bus_model text, driver_name text, driver_phone text, copilot_name text, departure_station_name text, arrival_station_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    sch.id,
    sch.route_name,
    sch.departure_datetime,
    CASE
      WHEN sch.arrival_datetime - sch.departure_datetime = interval '8 hours'
       AND coalesce(sch.estimated_duration_minutes, 0) > 0
       AND sch.estimated_duration_minutes <> 480
      THEN sch.departure_datetime + make_interval(mins => sch.estimated_duration_minutes)
      ELSE sch.arrival_datetime
    END,
    sch.status,
    COALESCE(sch.seats_available, GREATEST(0, COALESCE(b.total_seats, b.capacity, 0) - COALESCE(sch.seats_reserved, 0))) AS seats_available,
    COALESCE(sch.seats_reserved, 0) AS seats_reserved,
    COALESCE(b.total_seats, b.capacity, 0) AS bus_capacity,
    sch.fill_rate,
    COALESCE(sch.notes, '') AS notes,
    COALESCE(sch.transit_stops, '[]'::jsonb) AS transit_stops,
    COALESCE(b.registration_number, '—') AS bus_registration,
    COALESCE(b.model, '') AS bus_model,
    COALESCE(u_driver.full_name, '—') AS driver_name,
    COALESCE(u_driver.phone, '') AS driver_phone,
    COALESCE(u_copilot.full_name, '') AS copilot_name,
    COALESCE(dep_st.name, '—') AS departure_station_name,
    COALESCE(arr_st.name, '—') AS arrival_station_name
  FROM schedules sch
  LEFT JOIN buses b ON b.id = sch.bus_id
  LEFT JOIN users u_driver ON u_driver.id = sch.driver_id
  LEFT JOIN users u_copilot ON u_copilot.id = sch.copilot_id
  LEFT JOIN stations dep_st ON dep_st.id = sch.departure_station_id
  LEFT JOIN stations arr_st ON arr_st.id = sch.arrival_station_id
  WHERE sch.departure_station_id = p_station_id
    AND sch.departure_datetime >= (p_date::timestamptz AT TIME ZONE 'UTC')
    AND sch.departure_datetime < ((p_date + 1)::timestamptz AT TIME ZONE 'UTC')
    AND (
      sch.is_anticipated = false
      OR (sch.is_anticipated = true AND sch.bus_id IS NOT NULL AND sch.driver_id IS NOT NULL)
    )
  ORDER BY sch.departure_datetime ASC;
$function$;

-- 3. A departure whose time is unknown (00:00 exactly) is not set « en cours » by the clock
CREATE OR REPLACE FUNCTION public.auto_transition_departed_schedules()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  updated_count integer;
BEGIN
  UPDATE schedules
     SET status = 'en_cours'
   WHERE status = 'planifie'
     AND departure_datetime <= NOW()
     AND (departure_datetime AT TIME ZONE 'UTC')::time <> time '00:00';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

NOTIFY pgrst, 'reload schema';
