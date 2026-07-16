/*
# Schedule Reactivation System

Admin-only feature to reactivate terminated schedules for corrections.

## New Tables
- `schedule_reactivation_logs`
  - `id` (uuid, pk)
  - `schedule_id` (uuid, fk -> schedules)
  - `action` (text): 'reactivate' or 'reterminate'
  - `old_status` (text): status before the change
  - `new_status` (text): status after the change
  - `reason` (text, not null): mandatory justification
  - `performed_by` (uuid, fk -> auth.users): admin who performed the action
  - `performed_at` (timestamptz): timestamp of action
  - `user_role` (text): role of the user who performed action
  - `user_full_name` (text): full name for audit trail

## New Functions
- `admin_reactivate_schedule(p_schedule_id, p_reason)`: toggles status between termine/en_cours
  - Only admins can call it
  - Logs every change with full audit trail

## Security
- RLS enabled on schedule_reactivation_logs
- SELECT: all authenticated users can view logs
- INSERT: only via the RPC (security definer)

## Important Notes
1. Only administrators can reactivate schedules
2. Reactivated schedules become editable by chef_gare and guichetier
3. Admin can re-terminate once corrections are done
4. Full audit trail is maintained
*/

-- Reactivation audit log table
CREATE TABLE IF NOT EXISTS schedule_reactivation_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  action          text NOT NULL CHECK (action IN ('reactivate', 'reterminate')),
  old_status      text NOT NULL,
  new_status      text NOT NULL,
  reason          text NOT NULL,
  performed_by    uuid NOT NULL REFERENCES auth.users(id),
  performed_at    timestamptz NOT NULL DEFAULT now(),
  user_role       text NOT NULL,
  user_full_name  text NOT NULL
);

ALTER TABLE schedule_reactivation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_reactivation_logs" ON schedule_reactivation_logs;
CREATE POLICY "authenticated_select_reactivation_logs"
  ON schedule_reactivation_logs FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin_insert_reactivation_logs" ON schedule_reactivation_logs;
CREATE POLICY "admin_insert_reactivation_logs"
  ON schedule_reactivation_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

-- Index for fast lookups per schedule
CREATE INDEX IF NOT EXISTS idx_reactivation_logs_schedule_id
  ON schedule_reactivation_logs(schedule_id);

CREATE INDEX IF NOT EXISTS idx_reactivation_logs_performed_at
  ON schedule_reactivation_logs(performed_at DESC);

-- RPC: Admin toggles schedule between termine <-> en_cours
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

  -- Update schedule status
  UPDATE schedules
  SET status = p_new_status
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
