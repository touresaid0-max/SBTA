/*
# Espace du DG : lecture des pannes

Le tableau de bord du DG propose « Pannes & Répartitions ». La page était réservée au DAF (accès
refusé au DG), et la table des pannes (schedule_breakdowns) n'était lisible que par l'admin, le
DAF, le comptable, le chef de gare et le gestionnaire : même avec l'accès à la page, le rapport
du DG serait resté vide.

Le DG peut maintenant LIRE les pannes. Il ne peut ni en créer, ni en modifier (règles inchangées).
Les autres rôles gardent exactement le même accès.
*/

DROP POLICY IF EXISTS "select_breakdowns" ON schedule_breakdowns;
CREATE POLICY "select_breakdowns" ON schedule_breakdowns
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'daf', 'dg', 'comptable', 'chef_gare', 'gestionnaire')
    )
  );
