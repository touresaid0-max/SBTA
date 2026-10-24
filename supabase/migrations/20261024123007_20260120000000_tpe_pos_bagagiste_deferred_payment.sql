/*
# TPE-POS Bagagiste — Deferred Payment System

## Overview
Adds support for two TPE-POS bagagiste modes (with and without guichet) and
deferred payment confirmation at the guichet. New columns on `users` for
admin-configurable TPE-POS authorization, new columns on `baggage_tickets`
for payment status tracking, and a SECURITY DEFINER RPC for atomic payment
confirmation that prevents double payment.

## New Columns

### users table
- `tpe_pos_enabled` (boolean, default false) — admin toggles TPE-POS access
  for bagagiste accounts. When false, the bagagiste cannot log into the TPE-POS
  terminal at all.
- `tpe_mode` (text, default 'sans_guichet') — when tpe_pos_enabled is true,
  determines the mode: 'sans_guichet' (bagagiste collects payment directly) or
  'avec_guichet' (bagagiste registers baggage with deferred payment, guichetier
  confirms payment later).

### baggage_tickets table
- `payment_status` (text, default 'paye') — 'paye' for paid/confirmed baggage
  (existing behavior), 'en_attente' for deferred payment registered by TPE-POS
  bagagiste in 'avec_guichet' mode.
- `paid_at` (timestamptz, nullable) — when payment was confirmed (null for
  'en_attente' and for pre-existing rows which default to 'paye').
- `paid_by` (uuid, nullable) — the guichetier who confirmed the payment
  (references auth.users; null for direct sales by bagagiste in sans_guichet
  mode).

## Security

### Trigger: protect_tpe_pos_settings
A BEFORE UPDATE trigger on `users` prevents any non-admin from changing
`tpe_pos_enabled` or `tpe_mode`. Only callers with `get_my_role() = 'admin'`
can modify these columns. This protects against a bagagiste self-elevating
their TPE-POS access through the `users_update_own` RLS policy.

### RLS: baggage_tickets SELECT policy update
The existing "Guichetier can read own baggage tickets" SELECT policy is
replaced with "Guichetier can read baggage tickets" which additionally
allows guichetier to read `payment_status = 'en_attente'` baggage at their
own station — needed for the TPE-POS pending baggage search at the guichet.

### RPC: confirm_baggage_payment(uuid)
SECURITY DEFINER function that atomically confirms payment of a pending
baggage ticket. It performs an UPDATE...WHERE...RETURNING that only matches
rows with `payment_status = 'en_attente'`, so concurrent callers cannot
double-pay the same baggage. The caller must be guichetier, admin, or
chef_gare. EXECUTE is revoked from PUBLIC/anon and granted to authenticated.

### Grant: paid_by foreign key
`paid_by` references `auth.users(id)` with ON DELETE SET NULL.
*/

-- ── users: TPE-POS authorization columns ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS tpe_pos_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tpe_mode text NOT NULL DEFAULT 'sans_guichet'
  CHECK (tpe_mode IN ('sans_guichet', 'avec_guichet'));

-- ── baggage_tickets: payment status columns ──
ALTER TABLE baggage_tickets ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paye'
  CHECK (payment_status IN ('paye', 'en_attente'));
ALTER TABLE baggage_tickets ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE baggage_tickets ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for searching pending baggage by station
CREATE INDEX IF NOT EXISTS idx_baggage_tickets_pending_station
  ON baggage_tickets (station_id) WHERE payment_status = 'en_attente';

-- Index for searching by baggage number suffix
CREATE INDEX IF NOT EXISTS idx_baggage_tickets_number
  ON baggage_tickets (baggage_number);

-- ── Trigger: prevent non-admins from changing TPE-POS settings ──
CREATE OR REPLACE FUNCTION protect_tpe_pos_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (NEW.tpe_pos_enabled IS DISTINCT FROM OLD.tpe_pos_enabled
      OR NEW.tpe_mode IS DISTINCT FROM OLD.tpe_mode) THEN
    IF get_my_role() <> 'admin' THEN
      RAISE EXCEPTION 'Non autorisé à modifier les paramètres TPE-POS';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_tpe_pos_settings ON users;
CREATE TRIGGER trg_protect_tpe_pos_settings
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION protect_tpe_pos_settings();

-- ── RLS: update baggage_tickets SELECT policy ──
DROP POLICY IF EXISTS "Guichetier can read own baggage tickets" ON baggage_tickets;
DROP POLICY IF EXISTS "Guichetier can read baggage tickets" ON baggage_tickets;

CREATE POLICY "Guichetier can read baggage tickets" ON baggage_tickets FOR SELECT
  TO authenticated USING (
    sold_by = auth.uid()
    OR (auth.jwt() -> 'app_metadata') ->> 'role' = ANY (
      ARRAY['admin', 'chef_gare', 'comptable', 'gestionnaire', 'daf', 'dg']
    )
    OR (
      payment_status = 'en_attente'
      AND station_id = (
        SELECT station_id FROM users WHERE id = auth.uid()
      )
      AND (auth.jwt() -> 'app_metadata') ->> 'role' = 'guichetier'
    )
  );

-- ── RPC: atomic payment confirmation ──
CREATE OR REPLACE FUNCTION confirm_baggage_payment(p_baggage_id uuid)
RETURNS baggage_tickets
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row baggage_tickets;
  v_caller_role text;
BEGIN
  v_caller_role := get_my_role();
  IF v_caller_role NOT IN ('guichetier', 'admin', 'chef_gare') THEN
    RAISE EXCEPTION 'Non autorisé à confirmer un paiement bagage';
  END IF;

  -- Atomic claim: only updates if currently 'en_attente'
  UPDATE baggage_tickets
  SET payment_status = 'paye',
      paid_at = now(),
      paid_by = auth.uid()
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
GRANT EXECUTE ON FUNCTION confirm_baggage_payment(uuid) TO authenticated;
