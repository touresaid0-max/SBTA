/*
# Finalize deferred TPE baggage financial recognition

1. Purpose
- Keep deferred TPE baggage outside revenue and cash totals until a guichetier confirms payment.
- Record the actual payment actor, counter, amount, and timestamp on the baggage row.

2. New columns on `baggage_tickets`
- `paid_amount`: amount recognized as actually paid; populated atomically from the server-side baggage price.
- `paid_counter_id`: counter where the guichetier confirmed payment.

3. Security and integrity
- The confirmation RPC validates that the caller is authorized and assigned to the supplied counter.
- The atomic update only accepts rows still marked `en_attente`, preventing duplicate payment claims.
- Existing direct-paid baggage remains valid; its financial amount is derived from `price` when `paid_amount` is null.
*/

ALTER TABLE baggage_tickets
  ADD COLUMN IF NOT EXISTS paid_amount numeric(15,2),
  ADD COLUMN IF NOT EXISTS paid_counter_id uuid REFERENCES counters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_baggage_tickets_paid_counter
  ON baggage_tickets (paid_counter_id, paid_at)
  WHERE payment_status = 'paye';

CREATE OR REPLACE FUNCTION confirm_baggage_payment(
  p_baggage_id uuid,
  p_counter_id uuid
)
RETURNS baggage_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row baggage_tickets;
  v_caller_role text;
BEGIN
  v_caller_role := get_my_role();
  IF v_caller_role NOT IN ('guichetier', 'admin', 'chef_gare') THEN
    RAISE EXCEPTION 'Non autorisé à confirmer un paiement bagage';
  END IF;

  IF v_caller_role = 'guichetier' AND NOT EXISTS (
    SELECT 1
    FROM counters
    WHERE id = p_counter_id
      AND assigned_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Guichet non autorisé pour cet utilisateur';
  END IF;

  UPDATE baggage_tickets
  SET payment_status = 'paye',
      paid_at = now(),
      paid_by = auth.uid(),
      paid_counter_id = p_counter_id,
      paid_amount = price
  WHERE id = p_baggage_id
    AND payment_status = 'en_attente'
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    SELECT * INTO v_row FROM baggage_tickets WHERE id = p_baggage_id;
    IF v_row IS NULL THEN
      RAISE EXCEPTION 'Bagage introuvable';
    ELSE
      RAISE EXCEPTION 'Ce bagage a déjà été payé ou confirmé';
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION confirm_baggage_payment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION confirm_baggage_payment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirm_baggage_payment(uuid, uuid) TO authenticated;
