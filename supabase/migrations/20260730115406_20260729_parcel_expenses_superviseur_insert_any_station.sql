/*
# Allow superviseur_colis to insert parcel expenses for any station

## Problem
The INSERT policy on parcel_service_expenses requires u.station_id = expense.station_id.
A superviseur_colis may not have a station_id (they oversee all gares), so inserts
were blocked when they tried to record expenses for a station other than their own.

## Changes
- DROP and recreate the INSERT policy:
  - superviseur_colis and admin can insert for ANY station
  - agent_colis can only insert for their own station (unchanged behavior)
- No changes to SELECT, UPDATE, or DELETE policies.

## Security
- INSERT still restricted to authenticated users with colis/admin roles.
- agent_colis station-scoping preserved.
*/

DROP POLICY IF EXISTS "parcel_expenses_insert" ON parcel_service_expenses;
CREATE POLICY "parcel_expenses_insert"
ON parcel_service_expenses FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid()
    AND (
      u.role = ANY (ARRAY['superviseur_colis', 'admin'])
      OR (u.role = 'agent_colis' AND u.station_id = parcel_service_expenses.station_id)
    )
  )
);
