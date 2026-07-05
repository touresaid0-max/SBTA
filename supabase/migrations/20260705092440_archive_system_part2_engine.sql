/*
# Système d'archivage intelligent SBTA/EAFRIBUS — Partie 2: Fonctions & configuration

## Résumé
Ajoute le moteur d'archivage piloté par configuration et l'API du tableau de bord,
puis renseigne les règles de gestion par défaut demandées.

## Nouvelles fonctions
1. `run_archive(p_run_type, p_triggered_by, p_only_table)` — SECURITY DEFINER.
   - Parcourt `archive_policies` actives, dans l'ordre `sort_order` (enfants avant parents).
   - action='archive': copie vers `archived_records` (snapshot jsonb + champs de
     recherche) les lignes plus anciennes que `retention_months`, puis supprime
     UNIQUEMENT les lignes effectivement archivées de la table active.
   - action='purge': supprime les données temporaires/logs expirés.
   - action='keep': ignorée (données permanentes).
   - Chaque table est traitée dans un sous-bloc protégé: une erreur (ex: contrainte FK)
     est journalisée sans interrompre l'ensemble ni perdre de donnée.
   - Contrôle d'accès: run_type='manual' réservé à l'administrateur; run_type='auto'
     réservé au contexte planificateur (auth.uid() nul, ex: cron).
   - Journalise l'exécution dans `archive_runs` et met à jour `archive_settings`.
2. `get_archive_dashboard()` — SECURITY DEFINER, réservée admin/daf/gestionnaire.
   Retourne un JSON: compteurs par type, taille base active, taille des archives,
   date du dernier et prochain archivage, résumé des politiques.

## Données de configuration (par défaut, modifiables/extensibles depuis l'UI)
- Métier (archivage 12 mois): payments, baggage_tickets, mobile_bookings,
  parcel_tracking_events, parcels, reservations, schedules.
- Temporaire (purge): mobile_otp_codes, mobile_otp_attempts, user_sessions.
- Logs (purge): sms_logs, activity_logs, ticket_sale_audit_log.

## Notes importantes
1. Aucune donnée n'est déplacée par cette migration (seule la configuration est créée).
   Avec une rétention de 12 mois et des données récentes, rien n'est éligible
   immédiatement — les rapports actifs (DAF, gestionnaire) restent intacts.
2. L'ordre de traitement respecte les clés étrangères (enfants avant parents).
*/

CREATE OR REPLACE FUNCTION run_archive(
  p_run_type text DEFAULT 'manual',
  p_triggered_by uuid DEFAULT NULL,
  p_only_table text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_id uuid;
  v_uid uuid := auth.uid();
  pol RECORD;
  v_ref text; v_client text; v_phone text; v_amount text; v_date text;
  v_company text; v_station text; v_bus text; v_driver text;
  v_arch integer; v_del integer;
  v_total_arch integer := 0; v_total_purge integer := 0;
  v_details jsonb := '[]'::jsonb;
BEGIN
  -- Access control
  IF p_run_type = 'manual' THEN
    IF NOT archive_is_admin() THEN
      RAISE EXCEPTION 'Accès réservé aux administrateurs';
    END IF;
  ELSE
    -- automatic runs only allowed outside of an end-user session (e.g. cron)
    IF v_uid IS NOT NULL THEN
      RAISE EXCEPTION 'Exécution automatique non autorisée dans ce contexte';
    END IF;
  END IF;

  INSERT INTO archive_runs (run_type, status, triggered_by)
  VALUES (p_run_type, 'running', COALESCE(p_triggered_by, v_uid))
  RETURNING id INTO v_run_id;

  FOR pol IN
    SELECT * FROM archive_policies
    WHERE is_active AND action <> 'keep'
      AND (p_only_table IS NULL OR source_table = p_only_table)
    ORDER BY sort_order, source_table
  LOOP
    v_arch := 0; v_del := 0;
    BEGIN
      v_date := 't.' || quote_ident(pol.date_column);

      IF pol.action = 'purge' THEN
        EXECUTE format(
          'DELETE FROM %I t WHERE %s < (now() - (%L || '' months'')::interval)',
          pol.source_table, v_date, pol.retention_months
        );
        GET DIAGNOSTICS v_del = ROW_COUNT;
        v_total_purge := v_total_purge + v_del;

      ELSE -- archive
        v_ref     := CASE WHEN pol.reference_column   IS NOT NULL THEN 't.'||quote_ident(pol.reference_column)||'::text'   ELSE 'NULL::text' END;
        v_client  := CASE WHEN pol.client_name_column IS NOT NULL THEN 't.'||quote_ident(pol.client_name_column)||'::text' ELSE 'NULL::text' END;
        v_phone   := CASE WHEN pol.phone_column       IS NOT NULL THEN 't.'||quote_ident(pol.phone_column)||'::text'       ELSE 'NULL::text' END;
        v_amount  := CASE WHEN pol.amount_column      IS NOT NULL THEN 't.'||quote_ident(pol.amount_column)||'::numeric'   ELSE 'NULL::numeric' END;
        v_company := CASE WHEN pol.company_column      IS NOT NULL THEN 't.'||quote_ident(pol.company_column)||'::uuid'     ELSE 'NULL::uuid' END;
        v_station := CASE WHEN pol.station_column      IS NOT NULL THEN 't.'||quote_ident(pol.station_column)||'::uuid'     ELSE 'NULL::uuid' END;
        v_bus     := CASE WHEN pol.bus_column          IS NOT NULL THEN 't.'||quote_ident(pol.bus_column)||'::uuid'         ELSE 'NULL::uuid' END;
        v_driver  := CASE WHEN pol.driver_column       IS NOT NULL THEN 't.'||quote_ident(pol.driver_column)||'::uuid'      ELSE 'NULL::uuid' END;

        EXECUTE format(
          'INSERT INTO archived_records
             (source_table, source_id, reference, client_name, client_phone, amount,
              record_date, company_id, station_id, bus_id, driver_id, data, archive_run_id)
           SELECT %L, t.id, %s, %s, %s, %s, %s::timestamptz, %s, %s, %s, %s, to_jsonb(t.*), %L
           FROM %I t
           WHERE %s < (now() - (%L || '' months'')::interval)
           ON CONFLICT (source_table, source_id) DO NOTHING',
          pol.source_table, v_ref, v_client, v_phone, v_amount, v_date,
          v_company, v_station, v_bus, v_driver, v_run_id,
          pol.source_table, v_date, pol.retention_months
        );
        GET DIAGNOSTICS v_arch = ROW_COUNT;

        EXECUTE format(
          'DELETE FROM %I t WHERE t.id IN (
             SELECT source_id FROM archived_records
             WHERE source_table = %L AND archive_run_id = %L)',
          pol.source_table, pol.source_table, v_run_id
        );
        GET DIAGNOSTICS v_del = ROW_COUNT;
        v_total_arch := v_total_arch + v_del;
      END IF;

      v_details := v_details || jsonb_build_object(
        'source_table', pol.source_table,
        'label', pol.label,
        'action', pol.action,
        'archived', v_arch,
        'deleted', v_del,
        'status', 'ok'
      );

    EXCEPTION WHEN OTHERS THEN
      v_details := v_details || jsonb_build_object(
        'source_table', pol.source_table,
        'label', pol.label,
        'action', pol.action,
        'archived', 0,
        'deleted', 0,
        'status', 'error',
        'error', SQLERRM
      );
    END;
  END LOOP;

  UPDATE archive_runs
     SET status = 'completed', finished_at = now(),
         total_archived = v_total_arch, total_purged = v_total_purge,
         details = v_details
   WHERE id = v_run_id;

  UPDATE archive_settings SET last_run_at = now(), updated_at = now() WHERE id = 1;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_archive_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_last timestamptz;
  v_schedule text;
BEGIN
  IF NOT archive_can_view() THEN
    RAISE EXCEPTION 'Accès non autorisé';
  END IF;

  SELECT last_run_at, schedule_label INTO v_last, v_schedule FROM archive_settings WHERE id = 1;

  SELECT jsonb_build_object(
    'counts_by_type', COALESCE((
      SELECT jsonb_object_agg(source_table, cnt)
      FROM (SELECT source_table, count(*) AS cnt FROM archived_records GROUP BY source_table) s
    ), '{}'::jsonb),
    'total_archived', (SELECT count(*) FROM archived_records),
    'active_db_size', pg_database_size(current_database()),
    'active_db_size_pretty', pg_size_pretty(pg_database_size(current_database())),
    'archive_size', pg_total_relation_size('archived_records'),
    'archive_size_pretty', pg_size_pretty(pg_total_relation_size('archived_records')),
    'last_run_at', v_last,
    'schedule_label', v_schedule,
    'last_runs', COALESCE((
      SELECT jsonb_agg(r) FROM (
        SELECT id, run_type, status, started_at, finished_at,
               total_archived, total_purged, details, error
        FROM archive_runs ORDER BY started_at DESC LIMIT 10
      ) r
    ), '[]'::jsonb),
    'policies', COALESCE((
      SELECT jsonb_agg(p ORDER BY p.sort_order) FROM (
        SELECT source_table, label, category, action, retention_months, date_column, is_active, sort_order
        FROM archive_policies
      ) p
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Seed default policies (idempotent)
INSERT INTO archive_policies
  (source_table, label, category, date_column, retention_months, action,
   reference_column, client_name_column, phone_column, amount_column,
   company_column, station_column, bus_column, driver_column, sort_order)
VALUES
  ('payments','Paiements','metier','created_at',12,'archive',
    'payment_reference',NULL,NULL,'amount', NULL,NULL,NULL,NULL, 10),
  ('baggage_tickets','Bordereaux / Bagages','metier','created_at',12,'archive',
    'baggage_number','owner_name','owner_phone','price', NULL,'station_id',NULL,NULL, 15),
  ('mobile_bookings','Billets en ligne','metier','created_at',12,'archive',
    'booking_ref',NULL,'payment_phone','total', 'company_id',NULL,NULL,NULL, 20),
  ('parcel_tracking_events','Suivi colis','metier','created_at',12,'archive',
    NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL, 25),
  ('parcels','Colis livrés','metier','created_at',12,'archive',
    'parcel_code','recipient_name','recipient_phone','total_amount', 'company_id','origin_station_id','bus_id','driver_id', 30),
  ('reservations','Réservations','metier','created_at',12,'archive',
    'booking_reference','passenger_name','passenger_phone','total_price', NULL,NULL,NULL,'booked_by', 40),
  ('schedules','Voyages / Planification','metier','departure_datetime',12,'archive',
    'route_name',NULL,NULL,'price', NULL,'departure_station_id','bus_id','driver_id', 50),
  ('mobile_otp_codes','Codes OTP expirés','temporaire','expires_at',0,'purge',
    NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL, 80),
  ('mobile_otp_attempts','Tentatives OTP','temporaire','created_at',3,'purge',
    NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL, 81),
  ('user_sessions','Sessions expirées','temporaire','expires_at',0,'purge',
    NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL, 82),
  ('sms_logs','Journaux SMS','log','created_at',12,'purge',
    NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL, 90),
  ('activity_logs','Journaux techniques','log','created_at',24,'purge',
    NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL, 91),
  ('ticket_sale_audit_log','Audit ventes','log','created_at',24,'purge',
    NULL,NULL,NULL,NULL, NULL,NULL,NULL,NULL, 92)
ON CONFLICT (source_table) DO NOTHING;
