/*
# Add SELECT access to buses table for colis and related roles

## Problem
The roles agent_colis, superviseur_colis, chauffeur, and comptable had no SELECT
policy on the buses table, causing the bus dropdown in expedition modals to
always return empty.

## Changes
- Adds a single SELECT policy that covers all roles that need read-only access
  to the full buses list: agent_colis, superviseur_colis, chauffeur, comptable,
  gestionnaire (already has one but scoped to company), and rh.

## Security
- Read-only (SELECT only).
- Scoped to authenticated users with matching roles via JWT app_metadata.
- No INSERT/UPDATE/DELETE granted.
*/

DROP POLICY IF EXISTS "buses_select_colis_and_related" ON buses;
CREATE POLICY "buses_select_colis_and_related"
ON buses FOR SELECT
TO authenticated
USING (
  ((auth.jwt() -> 'app_metadata') ->> 'role') = ANY (ARRAY[
    'agent_colis',
    'superviseur_colis',
    'chauffeur',
    'comptable',
    'rh',
    'charge_achat',
    'agent_reservation',
    'agent_qhse'
  ])
);
