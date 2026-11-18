/*
# Départs partagés : la part de chaque gare dans les rapports, et le partage dans un seul sens

Demande (18/11/2026) : sur un car chargé dans plusieurs gares (« Charger dans une autre gare »),
les rapports donnaient tout le départ à la gare principale. Ce qui est partagé doit être réparti :
« on ne peut attribuer tout à une seule gare ».

1. Gares partenaires cochées par l'administrateur (fiche itinéraire)
   - route_secondary_routes.partner_station_ids : les gares autorisées à recevoir une part des
     départs de l'itinéraire, pour chaque itinéraire secondaire. Pré-rempli avec ce que le guichet
     proposait jusqu'ici (gares des guichets qui ont l'itinéraire secondaire, gare d'origine).
     NULL (ligne ajoutée par une ancienne version de l'écran) : même calcul qu'avant.
   - get_route_secondary_stations() rend les gares cochées.
   - Un seul sens : un itinéraire ne peut pas être l'itinéraire secondaire de son propre
     itinéraire secondaire (seule la gare principale crée le départ et choisit ses partenaires).
     Les liens réciproques déjà enregistrés ne sont pas supprimés ; la requête de contrôle fournie
     avec ce fichier les liste.
   - L'administrateur peut modifier les gares cochées (règle d'accès UPDATE ajoutée, admin seul).

2. Répartition d'un départ partagé (schedules.seat_allocations), mêmes règles que le guichet :
   - tickets : à la gare dont la plage contient le siège (premier siège du ticket) ;
   - bagages : à la gare du ticket lié ; sans ticket, à la gare principale ;
   - ration, carburant et péage : partagés au prorata des places de chaque gare ;
   - dépenses « Autres » : à la gare qui les a saisies ;
   - réservations mobiles, ramassage, panne (part reversée) : à la gare principale ;
   - la gare principale garde le total du départ moins les parts des gares partenaires : la somme
     des parts est toujours égale au total du car.
   Les convois ne sont pas répartis.

3. Rapports, une ligne par gare sur un départ partagé, avec share_role ('principale' ou
   'partenaire'), seat_from et seat_to. Le nombre de départs reste compté une fois par l'écran.
   - get_daf_voyage_report (DAF, DG, administrateur) ;
   - get_gestionnaire_route_departures (gestionnaire) ;
   - get_station_sales_split (nouveau, chef de gare) : les départs de sa gare et les départs
     partagés où sa gare a des places, avec sa part seulement.
   Le type de retour des deux premières fonctions change : elles sont supprimées puis recréées,
   avec les mêmes droits. Les écrans déjà en ligne ignorent les colonnes ajoutées.

Aucune donnée de vente, de dépense ou de bagage n'est modifiée. Fonctions en lecture seule.
*/

-- ─── 1. Gares partenaires et un seul sens ─────────────────────────────────────

ALTER TABLE public.route_secondary_routes ADD COLUMN IF NOT EXISTS partner_station_ids uuid[];

-- Pré-remplissage : ce que le guichet proposait jusqu'ici
UPDATE public.route_secondary_routes rsr
SET partner_station_ids = coalesce((
  SELECT array_agg(DISTINCT x.station_id ORDER BY x.station_id)
  FROM (
    SELECT c.station_id
    FROM counter_routes cr
    JOIN counters c ON c.id = cr.counter_id
    WHERE cr.route_id = rsr.secondary_route_id
      AND c.station_id IS NOT NULL
      AND coalesce(c.is_active, true)
    UNION
    SELECT r.origin_station_id
    FROM routes r
    WHERE r.id = rsr.secondary_route_id
      AND r.origin_station_id IS NOT NULL
  ) x
  JOIN stations st ON st.id = x.station_id AND coalesce(st.is_active, true)
), '{}')
WHERE rsr.partner_station_ids IS NULL;

DROP POLICY IF EXISTS "route_secondary_routes_admin_update" ON public.route_secondary_routes;
CREATE POLICY "route_secondary_routes_admin_update"
  ON public.route_secondary_routes FOR UPDATE
  TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.route_secondary_routes_one_way()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_main text;
  v_secondary text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM route_secondary_routes x
    WHERE x.route_id = NEW.secondary_route_id AND x.secondary_route_id = NEW.route_id
  ) THEN
    SELECT name INTO v_main FROM routes WHERE id = NEW.route_id;
    SELECT name INTO v_secondary FROM routes WHERE id = NEW.secondary_route_id;
    RAISE EXCEPTION 'Partage dans un seul sens : « % » a déjà « % » comme itinéraire secondaire',
      coalesce(v_secondary, '?'), coalesce(v_main, '?')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_route_secondary_routes_one_way ON public.route_secondary_routes;
CREATE TRIGGER trg_route_secondary_routes_one_way
  BEFORE INSERT OR UPDATE OF route_id, secondary_route_id ON public.route_secondary_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.route_secondary_routes_one_way();

DROP FUNCTION IF EXISTS public.get_route_secondary_stations();

CREATE FUNCTION public.get_route_secondary_stations()
RETURNS TABLE (route_id uuid, station_id uuid, secondary_route_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT rsr.route_id, x.station_id, rsr.secondary_route_id
  FROM route_secondary_routes rsr
  CROSS JOIN LATERAL (
    -- Gares cochées par l'administrateur
    SELECT unnest(rsr.partner_station_ids) AS station_id
    WHERE rsr.partner_station_ids IS NOT NULL
    UNION
    -- Ligne sans choix enregistré : le calcul d'avant
    SELECT c.station_id
    FROM counter_routes cr
    JOIN counters c ON c.id = cr.counter_id
    WHERE rsr.partner_station_ids IS NULL
      AND cr.route_id = rsr.secondary_route_id
      AND c.station_id IS NOT NULL
      AND coalesce(c.is_active, true)
    UNION
    SELECT r.origin_station_id
    FROM routes r
    WHERE rsr.partner_station_ids IS NULL
      AND r.id = rsr.secondary_route_id
      AND r.origin_station_id IS NOT NULL
  ) x
  JOIN stations st ON st.id = x.station_id AND coalesce(st.is_active, true);
$$;

REVOKE ALL ON FUNCTION public.get_route_secondary_stations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_route_secondary_stations() TO authenticated;

-- ─── 2. Part de chaque gare sur un départ partagé ─────────────────────────────
-- Une ligne par gare du départ (la gare principale comprise, pour sa plage de sièges). Les
-- montants des gares partenaires sont ceux de leur part ; les rapports donnent à la gare
-- principale le total du départ moins ces parts. Fonction interne : appelée par les rapports
-- ci-dessous, pas par les écrans.

CREATE OR REPLACE FUNCTION public.schedule_station_shares(p_schedule_ids uuid[])
RETURNS TABLE (
  schedule_id    uuid,
  station_id     uuid,
  share_role     text,
  seat_from      integer,
  seat_to        integer,
  seats_alloc    integer,
  counter_id     uuid,
  seats_sold     integer,
  tickets_amount numeric,
  baggage_count  integer,
  baggage_amount numeric,
  exp_ration     numeric,
  exp_carburant  numeric,
  exp_peage      numeric,
  exp_autres     numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH s AS (
    SELECT sc.id AS sid, sc.departure_station_id AS main_id, sc.seat_allocations AS al
    FROM schedules sc
    WHERE sc.id = ANY (p_schedule_ids)
      AND coalesce(sc.status, '') <> 'convoi'
      AND sc.departure_station_id IS NOT NULL
      AND jsonb_typeof(sc.seat_allocations) = 'array'
      AND cardinality(sc.shared_station_ids) > 0
  ),
  -- Each seat range of the departure
  rg AS (
    SELECT s.sid, (a->>'station_id')::uuid AS st, (a->>'seat_from')::int AS f, (a->>'seat_to')::int AS t
    FROM s, jsonb_array_elements(s.al) a
    WHERE a->>'station_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND a->>'seat_from' ~ '^[0-9]+$' AND a->>'seat_to' ~ '^[0-9]+$'
      AND (a->>'seat_to')::int >= (a->>'seat_from')::int
  ),
  -- Each station of the departure with its seats. A main station without its own range (every
  -- seat given away) keeps the seats before the first range.
  stn AS (
    SELECT rg.sid, rg.st, min(rg.f) AS f, max(rg.t) AS t, sum(rg.t - rg.f + 1)::int AS n
    FROM rg GROUP BY rg.sid, rg.st
    UNION ALL
    SELECT s.sid, s.main_id, 1, m.first_seat - 1, greatest(m.first_seat - 1, 0)
    FROM s
    CROSS JOIN LATERAL (SELECT min(rg.f) AS first_seat FROM rg WHERE rg.sid = s.sid) m
    WHERE NOT EXISTS (SELECT 1 FROM rg WHERE rg.sid = s.sid AND rg.st = s.main_id)
  ),
  tot AS (SELECT stn.sid, sum(stn.n) AS n FROM stn GROUP BY stn.sid),
  -- Tickets of the departure (same as the DAF report), at the station of their first seat
  tk AS (
    SELECT r.id AS rid, r.schedule_id AS sid, r.booked_by,
           coalesce(nullif(r.total_seats, 0), cardinality(r.seat_numbers), 1)::int AS seats,
           coalesce(r.total_price, 0)::numeric AS amount,
           (SELECT trim(x::text)::int FROM unnest(r.seat_numbers) x
             WHERE trim(x::text) ~ '^[0-9]{1,6}$' LIMIT 1) AS seat
    FROM reservations r
    WHERE r.schedule_id IN (SELECT s.sid FROM s)
      AND coalesce(r.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
      AND (r.status IN ('confirmee', 'utilisee', 'confirmed', 'paid')
           OR r.payment_status IN ('payee', 'paid'))
  ),
  tks AS (
    SELECT tk.*, coalesce(
             (SELECT rg.st FROM rg WHERE rg.sid = tk.sid AND tk.seat BETWEEN rg.f AND rg.t LIMIT 1),
             s.main_id) AS st
    FROM tk JOIN s ON s.sid = tk.sid
  ),
  -- Paid baggage: station of the linked ticket, otherwise the main station
  bg AS (
    SELECT b.schedule_id AS sid, coalesce(tks.st, s.main_id) AS st, coalesce(b.price, 0)::numeric AS price
    FROM baggage_tickets b
    JOIN s ON s.sid = b.schedule_id
    LEFT JOIN tks ON tks.rid = b.reservation_id
    WHERE coalesce(b.payment_status, '') <> 'en_attente'
  ),
  cc AS (
    SELECT c.schedule_id AS sid, c.station_id AS cst, c.charge_type, coalesce(c.amount, 0)::numeric AS amount
    FROM counter_charges c
    WHERE c.schedule_id IN (SELECT s.sid FROM s) AND coalesce(c.status, '') <> 'rejete'
  ),
  bus_exp AS (
    SELECT cc.sid,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type = 'ration'), 0) AS ration,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type IN ('carburant_complement', 'carburant')), 0) AS carburant,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type = 'peage'), 0) AS peage
    FROM cc GROUP BY cc.sid
  )
  SELECT
    stn.sid,
    stn.st,
    (CASE WHEN stn.st = s.main_id THEN 'principale' ELSE 'partenaire' END)::text,
    stn.f::integer,
    stn.t::integer,
    stn.n::integer,
    (CASE WHEN stn.st = s.main_id THEN NULL ELSE coalesce(
      (SELECT c.counter_id FROM counter_charges c
        WHERE c.schedule_id = stn.sid AND c.station_id = stn.st AND c.counter_id IS NOT NULL
        GROUP BY c.counter_id ORDER BY count(*) DESC LIMIT 1),
      (SELECT b.counter_id FROM baggage_tickets b
        WHERE b.schedule_id = stn.sid AND b.station_id = stn.st AND b.counter_id IS NOT NULL
        GROUP BY b.counter_id ORDER BY count(*) DESC LIMIT 1),
      (SELECT co.id FROM tks JOIN counters co ON co.assigned_user_id = tks.booked_by AND co.station_id = stn.st
        WHERE tks.sid = stn.sid AND tks.st = stn.st
        GROUP BY co.id ORDER BY count(*) DESC LIMIT 1)) END)::uuid,
    coalesce((SELECT sum(tks.seats) FROM tks WHERE tks.sid = stn.sid AND tks.st = stn.st), 0)::integer,
    coalesce((SELECT sum(tks.amount) FROM tks WHERE tks.sid = stn.sid AND tks.st = stn.st), 0)::numeric,
    (SELECT count(*) FROM bg WHERE bg.sid = stn.sid AND bg.st = stn.st)::integer,
    coalesce((SELECT sum(bg.price) FROM bg WHERE bg.sid = stn.sid AND bg.st = stn.st), 0)::numeric,
    (CASE WHEN tot.n > 0 THEN round(coalesce(be.ration, 0) * stn.n / tot.n) ELSE 0 END)::numeric,
    (CASE WHEN tot.n > 0 THEN round(coalesce(be.carburant, 0) * stn.n / tot.n) ELSE 0 END)::numeric,
    (CASE WHEN tot.n > 0 THEN round(coalesce(be.peage, 0) * stn.n / tot.n) ELSE 0 END)::numeric,
    coalesce((SELECT sum(cc.amount) FROM cc
      WHERE cc.sid = stn.sid
        AND cc.charge_type NOT IN ('ration', 'carburant_complement', 'carburant', 'peage')
        AND (CASE WHEN EXISTS (SELECT 1 FROM stn x WHERE x.sid = cc.sid AND x.st = cc.cst)
                  THEN cc.cst ELSE s.main_id END) = stn.st), 0)::numeric
  FROM stn
  JOIN s ON s.sid = stn.sid
  JOIN tot ON tot.sid = stn.sid
  LEFT JOIN bus_exp be ON be.sid = stn.sid;
$$;

REVOKE ALL ON FUNCTION public.schedule_station_shares(uuid[]) FROM PUBLIC, anon, authenticated;

-- ─── 3a. Rapport voyage DAF / DG ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_daf_voyage_report(date, date);

CREATE FUNCTION public.get_daf_voyage_report(p_from date, p_to date)
RETURNS TABLE (
  schedule_id          uuid,
  departure_datetime   timestamptz,
  departure_number     integer,
  status               text,
  route_id             uuid,
  route_name           text,
  station_id           uuid,
  station_name         text,
  arrival_station_name text,
  counter_id           uuid,
  counter_number       text,
  bus_id               uuid,
  bus_registration     text,
  company_id           uuid,
  company_name         text,
  capacity             integer,
  seats_sold           integer,
  tickets_amount       numeric,
  baggage_count        integer,
  baggage_amount       numeric,
  ramassage_amount     numeric,
  exp_ration           numeric,
  exp_carburant        numeric,
  exp_peage            numeric,
  exp_autres           numeric,
  share_role           text,
  seat_from            integer,
  seat_to              integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT (public.is_daf_user() OR coalesce(public.get_user_role(), '') IN ('daf', 'dg', 'admin')
          OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Rapport réservé au DAF, au DG et à l''administrateur' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH s AS (
    SELECT sc.*
    FROM schedules sc
    WHERE sc.departure_datetime::date BETWEEN p_from AND p_to
  ),
  res AS (
    SELECT r.schedule_id AS sid,
           sum(coalesce(nullif(r.total_seats, 0), cardinality(r.seat_numbers), 1))::integer AS seats,
           coalesce(sum(r.total_price), 0)::numeric AS amount
    FROM reservations r
    WHERE r.schedule_id IN (SELECT s.id FROM s)
      AND coalesce(r.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
      AND (r.status IN ('confirmee', 'utilisee', 'confirmed', 'paid')
           OR r.payment_status IN ('payee', 'paid'))
    GROUP BY r.schedule_id
  ),
  mob AS (
    SELECT m.schedule_id AS sid,
           coalesce(sum(m.seats_count), 0)::integer AS seats,
           coalesce(sum(m.unit_price * m.seats_count), 0)::numeric AS amount
    FROM mobile_bookings m
    WHERE m.schedule_id IN (SELECT s.id FROM s) AND m.status = 'confirmed'
    GROUP BY m.schedule_id
  ),
  bag AS (
    SELECT b.schedule_id AS sid, count(*)::integer AS n, coalesce(sum(b.price), 0)::numeric AS amount
    FROM baggage_tickets b
    WHERE b.schedule_id IN (SELECT s.id FROM s)
    GROUP BY b.schedule_id
  ),
  ram AS (
    SELECT rc.schedule_id AS sid, coalesce(sum(rc.amount), 0)::numeric AS amount
    FROM ramassage_collections rc
    WHERE rc.schedule_id IN (SELECT s.id FROM s)
    GROUP BY rc.schedule_id
  ),
  chg AS (
    SELECT cc.schedule_id AS sid,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type = 'ration'), 0)::numeric AS ration,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type IN ('carburant_complement', 'carburant')), 0)::numeric AS carburant,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type = 'peage'), 0)::numeric AS peage,
           coalesce(sum(cc.amount) FILTER (WHERE cc.charge_type NOT IN ('ration', 'carburant_complement', 'carburant', 'peage')), 0)::numeric AS autres
    FROM counter_charges cc
    WHERE cc.schedule_id IN (SELECT s.id FROM s) AND coalesce(cc.status, '') <> 'rejete'
    GROUP BY cc.schedule_id
  ),
  -- One row per departure, as before
  b AS (
    SELECT
      s.id AS b_id,
      s.departure_datetime::timestamptz AS b_dt,
      s.departure_number::integer AS b_no,
      s.status::text AS b_status,
      s.route_id AS b_route_id,
      coalesce(ro.name, s.route_name)::text AS b_route,
      s.departure_station_id AS b_station_id,
      st.name::text AS b_station,
      sa.name::text AS b_arrival,
      s.counter_id AS b_counter_id,
      co.counter_number::text AS b_counter,
      s.bus_id AS b_bus_id,
      bu.registration_number::text AS b_bus,
      bu.company_id AS b_company_id,
      cp.name::text AS b_company,
      coalesce(nullif(s.seats_total, 0), nullif(bu.total_seats, 0), 0)::integer AS b_capacity,
      (coalesce(res.seats, 0) + coalesce(mob.seats, 0))::integer AS b_seats,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.amount, 0)
            ELSE coalesce(res.amount, 0) + coalesce(mob.amount, 0) END)::numeric AS b_tickets,
      coalesce(bag.n, 0)::integer AS b_bag_n,
      coalesce(bag.amount, 0)::numeric AS b_bag,
      coalesce(ram.amount, 0)::numeric AS b_ram,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.ratio_amount, 0)     ELSE coalesce(chg.ration, 0) END)::numeric AS b_ration,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.carburant_amount, 0) ELSE coalesce(chg.carburant, 0) END)::numeric AS b_carburant,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.peage_amount, 0)     ELSE coalesce(chg.peage, 0) END)::numeric AS b_peage,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.autres_amount, 0)    ELSE coalesce(chg.autres, 0) END)::numeric AS b_autres
    FROM s
    LEFT JOIN routes ro    ON ro.id = s.route_id
    LEFT JOIN stations st  ON st.id = s.departure_station_id
    LEFT JOIN stations sa  ON sa.id = s.arrival_station_id
    LEFT JOIN counters co  ON co.id = s.counter_id
    LEFT JOIN buses bu     ON bu.id = s.bus_id
    LEFT JOIN companies cp ON cp.id = bu.company_id
    LEFT JOIN res ON res.sid = s.id
    LEFT JOIN mob ON mob.sid = s.id
    LEFT JOIN bag ON bag.sid = s.id
    LEFT JOIN ram ON ram.sid = s.id
    LEFT JOIN chg ON chg.sid = s.id
    LEFT JOIN convoys cv   ON cv.schedule_id = s.id   -- one convoy per departure at most (unique)
  ),
  sh AS (
    SELECT x.* FROM public.schedule_station_shares(
      ARRAY(SELECT s.id FROM s WHERE cardinality(s.shared_station_ids) > 0)) x
  ),
  -- What the partner stations take from each shared departure
  ps AS (
    SELECT sh.schedule_id AS p_id, sum(sh.seats_alloc) AS p_n, sum(sh.seats_sold) AS p_seats,
           sum(sh.tickets_amount) AS p_tickets, sum(sh.baggage_count) AS p_bag_n, sum(sh.baggage_amount) AS p_bag,
           sum(sh.exp_ration) AS p_ration, sum(sh.exp_carburant) AS p_carburant,
           sum(sh.exp_peage) AS p_peage, sum(sh.exp_autres) AS p_autres
    FROM sh WHERE sh.share_role = 'partenaire' GROUP BY sh.schedule_id
  ),
  rows_out AS (
    -- The departure, at its station: the whole departure, or what the partners leave it
    SELECT b.b_id, b.b_dt, b.b_no, b.b_status, b.b_route_id, b.b_route, b.b_station_id, b.b_station,
           b.b_arrival, b.b_counter_id, b.b_counter, b.b_bus_id, b.b_bus, b.b_company_id, b.b_company,
           greatest(b.b_capacity - coalesce(ps.p_n, 0), 0)::integer AS capacity_o,
           (b.b_seats - coalesce(ps.p_seats, 0))::integer AS seats_o,
           (b.b_tickets - coalesce(ps.p_tickets, 0))::numeric AS tickets_o,
           (b.b_bag_n - coalesce(ps.p_bag_n, 0))::integer AS bag_n_o,
           (b.b_bag - coalesce(ps.p_bag, 0))::numeric AS bag_o,
           b.b_ram AS ram_o,
           (b.b_ration - coalesce(ps.p_ration, 0))::numeric AS ration_o,
           (b.b_carburant - coalesce(ps.p_carburant, 0))::numeric AS carburant_o,
           (b.b_peage - coalesce(ps.p_peage, 0))::numeric AS peage_o,
           (b.b_autres - coalesce(ps.p_autres, 0))::numeric AS autres_o,
           (CASE WHEN ps.p_id IS NOT NULL THEN 'principale' END)::text AS role_o,
           (CASE WHEN ps.p_id IS NOT NULL THEN mn.seat_from END)::integer AS from_o,
           (CASE WHEN ps.p_id IS NOT NULL THEN mn.seat_to END)::integer AS to_o,
           0 AS ord
    FROM b
    LEFT JOIN ps ON ps.p_id = b.b_id
    LEFT JOIN sh mn ON mn.schedule_id = b.b_id AND mn.share_role = 'principale'
    UNION ALL
    -- The share of each partner station
    SELECT b.b_id, b.b_dt, b.b_no, b.b_status, b.b_route_id, b.b_route, sh.station_id, pst.name::text,
           b.b_arrival, sh.counter_id, pco.counter_number::text, b.b_bus_id, b.b_bus, b.b_company_id, b.b_company,
           sh.seats_alloc, sh.seats_sold, sh.tickets_amount, sh.baggage_count, sh.baggage_amount, 0::numeric,
           sh.exp_ration, sh.exp_carburant, sh.exp_peage, sh.exp_autres,
           'partenaire'::text, sh.seat_from, sh.seat_to, 1
    FROM sh
    JOIN b ON b.b_id = sh.schedule_id
    LEFT JOIN stations pst ON pst.id = sh.station_id
    LEFT JOIN counters pco ON pco.id = sh.counter_id
    WHERE sh.share_role = 'partenaire'
  )
  SELECT o.b_id, o.b_dt, o.b_no, o.b_status, o.b_route_id, o.b_route, o.b_station_id, o.b_station,
         o.b_arrival, o.b_counter_id, o.b_counter, o.b_bus_id, o.b_bus, o.b_company_id, o.b_company,
         o.capacity_o, o.seats_o, o.tickets_o, o.bag_n_o, o.bag_o, o.ram_o,
         o.ration_o, o.carburant_o, o.peage_o, o.autres_o, o.role_o, o.from_o, o.to_o
  FROM rows_out o
  -- A fixed order: the pages of a long period neither repeat nor skip a row
  ORDER BY o.b_dt DESC, o.b_id, o.ord, o.b_station_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daf_voyage_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daf_voyage_report(date, date) TO authenticated;

-- ─── 3b. Détail des départs du gestionnaire ───────────────────────────────────

DROP FUNCTION IF EXISTS public.get_gestionnaire_route_departures(uuid, date, date);

CREATE FUNCTION public.get_gestionnaire_route_departures(p_route_id uuid, p_from date, p_to date)
RETURNS TABLE (
  schedule_id          uuid,
  is_departure         boolean,
  departure_datetime   timestamptz,
  departure_number     integer,
  status               text,
  route_id             uuid,
  route_name           text,
  station_id           uuid,
  station_name         text,
  counter_id           uuid,
  counter_number       text,
  bus_registration     text,
  company_name         text,
  capacity             integer,
  seats_sold           integer,
  tickets_amount       numeric,
  baggage_count        integer,
  baggage_amount       numeric,
  ramassage_amount     numeric,
  recette              numeric,
  transferred_amount   numeric,
  exp_ration           numeric,
  exp_carburant        numeric,
  exp_peage            numeric,
  exp_autres           numeric,
  share_role           text,
  seat_from            integer,
  seat_to              integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_company_id uuid;
BEGIN
  IF coalesce(public.get_user_role(), '') <> 'gestionnaire' THEN
    RAISE EXCEPTION 'Détail réservé au gestionnaire' USING ERRCODE = '42501';
  END IF;
  v_company_id := public.get_gestionnaire_company_id();
  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH scr AS (
    SELECT x.* FROM public.schedule_company_revenue(p_from, p_to) x
    WHERE x.company_id = v_company_id
      AND (p_route_id IS NULL OR x.route_id = p_route_id)
  ),
  scc AS (
    SELECT c.schedule_id AS sid, c.is_beneficiary AS benef,
           sum(c.cc_ration) AS ration, sum(c.cc_carburant) AS carburant,
           sum(c.cc_peage) AS peage, sum(c.cc_autres) AS autres
    FROM public.schedule_company_charges(p_from, p_to) c
    WHERE c.company_id = v_company_id
    GROUP BY c.schedule_id, c.is_beneficiary
  ),
  -- Same reservations as the report: confirmed or used
  res AS (
    SELECT r.schedule_id AS sid,
           sum(coalesce(nullif(r.total_seats, 0), cardinality(r.seat_numbers), 1))::integer AS seats,
           coalesce(sum(r.total_price), 0)::numeric AS amount
    FROM reservations r
    WHERE r.schedule_id IN (SELECT scr.schedule_id FROM scr) AND r.status IN ('confirmee', 'utilisee')
    GROUP BY r.schedule_id
  ),
  mob AS (
    SELECT m.schedule_id AS sid,
           coalesce(sum(m.seats_count), 0)::integer AS seats,
           coalesce(sum(m.unit_price * m.seats_count), 0)::numeric AS amount
    FROM mobile_bookings m
    WHERE m.schedule_id IN (SELECT scr.schedule_id FROM scr) AND m.status = 'confirmed'
    GROUP BY m.schedule_id
  ),
  -- Paid baggage, as on the counter's receipts slip (baggage waiting for payment left out)
  bag AS (
    SELECT b.schedule_id AS sid, count(*)::integer AS n, coalesce(sum(b.price), 0)::numeric AS amount
    FROM baggage_tickets b
    WHERE b.schedule_id IN (SELECT scr.schedule_id FROM scr)
      AND coalesce(b.payment_status, '') <> 'en_attente'
    GROUP BY b.schedule_id
  ),
  ram AS (
    SELECT rc.schedule_id AS sid, coalesce(sum(rc.amount), 0)::numeric AS amount
    FROM ramassage_collections rc
    WHERE rc.schedule_id IN (SELECT scr.schedule_id FROM scr)
    GROUP BY rc.schedule_id
  ),
  -- One row per departure (or per bus of a breakdown), as before
  b AS (
    SELECT
      scr.schedule_id AS b_id,
      (s.id IS NOT NULL) AS b_is_dep,
      coalesce(s.departure_datetime, dr.departure_datetime, scr.schedule_date::timestamptz) AS b_dt,
      coalesce(s.route_number, s.departure_number)::integer AS b_no,
      (CASE WHEN s.id IS NULL THEN 'ramassage_direct' ELSE s.status END)::text AS b_status,
      scr.route_id AS b_route_id,
      coalesce(ro.name, s.route_name, 'Ligne inconnue')::text AS b_route,
      scr.station_id AS b_station_id,
      coalesce(st.name, 'Gare inconnue')::text AS b_station,
      s.counter_id AS b_counter_id,
      co.counter_number::text AS b_counter,
      bu.registration_number::text AS b_bus,
      cp.name::text AS b_company,
      (CASE WHEN s.id IS NULL THEN 0
            ELSE coalesce(nullif(s.seats_total, 0), nullif(bu.total_seats, 0), 0) END)::integer AS b_capacity,
      (coalesce(res.seats, 0) + coalesce(mob.seats, 0))::integer AS b_seats,
      (CASE WHEN s.status = 'convoi' THEN coalesce(cv.amount, 0)
            ELSE coalesce(res.amount, 0) + coalesce(mob.amount, 0) END)::numeric AS b_tickets,
      coalesce(bag.n, 0)::integer AS b_bag_n,
      coalesce(bag.amount, 0)::numeric AS b_bag,
      (CASE WHEN s.id IS NULL THEN coalesce(scr.revenue, 0) ELSE coalesce(ram.amount, 0) END)::numeric AS b_ram,
      scr.revenue::numeric AS b_recette,
      coalesce(scr.transferred_amount, 0)::numeric AS b_transferred,
      coalesce(scc.ration, 0)::numeric AS b_ration,
      coalesce(scc.carburant, 0)::numeric AS b_carburant,
      coalesce(scc.peage, 0)::numeric AS b_peage,
      coalesce(scc.autres, 0)::numeric AS b_autres,
      -- Shared between stations: a departure of the company's own bus (not a breakdown share)
      (s.id IS NOT NULL AND coalesce(s.status, '') <> 'convoi' AND NOT coalesce(scr.is_beneficiary, false)
        AND cardinality(s.shared_station_ids) > 0) AS b_shareable
    FROM scr
    LEFT JOIN schedules s  ON s.id = scr.schedule_id
    LEFT JOIN routes ro    ON ro.id = scr.route_id
    LEFT JOIN stations st  ON st.id = scr.station_id
    LEFT JOIN counters co  ON co.id = s.counter_id
    LEFT JOIN buses bu     ON bu.id = scr.bus_id
    LEFT JOIN companies cp ON cp.id = scr.company_id
    LEFT JOIN res ON res.sid = scr.schedule_id
    LEFT JOIN mob ON mob.sid = scr.schedule_id
    LEFT JOIN bag ON bag.sid = scr.schedule_id
    LEFT JOIN ram ON ram.sid = scr.schedule_id
    LEFT JOIN scc ON scc.sid = scr.schedule_id AND scc.benef = scr.is_beneficiary
    LEFT JOIN convoys cv   ON cv.schedule_id = scr.schedule_id
    -- Direct ramassage: the report row id is the collection id; its time comes from the notification
    LEFT JOIN LATERAL (
      SELECT coalesce(rn.departure_datetime, rn.collected_at, rn.created_at, rc.created_at) AS departure_datetime
      FROM ramassage_collections rc
      LEFT JOIN ramassage_notifications rn ON rn.local_depart_id = rc.local_depart_id
      WHERE s.id IS NULL AND rc.id = scr.schedule_id
      LIMIT 1
    ) dr ON true
  ),
  sh AS (
    SELECT x.* FROM public.schedule_station_shares(ARRAY(SELECT b.b_id FROM b WHERE b.b_shareable)) x
  ),
  ps AS (
    SELECT sh.schedule_id AS p_id, sum(sh.seats_alloc) AS p_n, sum(sh.seats_sold) AS p_seats,
           sum(sh.tickets_amount) AS p_tickets, sum(sh.baggage_count) AS p_bag_n, sum(sh.baggage_amount) AS p_bag,
           sum(sh.exp_ration) AS p_ration, sum(sh.exp_carburant) AS p_carburant,
           sum(sh.exp_peage) AS p_peage, sum(sh.exp_autres) AS p_autres
    FROM sh WHERE sh.share_role = 'partenaire' GROUP BY sh.schedule_id
  ),
  rows_out AS (
    SELECT b.b_id, b.b_is_dep, b.b_dt, b.b_no, b.b_status, b.b_route_id, b.b_route, b.b_station_id, b.b_station,
           b.b_counter_id, b.b_counter, b.b_bus, b.b_company,
           (CASE WHEN b.b_shareable AND ps.p_id IS NOT NULL
                 THEN greatest(b.b_capacity - ps.p_n, 0) ELSE b.b_capacity END)::integer AS capacity_o,
           (b.b_seats - CASE WHEN b.b_shareable THEN coalesce(ps.p_seats, 0) ELSE 0 END)::integer AS seats_o,
           (b.b_tickets - CASE WHEN b.b_shareable THEN coalesce(ps.p_tickets, 0) ELSE 0 END)::numeric AS tickets_o,
           (b.b_bag_n - CASE WHEN b.b_shareable THEN coalesce(ps.p_bag_n, 0) ELSE 0 END)::integer AS bag_n_o,
           (b.b_bag - CASE WHEN b.b_shareable THEN coalesce(ps.p_bag, 0) ELSE 0 END)::numeric AS bag_o,
           b.b_ram AS ram_o,
           (b.b_recette - CASE WHEN b.b_shareable THEN coalesce(ps.p_tickets, 0) ELSE 0 END)::numeric AS recette_o,
           b.b_transferred AS transferred_o,
           (b.b_ration - CASE WHEN b.b_shareable THEN coalesce(ps.p_ration, 0) ELSE 0 END)::numeric AS ration_o,
           (b.b_carburant - CASE WHEN b.b_shareable THEN coalesce(ps.p_carburant, 0) ELSE 0 END)::numeric AS carburant_o,
           (b.b_peage - CASE WHEN b.b_shareable THEN coalesce(ps.p_peage, 0) ELSE 0 END)::numeric AS peage_o,
           (b.b_autres - CASE WHEN b.b_shareable THEN coalesce(ps.p_autres, 0) ELSE 0 END)::numeric AS autres_o,
           (CASE WHEN b.b_shareable AND ps.p_id IS NOT NULL THEN 'principale' END)::text AS role_o,
           (CASE WHEN b.b_shareable AND ps.p_id IS NOT NULL THEN mn.seat_from END)::integer AS from_o,
           (CASE WHEN b.b_shareable AND ps.p_id IS NOT NULL THEN mn.seat_to END)::integer AS to_o
    FROM b
    LEFT JOIN ps ON ps.p_id = b.b_id
    LEFT JOIN sh mn ON mn.schedule_id = b.b_id AND mn.share_role = 'principale'
    UNION ALL
    SELECT b.b_id, b.b_is_dep, b.b_dt, b.b_no, b.b_status, b.b_route_id, b.b_route, sh.station_id,
           coalesce(pst.name, 'Gare inconnue')::text, sh.counter_id, pco.counter_number::text, b.b_bus, b.b_company,
           sh.seats_alloc, sh.seats_sold, sh.tickets_amount, sh.baggage_count, sh.baggage_amount, 0::numeric,
           sh.tickets_amount, 0::numeric,
           sh.exp_ration, sh.exp_carburant, sh.exp_peage, sh.exp_autres,
           'partenaire'::text, sh.seat_from, sh.seat_to
    FROM sh
    JOIN b ON b.b_id = sh.schedule_id AND b.b_shareable
    LEFT JOIN stations pst ON pst.id = sh.station_id
    LEFT JOIN counters pco ON pco.id = sh.counter_id
    WHERE sh.share_role = 'partenaire'
  )
  SELECT o.b_id, o.b_is_dep, o.b_dt, o.b_no, o.b_status, o.b_route_id, o.b_route, o.b_station_id, o.b_station,
         o.b_counter_id, o.b_counter, o.b_bus, o.b_company, o.capacity_o, o.seats_o, o.tickets_o,
         o.bag_n_o, o.bag_o, o.ram_o, o.recette_o, o.transferred_o,
         o.ration_o, o.carburant_o, o.peage_o, o.autres_o, o.role_o, o.from_o, o.to_o
  FROM rows_out o
  -- date, gare, N°, then the departure itself: a fixed order, so that the pages of a long period
  -- (the API sends about 1 000 rows per request) neither repeat nor skip a row
  ORDER BY o.b_dt, o.b_station, o.b_no, o.b_id, o.role_o NULLS FIRST, o.b_station_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gestionnaire_route_departures(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gestionnaire_route_departures(uuid, date, date) TO authenticated;

-- ─── 3c. Suivi des ventes du chef de gare ─────────────────────────────────────
-- Les lignes de schedule_receipt_summary de sa gare, comme l'écran les lisait ; sur un départ
-- partagé, la part de sa gare seulement, et les départs d'une autre gare où sa gare a des places.

CREATE OR REPLACE FUNCTION public.get_station_sales_split(p_from date, p_to date)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_station uuid;
BEGIN
  IF coalesce(public.get_user_role(), '') NOT IN ('chef_gare', 'admin') THEN
    RAISE EXCEPTION 'Suivi réservé au chef de gare' USING ERRCODE = '42501';
  END IF;
  v_station := public.get_my_station_id();
  IF v_station IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH v AS (
    SELECT srs.*
    FROM schedule_receipt_summary srs
    WHERE srs.departure_date BETWEEN p_from AND p_to
      AND (srs.station_id = v_station
           OR srs.schedule_id IN (SELECT sc.id FROM schedules sc
                                  WHERE v_station = ANY (sc.shared_station_ids)
                                    AND sc.departure_datetime::date BETWEEN p_from - 1 AND p_to + 1))
  ),
  sh AS (
    SELECT x.* FROM public.schedule_station_shares(ARRAY(SELECT v.schedule_id FROM v)) x
  ),
  ps AS (
    SELECT sh.schedule_id AS p_id, sum(sh.seats_alloc) AS p_n, sum(sh.seats_sold) AS p_seats,
           sum(sh.tickets_amount) AS p_tickets, sum(sh.baggage_amount) AS p_bag,
           sum(sh.exp_ration) AS p_ration, sum(sh.exp_carburant) AS p_carburant,
           sum(sh.exp_peage) AS p_peage, sum(sh.exp_autres) AS p_autres
    FROM sh WHERE sh.share_role = 'partenaire' GROUP BY sh.schedule_id
  ),
  others AS (
    SELECT sh.schedule_id AS o_id, string_agg(DISTINCT st.name, ', ') AS names
    FROM sh JOIN stations st ON st.id = sh.station_id
    WHERE sh.station_id <> v_station
    GROUP BY sh.schedule_id
  )
  -- Departures of the station: whole, or what the partner stations leave it
  SELECT CASE WHEN ps.p_id IS NULL THEN to_jsonb(v)
    ELSE to_jsonb(v) || jsonb_build_object(
      'capacity', greatest(v.capacity - ps.p_n, 0),
      'seats_sold', v.seats_sold - ps.p_seats,
      'seats_remaining', greatest(v.capacity - ps.p_n, 0) - (v.seats_sold - ps.p_seats),
      'total_ticket_amount', v.total_ticket_amount - ps.p_tickets,
      'total_baggage', v.total_baggage - ps.p_bag,
      'total_rations', v.total_rations - ps.p_ration,
      'total_carburant', v.total_carburant - ps.p_carburant,
      'total_peages', v.total_peages - ps.p_peage,
      'total_autres', v.total_autres - ps.p_autres,
      'total_charges', v.total_charges - (ps.p_ration + ps.p_carburant + ps.p_peage + ps.p_autres),
      'solde_ticket', v.solde_ticket - ps.p_tickets + (ps.p_ration + ps.p_carburant + ps.p_peage + ps.p_autres),
      'share_role', 'principale', 'seat_from', mn.seat_from, 'seat_to', mn.seat_to,
      'share_with', ot.names) END
  FROM v
  LEFT JOIN ps ON ps.p_id = v.schedule_id
  LEFT JOIN sh mn ON mn.schedule_id = v.schedule_id AND mn.share_role = 'principale'
  LEFT JOIN others ot ON ot.o_id = v.schedule_id
  WHERE v.station_id = v_station
  UNION ALL
  -- Departures of another station where this station has seats: its share only
  SELECT to_jsonb(v) || jsonb_build_object(
      'station_id', v_station,
      'counter_id', sh.counter_id,
      'counter_number', co.counter_number,
      'capacity', sh.seats_alloc,
      'seats_sold', sh.seats_sold,
      'seats_remaining', sh.seats_alloc - sh.seats_sold,
      'total_ticket_amount', sh.tickets_amount,
      'total_baggage', sh.baggage_amount,
      'total_rations', sh.exp_ration,
      'total_carburant', sh.exp_carburant,
      'total_peages', sh.exp_peage,
      'total_autres', sh.exp_autres,
      'total_charges', sh.exp_ration + sh.exp_carburant + sh.exp_peage + sh.exp_autres,
      'ramassage_amount', 0,
      'breakdown_transfer', 0,
      'solde_ticket', sh.tickets_amount - (sh.exp_ration + sh.exp_carburant + sh.exp_peage + sh.exp_autres),
      'share_role', 'partenaire', 'seat_from', sh.seat_from, 'seat_to', sh.seat_to,
      'share_with', v.station_name)
  FROM v
  JOIN sh ON sh.schedule_id = v.schedule_id AND sh.station_id = v_station AND sh.share_role = 'partenaire'
  LEFT JOIN counters co ON co.id = sh.counter_id
  WHERE v.station_id <> v_station;
END;
$$;

REVOKE ALL ON FUNCTION public.get_station_sales_split(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_station_sales_split(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
