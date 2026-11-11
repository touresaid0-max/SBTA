/*
# Chef de gare : la gare choisie dans « Utilisateurs » est bien prise en compte

Constat (11/11/2026) : dans l'interface admin, « Modifier l'utilisateur » enregistrait la gare
d'affectation d'un chef de gare dans users.station_id, mais le chef de gare retrouve sa gare
par get_my_station_id(), qui lit la table station_managers (puis stations.station_manager_id).
La nouvelle gare n'y était jamais écrite : le chef restait sur son ancienne gare, ou sans gare.

Un trigger sur users tient station_managers à jour dès que la gare ou le rôle d'un utilisateur
change (modification depuis « Utilisateurs », création de compte, ou tout autre chemin) :
  - chef de gare avec une gare : il est rattaché à cette gare (chef principal si la gare n'en a
    pas) et retiré de ses autres gares ; stations.station_manager_id suit ;
  - plus chef de gare, ou plus de gare : il est retiré de toutes les gares.
Une gare qui perd son chef principal en reçoit un autre parmi ses chefs restants.

Les gares gérées depuis la page « Gares » (plusieurs chefs par gare) ne changent pas tant que
l'utilisateur lui-même n'est pas modifié. RLS reste activé ; aucune politique ne change.
*/

CREATE OR REPLACE FUNCTION public.sync_chef_gare_station_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_left uuid[];
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.station_id IS NOT DISTINCT FROM OLD.station_id THEN
    RETURN NEW;
  END IF;

  -- Stations this user leaves
  SELECT coalesce(array_agg(sm.station_id), '{}') INTO v_left
  FROM station_managers sm
  WHERE sm.manager_id = NEW.id
    AND (NEW.role IS DISTINCT FROM 'chef_gare' OR NEW.station_id IS NULL OR sm.station_id <> NEW.station_id);

  DELETE FROM station_managers sm
  WHERE sm.manager_id = NEW.id AND sm.station_id = ANY (v_left);

  UPDATE stations st SET station_manager_id = NULL
  WHERE st.station_manager_id = NEW.id
    AND (NEW.role IS DISTINCT FROM 'chef_gare' OR NEW.station_id IS NULL OR st.id <> NEW.station_id);

  -- A station left without a primary chef: the oldest remaining chef becomes primary
  UPDATE station_managers sm SET is_primary = true
  WHERE sm.id IN (
    SELECT DISTINCT ON (x.station_id) x.id
    FROM station_managers x
    WHERE x.station_id = ANY (v_left)
      AND NOT EXISTS (SELECT 1 FROM station_managers p WHERE p.station_id = x.station_id AND p.is_primary)
    ORDER BY x.station_id, x.created_at
  );
  UPDATE stations st SET station_manager_id = (
    SELECT p.manager_id FROM station_managers p WHERE p.station_id = st.id AND p.is_primary LIMIT 1)
  WHERE st.id = ANY (v_left) AND st.station_manager_id IS NULL;

  -- The station chosen for this chef de gare
  IF NEW.role = 'chef_gare' AND NEW.station_id IS NOT NULL THEN
    INSERT INTO station_managers (station_id, manager_id, is_primary)
    VALUES (
      NEW.station_id, NEW.id,
      NOT EXISTS (SELECT 1 FROM station_managers p WHERE p.station_id = NEW.station_id AND p.is_primary)
    )
    ON CONFLICT (station_id, manager_id) DO NOTHING;

    UPDATE stations st SET station_manager_id = NEW.id
    WHERE st.id = NEW.station_id AND st.station_manager_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_chef_gare_station_from_user ON public.users;
CREATE TRIGGER trg_sync_chef_gare_station_from_user
  AFTER INSERT OR UPDATE OF role, station_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_chef_gare_station_from_user();
