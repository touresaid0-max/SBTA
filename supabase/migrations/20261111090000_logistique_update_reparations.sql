/*
# Réparations : le responsable logistique peut modifier et libérer un car

Constat (production, 11/11/2026) : dans « Cars en réparation », le responsable logistique ne
pouvait ni libérer un car ni modifier sa réparation. La règle de modification de
garage_reparations (migration du 15/08) n'autorisait que l'administrateur et le gérant
principal : la modification ne touchait aucune ligne et l'écran affichait « Cannot coerce the
result to a single JSON object » (PATCH 406).

La règle « garage_reparations_update » est recréée avec le responsable logistique en plus. Le
rôle est lu dans le jeton (app_metadata.role, comme avant) ou dans la table users
(get_user_role), pour les comptes dont le jeton ne porte pas le rôle. RLS reste activé ; les
règles de lecture, d'ajout et de suppression ne changent pas. Le changement de statut reste
journalisé et notifié par le trigger trg_log_reparation_status, comme avant.
*/

DROP POLICY IF EXISTS "garage_reparations_update" ON public.garage_reparations;
CREATE POLICY "garage_reparations_update" ON public.garage_reparations FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal', 'admin', 'responsable_logistique')
    OR public.get_user_role() IN ('gerant_principal', 'admin', 'responsable_logistique')
  )
  WITH CHECK (
    (auth.jwt()->'app_metadata'->>'role') IN ('gerant_principal', 'admin', 'responsable_logistique')
    OR public.get_user_role() IN ('gerant_principal', 'admin', 'responsable_logistique')
  );
