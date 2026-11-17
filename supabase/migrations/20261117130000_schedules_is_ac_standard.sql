/*
# Départ : standard ou climatisé, choisi par le guichetier

Demande (17/11/2026) : à la création d'un départ au guichet, la case « Standard » est cochée par
défaut (tarif standard de l'itinéraire). Décochée, le départ est climatisé et le tarif climatisé
de l'itinéraire s'applique à la vente. Dans l'écran de vente, « Climatisé : Oui / Non » se
change d'un clic.

schedules.is_ac garde ce choix, pour que les autres postes (et la gare secondaire d'un départ
partagé) appliquent le même tarif. Par défaut : non climatisé (standard).

Sur SbtaTeste, une ancienne version (20261116100000, retirée) avait créé la colonne avec
« climatisé » par défaut : elle passe à « standard » par défaut, et les départs restés à
climatisé y reviennent à standard (choix jamais utilisé à la vente). Sur un serveur sans la
colonne (production), elle est simplement créée : aucune donnée existante n'est modifiée.
Aucune règle d'accès ne change, RLS reste activé.
*/

DO $$
DECLARE
  old_default_true boolean;
BEGIN
  SELECT column_default = 'true' INTO old_default_true
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'is_ac';

  IF old_default_true IS NULL THEN
    ALTER TABLE public.schedules ADD COLUMN is_ac boolean NOT NULL DEFAULT false;
  ELSIF old_default_true THEN
    -- SbtaTeste only: column created earlier with « climatisé » by default
    ALTER TABLE public.schedules ALTER COLUMN is_ac SET DEFAULT false;
    UPDATE public.schedules SET is_ac = false WHERE is_ac;
  END IF;
END $$;

COMMENT ON COLUMN public.schedules.is_ac IS 'Départ climatisé (tarif climatisé) ; faux = standard (tarif standard), choisi au guichet';

NOTIFY pgrst, 'reload schema';
