-- Backfill seats_total from seats_available + seats_reserved for existing schedules
-- Done in a DO block to avoid triggering validate_schedule_conflicts per-row
DO $$
BEGIN
  UPDATE schedules
  SET seats_total = (seats_available + seats_reserved)
  WHERE seats_total IS NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Backfill skipped: %', SQLERRM;
END $$;
