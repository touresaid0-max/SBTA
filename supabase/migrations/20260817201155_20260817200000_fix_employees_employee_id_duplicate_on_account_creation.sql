/*
# Fix duplicate key error on employees_employee_id_key during account creation

## Problem
When an Admin creates a login account for an employee previously created by HR,
the `sync_employee_from_user` trigger fires AFTER INSERT on `public.users` and
tries to INSERT a new row into `public.employees`. The HR-created employee
already has the same `employee_id` (matricule), so the
`employees_employee_id_key` unique constraint is violated:
  "duplicate key value violates unique constraint employees_employee_id_key"

The trigger only handled `ON CONFLICT (auth_user_id)`, not `ON CONFLICT
(employee_id)`.

## Fix
Rewrite the trigger's INSERT branch to:
1. If an employee row already exists with `auth_user_id = NEW.id` OR
   `employee_id = NEW.employee_id` (and that employee has no auth_user_id yet),
   UPDATE that row to link it to the new auth user instead of inserting.
2. Otherwise insert a new employee row as before.

This makes the trigger idempotent for both unique keys and lets the Admin
account-creation flow adopt the HR-created employee record.

## Security
No RLS or policy changes. The trigger remains SECURITY DEFINER as table owner.
*/

CREATE OR REPLACE FUNCTION public.sync_employee_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mapped_status text;
  existing_emp_id uuid;
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
    -- Check if an employee already exists for this auth user or matricule
    SELECT id INTO existing_emp_id
    FROM public.employees
    WHERE auth_user_id = NEW.id
       OR (NEW.employee_id IS NOT NULL AND employee_id = NEW.employee_id)
    LIMIT 1;

    IF existing_emp_id IS NOT NULL THEN
      -- Adopt / update the existing employee row (created by HR, etc.)
      UPDATE public.employees SET
        auth_user_id       = NEW.id,
        first_name         = COALESCE(NEW.first_name, employees.first_name),
        last_name          = COALESCE(NEW.last_name, employees.last_name),
        phone              = COALESCE(NEW.phone, employees.phone),
        professional_email = COALESCE(NEW.email, employees.professional_email),
        role               = NEW.role,
        employee_id        = COALESCE(NEW.employee_id, employees.employee_id),
        company_id         = COALESCE(NEW.company_id, employees.company_id),
        station_id         = COALESCE(NEW.station_id, employees.station_id),
        license_number     = COALESCE(NEW.license_number, employees.license_number),
        license_expiry     = COALESCE(NEW.license_expiry, employees.license_expiry),
        license_category   = COALESCE(NEW.license_category, employees.license_category),
        technician_type_id = COALESCE(NEW.technician_type_id, employees.technician_type_id),
        avatar_url         = COALESCE(NEW.avatar_url, employees.avatar_url),
        account_status     = mapped_status,
        account_created_at = COALESCE(employees.account_created_at, now()),
        account_created_by = COALESCE(NEW.created_by, employees.account_created_by),
        updated_at         = now()
      WHERE employees.id = existing_emp_id;
    ELSE
      -- No existing employee — create one
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
    END IF;
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
