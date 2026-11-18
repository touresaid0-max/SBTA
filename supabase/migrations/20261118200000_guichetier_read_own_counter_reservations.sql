/*
# Guichet : lecture des tickets des départs de son propre guichet (ancienne gare comprise)

Demande (18/11/2026) : le guichet BLANDINE a été déplacé de Gare Yopougon à YOP-DALOA le
17/11/2026. La guichetière doit retrouver dans l'application guichet ses départs de Gare
Yopougon, avec leurs chiffres.

L'application lit maintenant aussi les départs faits par son guichet dans une autre gare. Mais un
guichetier ne pouvait lire que les tickets qu'il a vendus lui-même, ou ceux des départs de sa
gare actuelle : les tickets vendus avec un autre compte sur ses anciens départs (36 tickets le
15/11) manquaient, et le MT Ticket du départ était faux.

## Changement
Nouvelle règle d'accès en LECTURE seule sur reservations : un guichetier lit les tickets des
départs dont le guichet (schedules.counter_id) est le sien (counters.assigned_user_id).
Aucune règle existante n'est supprimée ni modifiée ; RLS reste activé. Aucune donnée n'est
modifiée.
*/

DROP POLICY IF EXISTS "Guichetier can view reservations of own counter schedules" ON public.reservations;

CREATE POLICY "Guichetier can view reservations of own counter schedules"
  ON public.reservations
  FOR SELECT
  TO authenticated
  USING (
    get_user_role() = 'guichetier'
    AND EXISTS (
      SELECT 1
      FROM public.schedules s
      JOIN public.counters c ON c.id = s.counter_id
      WHERE s.id = reservations.schedule_id
        AND c.assigned_user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
