/*
# Totaux des rapports calculés par la base (tableau de bord admin, rapports Ventes et Financier)

Constat (production, 31/10/2026) : ces écrans téléchargeaient les billets et faisaient les
sommes dans le navigateur. Supabase ne renvoie jamais plus de 1 000 lignes par requête : pour
octobre, ils affichaient 2 526 000 F au lieu de 14 350 500 F (1 000 billets sur 5 650).
Le tableau de bord admin faisait en plus 60 requêtes (3 par compagnie, enchaînées).

Trois fonctions renvoient désormais les totaux calculés par la base, sans limite de lignes :
  - get_admin_dashboard_stats(p_start, p_end)
  - get_sales_report_stats(p_start, p_end, p_company_id, p_route, p_bus_id)
  - get_financial_report_stats(p_start, p_end)

SECURITY INVOKER : les droits (RLS) de l'utilisateur s'appliquent exactement comme pour les
lectures qu'elles remplacent ; chacun ne voit que ce qu'il voyait déjà.

Valeurs de statut : le schéma écrit 'annulee', 'reussie', 'validee', alors que les écrans
filtraient sur 'cancelled', 'completed', 'validated' (billets annulés comptés, paiements et
charges toujours à 0). Les deux orthographes sont acceptées ici.
Carburant : fuel_enlevements n'a pas de colonne status ; l'ancien filtre status = 'valide'
faisait échouer la lecture (0 L affiché). Tous les enlèvements enregistrés sont comptés.
*/

-- ── Tableau de bord admin ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
  );
$$;

-- ── Rapport des ventes ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_report_stats(
  p_start timestamptz,
  p_end timestamptz,
  p_company_id uuid DEFAULT NULL,
  p_route text DEFAULT NULL,
  p_bus_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH res AS (
    SELECT r.schedule_id, r.created_at, r.total_price,
           greatest(coalesce(cardinality(r.seat_numbers), 0), 1) AS seats,
           coalesce(nullif(b.capacity, 0), 50) AS capacity
    FROM reservations r
    LEFT JOIN schedules s ON s.id = r.schedule_id
    LEFT JOIN buses b ON b.id = s.bus_id
    WHERE r.payment_status = 'payee'
      AND r.created_at >= p_start AND r.created_at <= p_end
      AND (p_company_id IS NULL OR b.company_id = p_company_id)
      AND (p_route IS NULL OR position(p_route IN coalesce(s.route_name, '')) > 0)
      AND (p_bus_id IS NULL OR s.bus_id = p_bus_id)
  )
  SELECT jsonb_build_object(
    'tickets', (SELECT count(*) FROM res),
    'gross_revenue', (SELECT coalesce(sum(total_price), 0) FROM res),
    'avg_occupancy', (
      SELECT coalesce(avg(o.rate), 0)
      FROM (SELECT sum(seats)::numeric / max(capacity) * 100 AS rate FROM res GROUP BY schedule_id) o),
    'revenue_by_day', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'revenue', d.revenue) ORDER BY d.day), '[]'::jsonb)
      FROM (SELECT (created_at AT TIME ZONE 'UTC')::date AS day, sum(total_price) AS revenue FROM res GROUP BY 1) d)
  );
$$;

-- ── Rapport financier consolidé ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_financial_report_stats(p_start timestamptz, p_end timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH res AS (
    SELECT r.total_price, b.company_id
    FROM reservations r
    LEFT JOIN schedules s ON s.id = r.schedule_id
    LEFT JOIN buses b ON b.id = s.bus_id
    WHERE r.payment_status = 'payee'
      AND r.created_at >= p_start AND r.created_at <= p_end
  ),
  exp AS (
    SELECT e.amount, b.company_id
    FROM bus_expenses e
    JOIN buses b ON b.id = e.bus_id
    WHERE e.status IN ('validee', 'validated')
      AND e.expense_date >= (p_start AT TIME ZONE 'UTC')::date
      AND e.expense_date <= (p_end AT TIME ZONE 'UTC')::date
  )
  SELECT jsonb_build_object(
    'revenue',  (SELECT coalesce(sum(total_price), 0) FROM res),
    'expenses', (SELECT coalesce(sum(amount), 0) FROM exp),
    'by_company', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', co.id, 'name', co.name,
               'revenue',  coalesce((SELECT sum(total_price) FROM res WHERE res.company_id = co.id), 0),
               'expenses', coalesce((SELECT sum(amount) FROM exp WHERE exp.company_id = co.id), 0))
             ORDER BY co.name), '[]'::jsonb)
      FROM companies co)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_report_stats(timestamptz, timestamptz, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_financial_report_stats(timestamptz, timestamptz) TO authenticated;
