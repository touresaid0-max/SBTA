/*
# Départ : bus climatisé ou non, choisi par le guichetier

Demande (16/11/2026) : à l'enregistrement d'un nouveau départ au guichet, le guichetier coche ou
décoche « Bus climatisé ». Par défaut, le bus est climatisé.

Jusqu'ici le choix n'existait que sur l'appareil du guichet (toujours « Non ») : le serveur ne le
connaissait pas. schedules.is_ac le garde, pour que les autres postes (et la gare secondaire d'un
départ partagé) voient la même chose.

Information seulement : le prix du ticket n'en dépend plus (le guichetier saisit le prix à la
vente).

Les départs existants prennent la valeur par défaut (climatisé). Aucune autre donnée n'est
modifiée ; aucune règle d'accès ne change, RLS reste activé.
*/

ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS is_ac boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.schedules.is_ac IS 'Bus climatisé (choisi au guichet à la création du départ, oui par défaut)';

NOTIFY pgrst, 'reload schema';
