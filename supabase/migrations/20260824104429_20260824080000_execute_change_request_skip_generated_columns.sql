/*
# Ignorer les colonnes générées automatiquement dans execute_change_request

Problème :
La colonne `parcels.total_amount` est de type `GENERATED ALWAYS AS (delivery_fee + sms_tracking_fee)`.
PostgreSQL interdit les UPDATE directs sur ces colonnes :
  "column total_amount can only be updated to DEFAULT"

Solution :
Dans la boucle qui construit la clause SET, vérifier `is_generated` dans
information_schema.columns et faire un CONTINUE si la colonne est `ALWAYS`.
Ceci évite l'erreur pour `total_amount` et toute autre colonne générée
qui pourrait exister dans le futur sur les tables cibles.

Sécurité : aucun changement de RLS, aucune modification d'autres logiques.
*/

CREATE OR REPLACE FUNCTION public.execute_change_request(
  p_request_id uuid,
  p_execution_notes text,
  p_old_values jsonb DEFAULT NULL::jsonb,
  p_new_values jsonb DEFAULT NULL::jsonb,
  p_deleted_snapshot jsonb DEFAULT NULL::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req            public.operation_change_requests%ROWTYPE;
  v_user_id        uuid;
  v_user_name      text;
  v_user_role      text;
  v_raw_table      text;
  v_table_name     text;
  v_is_uuid_pk     boolean;
  v_allowlist      text[] := ARRAY[
    'reservations','baggage_tickets','counter_charges','schedules','convoys',
    'ramassage_notifications','parcels','bus_expenses','vehicle_expenses'
  ];
  v_del_sql        text;
  v_upd_sql        text;
  v_keys           text[];
  v_set_clause     text;
  v_has_updated_at boolean;
  v_udt_name       text;
  v_is_generated   text;
  v_base_udt       text;
  v_expr           text;
  v_k              text;
  v_uuid_id        uuid;
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

  v_raw_table := v_req.operation_table;
  v_table_name := CASE v_raw_table
    WHEN 'tickets' THEN 'reservations'
    WHEN 'bagage_tickets' THEN 'baggage_tickets'
    WHEN 'bagages' THEN 'baggage_tickets'
    WHEN 'depenses' THEN 'counter_charges'
    ELSE v_raw_table
  END;

  IF v_table_name IS NULL OR v_table_name = '' OR NOT (v_table_name = ANY(v_allowlist)) THEN
    RAISE EXCEPTION 'Table d''opération non autorisée pour l''exécution: % (mappée: %)', v_raw_table, v_table_name;
  END IF;

  BEGIN
    v_uuid_id := v_req.operation_id::uuid;
    v_is_uuid_pk := true;
  EXCEPTION WHEN invalid_text_representation THEN
    v_is_uuid_pk := false;
  END;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_table_name
      AND column_name = 'updated_at'
  ) INTO v_has_updated_at;

  IF v_req.status = 'autorisee_suppression' THEN
    IF p_deleted_snapshot IS NULL AND v_req.operation_snapshot IS NOT NULL THEN
      p_deleted_snapshot := v_req.operation_snapshot;
    END IF;

    BEGIN
      IF v_is_uuid_pk THEN
        v_del_sql := format('DELETE FROM public.%I WHERE id = $1', v_table_name);
        EXECUTE v_del_sql USING v_uuid_id;
      ELSE
        v_del_sql := format('DELETE FROM public.%I WHERE id::text = $1', v_table_name);
        EXECUTE v_del_sql USING v_req.operation_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Impossible de supprimer l''opération dans %: %', v_table_name, SQLERRM;
    END;
  ELSE
    IF p_new_values IS NULL THEN
      RAISE EXCEPTION 'Aucune nouvelle valeur fournie pour la modification';
    END IF;

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
      SELECT udt_name, is_generated INTO v_udt_name, v_is_generated
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table_name
        AND column_name = v_k;

      -- Ignorer les clés qui ne sont pas des colonnes réelles de la table cible
      IF v_udt_name IS NULL THEN
        CONTINUE;
      END IF;

      -- Ignorer les colonnes générées automatiquement (GENERATED ALWAYS AS ...)
      -- PostgreSQL interdit les UPDATE directs sur ces colonnes
      IF v_is_generated = 'ALWAYS' THEN
        CONTINUE;
      END IF;

      v_expr := NULL;

      IF v_udt_name IN ('json','jsonb') THEN
        v_expr := format('%I = ($1 -> %L)', v_k, v_k);
      ELSIF v_udt_name LIKE '\_%' ESCAPE '\' THEN
        v_base_udt := substring(v_udt_name from 2);
        v_expr := format(
          '%I = CASE '
            || 'WHEN ($1 -> %L) IS NULL OR jsonb_typeof($1 -> %L) = ''null'' THEN NULL '
            || 'WHEN jsonb_typeof($1 -> %L) = ''array'' THEN ('
              || 'SELECT array_agg(NULLIF(elem, '''')::' || v_base_udt || ') '
              || 'FROM jsonb_array_elements_text($1 -> %L) AS t(elem)'
            || ') '
            || 'WHEN ($1 ->> %L) = '''' THEN NULL '
            || 'ELSE string_to_array(($1 ->> %L), '','')::' || v_base_udt || '[] '
          || 'END',
          v_k, v_k, v_k, v_k, v_k, v_k, v_k
        );
      ELSIF v_udt_name = 'uuid' THEN
        v_expr := format('%I = NULLIF(($1 ->> %L), '''')::uuid', v_k, v_k);
      ELSIF v_udt_name IN ('int2','int4','int8') THEN
        v_expr := format('%I = NULLIF(($1 ->> %L), '''')::' || v_udt_name, v_k, v_k);
      ELSIF v_udt_name IN ('float4','float8','numeric') THEN
        v_expr := format('%I = NULLIF(($1 ->> %L), '''')::' || v_udt_name, v_k, v_k);
      ELSIF v_udt_name = 'bool' THEN
        v_expr := format('%I = NULLIF(($1 ->> %L), '''')::boolean', v_k, v_k);
      ELSIF v_udt_name IN ('date','time','timetz','timestamp','timestamptz','interval') THEN
        v_expr := format('%I = NULLIF(($1 ->> %L), '''')::' || v_udt_name, v_k, v_k);
      ELSE
        v_expr := format('%I = ($1 ->> %L)', v_k, v_k);
      END IF;

      IF v_set_clause <> '' THEN
        v_set_clause := v_set_clause || ', ';
      END IF;
      v_set_clause := v_set_clause || v_expr;
    END LOOP;

    IF v_set_clause = '' THEN
      RAISE EXCEPTION 'Aucun champ valide à modifier trouvé pour la table %', v_table_name;
    END IF;

    IF v_has_updated_at THEN
      v_set_clause := v_set_clause || ', updated_at = now()';
    END IF;

    IF p_old_values IS NULL AND v_req.operation_snapshot IS NOT NULL THEN
      p_old_values := v_req.operation_snapshot;
    END IF;

    BEGIN
      IF v_is_uuid_pk THEN
        v_upd_sql := format('UPDATE public.%I SET %s WHERE id = $2', v_table_name, v_set_clause);
        EXECUTE v_upd_sql USING p_new_values, v_uuid_id;
      ELSE
        v_upd_sql := format('UPDATE public.%I SET %s WHERE id::text = $2', v_table_name, v_set_clause);
        EXECUTE v_upd_sql USING p_new_values, v_req.operation_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Impossible d''appliquer la modification sur %: %', v_table_name, SQLERRM;
    END;
  END IF;

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
$function$;
