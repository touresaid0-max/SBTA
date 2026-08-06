/*
# Extend ramassage_notifications with schedule details

Adds columns so the destination guichet can display verrouillées info
without re-querying the schedule: driver name, departure datetime, and
the free-seats quota captured at cloture time.
*/

ALTER TABLE ramassage_notifications
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS departure_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS seats_total int,
  ADD COLUMN IF NOT EXISTS seats_sold int;

-- seats_free = seats_total - seats_sold (computed at cloture time)
COMMENT ON COLUMN ramassage_notifications.seats_total IS 'Total seats at cloture time';
COMMENT ON COLUMN ramassage_notifications.seats_sold IS 'Seats sold at cloture time';

NOTIFY pgrst, 'reload schema';
