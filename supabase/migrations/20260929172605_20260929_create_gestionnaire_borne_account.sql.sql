-- Add gestionnaire_borne to the users_role_check constraint
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (
  role = ANY (ARRAY[
    'admin','dg','daf','comptable','rh','gestionnaire','planificateur','charge_achat',
    'chauffeur','guichetier','chef_garage','mecanicien','pompiste','chef_gare','bagagiste',
    'superviseur_colis','agent_colis','agent_reservation','carburant','gerant_principal',
    'responsable_assurance','responsable_logistique','logistique','agent_qhse',
    'gestion_agboville','gestionnaire_borne','client'
  ])
);

-- Also check employees role constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_role_check'
      AND conrelid = 'public.employees'::regclass
  ) THEN
    ALTER TABLE public.employees DROP CONSTRAINT employees_role_check;
  END IF;
END $$;
ALTER TABLE public.employees ADD CONSTRAINT employees_role_check CHECK (
  role = ANY (ARRAY[
    'admin','dg','daf','comptable','rh','gestionnaire','planificateur','charge_achat',
    'chauffeur','guichetier','chef_garage','mecanicien','pompiste','chef_gare','bagagiste',
    'superviseur_colis','agent_colis','agent_reservation','carburant','gerant_principal',
    'responsable_assurance','responsable_logistique','logistique','agent_qhse',
    'gestion_agboville','gestionnaire_borne','client'
  ])
);

-- Create the account
DO $$
DECLARE v_existing uuid; v_auth_uid uuid;
BEGIN
  SELECT id INTO v_existing FROM auth.users WHERE email = 'gestionnaire.borne@sbta.ci';
  IF v_existing IS NULL THEN
    v_auth_uid := gen_random_uuid();
    INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,is_sso_user,is_anonymous)
    VALUES ('00000000-0000-0000-0000-000000000000',v_auth_uid,'authenticated','authenticated','gestionnaire.borne@sbta.ci',crypt('Borne@2026',gen_salt('bf',10)),now(),now(),now(),jsonb_build_object('role','gestionnaire_borne','provider','email','providers',jsonb_build_array('email')),jsonb_build_object('full_name','Gestionnaire Borne','role','gestionnaire_borne'),false,false);
    INSERT INTO auth.identities (id,user_id,identity_data,provider_id,provider,last_sign_in_at,created_at,updated_at)
    VALUES (gen_random_uuid(),v_auth_uid,jsonb_build_object('sub',v_auth_uid::text,'email','gestionnaire.borne@sbta.ci','email_verified',true),v_auth_uid::text,'email',now(),now(),now());
  ELSE
    v_auth_uid := v_existing;
    UPDATE auth.users SET encrypted_password=crypt('Borne@2026',gen_salt('bf',10)),email_confirmed_at=now(),raw_app_meta_data=jsonb_build_object('role','gestionnaire_borne','provider','email','providers',jsonb_build_array('email')),raw_user_meta_data=jsonb_build_object('full_name','Gestionnaire Borne','role','gestionnaire_borne'),updated_at=now() WHERE id=v_auth_uid;
  END IF;
  INSERT INTO public.users (id,email,full_name,first_name,last_name,role,status,is_active,is_self_registered,created_at)
  VALUES (v_auth_uid,'gestionnaire.borne@sbta.ci','Gestionnaire Borne','Gestionnaire','Borne','gestionnaire_borne','active',true,false,now())
  ON CONFLICT (id) DO UPDATE SET role='gestionnaire_borne',status='active',is_active=true;
  INSERT INTO public.employees (auth_user_id,first_name,last_name,role,professional_email,account_status,account_created_at,created_at,updated_at)
  VALUES (v_auth_uid,'Gestionnaire','Borne','gestionnaire_borne','gestionnaire.borne@sbta.ci','active',now(),now(),now())
  ON CONFLICT DO NOTHING;
END $$;

NOTIFY pgrst,'reload schema';
