/*
# Allow bagagiste to read bus registrations

1. Purpose
- The baggage-sale screen reads schedules and then retrieves the selected bus registration.
- The `bagagiste` role can currently see the departure row but cannot read the related `buses` row, so the Car / Immatriculation field stays empty.

2. Modified Tables
- `buses`: no columns are added, removed, renamed, or changed.

3. Security
- Adds one authenticated SELECT policy for the `bagagiste` role only.
- The policy permits reading bus rows needed by the baggage workflow and does not grant insert, update, or delete access.
- Existing policies and all other roles remain unchanged.
*/

DROP POLICY IF EXISTS "buses_select_bagagiste" ON public.buses;

CREATE POLICY "buses_select_bagagiste"
ON public.buses
FOR SELECT
TO authenticated
USING (public.get_my_role() = 'bagagiste');