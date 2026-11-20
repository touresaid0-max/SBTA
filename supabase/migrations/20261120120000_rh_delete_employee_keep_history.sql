/*
# RH : supprimer aussi un employé qui a déjà travaillé (historique conservé)

Demande (20/11/2026) : le RH doit pouvoir supprimer un employé qui a déjà travaillé.

## Constat
Supprimer vraiment un tel employé détruirait l'historique : la base EFFACERAIT en cascade ses
sessions de guichet, heures de conduite, dépenses de courrier, demandes de modification…, VIDERAIT
le vendeur des tickets et le chauffeur des départs, et REFUSERAIT la suppression pour ses dépenses
de guichet, courriers et journées de paie.

## Règle (admin_delete_employee_permanently, reprise de 20261120100000)
- Sans historique : inchangé (fiche, compte et compte de connexion supprimés).
- Avec historique : l'employé est supprimé des listes sans toucher à son historique :
  fiche RH et compte au statut « deleted » (nouveau statut), connexion bloquée pour toujours,
  sessions fermées, e-mail libéré (remplacé par une adresse technique), affectations libérées
  (guichet, gares, services, sociétés du comptable). Ses départs, tickets, caisses et paies
  gardent son nom. Fiche et compte complets inscrits au journal avant la modification.
- Inchangé : le RH ne supprime ni un administrateur ni son propre compte.

## Schéma
Valeur « deleted » ajoutée aux contraintes users_status_check et employees_account_status_check
(contraintes recréées à l'identique avec cette valeur en plus). Aucune politique RLS modifiée,
aucune donnée d'historique supprimée.
*/

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_status_check CHECK (status = ANY (ARRAY[
  'active'::text, 'inactive'::text, 'suspended'::text, 'repos_obligatoire'::text,
  'pending_confirmation'::text, 'pending_otp'::text, 'pending_deletion'::text, 'deleted'::text]));

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_account_status_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_account_status_check CHECK (account_status = ANY (ARRAY[
  'pending'::text, 'active'::text, 'suspended'::text, 'inactive'::text, 'pending_deletion'::text, 'deleted'::text]));

CREATE OR REPLACE FUNCTION public.admin_delete_employee_permanently(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id    uuid;
  v_caller_name  text;
  v_caller_role  text;
  v_emp          public.employees%ROWTYPE;
  v_user         public.users%ROWTYPE;
  v_has_emp      boolean := false;
  v_has_user     boolean := false;
  v_uid          uuid;
  v_name         text;
  v_fk           record;
  v_count        bigint;
  v_history      text;
  -- Données personnelles, supprimées avec l'employé (pas un historique)
  v_personal     text[] := ARRAY[
    'admin_chat_messages', 'user_sessions', 'mobile_otp_codes', 'seat_locks',
    'comptable_companies', 'station_agents', 'station_baggage_handlers', 'station_managers',
    'fuel_service_agents', 'garage_reparation_notifications'
  ];
  v_own_filter   text;
  v_tomb         text;
BEGIN
  SELECT user_id, user_name, user_role INTO v_caller_id, v_caller_name, v_caller_role
  FROM public.get_current_user_info()
  LIMIT 1;
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'rh') THEN
    RAISE EXCEPTION 'Seuls l''administrateur et le RH peuvent supprimer définitivement un employé';
  END IF;

  -- La fiche RH et le compte, quel que soit l'identifiant reçu
  SELECT * INTO v_emp FROM public.employees WHERE id = p_id OR auth_user_id = p_id LIMIT 1 FOR UPDATE;
  v_has_emp := FOUND;
  v_uid := CASE WHEN v_has_emp AND v_emp.auth_user_id IS NOT NULL THEN v_emp.auth_user_id ELSE p_id END;
  SELECT * INTO v_user FROM public.users WHERE id = v_uid FOR UPDATE;
  v_has_user := FOUND;
  IF NOT v_has_user THEN v_uid := NULL; END IF;

  IF NOT v_has_emp AND NOT v_has_user THEN
    RAISE EXCEPTION 'Employé introuvable (déjà supprimé ?)';
  END IF;
  -- Le RH supprime directement (confirmation dans l'écran) ; l'admin, seulement ce que le RH a demandé
  IF v_caller_role = 'admin' AND NOT ((v_has_emp AND v_emp.account_status = 'pending_deletion')
          OR (v_has_user AND v_user.status = 'pending_deletion')) THEN
    RAISE EXCEPTION 'La suppression de cet employé n''a pas été demandée par le RH';
  END IF;
  -- Un compte administrateur n'est supprimé que par un administrateur
  IF v_caller_role = 'rh' AND (coalesce(v_emp.role, v_user.role) = 'admin' OR v_user.role = 'admin') THEN
    RAISE EXCEPTION 'Seul un administrateur peut supprimer un compte administrateur';
  END IF;
  -- Le RH ne supprime pas son propre compte
  IF v_caller_role = 'rh' AND v_uid IS NOT DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Vous ne pouvez pas supprimer votre propre compte';
  END IF;

  v_name := btrim(coalesce(
    nullif(btrim(coalesce(v_emp.first_name, '') || ' ' || coalesce(v_emp.last_name, '')), ''),
    v_user.full_name, ''));

  -- Historique : toute ligne d'une autre table qui désigne cet employé (compte, compte de
  -- connexion ou fiche RH), hors données personnelles
  FOR v_fk IN
    SELECT con.conrelid::regclass AS ref_table, cls.relname AS ref_name, att.attname AS ref_column,
           CASE WHEN con.confrelid = 'public.employees'::regclass THEN 'emp' ELSE 'user' END AS target
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND con.confrelid IN ('public.users'::regclass, 'auth.users'::regclass, 'public.employees'::regclass)
      AND ns.nspname = 'public'
      AND NOT (cls.relname = ANY (v_personal))
  LOOP
    -- Dans users et employees, la propre ligne de l'employé ne compte pas (users.id → auth.users) ;
    -- une autre ligne qui le désigne (« créé par »…) est un historique
    v_own_filter := CASE v_fk.ref_name
      WHEN 'users'     THEN ' AND id IS DISTINCT FROM $2'
      WHEN 'employees' THEN ' AND id IS DISTINCT FROM $3'
      ELSE '' END;
    IF v_fk.target = 'emp' THEN
      CONTINUE WHEN NOT v_has_emp;
      EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.ref_table, v_fk.ref_column) || v_own_filter
        INTO v_count USING v_emp.id, v_uid, v_emp.id;
    ELSE
      CONTINUE WHEN v_uid IS NULL;
      EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.ref_table, v_fk.ref_column) || v_own_filter
        INTO v_count USING v_uid, v_uid, v_emp.id;
    END IF;
    IF v_count > 0 THEN
      v_history := concat_ws(', ', v_history, v_count || ' ' || CASE v_fk.ref_name
        WHEN 'schedules'        THEN 'départ(s)'
        WHEN 'reservations'     THEN 'ticket(s) / réservation(s)'
        WHEN 'parcels'          THEN 'courrier(s)'
        WHEN 'baggage_tickets'  THEN 'ticket(s) bagage'
        WHEN 'counters'         THEN 'guichet(s) affecté(s)'
        WHEN 'counter_shifts'   THEN 'session(s) de guichet'
        WHEN 'activity_logs'    THEN 'action(s) au journal d''audit'
        WHEN 'fuel_vouchers'    THEN 'bon(s) de carburant'
        WHEN 'fuel_logs'        THEN 'plein(s) de carburant'
        WHEN 'bus_expenses'     THEN 'dépense(s) de bus'
        WHEN 'counter_charges'  THEN 'dépense(s) de guichet'
        WHEN 'driver_daily_logs' THEN 'journée(s) de paie'
        WHEN 'driver_hours_log' THEN 'heure(s) de conduite'
        WHEN 'driver_performance' THEN 'évaluation(s)'
        WHEN 'driver_reviews'   THEN 'avis client(s)'
        WHEN 'parcel_service_expenses' THEN 'dépense(s) de courrier'
        WHEN 'operation_change_requests' THEN 'demande(s) de modification'
        WHEN 'operation_change_request_events' THEN 'étape(s) de demande de modification'
        ELSE v_fk.ref_name || '.' || v_fk.ref_column
      END);
    END IF;
  END LOOP;

  IF v_history IS NOT NULL THEN
    -- L'employé a déjà travaillé : le supprimer effacerait ou retirerait son nom de ses sessions de
    -- guichet, départs, tickets, courriers, paie… Il est retiré de toutes les listes, ne peut plus
    -- se connecter et son e-mail redevient libre ; son historique garde son nom.
    INSERT INTO public.activity_logs (user_id, target_id, target_type, action, description, old_values)
    VALUES (
      v_caller_id, coalesce(v_emp.id, v_uid), 'employee', 'delete_keep_history',
      format('Suppression de %s (%s) par %s — historique conservé : %s', v_name,
             coalesce(v_emp.role, v_user.role, '?'), v_caller_name, v_history),
      jsonb_build_object('employee', CASE WHEN v_has_emp THEN to_jsonb(v_emp) END,
                         'user', CASE WHEN v_has_user THEN to_jsonb(v_user) END)
    );

    IF v_uid IS NOT NULL THEN
      v_tomb := 'supprime.' || replace(v_uid::text, '-', '') || '@profil.sbta-gestion.cloud';
      UPDATE public.users
      SET status = 'deleted', is_active = false, account_status = 'inactive', email = v_tomb,
          deactivated_at = now(), deactivation_reason = 'Supprimé par ' || coalesce(v_caller_name, '?'),
          updated_at = now()
      WHERE id = v_uid;
      -- Plus de connexion possible, e-mail libéré, sessions ouvertes fermées
      UPDATE auth.users
      SET email = v_tomb, banned_until = 'infinity', updated_at = now()
      WHERE id = v_uid;
      UPDATE auth.identities
      SET identity_data = identity_data || jsonb_build_object('email', v_tomb)
      WHERE user_id = v_uid AND provider = 'email';
      DELETE FROM auth.sessions WHERE user_id = v_uid;
      -- Affectations libérées (guichet, gare, services…)
      UPDATE public.counters SET assigned_user_id = NULL WHERE assigned_user_id = v_uid;
      UPDATE public.stations SET station_manager_id = NULL WHERE station_manager_id = v_uid;
      UPDATE public.stations SET station_agent_colis_id = NULL WHERE station_agent_colis_id = v_uid;
      DELETE FROM public.station_agents WHERE agent_id = v_uid;
      DELETE FROM public.station_managers WHERE manager_id = v_uid;
      DELETE FROM public.station_baggage_handlers WHERE handler_id = v_uid;
      DELETE FROM public.comptable_companies WHERE user_id = v_uid;
    END IF;

    -- La fiche RH en dernier : le déclencheur trg_sync_employee_from_user recopie le statut du
    -- compte dans la fiche (« inactive ») à la mise à jour du compte
    IF v_has_emp THEN
      UPDATE public.employees
      SET account_status = 'deleted', deactivated_at = now(),
          deactivation_reason = 'Supprimé par ' || coalesce(v_caller_name, '?'), updated_at = now()
      WHERE id = v_emp.id;
      DELETE FROM public.fuel_service_agents WHERE employee_id = v_emp.id;
    END IF;

    RETURN v_name || ' (historique conservé)';
  END IF;

  -- Trace avant suppression
  INSERT INTO public.activity_logs (user_id, target_id, target_type, action, description, old_values)
  VALUES (
    v_caller_id, coalesce(v_emp.id, v_uid), 'employee', 'delete_permanent',
    format('Suppression définitive de %s (%s) par %s — %s', v_name,
           coalesce(v_emp.role, v_user.role, '?'), v_caller_name,
           CASE WHEN v_caller_role = 'rh' THEN 'faite par le RH' ELSE 'demandée par le RH' END),
    jsonb_build_object('employee', CASE WHEN v_has_emp THEN to_jsonb(v_emp) END,
                       'user', CASE WHEN v_has_user THEN to_jsonb(v_user) END)
  );

  IF v_has_emp THEN
    DELETE FROM public.employees WHERE id = v_emp.id;
  END IF;
  IF v_uid IS NOT NULL THEN
    -- Le compte de connexion : son profil users et ses données personnelles suivent (cascade)
    DELETE FROM auth.users WHERE id = v_uid;
    DELETE FROM public.users WHERE id = v_uid;
  END IF;

  RETURN v_name;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_employee_permanently(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_employee_permanently(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
