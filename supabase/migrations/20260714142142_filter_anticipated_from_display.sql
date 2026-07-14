/*
# Filter anticipated departures from public station display

1. Changes
  - Updates `get_station_departures` RPC to exclude anticipated departures (`is_anticipated = true`)
    UNLESS the chef de gare has completed all required fields (bus_id, driver_id, and departure_datetime).
  - An anticipated departure becomes visible on the display screen only after the station manager
    assigns a bus, a driver, and confirms the departure time.

2. Business Rules
  - `is_anticipated = true` AND (`bus_id IS NULL` OR `driver_id IS NULL`) → hidden from display
  - `is_anticipated = true` AND `bus_id IS NOT NULL` AND `driver_id IS NOT NULL` → visible on display
  - `is_anticipated = false` → always visible (unchanged behavior)

3. Security
  - Function remains SECURITY DEFINER with fixed search_path
  - Grants to anon and authenticated unchanged
*/

CREATE OR REPLACE FUNCTION get_station_departures(p_station_id uuid, p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  id                      uuid,
  route_name              text,
  departure_datetime      timestamptz,
  arrival_datetime        timestamptz,
  status                  text,
  seats_available         int,
  seats_reserved          int,
  bus_capacity            int,
  fill_rate               numeric,
  notes                   text,
  transit_stops           jsonb,
  bus_registration        text,
  bus_model               text,
  driver_name             text,
  driver_phone            text,
  copilot_name            text,
  departure_station_name  text,
  arrival_station_name    text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    sch.id,
    sch.route_name,
    sch.departure_datetime,
    sch.arrival_datetime,
    sch.status,
    COALESCE(sch.seats_available, GREATEST(0, COALESCE(b.total_seats, b.capacity, 0) - COALESCE(sch.seats_reserved, 0))) AS seats_available,
    COALESCE(sch.seats_reserved, 0) AS seats_reserved,
    COALESCE(b.total_seats, b.capacity, 0) AS bus_capacity,
    sch.fill_rate,
    COALESCE(sch.notes, '') AS notes,
    COALESCE(sch.transit_stops, '[]'::jsonb) AS transit_stops,
    COALESCE(b.registration_number, '—') AS bus_registration,
    COALESCE(b.model, '') AS bus_model,
    COALESCE(u_driver.full_name, '—') AS driver_name,
    COALESCE(u_driver.phone, '') AS driver_phone,
    COALESCE(u_copilot.full_name, '') AS copilot_name,
    COALESCE(dep_st.name, '—') AS departure_station_name,
    COALESCE(arr_st.name, '—') AS arrival_station_name
  FROM schedules sch
  LEFT JOIN buses            b         ON b.id         = sch.bus_id
  LEFT JOIN users            u_driver  ON u_driver.id  = sch.driver_id
  LEFT JOIN users            u_copilot ON u_copilot.id = sch.copilot_id
  LEFT JOIN stations         dep_st    ON dep_st.id    = sch.departure_station_id
  LEFT JOIN stations         arr_st    ON arr_st.id    = sch.arrival_station_id
  WHERE sch.departure_station_id = p_station_id
    AND sch.departure_datetime >= (p_date::timestamptz AT TIME ZONE 'UTC')
    AND sch.departure_datetime <  ((p_date + 1)::timestamptz AT TIME ZONE 'UTC')
    AND (
      sch.is_anticipated = false
      OR (sch.is_anticipated = true AND sch.bus_id IS NOT NULL AND sch.driver_id IS NOT NULL)
    )
  ORDER BY sch.departure_datetime ASC;
$$;

GRANT EXECUTE ON FUNCTION get_station_departures(uuid, date) TO anon, authenticated;
