/*
# Recreate gestionnaire_borne Auth account cleanly

## Problem
The manually-inserted auth.users row has subtle structural differences from
accounts created via Supabase Auth's signup flow. GoTrue fails while loading
the schema and returns "Database error querying schema" (HTTP 500).

## Fix
1. Remove the broken auth.users row (cascades to auth.identities).
2. Remove the matching public.users / employees rows.
3. A follow-up migration will recreate the account via Supabase Auth signup.
*/

DELETE FROM auth.identities
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'gestionnaire.borne@sbta.ci');

DELETE FROM auth.users
WHERE email = 'gestionnaire.borne@sbta.ci';

DELETE FROM public.users
WHERE email = 'gestionnaire.borne@sbta.ci';

DELETE FROM public.employees
WHERE professional_email = 'gestionnaire.borne@sbta.ci';
