/*
# Fix auth.identities and password for gestionnaire.borne@sbta.ci

## Problem
The gestionnaire_borne account was created with:
1. provider_id = UUID in auth.identities — but this project's GoTrue requires provider_id = email (migration 088)
2. encrypted_password with $2a$ prefix — but working accounts use $2b$ prefix (migration 090/091)

These two issues cause GoTrue to return "Database error querying schema" (HTTP 500)
on every login attempt.

## Fix
1. Set provider_id = email in auth.identities for this user
2. Reset encrypted_password with $2b$ bcrypt prefix for "Borne@2026"
*/

UPDATE auth.identities
SET provider_id = 'gestionnaire.borne@sbta.ci',
    updated_at = now()
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'gestionnaire.borne@sbta.ci')
  AND provider = 'email';

UPDATE auth.users
SET encrypted_password = crypt('Borne@2026', gen_salt('bf', 10)),
    updated_at = now()
WHERE email = 'gestionnaire.borne@sbta.ci';
