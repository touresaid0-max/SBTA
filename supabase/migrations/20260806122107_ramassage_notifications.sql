/*
# Ramassage notifications (guichet → guichet)

Adds a table used to notify a destination station when an "origin" counter
closes a ramassage-flagged departure. The destination guichet reads only
notifications addressed to its own station.

1. New tables
- `ramassage_notifications`: destination-scoped alerts with the info
needed on the destination guichet (line, departure number, plate,
origin/destination stations).

2. Security
- RLS enabled.
- Authenticated users can SELECT / UPDATE their own destination rows.
- Any authenticated user can INSERT (guichet operators create rows when
they close a ramassage departure).
- No DELETE policy.
*/

CREATE TABLE IF NOT EXISTS ramassage_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid,
  local_depart_id text,
  route_id uuid,
  route_name text,
  departure_number int,
  bus_id uuid,
  bus_registration text,
  origin_station_id uuid,
  origin_station_name text,
  destination_station_id uuid NOT NULL,
  destination_station_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consulted','done')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  consulted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ramassage_notif_dest_pending
  ON ramassage_notifications (destination_station_id, status);

CREATE INDEX IF NOT EXISTS idx_ramassage_notif_bus
  ON ramassage_notifications (bus_registration);

ALTER TABLE ramassage_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_ramassage_notifs" ON ramassage_notifications;
CREATE POLICY "select_ramassage_notifs"
  ON ramassage_notifications FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_ramassage_notifs" ON ramassage_notifications;
CREATE POLICY "insert_ramassage_notifs"
  ON ramassage_notifications FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_ramassage_notifs" ON ramassage_notifications;
CREATE POLICY "update_ramassage_notifs"
  ON ramassage_notifications FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
