/*
# Convoi : le guichetier ajoute une ville d'arrivée qui n'existe pas encore

Demande (11/11/2026) : au guichet, à l'enregistrement d'un convoi, une ville absente de la liste
doit pouvoir être ajoutée sur le moment, et apparaître dans l'onglet « Villes » de l'admin.

La liste « Ville d'arrivée » du convoi est faite des itinéraires (leur ville d'arrivée) et le
convoi enregistre un itinéraire : ajouter la ville seule ne suffirait pas. La fonction
pos_add_convoy_city(nom de la ville, gare du guichet) :
  1. retrouve la ville par son nom (sans tenir compte des majuscules ni des espaces autour), ou
     l'ajoute dans cities — elle apparaît alors dans « Villes » de l'admin ;
  2. retrouve l'itinéraire de la ville de la gare vers cette ville, ou le crée
     (« Ville de la gare - Nouvelle ville », prix 0, actif) ;
  3. renvoie cet itinéraire, au format de la liste du convoi.

Réservée aux guichetiers, chefs de gare et administrateurs (vérifié dans la fonction). Elle
tourne avec les droits de son propriétaire : les guichetiers n'ont pas le droit d'écrire
directement dans cities et routes, et ce droit ne leur est pas donné. RLS reste activé.
*/

CREATE OR REPLACE FUNCTION public.pos_add_convoy_city(p_city_name text, p_station_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name         text := regexp_replace(trim(coalesce(p_city_name, '')), '\s+', ' ', 'g');
  v_city_id      uuid;
  v_city_name    text;
  v_origin_id    uuid;
  v_origin_name  text;
  v_route_id     uuid;
BEGIN
  IF coalesce(public.get_user_role(), '') NOT IN ('guichetier', 'chef_gare', 'admin') THEN
    RAISE EXCEPTION 'Ajout de ville réservé aux guichetiers, chefs de gare et administrateurs' USING ERRCODE = '42501';
  END IF;
  IF length(v_name) < 2 OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Nom de ville invalide (2 à 80 caractères)' USING ERRCODE = '22023';
  END IF;

  SELECT st.city_id, c.name INTO v_origin_id, v_origin_name
  FROM stations st LEFT JOIN cities c ON c.id = st.city_id
  WHERE st.id = p_station_id;
  IF v_origin_id IS NULL THEN
    RAISE EXCEPTION 'La gare du guichet n''a pas de ville : contactez l''administrateur' USING ERRCODE = '22023';
  END IF;

  -- 1. The city: found by its name, or added (shown in the admin's « Villes »)
  SELECT c.id, c.name INTO v_city_id, v_city_name
  FROM cities c
  WHERE lower(trim(c.name)) = lower(v_name)
  ORDER BY c.is_active DESC NULLS LAST, c.created_at
  LIMIT 1;
  IF v_city_id IS NULL THEN
    INSERT INTO cities (name, is_active) VALUES (v_name, true)
    RETURNING id, name INTO v_city_id, v_city_name;
  END IF;

  IF v_city_id = v_origin_id THEN
    RAISE EXCEPTION 'La ville d''arrivée est la ville de la gare' USING ERRCODE = '22023';
  END IF;

  -- 2. The route from the station's city to it: found, or created
  SELECT r.id INTO v_route_id
  FROM routes r
  WHERE r.origin_city_id = v_origin_id AND r.destination_city_id = v_city_id
    AND (r.origin_station_id IS NULL OR r.origin_station_id = p_station_id)
  ORDER BY r.is_active DESC NULLS LAST, (r.origin_station_id = p_station_id) DESC NULLS LAST, r.created_at
  LIMIT 1;
  IF v_route_id IS NULL THEN
    INSERT INTO routes (name, origin_city_id, destination_city_id, origin_station_id, base_price, is_active)
    VALUES (v_origin_name || ' - ' || v_city_name, v_origin_id, v_city_id, p_station_id, 0, true)
    RETURNING id INTO v_route_id;
  END IF;

  -- 3. In the shape of the convoy's list
  RETURN (
    SELECT jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'base_price', coalesce(r.base_price, 0),
      'estimated_duration_minutes', r.estimated_duration_minutes,
      'origin_city_id', r.origin_city_id,
      'destination_city_id', r.destination_city_id,
      'origin_city', jsonb_build_object('id', v_origin_id, 'name', v_origin_name),
      'destination_city', jsonb_build_object('id', v_city_id, 'name', v_city_name)
    )
    FROM routes r WHERE r.id = v_route_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_add_convoy_city(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_add_convoy_city(text, uuid) TO authenticated;
