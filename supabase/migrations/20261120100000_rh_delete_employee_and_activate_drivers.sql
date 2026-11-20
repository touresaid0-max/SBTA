/*
# RH : supprimer un employé et activer les chauffeurs sans connexion

Demande (20/11/2026) :
- le RH doit pouvoir supprimer lui-même un employé ou un compte existant, après une fenêtre de
  confirmation (jusqu'ici il demandait la suppression et l'admin l'exécutait) ;
- les chauffeurs n'ont pas besoin de se connecter : le RH doit pouvoir les activer sans e-mail
  ni mot de passe.

## 1. admin_delete_employee_permanently (repris de 20261110140000)
- Ouverte au RH. Le RH supprime directement ; l'admin garde sa règle (seulement les suppressions
  demandées par le RH).
- Le RH ne supprime ni un compte administrateur, ni son propre compte.
- Inchangé : un employé qui a un historique (départs, tickets, courriers, journal d'audit…)
  n'est jamais supprimé, la suppression est refusée et l'historique nommé ; tout est fait dans
  une transaction ; la fiche et le compte complets sont inscrits au journal avant suppression.

## 2. rh_activate_drivers_without_login(ids)
Pour chaque fiche RH chauffeur en attente de compte : le profil chauffeur sans connexion
(20261110100000, compte de connexion verrouillé, adresse technique) est créé s'il manque, puis la
fiche et le profil passent « actifs ». Aucun e-mail ni mot de passe : personne ne peut s'y
connecter. Une fiche liée à un vrai compte de connexion inachevé n'est pas touchée (comptée à
part). Le RH ou l'admin pourra toujours lui donner un vrai compte plus tard (fonction
admin-create-account : reprise du profil).

## Sécurité
Fonctions SECURITY DEFINER, rôle vérifié dans la fonction (admin ou RH), exécutables par les
comptes connectés seulement. Aucune politique RLS modifiée.
*/

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
    RAISE EXCEPTION 'Suppression définitive impossible : % a un historique (%). Réactivez-le ou laissez-le désactivé pour le conserver.', v_name, v_history;
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


CREATE OR REPLACE FUNCTION public.rh_activate_drivers_without_login(p_employee_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id    uuid;
  v_caller_name  text;
  v_caller_role  text;
  v_id           uuid;
  e              public.employees%ROWTYPE;
  v_uid          uuid;
  v_locked       boolean;
  v_activated    int := 0;
  v_skipped      jsonb := '[]'::jsonb;
BEGIN
  SELECT user_id, user_name, user_role INTO v_caller_id, v_caller_name, v_caller_role
  FROM public.get_current_user_info()
  LIMIT 1;
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin', 'rh') THEN
    RAISE EXCEPTION 'Seuls l''administrateur et le RH peuvent activer un chauffeur';
  END IF;

  FOREACH v_id IN ARRAY coalesce(p_employee_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO e FROM public.employees WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR e.role IS DISTINCT FROM 'chauffeur' OR e.account_status IS DISTINCT FROM 'pending' THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'raison', 'pas un chauffeur en attente de compte');
      CONTINUE;
    END IF;

    -- Le profil chauffeur sans connexion, créé s'il manque
    v_uid := e.auth_user_id;
    IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid) THEN
      v_uid := public.create_driver_profile(e.id);
    END IF;
    IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_uid) THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'raison', 'compte de connexion inachevé : à créer avec un e-mail');
      CONTINUE;
    END IF;

    -- Seulement un profil verrouillé : un vrai compte (mot de passe connu) n'est pas activé ici
    SELECT coalesce((raw_app_meta_data->>'driver_profile')::boolean, false) INTO v_locked
    FROM auth.users WHERE id = v_uid;
    IF NOT coalesce(v_locked, false) THEN
      v_skipped := v_skipped || jsonb_build_object('id', v_id, 'raison', 'déjà lié à un compte de connexion : à activer avec un e-mail');
      CONTINUE;
    END IF;

    UPDATE public.employees
    SET account_status     = 'active',
        auth_user_id       = v_uid,
        account_created_at = now(),
        account_created_by = v_caller_id,
        updated_at         = now()
    WHERE id = e.id;

    UPDATE public.users
    SET status = 'active', is_active = true, account_status = 'active', updated_at = now()
    WHERE id = v_uid;

    INSERT INTO public.activity_logs (user_id, target_id, target_type, action, description, new_values)
    VALUES (v_caller_id, e.id, 'employee', 'driver_activated_without_login',
            format('Chauffeur %s %s activé sans connexion par %s', e.first_name, e.last_name, v_caller_name),
            jsonb_build_object('auth_user_id', v_uid));

    v_activated := v_activated + 1;
  END LOOP;

  RETURN jsonb_build_object('activated', v_activated, 'skipped', v_skipped);
END;
$function$;

REVOKE ALL ON FUNCTION public.rh_activate_drivers_without_login(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_activate_drivers_without_login(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
