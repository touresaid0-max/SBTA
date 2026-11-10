/*
# Tableau de bord administrateur : totaux calculés sans dépasser le délai

Constat (production, 10/11/2026) : get_admin_dashboard_stats s'arrêtait sur
« canceling statement due to statement timeout » (57014) et le tableau de bord de l'admin
restait à 0. La fonction tournait avec les droits de l'appelant (SECURITY INVOKER) : pour chaque
réservation, paiement, départ et dépense de la période, la base revérifiait les règles d'accès
(RLS), chacune relisant le rôle de l'utilisateur. Le mois de novembre compte à lui seul plus de
31 000 réservations, lues deux fois.

La fonction tourne maintenant avec les droits de son propriétaire (SECURITY DEFINER) et vérifie
elle-même, une seule fois, que l'appelant est administrateur : l'admin voit déjà toutes ces
lignes (politique « Staff can view all reservations » et suivantes), le résultat ne change donc
pas. Tout autre compte reçoit une erreur. RLS reste activé sur toutes les tables ; aucune
politique n'est modifiée. Les calculs sont les mêmes que dans 20261031120000.
*/

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Administrators only (the SQL Editor, connected as postgres, may also run it to measure)
  IF coalesce(public.get_user_role(), '') <> 'admin' AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Tableau de bord réservé à l''administrateur' USING ERRCODE = '42501';
  END IF;

  WITH res AS (
    SELECT r.created_at, r.total_price,
           CASE WHEN r.seat_numbers IS NULL THEN 1 ELSE cardinality(r.seat_numbers) END AS seats
    FROM reservations r
    WHERE r.created_at >= p_start AND r.created_at <= p_end
      AND r.status IS DISTINCT FROM 'annulee' AND r.status IS DISTINCT FROM 'cancelled'
  ),
  sch AS (
    SELECT s.id, s.bus_id, s.route_id
    FROM schedules s
    WHERE s.departure_datetime >= p_start AND s.departure_datetime <= p_end
  ),
  sch_res AS (
    SELECT r.schedule_id, r.total_price,
           CASE WHEN r.seat_numbers IS NULL THEN 1 ELSE cardinality(r.seat_numbers) END AS seats
    FROM reservations r
    JOIN sch ON sch.id = r.schedule_id
    WHERE r.status IS DISTINCT FROM 'annulee' AND r.status IS DISTINCT FROM 'cancelled'
  )
  SELECT jsonb_build_object(
    'reservations', (SELECT count(*) FROM res),
    'tickets_sold', (SELECT coalesce(sum(seats), 0) FROM res),
    'revenue',      (SELECT coalesce(sum(total_price), 0) FROM res),
    'schedules',    (SELECT count(*) FROM sch),
    'payments', (
      SELECT coalesce(sum(p.amount), 0) FROM payments p
      WHERE p.created_at >= p_start AND p.created_at <= p_end
        AND p.status IN ('reussie', 'completed')),
    'expenses', (
      SELECT coalesce(sum(e.amount), 0) FROM bus_expenses e
      WHERE e.expense_date >= (p_start AT TIME ZONE 'UTC')::date
        AND e.expense_date <= (p_end AT TIME ZONE 'UTC')::date),
    'fuel_liters', (
      -- fuel_enlevements has no status column: every recorded withdrawal counts
      SELECT coalesce(sum(f.quantity_liters), 0) FROM fuel_enlevements f
      WHERE f.created_at >= p_start AND f.created_at <= p_end),
    'buses_active', (SELECT count(*) FROM buses b WHERE b.is_active),
    'bus_status', (
      SELECT coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
      FROM (SELECT b.status, count(*) AS n FROM buses b WHERE b.status IS NOT NULL GROUP BY b.status) x),
    'revenue_by_day', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'DD/MM'), 'revenue', d.revenue, 'tickets', d.tickets)
                                ORDER BY d.day), '[]'::jsonb)
      FROM (SELECT (created_at AT TIME ZONE 'UTC')::date AS day, sum(total_price) AS revenue, sum(seats) AS tickets
            FROM res GROUP BY 1) d),
    'revenue_by_company', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'value', c.value) ORDER BY c.value DESC), '[]'::jsonb)
      FROM (SELECT co.name, sum(sr.total_price) AS value
            FROM sch_res sr
            JOIN sch ON sch.id = sr.schedule_id
            JOIN buses b ON b.id = sch.bus_id
            JOIN companies co ON co.id = b.company_id AND co.is_active
            GROUP BY co.id, co.name
            HAVING sum(sr.total_price) > 0) c),
    'revenue_by_route', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', rt.name, 'revenue', rt.revenue, 'tickets', rt.tickets)
                                ORDER BY rt.revenue DESC), '[]'::jsonb)
      FROM (SELECT coalesce(ro.name, 'Inconnu') AS name,
                   coalesce(sum(sr.total_price), 0) AS revenue,
                   coalesce(sum(sr.seats), 0) AS tickets
            FROM sch
            LEFT JOIN routes ro ON ro.id = sch.route_id
            LEFT JOIN sch_res sr ON sr.schedule_id = sch.id
            GROUP BY coalesce(ro.name, 'Inconnu')) rt)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_stats(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats(timestamptz, timestamptz) TO authenticated;
