/*
# Climatisation : tarif standard (climatisé) et tarif non climatisé

Demande (17/11/2026) :
- le tarif standard de l'itinéraire est le tarif climatisé (les prix actuels) ;
- dans « Itinéraires », l'administrateur coche « Non climatisé » pour saisir un tarif non
  climatisé (facultatif) ;
- à la création d'un départ, le guichetier coche « Non climatisé » pour un bus non climatisé
  (décochée par défaut : climatisé, tarif standard) ; dans l'écran de vente, « Climatisé :
  Oui / Non » se change d'un clic.

Colonnes ajoutées (aucune donnée existante n'est modifiée) :
- routes.base_price_no_ac : tarif non climatisé de l'itinéraire ;
- route_city_stops.price_no_ac : tarif non climatisé vers une destination intermédiaire ;
- schedules.is_no_ac : départ non climatisé (faux par défaut : tous les départs existants
  restent climatisés, au tarif standard).

Sans tarif non climatisé, la vente sur un départ « Non climatisé » est refusée au guichet
(« contactez l'administrateur »).

Remplace 20261117110000 et 20261117130000, retirées avant toute mise en production. Sur
SbtaTeste, les colonnes qu'elles ont pu créer (routes.base_price_ac, route_city_stops.price_ac,
schedules.is_ac) restent sans usage. Aucune règle d'accès ne change, RLS reste activé.
*/

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS base_price_no_ac numeric;
ALTER TABLE public.route_city_stops ADD COLUMN IF NOT EXISTS price_no_ac numeric;
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS is_no_ac boolean NOT NULL DEFAULT false;

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

COMMENT ON COLUMN public.routes.base_price IS 'Tarif standard (climatisé) de l''itinéraire (FCFA)';
COMMENT ON COLUMN public.routes.base_price_no_ac IS 'Tarif non climatisé de l''itinéraire (FCFA), facultatif';
COMMENT ON COLUMN public.route_city_stops.price IS 'Tarif standard (climatisé) vers cette ville (FCFA)';
COMMENT ON COLUMN public.route_city_stops.price_no_ac IS 'Tarif non climatisé vers cette ville (FCFA), facultatif';
COMMENT ON COLUMN public.schedules.is_no_ac IS 'Départ non climatisé (tarif non climatisé), coché au guichet ; faux = climatisé (tarif standard)';

NOTIFY pgrst, 'reload schema';
