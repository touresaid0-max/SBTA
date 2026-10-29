-- Ticket reprint authorizations
-- The admin selects sold seats in "Gestion des sièges" and authorizes the
-- guichet to reprint the matching tickets. Each authorization is single-use:
-- the guichet consumes it after a successful reprint (printed as DUPLICATA).

CREATE TABLE IF NOT EXISTS public.ticket_reprint_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  seat_label text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'revoked')),
  authorized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ticket_reprint_auth_schedule_status
  ON public.ticket_reprint_authorizations (schedule_id, status);

-- Only one pending authorization per seat of a reservation
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_reprint_auth_pending
  ON public.ticket_reprint_authorizations (reservation_id, seat_label)
  WHERE status = 'pending';

ALTER TABLE public.ticket_reprint_authorizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_reprint_auth_select" ON public.ticket_reprint_authorizations;
CREATE POLICY "ticket_reprint_auth_select" ON public.ticket_reprint_authorizations
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin', 'guichetier', 'chef_gare'));

-- Writes go exclusively through the SECURITY DEFINER functions below.

-- Admin: authorize the reprint of one sold seat
CREATE OR REPLACE FUNCTION public.admin_authorize_ticket_reprint(
  p_schedule_id uuid,
  p_reservation_id uuid,
  p_seat_label text,
  p_reason text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat_numbers text[];
  v_id uuid;
BEGIN
  IF get_my_role() IS DISTINCT FROM 'admin' THEN
    RETURN json_build_object('success', false, 'error', 'Accès refusé — Admin uniquement');
  END IF;

  SELECT r.seat_numbers INTO v_seat_numbers
  FROM reservations r
  WHERE r.id = p_reservation_id
    AND r.schedule_id = p_schedule_id
    AND r.status IN ('confirmee', 'confirme', 'en_attente', 'payee', 'embarquee', 'embarque');

  IF v_seat_numbers IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Réservation introuvable ou annulée');
  END IF;

  IF NOT (p_seat_label = ANY(v_seat_numbers)) THEN
    RETURN json_build_object('success', false, 'error', 'Ce siège ne fait pas partie de cette réservation');
  END IF;

  SELECT id INTO v_id
  FROM ticket_reprint_authorizations
  WHERE reservation_id = p_reservation_id
    AND seat_label = p_seat_label
    AND status = 'pending';

  IF v_id IS NOT NULL THEN
    RETURN json_build_object('success', true, 'id', v_id, 'already_pending', true);
  END IF;

  INSERT INTO ticket_reprint_authorizations (schedule_id, reservation_id, seat_label, reason, authorized_by)
  VALUES (p_schedule_id, p_reservation_id, p_seat_label, NULLIF(trim(p_reason), ''), auth.uid())
  RETURNING id INTO v_id;

  RETURN json_build_object('success', true, 'id', v_id, 'already_pending', false);
END;
$$;

-- Admin: revoke a pending authorization
CREATE OR REPLACE FUNCTION public.admin_revoke_ticket_reprint(p_authorization_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_role() IS DISTINCT FROM 'admin' THEN
    RETURN json_build_object('success', false, 'error', 'Accès refusé — Admin uniquement');
  END IF;

  UPDATE ticket_reprint_authorizations
  SET status = 'revoked'
  WHERE id = p_authorization_id AND status = 'pending';

  RETURN json_build_object('success', FOUND);
END;
$$;

-- Guichet: consume an authorization after a successful reprint
CREATE OR REPLACE FUNCTION public.consume_ticket_reprint(p_authorization_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(get_my_role(), '') NOT IN ('guichetier', 'chef_gare', 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Accès refusé');
  END IF;

  UPDATE ticket_reprint_authorizations
  SET status = 'used', used_by = auth.uid(), used_at = now()
  WHERE id = p_authorization_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Autorisation déjà utilisée ou révoquée');
  END IF;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_authorize_ticket_reprint(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_ticket_reprint(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_ticket_reprint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_authorize_ticket_reprint(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_ticket_reprint(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ticket_reprint(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
