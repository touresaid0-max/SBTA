/*
# Operation Change Request Workflow — Secure Modification/Deletion Authorization

## Purpose
Implements a secure, auditable workflow for requesting modifications or deletions
of POS (Guichet) and Courier (Service Courrier) operations. No agent can directly
modify or delete a recorded operation — they must submit a change request that
flows through DG approval → technical execution → audit trail.

## Workflow
  Agent (Guichet/Courrier/Chef de Gare) → Submit Request (status: en_attente)
  → DG → Authorize Modification / Authorize Deletion / Refuse
  → Technical Team (admin) → Execute the authorized action only
  → Audit trail with old_values, new_values, full traceability

## Emergency Procedure
  When DG is unreachable, a Chef de Gare can exceptionally authorize, with
  mandatory documentation. The DG must review the complete file afterwards.

## New Tables

### 1. operation_change_requests
Main table holding each change request.
- request_type: 'modification' | 'suppression'
- operation_type: the kind of operation (ticket_sale, reservation, departure_expense,
    carburant, peage, ration, autres_depense, courrier_entrant, courrier_sortant,
    paiement_recette, convoy, baggage, other)
- operation_id: identifier of the target operation
- operation_table: the DB table the operation lives in
- operation_reference: human-readable reference
- operation_snapshot: JSONB snapshot of current values at request time
- status: en_attente | autorisee_modification | autorisee_suppression | refusee | executee | annulee
- is_emergency: emergency procedure flag
- reviewed_by/reviewer_name/reviewed_at: DG or Chef de Gare review
- executed_by/executor_name/executed_at: technical team execution
- old_values_snapshot/new_values_applied/deleted_record_snapshot: audit snapshots
- request_number: auto-generated (CR-YYYYMM-NNNN)

### 2. operation_change_request_events
Timeline of every event in a request's lifecycle (audit trail).

## Security (RLS)
- SELECT/INSERT: authenticated users
- UPDATE/DELETE: denied to all roles — changes go through SECURITY DEFINER RPCs only

## RPCs (all SECURITY DEFINER, search_path = public)
1. submit_change_request — creates request, generates number, logs event
2. review_change_request — DG or Chef de Gare (emergency) reviews
3. execute_change_request — Technical team executes authorized action
4. cancel_change_request — Requester cancels if still en_attente
*/

-- ============================================================
-- 1. operation_change_requests table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.operation_change_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number          text UNIQUE NOT NULL,
  request_type            text NOT NULL CHECK (request_type IN ('modification','suppression')),
  operation_type          text NOT NULL,
  operation_id            text NOT NULL,
  operation_table         text NOT NULL,
  operation_reference     text NOT NULL,
  operation_snapshot      jsonb,
  requested_by            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_name          text NOT NULL,
  requester_role          text NOT NULL,
  station_id              uuid,
  station_name            text,
  reason                  text NOT NULL,
  error_description       text NOT NULL,
  modification_details    text,
  new_values              jsonb,
  justification_doc_url   text,
  additional_comment      text,
  status                  text NOT NULL DEFAULT 'en_attente'
    CHECK (status IN ('en_attente','autorisee_modification','autorisee_suppression','refusee','executee','annulee')),
  is_emergency            boolean NOT NULL DEFAULT false,
  emergency_justification text,
  reviewed_by             uuid REFERENCES auth.users(id),
  reviewer_name           text,
  reviewed_at             timestamptz,
  review_comment          text,
  executed_by             uuid REFERENCES auth.users(id),
  executor_name           text,
  executed_at             timestamptz,
  execution_notes         text,
  old_values_snapshot     jsonb,
  new_values_applied      jsonb,
  deleted_record_snapshot jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.operation_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_change_requests" ON public.operation_change_requests;
CREATE POLICY "select_change_requests"
  ON public.operation_change_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_change_requests" ON public.operation_change_requests;
CREATE POLICY "insert_change_requests"
  ON public.operation_change_requests FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_change_requests" ON public.operation_change_requests;
CREATE POLICY "update_change_requests"
  ON public.operation_change_requests FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "delete_change_requests" ON public.operation_change_requests;
CREATE POLICY "delete_change_requests"
  ON public.operation_change_requests FOR DELETE
  TO authenticated USING (false);

-- ============================================================
-- 2. operation_change_request_events table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.operation_change_request_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES public.operation_change_requests(id) ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN ('created','reviewed','executed','refused','cancelled','emergency_override')),
  performed_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  performer_name text NOT NULL,
  performer_role text NOT NULL,
  comment       text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.operation_change_request_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_change_request_events" ON public.operation_change_request_events;
CREATE POLICY "select_change_request_events"
  ON public.operation_change_request_events FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_change_request_events" ON public.operation_change_request_events;
CREATE POLICY "insert_change_request_events"
  ON public.operation_change_request_events FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_change_request_events" ON public.operation_change_request_events;
CREATE POLICY "update_change_request_events"
  ON public.operation_change_request_events FOR UPDATE
  TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "delete_change_request_events" ON public.operation_change_request_events;
CREATE POLICY "delete_change_request_events"
  ON public.operation_change_request_events FOR DELETE
  TO authenticated USING (false);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ocr_status ON public.operation_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_ocr_requested_by ON public.operation_change_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_ocr_station ON public.operation_change_requests(station_id);
CREATE INDEX IF NOT EXISTS idx_ocr_created_at ON public.operation_change_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocre_request_id ON public.operation_change_request_events(request_id);
CREATE INDEX IF NOT EXISTS idx_ocre_created_at ON public.operation_change_request_events(created_at DESC);

-- ============================================================
-- 3. Helper: get current user's role + name
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_current_user_info()
RETURNS TABLE(user_id uuid, user_name text, user_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() AS user_id,
    COALESCE(
      (SELECT pu.full_name FROM public.users pu WHERE pu.id = auth.uid()),
      (SELECT au.email FROM auth.users au WHERE au.id = auth.uid()),
      'Inconnu'
    ) AS user_name,
    COALESCE(
      (SELECT pu.role FROM public.users pu WHERE pu.id = auth.uid()),
      COALESCE((auth.jwt() -> 'app_metadata' ->> 'role'), 'unknown')
    ) AS user_role
$$;

-- ============================================================
-- 4. RPC: submit_change_request
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_change_request(
  p_request_type        text,
  p_operation_type      text,
  p_operation_id        text,
  p_operation_table     text,
  p_operation_reference text,
  p_operation_snapshot  jsonb,
  p_reason              text,
  p_error_description   text,
  p_modification_details text,
  p_new_values          jsonb,
  p_justification_doc_url text,
  p_additional_comment  text,
  p_station_id          uuid,
  p_station_name        text,
  p_is_emergency        boolean DEFAULT false,
  p_emergency_justification text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id          uuid;
  v_number      text;
  v_user_id     uuid;
  v_user_name   text;
  v_user_role   text;
  v_count       int;
BEGIN
  SELECT user_id, user_name, user_role INTO v_user_id, v_user_name, v_user_role
  FROM public.get_current_user_info()
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;

  IF p_request_type NOT IN ('modification','suppression') THEN
    RAISE EXCEPTION 'Type de demande invalide';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Le motif est obligatoire';
  END IF;

  IF p_error_description IS NULL OR trim(p_error_description) = '' THEN
    RAISE EXCEPTION 'La description de l''erreur est obligatoire';
  END IF;

  IF p_is_emergency = true AND (p_emergency_justification IS NULL OR trim(p_emergency_justification) = '') THEN
    RAISE EXCEPTION 'La justification de l''urgence est obligatoire pour la procédure d''urgence';
  END IF;

  SELECT COUNT(*) + 1 INTO v_count
  FROM public.operation_change_requests
  WHERE created_at >= date_trunc('month', now());

  v_number := 'CR-' || to_char(now(), 'YYYYMM') || '-' || lpad(v_count::text, 4, '0');

  INSERT INTO public.operation_change_requests (
    request_number, request_type, operation_type, operation_id, operation_table,
    operation_reference, operation_snapshot,
    requested_by, requester_name, requester_role,
    station_id, station_name,
    reason, error_description, modification_details, new_values,
    justification_doc_url, additional_comment,
    is_emergency, emergency_justification,
    status
  ) VALUES (
    v_number, p_request_type, p_operation_type, p_operation_id, p_operation_table,
    p_operation_reference, p_operation_snapshot,
    v_user_id, v_user_name, v_user_role,
    p_station_id, p_station_name,
    p_reason, p_error_description, p_modification_details, p_new_values,
    p_justification_doc_url, p_additional_comment,
    p_is_emergency, p_emergency_justification,
    'en_attente'
  ) RETURNING id INTO v_id;

  INSERT INTO public.operation_change_request_events (
    request_id, event_type, performed_by, performer_name, performer_role, comment, metadata
  ) VALUES (
    v_id, 'created', v_user_id, v_user_name, v_user_role,
    'Demande ' || p_request_type || ' - ' || p_operation_reference,
    jsonb_build_object(
      'request_type', p_request_type,
      'operation_type', p_operation_type,
      'operation_reference', p_operation_reference,
      'is_emergency', p_is_emergency
    )
  );

  RETURN v_id;
END;
$$;

-- ============================================================
-- 5. RPC: review_change_request
-- ============================================================
CREATE OR REPLACE FUNCTION public.review_change_request(
  p_request_id    uuid,
  p_decision      text,
  p_review_comment text,
  p_is_emergency_override boolean DEFAULT false
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
  v_new_status  text;
  v_event_type  text;
BEGIN
  SELECT user_id, user_name, user_role INTO v_user_id, v_user_name, v_user_role
  FROM public.get_current_user_info()
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;

  SELECT * INTO v_req FROM public.operation_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;

  IF v_req.status <> 'en_attente' THEN
    RAISE EXCEPTION 'Cette demande a déjà été traitée (statut: %)', v_req.status;
  END IF;

  IF v_user_role NOT IN ('dg','admin') THEN
    IF v_user_role = 'chef_gare' AND p_is_emergency_override = true THEN
      IF v_req.is_emergency = false THEN
        RAISE EXCEPTION 'La procédure d''urgence n''est activée que pour les demandes en urgence';
      END IF;
    ELSE
      RAISE EXCEPTION 'Seul le DG ou l''administrateur peut autoriser les demandes';
    END IF;
  END IF;

  p_decision := lower(trim(p_decision));

  IF p_decision = 'autoriser_modification' THEN
    v_new_status := 'autorisee_modification';
    v_event_type := 'reviewed';
  ELSIF p_decision = 'autoriser_suppression' THEN
    v_new_status := 'autorisee_suppression';
    v_event_type := 'reviewed';
  ELSIF p_decision = 'refuser' THEN
    v_new_status := 'refusee';
    v_event_type := 'refused';
  ELSE
    RAISE EXCEPTION 'Décision invalide: %', p_decision;
  END IF;

  UPDATE public.operation_change_requests
  SET status = v_new_status,
      reviewed_by = v_user_id,
      reviewer_name = v_user_name,
      reviewed_at = now(),
      review_comment = p_review_comment,
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.operation_change_request_events (
    request_id, event_type, performed_by, performer_name, performer_role, comment, metadata
  ) VALUES (
    p_request_id,
    CASE WHEN p_is_emergency_override = true AND v_user_role = 'chef_gare' THEN 'emergency_override' ELSE v_event_type END,
    v_user_id, v_user_name, v_user_role,
    COALESCE(p_review_comment, ''),
    jsonb_build_object(
      'decision', p_decision,
      'previous_status', v_req.status,
      'new_status', v_new_status,
      'is_emergency_override', p_is_emergency_override
    )
  );

  RETURN true;
END;
$$;

-- ============================================================
-- 6. RPC: execute_change_request
-- ============================================================
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
      'old_values', p_old_values,
      'new_values', p_new_values,
      'deleted_snapshot', p_deleted_snapshot
    )
  );

  RETURN true;
END;
$$;

-- ============================================================
-- 7. RPC: cancel_change_request
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_change_request(
  p_request_id uuid,
  p_cancel_reason text
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
BEGIN
  SELECT user_id, user_name, user_role INTO v_user_id, v_user_name, v_user_role
  FROM public.get_current_user_info()
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilisateur non authentifié';
  END IF;

  SELECT * INTO v_req FROM public.operation_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable';
  END IF;

  IF v_req.status <> 'en_attente' THEN
    RAISE EXCEPTION 'Seule une demande en attente peut être annulée (statut: %)', v_req.status;
  END IF;

  IF v_req.requested_by <> v_user_id AND v_user_role NOT IN ('admin','dg') THEN
    RAISE EXCEPTION 'Seul le demandeur ou la direction peut annuler cette demande';
  END IF;

  UPDATE public.operation_change_requests
  SET status = 'annulee',
      review_comment = p_cancel_reason,
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.operation_change_request_events (
    request_id, event_type, performed_by, performer_name, performer_role, comment, metadata
  ) VALUES (
    p_request_id, 'cancelled', v_user_id, v_user_name, v_user_role,
    COALESCE(p_cancel_reason, ''),
    jsonb_build_object('previous_status', v_req.status)
  );

  RETURN true;
END;
$$;

-- ============================================================
-- 8. Permissions
-- ============================================================
GRANT SELECT, INSERT ON public.operation_change_requests TO authenticated;
GRANT SELECT, INSERT ON public.operation_change_request_events TO authenticated;

NOTIFY pgrst, 'reload schema';
