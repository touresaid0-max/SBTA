/*
# Employés : ne plus recopier ni auditer les mises à jour sans changement

Constat (production, 30/10/2026) : activity_logs contenait 92 997 lignes « employees / update »
(187 Mo, la moitié de la table). Chaîne en cause :
  1. l'application écrit users.last_seen_at toutes les 60 s par utilisateur connecté
     (et users.last_login à chaque rechargement du profil) ;
  2. trg_sync_employee_from_user recopiait alors toute la fiche dans employees, même sans
     aucun changement (ce qui déclenchait aussi trg_sync_guichetier_counter_route, car la
     colonne role figure dans la mise à jour) ;
  3. trg_audit_employees copiait la fiche complète, avant et après, dans activity_logs.

1. sync_employee_from_user()
  - En mise à jour, la fiche employé n'est recopiée que si l'une des données recopiées
    (nom, prénom, téléphone, e-mail, rôle, matricule, société, gare, permis, type de
    technicien, photo, statut) a réellement changé. Sinon, rien n'est écrit.
  - La création (INSERT) et le contenu de la recopie sont inchangés.

2. audit_critical_table()
  - Une mise à jour qui ne change rien (à part updated_at) n'est plus enregistrée.
  - Toutes les vraies modifications restent auditées à l'identique (mêmes colonnes,
    même contenu old_values / new_values).
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

  -- Presence / login updates (last_seen_at, last_login…) change nothing on the employee:
  -- skip them instead of rewriting the employee row (and its audit copy) every minute
  IF TG_OP = 'UPDATE' AND
     (NEW.first_name, NEW.last_name, NEW.phone, NEW.email, NEW.role, NEW.employee_id,
      NEW.company_id, NEW.station_id, NEW.license_number, NEW.license_expiry,
      NEW.license_category, NEW.technician_type_id, NEW.avatar_url, NEW.status)
     IS NOT DISTINCT FROM
     (OLD.first_name, OLD.last_name, OLD.phone, OLD.email, OLD.role, OLD.employee_id,
      OLD.company_id, OLD.station_id, OLD.license_number, OLD.license_expiry,
      OLD.license_category, OLD.technician_type_id, OLD.avatar_url, OLD.status) THEN
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

-- Generic audit function
CREATE OR REPLACE FUNCTION public.audit_critical_table()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _action text;
  _target_id uuid;
  _old jsonb;
  _new jsonb;
  _desc text;
BEGIN
  _action := lower(TG_OP);

  IF TG_OP = 'DELETE' THEN
    _target_id := OLD.id;
    _old := to_jsonb(OLD);
    _new := NULL;
    _desc := 'Suppression dans ' || TG_TABLE_NAME;
  ELSIF TG_OP = 'INSERT' THEN
    _target_id := NEW.id;
    _old := NULL;
    _new := to_jsonb(NEW);
    _desc := 'Création dans ' || TG_TABLE_NAME;
  ELSE -- UPDATE
    _target_id := NEW.id;
    _old := to_jsonb(OLD);
    _new := to_jsonb(NEW);
    _desc := 'Modification dans ' || TG_TABLE_NAME;
    -- Nothing changed apart from the update timestamp: nothing to audit
    IF (_new - 'updated_at') = (_old - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO activity_logs (user_id, target_id, target_type, action, description, old_values, new_values)
  VALUES (
    auth.uid(),
    _target_id,
    TG_TABLE_NAME,
    _action,
    _desc,
    _old,
    _new
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;
