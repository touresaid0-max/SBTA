/*
# Repair gestionnaire_borne Auth record

## Problem
The manually provisioned account had NULL values in Auth token columns.
Existing working accounts in this project use empty strings for these columns.
GoTrue fails while loading the Auth schema when this account contains NULL
values in the legacy token fields and returns "Database error querying schema".

## Fix
Normalize the account's legacy Auth token fields to empty strings and complete
its email identity metadata to match the working accounts.

## Security
No password, role, permission, or user profile is changed.
*/

UPDATE auth.users
SET confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change = '',
    confirmation_sent_at = NULL,
    recovery_sent_at = NULL,
    email_change_sent_at = NULL,
    updated_at = now()
WHERE email = 'gestionnaire.borne@sbta.ci';

UPDATE auth.identities
SET identity_data = jsonb_build_object(
      'sub', user_id::text,
      'email', 'gestionnaire.borne@sbta.ci',
      'email_verified', true,
      'phone_verified', false
    ),
    provider_id = 'gestionnaire.borne@sbta.ci',
    updated_at = now()
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'gestionnaire.borne@sbta.ci')
  AND provider = 'email';
