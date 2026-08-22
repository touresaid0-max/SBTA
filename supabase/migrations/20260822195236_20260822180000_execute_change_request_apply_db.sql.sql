/*
# Execute change request — actually apply the authorized operation in the database

## Purpose
When the Admin clicks "Exécuter" on an authorized change request, the `execute_change_request` RPC
previously only logged the execution in the audit trail but did NOT modify or delete the underlying
operation row. This meant that a ticket/expense/schedule authorized for suppression and marked
"Exécutée" still appeared in Guichet POS and other operational screens.

## Changes
1. `execute_change_request` now performs the real database operation:
   - For `autorisee_suppression`: DELETE the row from the target table (operation_table / operation_id).
   - For `autorisee_modification`: UPDATE the target row with the new values provided by the Admin.
2. An allowlist of target tables is enforced to prevent SQL injection via dynamic SQL.
   Allowed tables: tickets, bagage_tickets, counter_charges, schedules, convoys,
   ramassage_notifications, parcels, reservations, bus_expenses, vehicle_expenses.
3. The `operation_id` is cast to uuid for tables with uuid primary keys; for text-id tables
   it is used as-is.
4. The full audit trail (old values, new values, deleted snapshot, performer info) is preserved
   exactly as before — the only addition is the actual DML on the target table.
5. RLS bypass: the function is SECURITY DEFINER so it can operate on target tables regardless
   of the caller's role-level RLS. This is intentional — only admin/dg roles can call it (enforced
   inside the function body), and the entire operation is logged in the audit events table.

## Security
- SECURITY DEFINER with `search_path = 'public'` — same as before.
- Table name validated against a static allowlist (no user-controlled SQL).
- `operation_id` is passed as a parameter to `EXECUTE ... USING` — never string-interpolated.
- Role check: only `admin` and `dg` can execute (unchanged).
*/

CREATE OR REPLACE FUNCTION public.execute_change_request(
  p_request_id       uuid,
  p_execution_notes  text,
  p_old_values       jsonb DEFAULT NULL,
  p_new_values       jsonb DEFAULT NULL,
  p_deleted_snapshot jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_req         public.operation_change_requests%ROWTYPE;
  v_user_id     uuid;
  v_user_name   text;
  v_user_role   text;
  v_table_name  text;
  v_is_uuid_pk  boolean;
  v_allowlist   text[] := ARRAY[
    'tickets','bagage_tickets','counter_charges','schedules','convoys',
    'ramassage_notifications','parcels','reservations','bus_expenses','vehicle_expenses'
  ];
  v_del_sql     text;
  v_upd_sql     text;
  v_keys        text[];
  v_set_clause  text;
  v_k           text;
  v_uuid_id     uuid;
BEGIN
  SELECT user_id, user_name, user_role INTO v_user_id, v_user_name, v_user_role
  FROM public.get_current_user_info()
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;

  IF v_user_role NOT IN ('admin','dg') THEN
    RAISE EXCEPTION 'Seule l''équipe technique ou le DG peut exécuter les demandes';
  END IF;

  SELECT * INTO v_req FROM public.operation_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;

  IF v_req.status NOT IN ('autorisee_modification','autorisee_suppression') THEN
    RAISE EXCEPTION 'Cette demande n''est pas autorisée pour exécution (statut: %)', v_req.status;
  END IF;

  IF v_req.status = 'autorisee_modification' AND p_deleted_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'Cette demande autorise une modification, pas une suppression';
  END IF;
  IF v_req.status = 'autorisee_suppression' AND p_new_values IS NOT NULL THEN
    RAISE EXCEPTION 'Cette demande autorise une suppression, pas une modification';
  END IF;

  -- Validate table name against allowlist
  v_table_name := v_req.operation_table;
  IF v_table_name IS NULL OR v_table_name = '' OR NOT (v_table_name = ANY(v_allowlist)) THEN
    RAISE EXCEPTION 'Table d''opération non autorisée pour l''exécution: %', v_table_name;
  END IF;

  -- Determine if operation_id is a uuid (most tables use uuid PKs)
  BEGIN
    v_uuid_id := v_req.operation_id::uuid;
    v_is_uuid_pk := true;
  EXCEPTION WHEN invalid_text_representation THEN
    v_is_uuid_pk := false;
  END;

  ------------------------------------------------------------------
  -- SUPPRESSION: actually DELETE the row from the target table
  ------------------------------------------------------------------
  IF v_req.status = 'autorisee_suppression' THEN
    -- Save a full snapshot from the live row before deleting (if not already provided)
    IF p_deleted_snapshot IS NULL AND v_req.operation_snapshot IS NOT NULL THEN
      -- operation_snapshot was captured at request time; use it as the deleted snapshot
      p_deleted_snapshot := v_req.operation_snapshot;
    END IF;

    IF v_is_uuid_pk THEN
      v_del_sql := format('DELETE FROM public.%I WHERE id = $1', v_table_name);
      EXECUTE v_del_sql USING v_uuid_id;
    ELSE
      v_del_sql := format('DELETE FROM public.%I WHERE id::text = $1', v_table_name);
      EXECUTE v_del_sql USING v_req.operation_id;
    END IF;

  ------------------------------------------------------------------
  -- MODIFICATION: actually UPDATE the row with the new values
  ------------------------------------------------------------------
  ELSE
    IF p_new_values IS NULL THEN
      RAISE EXCEPTION 'Aucune nouvelle valeur fournie pour la modification';
    END IF;

    -- Build SET clause from the JSON keys (excluding id/created_at/updated_at)
    v_keys := ARRAY(
      SELECT jsonb_object_keys(p_new_values)
      WHERE key NOT IN ('id','created_at','updated_at')
    );

    IF array_length(v_keys, 1) IS NULL OR array_length(v_keys, 1) = 0 THEN
      RAISE EXCEPTION 'Aucun champ à modifier fourni';
    END IF;

    v_set_clause := '';
    FOREACH v_k IN ARRAY v_keys LOOP
      IF v_set_clause <> '' THEN
        v_set_clause := v_set_clause || ', ';
      END IF;
      v_set_clause := v_set_clause || format('%I = ($1 ->> %L)', v_k, v_k);
    END LOOP;

    -- Save old values snapshot from request if not provided
    IF p_old_values IS NULL AND v_req.operation_snapshot IS NOT NULL THEN
      p_old_values := v_req.operation_snapshot;
    END IF;

    IF v_is_uuid_pk THEN
      v_upd_sql := format('UPDATE public.%I SET %s, updated_at = now() WHERE id = $2', v_table_name, v_set_clause);
      EXECUTE v_upd_sql USING p_new_values, v_uuid_id;
    ELSE
      v_upd_sql := format('UPDATE public.%I SET %s, updated_at = now() WHERE id::text = $2', v_table_name, v_set_clause);
      EXECUTE v_upd_sql USING p_new_values, v_req.operation_id;
    END IF;
  END IF;

  -- Update the request record with execution info and audit snapshots
  UPDATE public.operation_change_requests
  SET status = 'executee',
      executed_by = v_user_id,
      executor_name = v_user_name,
      executed_at = now(),
      execution_notes = p_execution_notes,
      old_values_snapshot = p_old_values,
      new_values_applied = p_new_values,
      deleted_record_snapshot = p_deleted_snapshot,
      updated_at = now()
  WHERE id = p_request_id;

  -- Log the execution event
  INSERT INTO public.operation_change_request_events (
    request_id, event_type, performed_by, performer_name, performer_role, comment, metadata
  ) VALUES (
    p_request_id, 'executed', v_user_id, v_user_name, v_user_role,
    COALESCE(p_execution_notes, ''),
    jsonb_build_object(
      'authorized_action', v_req.status,
      'operation_table', v_table_name,
      'operation_id', v_req.operation_id,
      'old_values', p_old_values,
      'new_values', p_new_values,
      'deleted_snapshot', p_deleted_snapshot
    )
  );

  RETURN true;
END;
$$;

NOTIFY pgrst, 'reload schema';
