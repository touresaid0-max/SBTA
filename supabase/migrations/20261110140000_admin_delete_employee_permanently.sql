/*
# Suppression définitive d'un employé (demandée par le RH, exécutée par l'admin)

## Constat
Le bouton « Supprimer définitivement » (Admin → Utilisateurs → Suppressions demandées) ne
supprimait rien :
- l'écran devinait la table à viser (fiche RH ou compte) d'après les champs affichés, et se
  trompait pour les comptes : il supprimait dans employees avec l'identifiant d'un compte users,
  donc aucune ligne, sans erreur ; l'employé restait dans la liste ;
- même sur la bonne table, il n'effaçait que la moitié de l'employé (fiche RH OU compte) et
  jamais son compte de connexion (auth.users).

## Règle
`admin_delete_employee_permanently(p_id)` (p_id : identifiant de la fiche RH ou du compte) :
1. Réservée à l'admin ; seulement pour un employé dont le RH a demandé la suppression
   (statut pending_deletion sur la fiche RH ou le compte).
2. Un employé qui a un historique n'est PAS supprimé : départs conduits, tickets vendus,
   courriers, dépenses, journal d'audit… (toute ligne d'une autre table qui le désigne). La
   suppression est refusée et l'historique est nommé ; l'employé reste désactivé pour le
   conserver. Aucune suppression en cascade de données d'historique.
3. Ses données personnelles partent avec lui : sessions de connexion, messages de la
   messagerie, codes OTP, verrous de sièges, affectations (gares, comptoirs, services,
   sociétés du comptable), notifications de garage.
4. Sinon : fiche RH, compte (users) et compte de connexion (auth.users) supprimés ensemble,
   dans une transaction : en cas de refus, rien n'est modifié.
5. Trace : la fiche et le compte complets sont inscrits au journal d'audit (activity_logs).

## Sécurité
SECURITY DEFINER, rôle vérifié dans la fonction (admin). Aucune politique RLS modifiée.
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
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Seul l''administrateur peut supprimer définitivement un employé';
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
  IF NOT ((v_has_emp AND v_emp.account_status = 'pending_deletion')
          OR (v_has_user AND v_user.status = 'pending_deletion')) THEN
    RAISE EXCEPTION 'La suppression de cet employé n''a pas été demandée par le RH';
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
    format('Suppression définitive de %s (%s) par %s — demandée par le RH', v_name,
           coalesce(v_emp.role, v_user.role, '?'), v_caller_name),
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
