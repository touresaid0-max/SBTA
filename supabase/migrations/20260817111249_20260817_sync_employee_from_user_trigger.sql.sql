/*
# Sync employees from users automatically

1. Purpose
   When an Admin creates a user (via Admin → Utilisateurs → Nouvel utilisateur),
   the corresponding employee record in RH → Employés must be created or updated
   automatically so the two stay in sync without duplicates.

2. Approach
   A single trigger function `sync_employee_from_user()` fires AFTER INSERT OR
   UPDATE on `public.users`.
   - INSERT: if no employee row exists with `auth_user_id = NEW.id`, create one
     copying the professional fields (name, phone, email, role, company, station,
     matricule, licence, type technicien, avatar).
   - UPDATE: if a matching employee row exists, update those same fields.
   Matching is always by `auth_user_id = NEW.id`, which is unique, so no
   duplicates can be created.

3. account_status mapping
   users.status values → employees.account_status (CHECK-constrained to
   pending/active/suspended/inactive):
   - active, repos_obligatoire → active
   - pending_confirmation, pending_otp → pending
   - suspended → suspended
   - inactive, pending_deletion → inactive

4. Security
   The trigger function runs with SECURITY DEFINER as the table owner so it can
   write to employees regardless of the caller's role. No new RLS policies are
   needed; existing employees policies still govern direct access.

5. Notes
   - Idempotent: uses ON CONFLICT (auth_user_id) DO NOTHING on insert and a
     guarded UPDATE, so re-running or re-firing is safe.
   - The `is_self_registered` flag on users distinguishes admin-created users
     from self-signups; the trigger works for both, which is desired because any
     user with a non-client role should have an employee record.
*/

-- ---------------------------------------------------------------------------
-- Trigger function: upsert employee from user
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_employee_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mapped_status text;
BEGIN
  -- Only sync non-client roles (clients are not employees)
  IF NEW.role = 'client' THEN
    RETURN NEW;
  END IF;

  -- Map users.status → employees.account_status
  mapped_status := CASE
    WHEN NEW.status IN ('active', 'repos_obligatoire') THEN 'active'
    WHEN NEW.status IN ('pending_confirmation', 'pending_otp') THEN 'pending'
    WHEN NEW.status = 'suspended' THEN 'suspended'
    ELSE 'inactive'
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.employees (
      auth_user_id,
      first_name,
      last_name,
      phone,
      professional_email,
      role,
      employee_id,
      company_id,
      station_id,
      license_number,
      license_expiry,
      license_category,
      technician_type_id,
      avatar_url,
      account_status,
      account_created_at,
      account_created_by
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.first_name, ''),
      COALESCE(NEW.last_name, ''),
      NEW.phone,
      NEW.email,
      NEW.role,
      NEW.employee_id,
      NEW.company_id,
      NEW.station_id,
      NEW.license_number,
      NEW.license_expiry,
      NEW.license_category,
      NEW.technician_type_id,
      NEW.avatar_url,
      mapped_status,
      now(),
      NEW.created_by
    )
    ON CONFLICT (auth_user_id) DO NOTHING;
  ELSE -- UPDATE
    UPDATE public.employees SET
      first_name         = COALESCE(NEW.first_name, employees.first_name),
      last_name          = COALESCE(NEW.last_name, employees.last_name),
      phone              = NEW.phone,
      professional_email = NEW.email,
      role               = NEW.role,
      employee_id        = NEW.employee_id,
      company_id         = NEW.company_id,
      station_id         = NEW.station_id,
      license_number     = NEW.license_number,
      license_expiry     = NEW.license_expiry,
      license_category   = NEW.license_category,
      technician_type_id = NEW.technician_type_id,
      avatar_url         = NEW.avatar_url,
      account_status     = mapped_status,
      updated_at         = now()
    WHERE employees.auth_user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: after insert or update on users
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_employee_from_user ON public.users;
CREATE TRIGGER trg_sync_employee_from_user
  AFTER INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_employee_from_user();

-- ---------------------------------------------------------------------------
-- Backfill: create employee rows for existing users that don't have one yet
-- (excludes clients, who are not employees)
-- ---------------------------------------------------------------------------
INSERT INTO public.employees (
  auth_user_id,
  first_name,
  last_name,
  phone,
  professional_email,
  role,
  employee_id,
  company_id,
  station_id,
  license_number,
  license_expiry,
  license_category,
  technician_type_id,
  avatar_url,
  account_status,
  account_created_at,
  account_created_by
)
SELECT
  u.id,
  COALESCE(u.first_name, ''),
  COALESCE(u.last_name, ''),
  u.phone,
  u.email,
  u.role,
  u.employee_id,
  u.company_id,
  u.station_id,
  u.license_number,
  u.license_expiry,
  u.license_category,
  u.technician_type_id,
  u.avatar_url,
  CASE
    WHEN u.status IN ('active', 'repos_obligatoire') THEN 'active'
    WHEN u.status IN ('pending_confirmation', 'pending_otp') THEN 'pending'
    WHEN u.status = 'suspended' THEN 'suspended'
    ELSE 'inactive'
  END,
  now(),
  u.created_by
FROM public.users u
WHERE u.role <> 'client'
  AND NOT EXISTS (
    SELECT 1 FROM public.employees e WHERE e.auth_user_id = u.id
  )
ON CONFLICT (auth_user_id) DO NOTHING;
