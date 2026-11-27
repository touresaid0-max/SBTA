-- Audit Supabase production du 27/11/2026 : points critiques 2.1, 2.2 et 2.3.
-- Aucune RLS désactivée, aucune donnée supprimée.

-- ── 2.1 Tables de sauvegarde du 26/11 (nettoyage des lignes G10) sans RLS ──
-- Lisibles et modifiables par tous via l'API. RLS activée sans règle : plus accessibles par l'API
-- (le propriétaire et le service y accèdent toujours, pour une restauration).
DO $$
BEGIN
  IF to_regclass('public.backup_routes_20261126') IS NOT NULL THEN
    ALTER TABLE public.backup_routes_20261126 ENABLE ROW LEVEL SECURITY;
  END IF;
  IF to_regclass('public.backup_counter_routes_20261126') IS NOT NULL THEN
    ALTER TABLE public.backup_counter_routes_20261126 ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ── 2.2 Règles de la table employees fondées sur user_metadata ──
-- user_metadata est modifiable par l'utilisateur lui-même : il pouvait s'y donner le rôle admin ou
-- rh. Le rôle vient maintenant de la base (users.role, get_user_role()), comme les autres règles ;
-- app_metadata n'est plus lu non plus (un compte gestionnaire y avait « admin »).
DROP POLICY IF EXISTS employees_delete_admin ON public.employees;
CREATE POLICY employees_delete_admin ON public.employees FOR DELETE TO authenticated
  USING ((SELECT public.get_user_role()) = 'admin');

DROP POLICY IF EXISTS employees_insert_gerant_principal ON public.employees;
CREATE POLICY employees_insert_gerant_principal ON public.employees FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_user_role()) = 'gerant_principal');

DROP POLICY IF EXISTS employees_insert_rh_admin ON public.employees;
CREATE POLICY employees_insert_rh_admin ON public.employees FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_user_role()) = ANY (ARRAY['admin', 'rh']));

DROP POLICY IF EXISTS employees_select_gerant_principal ON public.employees;
CREATE POLICY employees_select_gerant_principal ON public.employees FOR SELECT TO authenticated
  USING ((SELECT public.get_user_role()) = 'gerant_principal');

DROP POLICY IF EXISTS employees_select_rh_admin_daf ON public.employees;
CREATE POLICY employees_select_rh_admin_daf ON public.employees FOR SELECT TO authenticated
  USING ((SELECT public.get_user_role()) = ANY (ARRAY['admin', 'rh', 'daf', 'dg']));

DROP POLICY IF EXISTS employees_update_rh_admin ON public.employees;
CREATE POLICY employees_update_rh_admin ON public.employees FOR UPDATE TO authenticated
  USING ((SELECT public.get_user_role()) = ANY (ARRAY['admin', 'rh']))
  WITH CHECK ((SELECT public.get_user_role()) = ANY (ARRAY['admin', 'rh']));

-- ── 2.3 Fonctions privilégiées (SECURITY DEFINER) appelables sans connexion ──
-- Elles restent ouvertes aux visiteurs seulement si une page sans connexion les appelle (écran
-- d'affichage des gares, kiosque, site public, suivi de colis, appli mobile avant connexion) ou si
-- elles disent seulement qui est connecté (utilisées par les règles d'accès ; rien pour un
-- visiteur). Les déclencheurs ne sont pas touchés : le droit d'exécution ne compte pas pour eux.
-- Celles que seuls le serveur et d'autres fonctions appellent sont fermées aussi aux comptes
-- connectés (fonctions Edge avec la clé de service ; les fonctions qui les appellent s'exécutent
-- avec les droits du propriétaire).
DO $$
DECLARE
  r record;
  keep_anon text[] := ARRAY[
    -- Pages sans connexion
    'get_station_departures', 'get_station_display_info', 'get_station_display_arrivals',
    'get_station_display_departures', 'get_server_time', 'now_utc',
    'auto_transition_departed_schedules', 'get_occupied_seats', 'get_sibling_schedule_ids',
    'try_lock_seat', 'release_seat_lock', 'get_mobile_service_fee', 'get_wave_public_status',
    'get_schedules_transport_info',
    -- Qui est connecté (règles d'accès)
    '_current_user_role', '_is_carburant_agent', '_my_tank_ids', 'archive_can_view',
    'archive_is_admin', 'archive_role', 'get_comptable_company_ids', 'get_current_employee',
    'get_current_user_info', 'get_gestionnaire_company_id', 'get_guichetier_station_id',
    'get_my_company_id', 'get_my_counter_id', 'get_my_employee_id', 'get_my_garage_id',
    'get_my_org', 'get_my_role', 'get_my_role_assurance', 'get_my_role_carburant',
    'get_my_role_for_fuel', 'get_my_role_logistique', 'get_my_station_id', 'get_subsidiary_ids',
    'get_user_company_id', 'get_user_role', 'has_permission', 'has_role', 'is_admin',
    'is_daf_user', 'is_gp_assistant'
  ];
  service_only text[] := ARRAY[
    'get_auth_user_id_by_email', 'decrement_station_sms_credit', 'decrement_schedule_seats',
    'recalc_schedule_seats', 'expire_seat_locks', 'auto_terminate_completed_schedules',
    'log_ticket_sale_attempt', 'regenerate_reparation_description', 'mobile_assign_seats',
    'generate_quote_number', 'validate_ticket_sale_timestamp', 'get_comptable_caisse_flux',
    'get_comptable_caisse_kpis', 'sbta_find_schedule_for_booking', 'schedule_company_charges',
    'schedule_company_revenue'
  ];
  had_authenticated boolean;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT (p.proname = ANY (keep_anon))
  LOOP
    had_authenticated := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    IF r.proname = ANY (service_only) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
    ELSIF had_authenticated THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- ── 2.3 Fonctions qui écrivent sans contrôler l'utilisateur ──
-- Même contrôle que les règles d'accès de la table qu'elles écrivent.

-- Import d'un bordereau ABG : règles de abg_bordereaux (gestion_agboville, admin)
CREATE OR REPLACE FUNCTION public.abg_import_bordereau(p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_bordereau_id uuid;
v_line         jsonb;
v_guichet_id   uuid;
BEGIN
IF coalesce(get_my_role(), '') NOT IN ('gestion_agboville', 'admin') THEN
  RAISE EXCEPTION 'Import de bordereau réservé à la gestion Agboville et à l''administrateur'
    USING ERRCODE = '42501';
END IF;

v_guichet_id := NULLIF(p_data->>'guichet_src_id', '')::uuid;

INSERT INTO abg_bordereaux (
bordereau_date, guichet_src_id, gare_label, segment_code,
societe_code, source,
total_tickets, total_seats, total_mt_ticket,
total_depense_pr, total_solde, total_baggage, status
) VALUES (
(p_data->>'bordereau_date')::date,
v_guichet_id,
p_data->>'gare_label',
NULLIF(p_data->>'segment_code', ''),
p_data->>'societe_code',
'import',
COALESCE(NULLIF(p_data->>'total_tickets','')::integer, 0),
COALESCE(NULLIF(p_data->>'total_seats','')::integer, 0),
COALESCE(NULLIF(p_data->>'total_mt_ticket','')::numeric, 0),
COALESCE(NULLIF(p_data->>'total_depense_pr','')::numeric, 0),
COALESCE(NULLIF(p_data->>'total_mt_ticket','')::numeric, 0) - COALESCE(NULLIF(p_data->>'total_depense_pr','')::numeric, 0),
COALESCE(NULLIF(p_data->>'total_baggage','')::numeric, 0),
'recu'
)
RETURNING id INTO v_bordereau_id;

FOR v_line IN SELECT jsonb_array_elements(p_data->'lignes')
LOOP
INSERT INTO abg_bordereau_lignes (
bordereau_id, car_matricule, departure_number,
seats, mt_ticket, depense_pr, solde_ticket, bagage
) VALUES (
v_bordereau_id,
v_line->>'car_matricule',
NULLIF(v_line->>'departure_number','')::integer,
COALESCE(NULLIF(v_line->>'seats','')::integer, 0),
COALESCE(NULLIF(v_line->>'mt_ticket','')::numeric, 0),
COALESCE(NULLIF(v_line->>'depense_pr','')::numeric, 0),
COALESCE(NULLIF(v_line->>'mt_ticket','')::numeric, 0) - COALESCE(NULLIF(v_line->>'depense_pr','')::numeric, 0),
COALESCE(NULLIF(v_line->>'bagage','')::numeric, 0)
);
END LOOP;

RETURN v_bordereau_id;
END;
$function$;

-- Numéro d'un départ sur un guichet : règles de departure_sequence (le guichetier de ce guichet,
-- le chef de gare de sa gare, l'administrateur, le planificateur)
CREATE OR REPLACE FUNCTION public.assign_departure_to_counter(p_schedule_id uuid, p_counter_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_next_num  int;
v_dep_date  date;
BEGIN
-- coalesce : un rôle inconnu (NULL) rendait la condition inconnue, et l'appel passait
IF NOT coalesce((
  EXISTS (SELECT 1 FROM counters c WHERE c.id = p_counter_id AND c.assigned_user_id = auth.uid())
  OR coalesce(get_my_role(), '') IN ('admin', 'planificateur')
  OR (coalesce(get_my_role(), '') = 'chef_gare'
      AND EXISTS (SELECT 1 FROM counters c WHERE c.id = p_counter_id AND c.station_id = get_my_station_id()))
), false) THEN
  RAISE EXCEPTION 'Ce guichet n''est pas le vôtre' USING ERRCODE = '42501';
END IF;

SELECT departure_datetime::date INTO v_dep_date
FROM schedules WHERE id = p_schedule_id;

SELECT COALESCE(MAX(departure_number), 0) + 1 INTO v_next_num
FROM departure_sequence
WHERE counter_id   = p_counter_id
AND departure_date = v_dep_date;

INSERT INTO departure_sequence (counter_id, schedule_id, departure_date, departure_number)
VALUES (p_counter_id, p_schedule_id, v_dep_date, v_next_num)
ON CONFLICT (schedule_id) DO NOTHING;

RETURN v_next_num;
END;
$function$;

-- Confirmation d'une réservation mobile : par son client, par le serveur (paiement Wave, clé de
-- service) ou par le déclencheur des départs (sbta_convert_provisional_on_schedule, lancé par le
-- compte qui crée le départ). N'importe quel compte confirmait n'importe quelle réservation.
CREATE OR REPLACE FUNCTION public.sbta_assign_and_confirm_mobile_booking(p_booking_id uuid, p_schedule_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_booking      mobile_bookings%ROWTYPE;
v_dep          timestamptz;
v_arr          timestamptz;
v_bus_id       uuid;
v_bus_label    text;
v_capacity     int;
v_need         int;
v_occupied     int[] := ARRAY[]::int[];
v_assigned     int[] := ARRAY[]::int[];
v_start        int;
v_k            int;
v_ok           boolean;
BEGIN
SELECT * INTO v_booking FROM mobile_bookings
WHERE id = p_booking_id AND status = 'provisional'
FOR UPDATE;
IF NOT FOUND THEN RETURN; END IF;

IF NOT (pg_trigger_depth() > 0 OR auth.uid() IS NULL OR v_booking.user_id IS NOT DISTINCT FROM auth.uid()
        OR coalesce(get_user_role(), '') = 'admin') THEN
  RAISE EXCEPTION 'Réservation d''un autre client' USING ERRCODE = '42501';
END IF;

SELECT s.departure_datetime, s.arrival_datetime, s.bus_id,
COALESCE(NULLIF(b.total_seats, 0), NULLIF(b.capacity, 0), NULLIF(s.seats_available, 0), 45),
COALESCE(b.registration_number, 'Bus')
INTO v_dep, v_arr, v_bus_id, v_capacity, v_bus_label
FROM schedules s
LEFT JOIN buses b ON b.id = s.bus_id
WHERE s.id = p_schedule_id;
IF v_dep IS NULL THEN RETURN; END IF;

v_need := GREATEST(v_booking.seats_count, 1);

-- Sieges deja occupes: reservations guichet + autres reservations mobile sur cet horaire.
SELECT COALESCE(array_agg(n), ARRAY[]::int[]) INTO v_occupied FROM (
SELECT (sn)::int AS n
FROM reservations r, unnest(r.seat_numbers) AS sn
WHERE r.schedule_id = p_schedule_id
AND COALESCE(r.status, '') NOT IN ('cancelled', 'annulee', 'annule')
AND sn ~ '^[0-9]+$'
UNION
SELECT s2 AS n
FROM mobile_bookings mb, unnest(mb.assigned_seats) AS s2
WHERE mb.schedule_id = p_schedule_id
AND mb.id <> p_booking_id
) q;

-- Recherche d'un bloc cote a cote.
v_ok := false;
FOR v_start IN 1..GREATEST(v_capacity - v_need + 1, 1) LOOP
v_ok := true;
FOR v_k IN 0..(v_need - 1) LOOP
IF (v_start + v_k) = ANY (v_occupied) THEN v_ok := false; EXIT; END IF;
END LOOP;
IF v_ok THEN
v_assigned := ARRAY(SELECT generate_series(v_start, v_start + v_need - 1));
EXIT;
END IF;
END LOOP;

-- Repli: premiers sieges libres disponibles.
IF NOT v_ok THEN
v_assigned := ARRAY[]::int[];
FOR v_k IN 1..v_capacity LOOP
IF NOT (v_k = ANY (v_occupied)) THEN
v_assigned := array_append(v_assigned, v_k);
IF array_length(v_assigned, 1) >= v_need THEN EXIT; END IF;
END IF;
END LOOP;
END IF;

-- Capacite insuffisante: on laisse le ticket provisoire.
IF array_length(v_assigned, 1) IS DISTINCT FROM v_need THEN RETURN; END IF;

UPDATE mobile_bookings SET
schedule_id    = p_schedule_id,
assigned_seats = v_assigned,
bus_label      = v_bus_label,
departure_time = to_char(v_dep, 'HH24:MI'),
arrival_time   = COALESCE(to_char(v_arr, 'HH24:MI'), arrival_time),
status         = 'confirmed',
updated_at     = now()
WHERE id = p_booking_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sbta_confirm_pending_mobile_booking(p_booking_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_schedule_id uuid;
v_status text;
v_owner uuid;
BEGIN
SELECT user_id INTO v_owner FROM mobile_bookings WHERE id = p_booking_id;
IF NOT (auth.uid() IS NULL OR v_owner IS NOT DISTINCT FROM auth.uid() OR coalesce(get_user_role(), '') = 'admin') THEN
  RAISE EXCEPTION 'Réservation d''un autre client' USING ERRCODE = '42501';
END IF;
v_schedule_id := sbta_find_schedule_for_booking(p_booking_id);
IF v_schedule_id IS NOT NULL THEN
PERFORM sbta_assign_and_confirm_mobile_booking(p_booking_id, v_schedule_id);
END IF;
SELECT status INTO v_status FROM mobile_bookings WHERE id = p_booking_id;
RETURN v_status;
END;
$function$;

NOTIFY pgrst, 'reload schema';
