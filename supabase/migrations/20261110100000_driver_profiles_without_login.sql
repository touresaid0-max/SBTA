/*
# Chauffeurs sans compte : profil chauffeur sans connexion, sélectionnable partout

## Constat (production, 09/11/2026)
Environ 120 chauffeurs (contractuels, titulaires, stagiaires) n'existent que dans la fiche RH
(employees, account_status = pending), sans compte. Un départ désigne son chauffeur par un compte
(schedules.driver_id → users, et users.id → auth.users) : ces chauffeurs n'étaient proposés nulle
part (guichet, chef de gare, planification, carburant…), ni comptés dans la paie journalière des
contractuels.

## Solution
Chaque chauffeur de la fiche RH reçoit un « profil chauffeur sans connexion » :
- un compte d'authentification VERROUILLÉ : adresse technique
  chauffeur.<identifiant>@profil.sbta-gestion.cloud (aucun e-mail n'y est envoyé), mot de passe
  aléatoire jamais connu de personne, compte bloqué (banned_until) : personne ne peut s'y
  connecter ;
- une ligne users (rôle chauffeur, statut actif) avec les données de la fiche RH : le chauffeur
  devient sélectionnable comme les autres, et ses départs comptent partout (paie, carburant,
  rapports) ;
- la fiche RH reste « en attente de compte » (account_status = pending) et garde son e-mail
  professionnel : l'admin peut toujours lui créer un vrai compte de connexion. Ce compte
  reprend alors le même profil (fonction admin-create-account mise à jour) : pas de doublon, les
  départs déjà affectés restent au chauffeur.

1. create_driver_profile(employee) : crée le profil d'une fiche RH chauffeur sans compte.
2. Exécutée ici pour toutes les fiches RH chauffeur sans compte (une fiche en échec n'empêche
   pas les autres ; le nombre créé et les échecs sont affichés).
3. Déclencheur sur employees : un chauffeur créé (ou passé au rôle chauffeur) sans compte reçoit
   son profil aussitôt ; un échec n'empêche jamais l'enregistrement de la fiche RH.

## Non traité
Une fiche RH liée à un compte d'authentification qui existe mais sans ligne users (création de
compte interrompue) n'est pas modifiée : ce compte a peut-être un vrai mot de passe. Elle est
comptée à part dans le message affiché.

## Sécurité
Fonctions SECURITY DEFINER, non exécutables par les utilisateurs (anon, authenticated). Aucune
politique RLS modifiée, aucune donnée supprimée.
*/

-- 1. Profil chauffeur sans connexion pour une fiche RH
CREATE OR REPLACE FUNCTION public.create_driver_profile(p_employee_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  e        public.employees%ROWTYPE;
  v_uid    uuid;
  v_email  text;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND OR e.role IS DISTINCT FROM 'chauffeur' THEN
    RETURN NULL;
  END IF;

  IF e.auth_user_id IS NOT NULL THEN
    -- Déjà un profil : rien à faire
    IF EXISTS (SELECT 1 FROM public.users WHERE id = e.auth_user_id) THEN
      RETURN e.auth_user_id;
    END IF;
    -- Compte d'authentification existant sans profil : laissé à l'admin (vrai mot de passe possible)
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = e.auth_user_id) THEN
      RETURN NULL;
    END IF;
    -- Lien vers un compte qui n'existe plus : un profil est créé
  END IF;

  v_uid   := gen_random_uuid();
  v_email := 'chauffeur.' || replace(e.id::text, '-', '') || '@profil.sbta-gestion.cloud';

  -- Compte verrouillé : mot de passe aléatoire jamais connu, bloqué ; jetons vides (et non NULL)
  -- pour que la liste des comptes du tableau de bord Supabase reste lisible
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, banned_until,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf', 10)),
    now(), '2999-12-31 00:00:00+00',
    '', '', '', '',
    now(), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                       'role', 'chauffeur', 'driver_profile', true),
    jsonb_build_object('employee_id', e.id, 'first_name', e.first_name, 'last_name', e.last_name,
                       'role', 'chauffeur'),
    false, false
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider_id, provider, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
          v_uid::text, 'email', NULL, now(), now());

  -- Fiche RH liée AVANT la ligne users : la recopie users → employees
  -- (trg_sync_employee_from_user) la retrouve ainsi au lieu de créer une seconde fiche
  UPDATE public.employees SET auth_user_id = v_uid WHERE id = e.id;

  INSERT INTO public.users (
    id, email, full_name, first_name, last_name, phone, role,
    company_id, station_id, employee_id, gender, hire_date, contract_type, salary, daily_rate,
    cnps_number, children_count, marital_status, bus_id, license_number, license_expiry,
    license_category, assigned_route_id, avatar_url,
    status, is_active, is_self_registered, created_by
  ) VALUES (
    v_uid, v_email, btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
    e.first_name, e.last_name, e.phone, 'chauffeur',
    e.company_id, e.station_id, e.employee_id, e.gender, e.hire_date, e.contract_type, e.salary,
    e.daily_rate, e.cnps_number, coalesce(e.children_count, 0), e.marital_status, e.bus_id,
    e.license_number, e.license_expiry, e.license_category, e.assigned_route_id, e.avatar_url,
    'active', true, false, auth.uid()
  );

  -- La recopie a mis l'adresse technique et le statut « actif » sur la fiche RH : remis comme
  -- avant (pas de connexion ; l'admin peut créer un vrai compte)
  UPDATE public.employees
  SET professional_email = e.professional_email,
      account_status     = e.account_status,
      account_created_at = e.account_created_at,
      updated_at         = now()
  WHERE id = e.id;

  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.create_driver_profile(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Rattrapage : toutes les fiches RH chauffeur sans compte
DO $$
DECLARE
  r          record;
  v_uid      uuid;
  v_created  integer := 0;
  v_skipped  integer := 0;
  v_failed   integer := 0;
BEGIN
  FOR r IN
    SELECT e.id, e.first_name, e.last_name
    FROM public.employees e
    WHERE e.role = 'chauffeur'
      AND (e.auth_user_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = e.auth_user_id))
    ORDER BY e.last_name, e.first_name
  LOOP
    BEGIN
      v_uid := public.create_driver_profile(r.id);
      IF v_uid IS NULL THEN v_skipped := v_skipped + 1; ELSE v_created := v_created + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE NOTICE 'Profil non créé pour % % : %', r.first_name, r.last_name, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Profils chauffeur créés : %, laissés à l''admin (compte existant sans profil) : %, en échec : %',
    v_created, v_skipped, v_failed;
END $$;

-- 3. Nouveaux chauffeurs de la fiche RH : profil créé aussitôt
CREATE OR REPLACE FUNCTION public.trg_create_driver_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    PERFORM public.create_driver_profile(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Jamais bloquant : la fiche RH est enregistrée, le profil pourra être créé plus tard
    RAISE WARNING 'Profil chauffeur non créé pour la fiche % : %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_employees_driver_profile ON public.employees;
CREATE TRIGGER trg_employees_driver_profile
  AFTER INSERT OR UPDATE OF role ON public.employees
  FOR EACH ROW
  WHEN (NEW.role = 'chauffeur' AND NEW.auth_user_id IS NULL)
  EXECUTE FUNCTION public.trg_create_driver_profile();

NOTIFY pgrst, 'reload schema';
