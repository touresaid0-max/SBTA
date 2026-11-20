/*
# Changement de car, partout dans l'application (20/11/2026)

Le car d'un départ se change à plusieurs endroits : guichet (« Modifier le départ »), admin
(Planification), planificateur (Calendrier), chef de gare (panne, car de remplacement). Seul le
guichet replaçait les passagers d'un siège que le nouveau car n'a pas.

Déclencheur sur schedules : dès que bus_id change, quel que soit l'écran, les billets des sièges
que le nouveau car n'a pas sont replacés sur ses places libres (gare vendeuse d'abord) et la
répartition entre gares est ramenée à la taille du car (reseat_schedule_out_of_bus, migration
20261120160000). Un problème à cette étape n'empêche jamais le changement de car.
*/

CREATE OR REPLACE FUNCTION public.trg_reseat_after_bus_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM reseat_schedule_out_of_bus(NEW.id, NEW.bus_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Passagers non replacés après changement de car (départ %) : %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedules_reseat_after_bus_change ON public.schedules;
CREATE TRIGGER trg_schedules_reseat_after_bus_change
  AFTER UPDATE OF bus_id ON public.schedules
  FOR EACH ROW
  WHEN (OLD.bus_id IS DISTINCT FROM NEW.bus_id AND NEW.bus_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_reseat_after_bus_change();
