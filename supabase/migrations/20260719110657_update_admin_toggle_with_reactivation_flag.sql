/*
# Update admin_toggle_schedule_status to manage admin_reactivated_at flag

1. Modified Functions
   - `admin_toggle_schedule_status`: 
     - When reactivating (status -> en_cours): sets admin_reactivated_at = now()
       This prevents auto_terminate_past_schedules from re-terminating the trip
     - When re-terminating (status -> termine): clears admin_reactivated_at = NULL
       This allows future auto-termination to work normally again

2. Important Notes
   - The flag ensures that once an admin reactivates a trip, it stays "en_cours"
     until the admin manually sets it back to "termine"
   - No other business logic is modified
   - The Chef de Gare and Guichetier can immediately use the unlocked trip
*/

CREATE OR REPLACE FUNCTION admin_toggle_schedule_status(
  p_schedule_id uuid,
  p_new_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_full_name text;
  v_current_status text;
  v_action text;
BEGIN
  -- Check caller is admin
  v_role := (auth.jwt()->'app_metadata'->>'role');
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Seul un administrateur peut effectuer cette action';
  END IF;

  -- Validate new_status
  IF p_new_status NOT IN ('en_cours', 'termine') THEN
    RAISE EXCEPTION 'Le nouveau statut doit etre en_cours ou termine';
  END IF;

  -- Get current schedule status
  SELECT status INTO v_current_status
  FROM schedules
  WHERE id = p_schedule_id;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Voyage introuvable';
  END IF;

  -- Validate transition
  IF p_new_status = 'en_cours' AND v_current_status != 'termine' THEN
    RAISE EXCEPTION 'Seul un voyage termine peut etre reactive';
  END IF;

  IF p_new_status = 'termine' AND v_current_status != 'en_cours' THEN
    RAISE EXCEPTION 'Seul un voyage en cours peut etre retermine';
  END IF;

  -- Determine action label
  v_action := CASE WHEN p_new_status = 'en_cours' THEN 'reactivate' ELSE 'reterminate' END;

  -- Get admin full name
  SELECT COALESCE(raw_user_meta_data->>'full_name', email)
  INTO v_full_name
  FROM auth.users
  WHERE id = auth.uid();

  -- Update schedule status + admin_reactivated_at flag
  UPDATE schedules
  SET status = p_new_status,
      admin_reactivated_at = CASE 
        WHEN p_new_status = 'en_cours' THEN now()
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = p_schedule_id;

  -- Log the action
  INSERT INTO schedule_reactivation_logs (
    schedule_id, action, old_status, new_status,
    reason, performed_by, user_role, user_full_name
  ) VALUES (
    p_schedule_id, v_action, v_current_status, p_new_status,
    p_reason, auth.uid(), v_role, v_full_name
  );

  RETURN jsonb_build_object(
    'success', true,
    'schedule_id', p_schedule_id,
    'old_status', v_current_status,
    'new_status', p_new_status,
    'action', v_action
  );
END;
$$;
