/*
# Enhancements to digital kiosks module:
1. Add slug column for virtual QR code URL access (/bornes/:slug)
2. Add channel column to kiosk_tickets (guichet | borne | borne_virtuelle)
3. Add station_id index to kiosk_tickets for filtering
*/

-- Add slug column to digital_kiosks
ALTER TABLE public.digital_kiosks ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.digital_kiosks ADD COLUMN IF NOT EXISTS kiosk_channel text NOT NULL DEFAULT 'borne' CHECK (kiosk_channel IN ('borne', 'borne_virtuelle'));

-- Generate slug from name on existing rows
UPDATE public.digital_kiosks
SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(id::text, 1, 8)
WHERE slug IS NULL;

-- Make slug unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_digital_kiosks_slug ON public.digital_kiosks(slug) WHERE slug IS NOT NULL;

-- Add channel to kiosk_tickets
ALTER TABLE public.kiosk_tickets ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'borne' CHECK (channel IN ('borne', 'borne_virtuelle'));

-- Add station_id to kiosk_tickets (already exists but ensure index)
CREATE INDEX IF NOT EXISTS idx_kiosk_tickets_station_id ON public.kiosk_tickets(station_id);

-- Function to generate slug automatically
CREATE OR REPLACE FUNCTION public.generate_kiosk_slug(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 8);
$$;

NOTIFY pgrst, 'reload schema';
