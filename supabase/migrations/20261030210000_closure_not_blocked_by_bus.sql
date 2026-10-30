/*
# Clôture des départs : ne plus être bloquée par l'état du bus

Constat (production, 30/10/2026) : 46 départs des jours passés restaient ouverts. 2 avaient un
bus « hors_service » : le contrôle trigger_validate_schedule_conflicts refusait de les passer en
« termine », toute la clôture était annulée, et les guichets la relançaient sans fin. La même
situation bloquerait la tâche planifiée de minuit (sbta-cloture-minuit).

1. validate_schedule_conflicts()
  - Terminer ou annuler un départ, sans changer son bus, n'exige plus que le bus soit
    « disponible » ou « en_service » : on clôture un voyage, on n'affecte pas un bus.
  - Création d'un départ, changement de bus et toute autre modification : contrôle inchangé.

2. auto_terminate_past_schedules()
  - Chaque départ est clôturé séparément : une erreur sur un départ est signalée
    (avertissement dans les journaux Postgres) et n'annule plus la clôture des autres.
  - Départs concernés, alertes « charges obligatoires manquantes » et résultat renvoyé :
    inchangés.
*/

CREATE OR REPLACE FUNCTION validate_schedule_conflicts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
v_bus_status text;
BEGIN
-- Closing or cancelling a trip does not assign its bus: no bus status check
IF TG_OP = 'UPDATE'
   AND NEW.status IN ('termine', 'annule')
   AND NEW.bus_id IS NOT DISTINCT FROM OLD.bus_id THEN
  RETURN NEW;
END IF;

-- Skip bus validation for anticipated departures without a bus assigned
IF NEW.is_anticipated = true AND NEW.bus_id IS NULL THEN
  RETURN NEW;
END IF;

-- Hard block: bus must be in an operable status (hardware constraint).
SELECT status INTO v_bus_status FROM buses WHERE id = NEW.bus_id;

IF v_bus_status IS NULL THEN
  RAISE EXCEPTION 'Bus introuvable';
END IF;

IF v_bus_status NOT IN ('disponible', 'en_service') THEN
  RAISE EXCEPTION 'Bus non disponible (statut: %)', v_bus_status;
END IF;

-- Schedule-overlap conflicts (bus already on another trip, driver already assigned)
-- are now soft warnings handled in the UI.  The trigger no longer blocks them.

RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auto_terminate_past_schedules(p_station_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  results jsonb := '[]'::jsonb;
  has_peage boolean;
  has_ration boolean;
  alert_msg text;
  alert_type_val text;
BEGIN
  FOR rec IN
    SELECT s.id, s.route_id, s.bus_id, s.departure_datetime, s.arrival_datetime, s.status,
           r.name as route_name,
           b.registration_number as plate_number
    FROM schedules s
    LEFT JOIN routes r ON r.id = s.route_id
    LEFT JOIN buses b ON b.id = s.bus_id
    WHERE s.status IN ('planifie', 'en_cours', 'retard', 'convoi', 'panne')
      AND s.admin_reactivated_at IS NULL
      AND s.departure_datetime < date_trunc('day', now())
      AND (p_station_id IS NULL OR s.departure_station_id = p_station_id)
    ORDER BY s.departure_datetime ASC
  LOOP
    -- Each departure on its own: an error on one no longer rolls back the others
    BEGIN
      SELECT EXISTS(
        SELECT 1 FROM counter_charges
        WHERE schedule_id = rec.id AND charge_type = 'peage' AND status != 'rejete'
      ) INTO has_peage;

      SELECT EXISTS(
        SELECT 1 FROM counter_charges
        WHERE schedule_id = rec.id AND charge_type = 'ration' AND status != 'rejete'
      ) INTO has_ration;

      UPDATE schedules
      SET status = 'termine',
          updated_at = now()
      WHERE id = rec.id;

      IF NOT has_peage OR NOT has_ration THEN
        alert_msg := 'Voyage ' || COALESCE(rec.route_name, '') || ' (' ||
                     COALESCE(rec.plate_number, '') || ') du ' ||
                     to_char(rec.departure_datetime, 'DD/MM/YYYY HH24:MI') ||
                     ' - OBLIGATOIRE manquant : ' ||
                     CASE WHEN NOT has_peage AND NOT has_ration THEN 'Peage + Ratios'
                          WHEN NOT has_peage THEN 'Peage'
                          ELSE 'Ratios'
                     END;
        alert_type_val := 'missing_mandatory_charges';

        INSERT INTO schedule_auto_close_alerts (schedule_id, station_id, alert_type, message)
        VALUES (rec.id, p_station_id, alert_type_val, alert_msg)
        ON CONFLICT DO NOTHING;

        results := results || jsonb_build_object(
          'schedule_id', rec.id,
          'route_name', COALESCE(rec.route_name, ''),
          'plate_number', COALESCE(rec.plate_number, ''),
          'departure', rec.departure_datetime,
          'missing_charges', true,
          'missing_peage', NOT has_peage,
          'missing_ration', NOT has_ration
        );
      ELSE
        results := results || jsonb_build_object(
          'schedule_id', rec.id,
          'route_name', COALESCE(rec.route_name, ''),
          'plate_number', COALESCE(rec.plate_number, ''),
          'departure', rec.departure_datetime,
          'missing_charges', false,
          'missing_peage', false,
          'missing_ration', false
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'auto_terminate_past_schedules: départ % non clôturé : %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN results;
END;
$$;
