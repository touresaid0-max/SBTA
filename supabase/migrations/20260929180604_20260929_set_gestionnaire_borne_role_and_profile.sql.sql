/*
# Set role and create profile for gestionnaire_borne

## Context
The auth account was created via Supabase Auth signup (the standard path).
Now we need to:
1. Set the role in raw_app_meta_data (authoritative for authorization)
2. Insert the public.users profile row
3. Insert the public.employees row

## Security
- Role is set in raw_app_meta_data (user-immutable, server-controlled)
- No changes to existing accounts
*/

UPDATE auth.users
SET raw_app_meta_data = jsonb_build_object(
      'role', 'gestionnaire_borne',
      'provider', 'email',
      'providers', jsonb_build_array('email')
    ),
    raw_user_meta_data = raw_user_meta_data || jsonb_build_object(
      'full_name', 'Gestionnaire Borne',
      'role', 'gestionnaire_borne'
    ),
    updated_at = now()
WHERE email = 'gestionnaire.borne@sbta.ci';

INSERT INTO public.users (id, email, full_name, first_name, last_name, role, status, is_active, is_self_registered, created_at)
SELECT id, email, 'Gestionnaire Borne', 'Gestionnaire', 'Borne', 'gestionnaire_borne', 'active', true, false, now()
FROM auth.users
WHERE email = 'gestionnaire.borne@sbta.ci'
ON CONFLICT (id) DO UPDATE SET
  role = 'gestionnaire_borne',
  status = 'active',
  is_active = true,
  full_name = 'Gestionnaire Borne';

INSERT INTO public.employees (auth_user_id, first_name, last_name, role, professional_email, account_status, account_created_at, created_at, updated_at)
SELECT id, 'Gestionnaire', 'Borne', 'gestionnaire_borne', 'gestionnaire.borne@sbta.ci', 'active', now(), now(), now()
FROM auth.users
WHERE email = 'gestionnaire.borne@sbta.ci'
ON CONFLICT DO NOTHING;
