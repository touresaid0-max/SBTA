/*
# Frais de service de réservation par trajet (application mobile)

## Objectif
Permettre de configurer des frais de service différents selon la ligne/trajet
(ville de départ → ville d'arrivée) pour les réservations effectuées depuis
l'application mobile /sbtamobile. Les frais sont appliqués automatiquement lors
de chaque réservation, sans modification du tarif de transport.

## Nouvelles tables
- `mobile_route_fees` : frais de service par trajet
  - `id` (uuid, primary key)
  - `origin_city_id` (uuid, FK → cities) : ville de départ
  - `destination_city_id` (uuid, FK → cities) : ville d'arrivée
  - `service_fee` (numeric, not null) : montant du frais de service en FCFA
  - `is_active` (boolean, default true)
  - `created_at`, `updated_at` (timestamps)
  - Contrainte d'unicité sur (origin_city_id, destination_city_id)

## Nouvelle fonction RPC
- `get_mobile_service_fee(p_origin_city_id, p_destination_city_id)` :
  retourne le frais de service applicable pour un trajet donné.
  - Si un frais spécifique existe et est actif pour ce trajet → retourne ce montant.
  - Sinon → retourne le frais par défaut de `mobile_app_settings.service_fee` + 1000 FCFA
    (règle : « toutes les autres lignes : +1000 F »).
  - Le paramètre par défaut de `mobile_app_settings` reste le frais de base global,
    la majoration de 1000 F ne s'applique qu'aux lignes non explicitement configurées.

## Sécurité (RLS)
- RLS activée sur `mobile_route_fees`.
- SELECT : `anon, authenticated` — l'application mobile (clé anon) doit pouvoir
  lire les frais pour calculer le montant à payer.
- INSERT/UPDATE/DELETE : `agent_reservation, admin` uniquement — seuls les
  gestionnaires de réservation et les administrateurs peuvent modifier les frais.

## Données initiales
Insertion des lignes spécifiques du tableau fourni :
- Abidjan → Agboville : 300 F
- Abidjan → Alépé : 300 F
- Abidjan → Sikensi : 500 F
- Abidjan → Adzopé : 500 F
- Abidjan → Bouaké : 1000 F

## Notes importantes
1. Le prix du billet de transport n'est pas modifié — seul le frais de service change.
2. Les frais sont paramétrables depuis l'interface « Paramètres de réservation »
   sans modification du code.
3. La fonction RPC gère automatiquement la majoration de 1000 F pour les lignes
   non configurées.
*/

CREATE TABLE IF NOT EXISTS public.mobile_route_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  destination_city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  service_fee numeric(10,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT mobile_route_fees_unique UNIQUE (origin_city_id, destination_city_id)
);

ALTER TABLE public.mobile_route_fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mobile_route_fees_select_all" ON public.mobile_route_fees;
CREATE POLICY "mobile_route_fees_select_all"
  ON public.mobile_route_fees FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "mobile_route_fees_insert_agent" ON public.mobile_route_fees;
CREATE POLICY "mobile_route_fees_insert_agent"
  ON public.mobile_route_fees FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = ANY (ARRAY['agent_reservation','admin']));

DROP POLICY IF EXISTS "mobile_route_fees_update_agent" ON public.mobile_route_fees;
CREATE POLICY "mobile_route_fees_update_agent"
  ON public.mobile_route_fees FOR UPDATE
  TO authenticated
  USING (get_my_role() = ANY (ARRAY['agent_reservation','admin']))
  WITH CHECK (get_my_role() = ANY (ARRAY['agent_reservation','admin']));

DROP POLICY IF EXISTS "mobile_route_fees_delete_agent" ON public.mobile_route_fees;
CREATE POLICY "mobile_route_fees_delete_agent"
  ON public.mobile_route_fees FOR DELETE
  TO authenticated
  USING (get_my_role() = ANY (ARRAY['agent_reservation','admin']));

-- Function to determine the applicable service fee for a given route
CREATE OR REPLACE FUNCTION public.get_mobile_service_fee(
  p_origin_city_id uuid,
  p_destination_city_id uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route_fee numeric;
  v_default_fee numeric;
BEGIN
  -- Check for a specific route fee
  SELECT service_fee INTO v_route_fee
  FROM mobile_route_fees
  WHERE origin_city_id = p_origin_city_id
    AND destination_city_id = p_destination_city_id
    AND is_active = true
  LIMIT 1;

  IF v_route_fee IS NOT NULL THEN
    RETURN v_route_fee;
  END IF;

  -- No specific fee: apply default + 1000 FCFA (rule for "all other lines")
  SELECT service_fee INTO v_default_fee
  FROM mobile_app_settings
  WHERE id = 1
  LIMIT 1;

  RETURN COALESCE(v_default_fee, 300) + 1000;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_mobile_service_fee(uuid, uuid) TO anon, authenticated;

-- Seed initial route fees based on the provided table
-- Abidjan → Agboville : 300 F
INSERT INTO public.mobile_route_fees (origin_city_id, destination_city_id, service_fee)
SELECT c1.id, c2.id, 300
FROM public.cities c1, public.cities c2
WHERE c1.name ILIKE 'Abidjan' AND c2.name ILIKE 'Agboville%'
ON CONFLICT (origin_city_id, destination_city_id) DO UPDATE SET service_fee = 300, updated_at = now();

-- Abidjan → Alépé : 300 F
INSERT INTO public.mobile_route_fees (origin_city_id, destination_city_id, service_fee)
SELECT c1.id, c2.id, 300
FROM public.cities c1, public.cities c2
WHERE c1.name ILIKE 'Abidjan' AND c2.name ILIKE 'Alépé%'
ON CONFLICT (origin_city_id, destination_city_id) DO UPDATE SET service_fee = 300, updated_at = now();

-- Abidjan → Sikensi : 500 F
INSERT INTO public.mobile_route_fees (origin_city_id, destination_city_id, service_fee)
SELECT c1.id, c2.id, 500
FROM public.cities c1, public.cities c2
WHERE c1.name ILIKE 'Abidjan' AND c2.name ILIKE 'Sikensi%'
ON CONFLICT (origin_city_id, destination_city_id) DO UPDATE SET service_fee = 500, updated_at = now();

-- Abidjan → Adzopé : 500 F
INSERT INTO public.mobile_route_fees (origin_city_id, destination_city_id, service_fee)
SELECT c1.id, c2.id, 500
FROM public.cities c1, public.cities c2
WHERE c1.name ILIKE 'Abidjan' AND c2.name ILIKE 'Adzopé%'
ON CONFLICT (origin_city_id, destination_city_id) DO UPDATE SET service_fee = 500, updated_at = now();

-- Abidjan → Bouaké : 1000 F
INSERT INTO public.mobile_route_fees (origin_city_id, destination_city_id, service_fee)
SELECT c1.id, c2.id, 1000
FROM public.cities c1, public.cities c2
WHERE c1.name ILIKE 'Abidjan' AND c2.name ILIKE 'Bouaké%'
ON CONFLICT (origin_city_id, destination_city_id) DO UPDATE SET service_fee = 1000, updated_at = now();

-- Enable realtime
ALTER TABLE public.mobile_route_fees REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mobile_route_fees'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mobile_route_fees;
  END IF;
END $$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
