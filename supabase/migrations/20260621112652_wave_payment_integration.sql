-- Wave payment integration: settings table + booking payment tracking columns.

CREATE TABLE IF NOT EXISTS wave_settings (
  id integer PRIMARY KEY DEFAULT 1,
  api_key text,
  signing_secret text,
  webhook_url text,
  mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'production')),
  is_active boolean NOT NULL DEFAULT false,
  checkout_enabled boolean NOT NULL DEFAULT true,
  balance_enabled boolean NOT NULL DEFAULT false,
  payout_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wave_settings_singleton CHECK (id = 1)
);

INSERT INTO wave_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE wave_settings ENABLE ROW LEVEL SECURITY;

-- Only reservation administrators can read/manage Wave merchant credentials.
-- Mobile clients never read this table directly; the edge functions use the service role.
CREATE POLICY "wave_settings_select_admins" ON wave_settings FOR SELECT
  TO authenticated
  USING (get_my_role() IN ('admin', 'agent_reservation'));

CREATE POLICY "wave_settings_insert_admins" ON wave_settings FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('admin', 'agent_reservation'));

CREATE POLICY "wave_settings_update_admins" ON wave_settings FOR UPDATE
  TO authenticated
  USING (get_my_role() IN ('admin', 'agent_reservation'))
  WITH CHECK (get_my_role() IN ('admin', 'agent_reservation'));

-- Wave payment tracking columns on bookings.
ALTER TABLE mobile_bookings
  ADD COLUMN IF NOT EXISTS wave_session_id text,
  ADD COLUMN IF NOT EXISTS wave_transaction_ref text,
  ADD COLUMN IF NOT EXISTS wave_checkout_status text,
  ADD COLUMN IF NOT EXISTS payment_date timestamptz;

-- Safe public status: lets the mobile app know whether Wave is available, without exposing secrets.
CREATE OR REPLACE FUNCTION get_wave_public_status()
RETURNS TABLE (is_active boolean, mode text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (w.is_active AND w.checkout_enabled AND w.api_key IS NOT NULL AND length(trim(w.api_key)) > 0) AS is_active,
         w.mode
  FROM wave_settings w
  WHERE w.id = 1;
$$;

GRANT EXECUTE ON FUNCTION get_wave_public_status() TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
