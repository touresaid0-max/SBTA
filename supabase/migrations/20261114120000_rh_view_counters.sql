/*
# RH : lire les guichets (page Connexions)

Le RH a maintenant la page « Connexions » (personnel connecté, historique des connexions). Elle
affiche la gare et le guichet de chaque guichetier. Le RH lisait déjà le personnel et le journal
des connexions, mais pas les guichets : la colonne « Point d'accès » n'aurait montré que la gare.

Le RH peut LIRE les guichets (numéro, gare, guichetier affecté). Il ne peut ni en créer, ni en
modifier, ni en supprimer. Les autres rôles ne changent pas.
*/

DROP POLICY IF EXISTS "rh can view counters" ON public.counters;
CREATE POLICY "rh can view counters" ON public.counters
  FOR SELECT TO authenticated
  USING (public.get_my_role() = 'rh');
