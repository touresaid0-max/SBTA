/*
# Fix parcel_service_expenses SELECT policy for superviseur_colis

## Problem
The superviseur_colis role could only see expenses from their own station_id,
but they need cross-station visibility to generate consolidated reports.

## Changes
- Drop and recreate the SELECT policy on parcel_service_expenses
- superviseur_colis and admin can now see ALL expenses (no station restriction)
- agent_colis still only sees their own station's expenses

## Security
- agent_colis: scoped to own station (u.station_id = parcel_service_expenses.station_id)
- superviseur_colis: full read access across all stations
- admin: full read access across all stations
*/

DROP POLICY IF EXISTS "parcel_expenses_select" ON parcel_service_expenses;

CREATE POLICY "parcel_expenses_select"
ON parcel_service_expenses FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid()
    AND (
      -- admin and superviseur can see all stations
      u.role IN ('admin', 'superviseur_colis')
      OR
      -- agent_colis sees only their own station
      (u.role = 'agent_colis' AND u.station_id = parcel_service_expenses.station_id)
    )
  )
);
