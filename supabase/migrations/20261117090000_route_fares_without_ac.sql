/*
# Climatisation : un tarif climatisé et un tarif sans clim par itinéraire

Demande (17/11/2026) : la climatisation est paramétrée par l'administrateur dans « Itinéraires » :
un tarif climatisé (obligatoire) et un tarif sans clim (facultatif). À la vente, le guichetier
choisit « Climatisé » ou « Non climatisé » et le tarif correspondant s'applique.

- routes.base_price reste le tarif de l'itinéraire : c'est le tarif climatisé.
- routes.base_price_no_ac (nouveau, facultatif) : le tarif sans clim.
- route_city_stops.price_no_ac (nouveau, facultatif) : le tarif sans clim de chaque destination
  intermédiaire (route_city_stops.price restant son tarif climatisé).

Sans tarif sans clim, le tarif climatisé s'applique aussi au bus non climatisé.
Aucune donnée existante n'est modifiée ; aucune règle d'accès ne change, RLS reste activé.
*/

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS base_price_no_ac numeric;
ALTER TABLE public.route_city_stops ADD COLUMN IF NOT EXISTS price_no_ac numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routes_base_price_no_ac_positive') THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_base_price_no_ac_positive CHECK (base_price_no_ac IS NULL OR base_price_no_ac > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_city_stops_price_no_ac_positive') THEN
    ALTER TABLE public.route_city_stops
      ADD CONSTRAINT route_city_stops_price_no_ac_positive CHECK (price_no_ac IS NULL OR price_no_ac > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.routes.base_price IS 'Tarif climatisé de l''itinéraire (FCFA)';
COMMENT ON COLUMN public.routes.base_price_no_ac IS 'Tarif sans climatisation (FCFA), facultatif : sinon le tarif climatisé';
COMMENT ON COLUMN public.route_city_stops.price_no_ac IS 'Tarif sans climatisation vers cette ville (FCFA), facultatif';

NOTIFY pgrst, 'reload schema';
