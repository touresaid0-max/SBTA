/*
# Fix execute_change_request — "column key does not exist" error

## Problem
When the Admin confirms "Exécuter la modification", the RPC fails with:
  ERROR: column "key" does not exist

This happens because the modification branch used:
  v_keys := ARRAY(
    SELECT jsonb_object_keys(p_new_values)
    WHERE key NOT IN ('id','created_at','updated_at')
  );

`jsonb_object_keys()` returns a setof text with NO column name — the expression
`WHERE key NOT IN (...)` references a column "key" that does not exist in that
result set, causing the error.

## Fix
1. Alias the set-returning function output: `SELECT k FROM jsonb_object_keys(...) AS k WHERE k NOT IN (...)`.
2. Only append `, updated_at = now()` to the SET clause for tables that actually
   have an `updated_at` column. For tables without it (e.g. baggage_tickets,
   ramassage_notifications, parcels, convoys), the unconditional `updated_at = now()`
   would cause a second "column does not exist" error. We check the information_schema
   at runtime and conditionally include the clause.
3. Everything else (suppression branch, audit trail, role check, table mapping,
   allowlist, event logging) is unchanged.
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
  v_raw_table   text;
  v_table_name  text;
  v_is_uuid_pk  boolean;
  v_allowlist   text[] := ARRAY[
    'reservations','baggage_tickets','counter_charges','schedules','convoys',
    'ramassage_notifications','parcels','bus_expenses','vehicle_expenses'
  ];
  v_del_sql     text;
  v_upd_sql     text;
  v_keys        text[];
  v_set_clause  text;
  v_has_updated_at boolean;
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

  -- Map POS store names to actual Supabase table names
  v_raw_table := v_req.operation_table;
  v_table_name := CASE v_raw_table
    WHEN 'tickets' THEN 'reservations'
    WHEN 'bagage_tickets' THEN 'baggage_tickets'
    WHEN 'bagages' THEN 'baggage_tickets'
    WHEN 'depenses' THEN 'counter_charges'
    ELSE v_raw_table
  END;

  -- Validate mapped table name against allowlist
  IF v_table_name IS NULL OR v_table_name = '' OR NOT (v_table_name = ANY(v_allowlist)) THEN
    RAISE EXCEPTION 'Table d''opération non autorisée pour l''exécution: % (mappée: %)', v_raw_table, v_table_name;
  END IF;

  -- Determine if operation_id is a uuid
  BEGIN
    v_uuid_id := v_req.operation_id::uuid;
    v_is_uuid_pk := true;
  EXCEPTION WHEN invalid_text_representation THEN
    v_is_uuid_pk := false;
  END;

  -- Check whether the target table has an updated_at column
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_table_name
      AND column_name = 'updated_at'
  ) INTO v_has_updated_at;

  ------------------------------------------------------------------
  -- SUPPRESSION: actually DELETE the row from the target table
  ------------------------------------------------------------------
  IF v_req.status = 'autorisee_suppression' THEN
    IF p_deleted_snapshot IS NULL AND v_req.operation_snapshot IS NOT NULL THEN
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
  -- MODIFICATION: actually UPDATE the row with new values
  ------------------------------------------------------------------
  ELSE
    IF p_new_values IS NULL THEN
      RAISE EXCEPTION 'Aucune nouvelle valeur fournie pour la modification';
    END IF;

    -- Build the list of columns to set, excluding id/created_at/updated_at.
    -- jsonb_object_keys returns a setof text with no column name, so we must
    -- alias it (AS k) before referencing it in WHERE.
    v_keys := ARRAY(
      SELECT k
      FROM jsonb_object_keys(p_new_values) AS k
      WHERE k NOT IN ('id','created_at','updated_at')
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

    IF v_has_updated_at THEN
      v_set_clause := v_set_clause || ', updated_at = now()';
    END IF;

    IF p_old_values IS NULL AND v_req.operation_snapshot IS NOT NULL THEN
      p_old_values := v_req.operation_snapshot;
    END IF;

    IF v_is_uuid_pk THEN
      v_upd_sql := format('UPDATE public.%I SET %s WHERE id = $2', v_table_name, v_set_clause);
      EXECUTE v_upd_sql USING p_new_values, v_uuid_id;
    ELSE
      v_upd_sql := format('UPDATE public.%I SET %s WHERE id::text = $2', v_table_name, v_set_clause);
      EXECUTE v_upd_sql USING p_new_values, v_req.operation_id;
    END IF;
  END IF;

  -- Update the request record
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

  -- Log execution event
  INSERT INTO public.operation_change_request_events (
    request_id, event_type, performed_by, performer_name, performer_role, comment, metadata
  ) VALUES (
    p_request_id, 'executed', v_user_id, v_user_name, v_user_role,
    COALESCE(p_execution_notes, ''),
    jsonb_build_object(
      'authorized_action', v_req.status,
      'operation_table', v_raw_table,
      'mapped_table', v_table_name,
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
