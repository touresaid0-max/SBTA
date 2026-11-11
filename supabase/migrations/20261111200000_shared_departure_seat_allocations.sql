/*
# Départ chargé dans une autre gare : la répartition des sièges va sur le serveur

Constat (11/11/2026) : au guichet, quand la gare principale active « Charger dans une autre
gare » et répartit les sièges (Bouaké 2 à 31, Yamoussoukro 32 à 62), la gare secondaire ne voit
jamais le départ. La répartition restait sur l'appareil de la gare principale : le serveur ne la
connaissait pas, et chaque guichet ne récupère que les départs de sa propre gare.

1. schedules.seat_allocations (jsonb) : la répartition, telle que le guichet l'enregistre :
   [{ "station_id", "station_name", "seat_from", "seat_to" }, …].
2. schedules.shared_station_ids (uuid[]) : les gares, autres que la gare de départ, qui vendent
   sur ce départ. Tenu à jour par un trigger depuis seat_allocations, indexé : la gare
   secondaire retrouve ses départs partagés par une simple recherche.

Aucune donnée existante n'est modifiée ; aucune règle d'accès ne change (les guichetiers lisent
déjà tous les départs, et vendent déjà sur n'importe quel départ).
*/

ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS seat_allocations jsonb;
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS shared_station_ids uuid[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.schedules_shared_station_ids()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.seat_allocations IS NULL OR jsonb_typeof(NEW.seat_allocations) <> 'array' THEN
    NEW.shared_station_ids := '{}';
  ELSE
    SELECT coalesce(array_agg(DISTINCT (a->>'station_id')::uuid), '{}')
    INTO NEW.shared_station_ids
    FROM jsonb_array_elements(NEW.seat_allocations) a
    WHERE a->>'station_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (NEW.departure_station_id IS NULL OR (a->>'station_id')::uuid <> NEW.departure_station_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedules_shared_station_ids ON public.schedules;
CREATE TRIGGER trg_schedules_shared_station_ids
  BEFORE INSERT OR UPDATE OF seat_allocations, departure_station_id ON public.schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.schedules_shared_station_ids();

CREATE INDEX IF NOT EXISTS idx_schedules_shared_station_ids
  ON public.schedules USING gin (shared_station_ids);

NOTIFY pgrst, 'reload schema';
