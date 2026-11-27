/*
# Clôture des départs tardifs : 5 heures de vente au moins après 20h (27/11/2026)

Demande : un départ créé tard (ex. 22h) était clôturé à 00h05, deux heures après : les guichets
n'avaient plus le temps de vendre ses billets. À partir de 20h, un départ reste ouvert au moins
5 heures avant d'être clôturé.

| Départ                                            | Heure retenue | Clôture                         |
| Créé le 27 à 08h, pour le 27, sans heure saisie   | 08h           | nuit du 27 au 28, à 00h05       |
| Créé le 27 à 22h, pour le 27, sans heure saisie   | 22h           | au plus tôt le 28 à 03h00       |
| Heure saisie à 21h30                              | 21h30         | au plus tôt à 02h30             |
| Créé le 27 à 22h, pour le 28                      | aucune        | nuit du 28 au 29                |

Heure retenue : l'heure saisie ; sans heure saisie (départ à 00:00, cas le plus courant au guichet),
l'heure de création du départ si elle est du même jour que le départ.

1. closure_settings : les deux réglages (20h, 5 h), une seule ligne. Lecture : comptes connectés
   (le guichet applique la même règle sur son poste). Modification : administrateur.
2. schedule_earliest_closure(départ, création) : moment à partir duquel un départ peut être clôturé :
   minuit après son jour, ou plus tard pour un départ tardif (jamais plus tôt qu'avant).
3. auto_terminate_past_schedules : ne clôture que les départs dont ce moment est passé. Les départs
   non tardifs : inchangé (clôturés à 00h05).
4. Tâche sbta-cloture-tardifs à 05h05 : même appel que sbta-cloture-minuit, pour les départs tardifs
   (au plus tard 23h59 + 5 h = 04h59). La tâche de 00h05 n'est pas modifiée.

Aucune donnée existante modifiée, aucune RLS désactivée.
*/

-- ── 1. Réglages ──
CREATE TABLE IF NOT EXISTS public.closure_settings (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  late_from_hour integer NOT NULL DEFAULT 20 CHECK (late_from_hour BETWEEN 0 AND 23),
  late_min_hours integer NOT NULL DEFAULT 5 CHECK (late_min_hours BETWEEN 0 AND 23),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);

INSERT INTO public.closure_settings (id, late_from_hour, late_min_hours)
VALUES (1, 20, 5)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.closure_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.closure_settings FROM anon;

DROP POLICY IF EXISTS closure_settings_select ON public.closure_settings;
CREATE POLICY closure_settings_select ON public.closure_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS closure_settings_update_admin ON public.closure_settings;
CREATE POLICY closure_settings_update_admin ON public.closure_settings FOR UPDATE TO authenticated
  USING ((SELECT public.get_user_role()) = 'admin')
  WITH CHECK ((SELECT public.get_user_role()) = 'admin');

-- ── 2. Moment à partir duquel un départ peut être clôturé ──
CREATE OR REPLACE FUNCTION public.schedule_earliest_closure(p_departure timestamptz, p_created timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT coalesce((SELECT late_from_hour FROM closure_settings WHERE id = 1), 20) AS from_hour,
           coalesce((SELECT late_min_hours FROM closure_settings WHERE id = 1), 5) AS min_hours
  ),
  d AS (
    SELECT date_trunc('day', p_departure AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 day' AS day_end,
           CASE
             WHEN (p_departure AT TIME ZONE 'UTC')::time <> time '00:00' THEN p_departure
             WHEN p_created IS NOT NULL
              AND (p_created AT TIME ZONE 'UTC')::date = (p_departure AT TIME ZONE 'UTC')::date THEN p_created
           END AS ref
  )
  SELECT CASE
           WHEN d.ref IS NOT NULL AND extract(hour FROM d.ref AT TIME ZONE 'UTC') >= r.from_hour
             THEN greatest(d.day_end, d.ref + make_interval(hours => r.min_hours))
           ELSE d.day_end
         END
  FROM d, r;
$$;

REVOKE ALL ON FUNCTION public.schedule_earliest_closure(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_earliest_closure(timestamptz, timestamptz) TO authenticated, service_role;

-- ── 3. Clôture : seulement les départs dont le moment de clôture est passé ──
CREATE OR REPLACE FUNCTION public.auto_terminate_past_schedules(p_station_id uuid DEFAULT NULL)
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
      -- A late departure (from 20h) stays open at least 5 h (closure_settings)
      AND schedule_earliest_closure(s.departure_datetime, s.created_at) <= now()
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

-- ── 4. Second passage à 05h05 pour les départs tardifs (même appel que celui de 00h05) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'sbta-cloture-tardifs',
      '5 5 * * *',
      $cmd$
    SELECT public.auto_terminate_past_schedules(s.departure_station_id)
    FROM (SELECT DISTINCT departure_station_id
          FROM public.schedules
          WHERE status IN ('planifie', 'en_cours', 'retard', 'convoi', 'panne')
            AND admin_reactivated_at IS NULL
            AND departure_datetime < date_trunc('day', now())) s;
  $cmd$
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
