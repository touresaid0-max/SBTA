/*
# Codes courrier : suite stricte, sans numéro perdu (020001, 020002, 020003…)

## Constat (base de test, 10/11/2026)
Le code d'un courrier est le code agence de la gare suivi d'un numéro sur 6 chiffres en tout
(migration 20261109120000). Pour travailler hors ligne, chaque poste réservait 40 numéros à
l'avance (reserve_parcel_codes) : chaque navigateur ouvert sur le courrier en prenait 40 qu'il
n'utilisait pas forcément. Le courrier suivant enregistré en ligne a ainsi reçu 020122 au lieu
de 020003.

## Règle
- En ligne : le serveur donne le numéro suivant au moment de l'enregistrement, et seulement à
  ce moment-là. Un enregistrement refusé ne consomme pas de numéro : le compteur est mis à jour
  dans la même transaction et annulé avec elle. La suite est stricte : 020001, 020002, 020003…
- Hors ligne : le courrier reçoit un code distinct et définitif (code agence + « H » + 5
  caractères, ex. 02H7K2QM), qui ne prend aucun numéro de la suite.

## Changements
1. reserve_parcel_codes supprimée : plus aucun poste, même resté sur une ancienne version de
   l'application, ne peut consommer de numéros à l'avance (son appel échoue sans conséquence,
   le courrier est quand même enregistré).
2. Compteurs remis à zéro (UPDATE, sans suppression) : le prochain courrier de la gare 02 reçoit
   020001. Les codes déjà attribués restent valables ; la suite les saute quand elle les atteint
   (next_parcel_code vérifie qu'un code n'est pas déjà pris).

Le déclencheur, le format sur 6 chiffres et le refus d'une gare sans code agence sont inchangés.

## Sécurité
Aucune politique RLS modifiée, aucune donnée supprimée.
*/

DROP FUNCTION IF EXISTS public.reserve_parcel_codes(uuid, integer);

UPDATE public.parcel_code_counters
SET last_number = 0, updated_at = now()
WHERE last_number <> 0;

NOTIFY pgrst, 'reload schema';
