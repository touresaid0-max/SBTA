/*
# Module Bornes digitales de vente de tickets

## Objectif
Créer un module de bornes libre-service (PWA) pour la vente de tickets
en gare, avec un profil Gestionnaire Borne pour les paramétrer, un mode
borne virtuelle par QR code, et un suivi des recettes.

## Nouvelles tables
- `digital_kiosks` : configuration des bornes par gare
  - `id` (uuid, PK)
  - `name` (text) : nom de la borne
  - `station_id` (uuid, FK → stations) : gare d'installation
  - `kiosk_type` (text) : 'physical' | 'virtual_qr'
  - `status` (text) : 'active' | 'defective' | 'offline'
  - `logo_url` (text) : logo personnalisable
  - `primary_color` (text) : couleur principale
  - `secondary_color` (text) : couleur secondaire
  - `background_image_url` (text) : image de fond
  - `welcome_text` (text) : texte d'accueil
  - `idle_timeout_seconds` (int) : timeout d'inactivité (défaut 60)
  - `payment_confirmation_mode` (text) : 'wave_api' | 'manual'
  - `services` (jsonb) : services activés (ex: {"ticket_sale": true, "info": false})
  - `is_active` (boolean, défaut true)
  - `created_at`, `updated_at` (timestamptz)

- `kiosk_tickets` : tickets vendus via les bornes
  - `id` (uuid, PK)
  - `kiosk_id` (uuid, FK → digital_kiosks)
  - `schedule_id` (uuid, FK → schedules)
  - `route_id` (uuid, FK → routes)
  - `bus_id` (uuid, nullable)
  - `origin_city_id` (uuid, FK → cities)
  - `destination_city_id` (uuid, FK → cities)
  - `passenger_name` (text)
  - `passenger_phone` (text, nullable)
  - `seat_numbers` (text[])
  - `unit_price` (numeric)
  - `service_fee` (numeric)
  - `total_amount` (numeric)
  - `payment_method` (text) : 'wave' | 'manual'
  - `payment_status` (text) : 'pending' | 'paid' | 'failed'
  - `wave_session_id` (text, nullable)
  - `ticket_ref` (text, unique)
  - `qr_code` (text, nullable)
  - `printed` (boolean, défaut false)
  - `created_at`, `updated_at` (timestamptz)

## Sécurité (RLS)
- `digital_kiosks` : SELECT pour anon+authenticated (la borne lit sa config
  sans auth), INSERT/UPDATE/DELETE pour gestionnaire_borne+admin.
- `kiosk_tickets` : SELECT pour anon+authenticated, INSERT pour anon+authenticated
  (la borne crée les tickets sans auth utilisateur), UPDATE pour
  gestionnaire_borne+admin (mise à jour du statut de paiement).

## Notes
1. Le rôle `gestionnaire_borne` est un nouveau rôle ajouté au système.
2. Les bornes physiques utilisent la PWA en plein écran tactile.
3. Les bornes virtuelles utilisent un QR code à scanner sur smartphone.
4. Le paiement Wave réutilise les edge functions existantes.
*/
CREATE TABLE IF NOT EXISTS public.digital_kiosks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  station_id uuid REFERENCES public.stations(id) ON DELETE CASCADE,
  kiosk_type text NOT NULL DEFAULT 'physical' CHECK (kiosk_type IN ('physical', 'virtual_qr')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'defective', 'offline')),
  logo_url text,
  primary_color text DEFAULT '#0B7439',
  secondary_color text DEFAULT '#E7F6EC',
  background_image_url text,
  welcome_text text DEFAULT 'Touchez l''écran pour commencer',
  idle_timeout_seconds integer NOT NULL DEFAULT 60,
  payment_confirmation_mode text NOT NULL DEFAULT 'wave_api' CHECK (payment_confirmation_mode IN ('wave_api', 'manual')),
  services jsonb NOT NULL DEFAULT '{"ticket_sale": true, "info": true}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.digital_kiosks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kiosks_select_all" ON public.digital_kiosks;
CREATE POLICY "kiosks_select_all"
  ON public.digital_kiosks FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "kiosks_insert_manager" ON public.digital_kiosks;
CREATE POLICY "kiosks_insert_manager"
  ON public.digital_kiosks FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = ANY (ARRAY['gestionnaire_borne','admin']));

DROP POLICY IF EXISTS "kiosks_update_manager" ON public.digital_kiosks;
CREATE POLICY "kiosks_update_manager"
  ON public.digital_kiosks FOR UPDATE
  TO authenticated
  USING (get_my_role() = ANY (ARRAY['gestionnaire_borne','admin']))
  WITH CHECK (get_my_role() = ANY (ARRAY['gestionnaire_borne','admin']));

DROP POLICY IF EXISTS "kiosks_delete_manager" ON public.digital_kiosks;
CREATE POLICY "kiosks_delete_manager"
  ON public.digital_kiosks FOR DELETE
  TO authenticated
  USING (get_my_role() = ANY (ARRAY['gestionnaire_borne','admin']));

CREATE TABLE IF NOT EXISTS public.kiosk_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_id uuid REFERENCES public.digital_kiosks(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.schedules(id) ON DELETE SET NULL,
  route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  bus_id uuid,
  origin_city_id uuid REFERENCES public.cities(id) ON DELETE SET NULL,
  destination_city_id uuid REFERENCES public.cities(id) ON DELETE SET NULL,
  passenger_name text NOT NULL DEFAULT 'Voyageur',
  passenger_phone text,
  seat_numbers text[] NOT NULL DEFAULT '{}',
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  service_fee numeric(10,2) NOT NULL DEFAULT 0,
  total_amount numeric(10,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'wave' CHECK (payment_method IN ('wave', 'manual')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  wave_session_id text,
  ticket_ref text UNIQUE NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  qr_code text,
  printed boolean NOT NULL DEFAULT false,
  station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.kiosk_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kiosk_tickets_select_all" ON public.kiosk_tickets;
CREATE POLICY "kiosk_tickets_select_all"
  ON public.kiosk_tickets FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "kiosk_tickets_insert_all" ON public.kiosk_tickets;
CREATE POLICY "kiosk_tickets_insert_all"
  ON public.kiosk_tickets FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "kiosk_tickets_update_manager" ON public.kiosk_tickets;
CREATE POLICY "kiosk_tickets_update_manager"
  ON public.kiosk_tickets FOR UPDATE
  TO authenticated
  USING (get_my_role() = ANY (ARRAY['gestionnaire_borne','admin']))
  WITH CHECK (get_my_role() = ANY (ARRAY['gestionnaire_borne','admin']));

DROP POLICY IF EXISTS "kiosk_tickets_update_anon_payment" ON public.kiosk_tickets;
CREATE POLICY "kiosk_tickets_update_anon_payment"
  ON public.kiosk_tickets FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_kiosk_tickets_kiosk_id ON public.kiosk_tickets(kiosk_id);
CREATE INDEX IF NOT EXISTS idx_kiosk_tickets_created_at ON public.kiosk_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kiosk_tickets_payment_status ON public.kiosk_tickets(payment_status);
CREATE INDEX IF NOT EXISTS idx_digital_kiosks_station_id ON public.digital_kiosks(station_id);

-- Enable realtime
ALTER TABLE public.digital_kiosks REPLICA IDENTITY FULL;
ALTER TABLE public.kiosk_tickets REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'digital_kiosks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.digital_kiosks;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'kiosk_tickets') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.kiosk_tickets;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
