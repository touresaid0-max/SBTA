/*
# Accès restreint : retenues sur salaire, congés, sessions de connexion

Constat (audit du 02/11/2026) : ces tables étaient ouvertes à tout utilisateur connecté
(politiques USING (true)) : un guichetier pouvait lire les retenues sur salaire de tout le
personnel, et lire, modifier ou supprimer les demandes de congé.

Les nouvelles règles suivent les pages qui utilisent ces données (rôles des routes) :
  - salary_deductions, lecture : rh, admin, daf, dg (pages Paie, Retenues, Livre de paie,
    Rapports RH). Écriture : inchangée (déjà réservée à rh / admin / daf).
  - leave_requests, lecture : rh, admin, daf, dg (Congés, Plafonds, Rapport des congés).
    Création, modification, suppression : rh, admin.
  - user_sessions, lecture : sa propre session, ou admin, dg, rh, chef_gare (pages Connexion
    et Guichets du chef de gare). Création et mise à jour de sa propre session : inchangées.

get_my_role() renvoie le rôle de l'utilisateur connecté (fiche employé, sinon jeton).
*/

-- Retenues sur salaire
DROP POLICY IF EXISTS "select_salary_deductions" ON public.salary_deductions;
CREATE POLICY "select_salary_deductions" ON public.salary_deductions
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('rh', 'admin', 'daf', 'dg'));

-- Demandes de congé
DROP POLICY IF EXISTS "rh_select_leave_requests" ON public.leave_requests;
CREATE POLICY "rh_select_leave_requests" ON public.leave_requests
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('rh', 'admin', 'daf', 'dg'));

DROP POLICY IF EXISTS "rh_insert_leave_requests" ON public.leave_requests;
CREATE POLICY "rh_insert_leave_requests" ON public.leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('rh', 'admin'));

DROP POLICY IF EXISTS "rh_update_leave_requests" ON public.leave_requests;
CREATE POLICY "rh_update_leave_requests" ON public.leave_requests
  FOR UPDATE TO authenticated
  USING (get_my_role() IN ('rh', 'admin'))
  WITH CHECK (get_my_role() IN ('rh', 'admin'));

DROP POLICY IF EXISTS "rh_delete_leave_requests" ON public.leave_requests;
CREATE POLICY "rh_delete_leave_requests" ON public.leave_requests
  FOR DELETE TO authenticated
  USING (get_my_role() IN ('rh', 'admin'));

-- Sessions de connexion
DROP POLICY IF EXISTS "select_user_sessions" ON public.user_sessions;
CREATE POLICY "select_user_sessions" ON public.user_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR get_my_role() IN ('admin', 'dg', 'rh', 'chef_gare'));
