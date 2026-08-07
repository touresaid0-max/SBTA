/*
# Fix fill_rate check constraint violation on bus change

## Problem
When a guichetier changes a depart's bus to a smaller one (e.g. 61 → 45 seats)
due to breakdown, the `auto_calculate_fill_rate` BEFORE UPDATE trigger computes:

  fill_rate = seats_reserved / bus_capacity * 100

using the NEW bus capacity from the `buses` table and the CURRENT reservation
count (which still has 61 tickets). This produces fill_rate = 135.5%, which
violates the CHECK constraint `fill_rate >= 0 AND fill_rate <= 100` and causes
the entire UPDATE to fail with error 23514 — before the surplus tickets can be
transferred to the next depart.

This also affects the pending-transfer case: when no next depart exists yet,
the surplus tickets remain on the source schedule, so the reservation count
exceeds the new bus capacity indefinitely.

## Fix
Clamp the calculated fill_rate to the valid range [0, 100] inside the trigger
function. The fill_rate column is a statistics/display field — it should never
block a legitimate data update. The actual seat counts (seats_reserved,
seats_available) are already clamped via GREATEST(0, ...).

## Important Notes
1. Only the trigger function is replaced — no table changes, no data loss
2. seats_available is already clamped to GREATEST(0, ...) 
3. seats_reserved reflects the true reservation count (not clamped, since
   overbooking is a real state during bus changes)
*/

CREATE OR REPLACE FUNCTION public.auto_calculate_fill_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus_capacity integer;
  v_seats_reserved integer;
  v_raw_fill_rate numeric;
BEGIN
  SELECT COALESCE(b.total_seats, b.capacity, 0)
  INTO v_bus_capacity
  FROM buses b WHERE b.id = NEW.bus_id;

  IF v_bus_capacity IS NULL OR v_bus_capacity = 0 THEN
    NEW.fill_rate := 0;
    NEW.seats_available := 0;
    NEW.seats_reserved := 0;
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(r.total_seats), 0)
  INTO v_seats_reserved
  FROM reservations r
  WHERE r.schedule_id = NEW.id
    AND r.status IN ('confirmee', 'confirme', 'en_attente', 'embarque');

  v_raw_fill_rate := ROUND((v_seats_reserved::numeric / v_bus_capacity::numeric) * 100, 2);

  -- Clamp to valid range [0, 100] to avoid CHECK constraint violations
  -- during bus changes where seats_reserved temporarily exceeds bus capacity
  NEW.fill_rate := LEAST(100, GREATEST(0, v_raw_fill_rate));
  NEW.seats_reserved  := v_seats_reserved;
  NEW.seats_available := GREATEST(0, v_bus_capacity - v_seats_reserved);

  RETURN NEW;
END;
$$;
