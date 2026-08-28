-- Backfill seats_total: temporarily disable the conflict trigger, update, re-enable
ALTER TABLE public.schedules DISABLE TRIGGER trigger_validate_schedule_conflicts;

UPDATE schedules
SET seats_total = (seats_available + seats_reserved)
WHERE seats_total IS NULL;

ALTER TABLE public.schedules ENABLE TRIGGER trigger_validate_schedule_conflicts;
