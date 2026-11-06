/*
# Suppression définitive d'un bus archivé (espace admin)

## Besoin
L'admin peut archiver un bus et le restaurer, mais pas le supprimer définitivement : les
doublons et les bus saisis par erreur restaient pour toujours dans les archives.

## Règle
`admin_delete_archived_bus(p_bus_id, p_reason)` :
1. Réservée à l'admin ; seulement pour un bus déjà archivé ; motif obligatoire
   (10 caractères au moins).
2. Un bus qui a un historique n'est PAS supprimé : départs, bons et pleins de carburant,
   dépenses, pannes, réparations, entretiens, courriers, affectations… Plusieurs de ces tables
   seraient vidées (ON DELETE CASCADE) ou perdraient leur bus (SET NULL) : la suppression est
   refusée et l'historique est nommé (« 120 départ(s), 3 bon(s) de carburant »). Le bus reste
   archivé pour le conserver. Aucune suppression en cascade.
3. Sinon le bus est supprimé, avec son plan de sièges s'il lui est propre et qu'aucun autre bus
   ne l'utilise.
4. Trace : la ligne complète et le motif sont inscrits au journal d'audit (activity_logs), en
   plus de l'enregistrement automatique de la suppression (audit_critical_table).
Tout se fait dans une transaction : en cas de refus, rien n'est modifié.

## Sécurité
SECURITY DEFINER, rôle vérifié dans la fonction (admin). Aucune politique RLS modifiée, aucune
table modifiée.
*/

CREATE OR REPLACE FUNCTION public.admin_delete_archived_bus(p_bus_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      uuid;
  v_user_name    text;
  v_user_role    text;
  v_bus          public.buses%ROWTYPE;
  v_fk           record;
  v_count        bigint;
  v_history      text;
  v_own_configs  uuid[];
  v_config_id    uuid;
BEGIN
  SELECT user_id, user_name, user_role INTO v_user_id, v_user_name, v_user_role
  FROM public.get_current_user_info()
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;
  IF v_user_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Seul l''administrateur peut supprimer définitivement un bus';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Motif obligatoire (10 caractères au moins)';
  END IF;

  SELECT * INTO v_bus FROM public.buses WHERE id = p_bus_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bus introuvable';
  END IF;
  IF v_bus.archived_at IS NULL THEN
    RAISE EXCEPTION 'Archivez d''abord ce bus : seul un bus archivé peut être supprimé définitivement';
  END IF;

  -- Historique : toute ligne d'une autre table qui désigne ce bus, quelle que soit sa règle de
  -- suppression (la cascade effacerait des dépenses, des réparations…). Le plan de sièges du bus
  -- est traité à part, plus bas.
  FOR v_fk IN
    SELECT con.conrelid::regclass AS ref_table, cls.relname AS ref_name, att.attname AS ref_column
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.buses'::regclass
      AND array_length(con.conkey, 1) = 1
      AND cls.relname <> 'bus_seat_config'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_fk.ref_table, v_fk.ref_column)
      INTO v_count USING p_bus_id;
    IF v_count > 0 THEN
      v_history := concat_ws(', ', v_history, v_count || ' ' || CASE v_fk.ref_name
        WHEN 'schedules'               THEN 'départ(s)'
        WHEN 'fuel_vouchers'           THEN 'bon(s) de carburant'
        WHEN 'fuel_logs'               THEN 'plein(s) de carburant'
        WHEN 'fuel_enlevements'        THEN 'enlèvement(s) de carburant'
        WHEN 'bus_expenses'            THEN 'dépense(s) du bus'
        WHEN 'counter_charges'         THEN 'dépense(s) de guichet'
        WHEN 'breakdown_reports'       THEN 'panne(s)'
        WHEN 'schedule_breakdowns'     THEN 'panne(s) en route'
        WHEN 'maintenance_work_orders' THEN 'ordre(s) de réparation'
        WHEN 'maintenance_diagnostics' THEN 'diagnostic(s)'
        WHEN 'maintenance_quotes'      THEN 'devis'
        WHEN 'planned_maintenances'    THEN 'entretien(s) planifié(s)'
        WHEN 'garage_reparations'      THEN 'réparation(s) au garage'
        WHEN 'incidents'               THEN 'incident(s)'
        WHEN 'parcels'                 THEN 'courrier(s)'
        WHEN 'users'                   THEN 'chauffeur(s) affecté(s)'
        WHEN 'employees'               THEN 'employé(s) affecté(s)'
        WHEN 'vehicle_insurances'      THEN 'assurance(s)'
        ELSE v_fk.ref_name
      END);
    END IF;
  END LOOP;

  IF v_history IS NOT NULL THEN
    RAISE EXCEPTION 'Suppression définitive impossible : ce bus a un historique (%). Il reste archivé pour le conserver.', v_history;
  END IF;

  -- Plan de sièges propre au bus : détaché, puis supprimé après le bus s'il ne sert à aucun autre
  v_own_configs := ARRAY(SELECT id FROM public.bus_seat_config WHERE bus_id = p_bus_id);
  UPDATE public.bus_seat_config SET bus_id = NULL WHERE bus_id = p_bus_id;

  DELETE FROM public.buses WHERE id = p_bus_id;

  FOREACH v_config_id IN ARRAY v_own_configs LOOP
    BEGIN
      DELETE FROM public.bus_seat_config WHERE id = v_config_id;
    EXCEPTION WHEN foreign_key_violation THEN
      NULL; -- encore utilisé par un autre bus : gardé
    END;
  END LOOP;

  INSERT INTO public.activity_logs (user_id, target_id, target_type, action, description, old_values)
  VALUES (
    v_user_id, p_bus_id, 'buses', 'delete_permanent',
    format('Suppression définitive du bus %s par %s — motif : %s', v_bus.registration_number, v_user_name, trim(p_reason)),
    to_jsonb(v_bus)
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_archived_bus(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_archived_bus(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
