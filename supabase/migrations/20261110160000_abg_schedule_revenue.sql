-- Suivi des recettes, Tableau de bord et Rapport consolidé (gestion Agboville).
--
-- These pages downloaded every ticket of the period to add them up on the device: a year is tens
-- of thousands of rows, read 1 000 at a time, and the page stayed on its spinner. The totals per
-- departure are now made by the database: one row per departure.
--
-- SECURITY INVOKER: the caller's own access rules (RLS) on reservations still apply, so each
-- account sees exactly the totals of the tickets it could already read.
-- A ticket counts when it is confirmed or paid, the same rule the pages applied.

CREATE OR REPLACE FUNCTION public.abg_schedule_revenue(p_schedule_ids uuid[])
RETURNS TABLE (
  schedule_id uuid,
  tickets     bigint,
  seats       numeric,
  amount      numeric,
  baggage     numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.schedule_id,
         count(*)                                 AS tickets,
         COALESCE(sum(r.total_seats), 0)::numeric AS seats,
         COALESCE(sum(r.total_price), 0)::numeric AS amount,
         COALESCE(sum(r.baggage_fee), 0)::numeric AS baggage
  FROM reservations r
  WHERE r.schedule_id = ANY (p_schedule_ids)
    AND (r.status IN ('confirmed', 'paid', 'confirmee')
         OR r.payment_status IN ('paid', 'payee'))
  GROUP BY r.schedule_id;
$$;

REVOKE ALL ON FUNCTION public.abg_schedule_revenue(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abg_schedule_revenue(uuid[]) TO authenticated;
