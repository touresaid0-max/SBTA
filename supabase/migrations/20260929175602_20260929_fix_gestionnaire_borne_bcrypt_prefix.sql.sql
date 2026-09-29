/*
# Fix bcrypt prefix for gestionnaire.borne password

## Problem
gen_salt('bf') produces $2a$ prefix, but GoTrue in this project
requires $2b$ prefix (as established by migrations 090/091).
The $2a$ prefix causes "Database error querying schema" on login.

## Fix
Replace the $2a$ prefix with $2b$ on the encrypted_password.
*/

UPDATE auth.users
SET encrypted_password = regexp_replace(encrypted_password, '^\$2a\$', '$2b$'),
    updated_at = now()
WHERE email = 'gestionnaire.borne@sbta.ci';
