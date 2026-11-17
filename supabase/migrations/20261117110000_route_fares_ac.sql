/*
# Climatisation : un tarif climatisé et un tarif sans clim par itinéraire

Demande (17/11/2026) : la climatisation est paramétrée par l'administrateur dans « Itinéraires » :
un tarif climatisé et un tarif sans clim (facultatif). À la vente, le guichetier choisit
« Climatisé » ou « Non climatisé » et le tarif correspondant s'applique.

Les prix actuels sont les tarifs SANS clim (confirmé le 17/11/2026) :
- routes.base_price reste le tarif sans clim ;
- routes.base_price_ac (nouveau) : le tarif climatisé ;
- route_city_stops.price reste le tarif sans clim de chaque destination intermédiaire ;
- route_city_stops.price_ac (nouveau) : son tarif climatisé.

Sans tarif climatisé, la vente en « Climatisé » est refusée au guichet (« contactez
l'administrateur »). Aucune donnée existante n'est modifiée ; aucune règle d'accès ne change,
RLS reste activé.
*/

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS base_price_ac numeric;
ALTER TABLE public.route_city_stops ADD COLUMN IF NOT EXISTS price_ac numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'routes_base_price_ac_positive') THEN
    ALTER TABLE public.routes
      ADD CONSTRAINT routes_base_price_ac_positive CHECK (base_price_ac IS NULL OR base_price_ac > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_city_stops_price_ac_positive') THEN
    ALTER TABLE public.route_city_stops
      ADD CONSTRAINT route_city_stops_price_ac_positive CHECK (price_ac IS NULL OR price_ac > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.routes.base_price IS 'Tarif sans climatisation de l''itinéraire (FCFA)';
COMMENT ON COLUMN public.routes.base_price_ac IS 'Tarif climatisé de l''itinéraire (FCFA)';
COMMENT ON COLUMN public.route_city_stops.price IS 'Tarif sans climatisation vers cette ville (FCFA)';
COMMENT ON COLUMN public.route_city_stops.price_ac IS 'Tarif climatisé vers cette ville (FCFA)';

NOTIFY pgrst, 'reload schema';
