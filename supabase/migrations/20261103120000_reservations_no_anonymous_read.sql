/*
# Réservations : plus de lecture sans connexion

Constat (audit du guichet, 03/11/2026) : la politique « anon can view active reservations »
(migration du 29/09, pour la borne publique) laisse n'importe qui, sans compte, lire toutes les
réservations non annulées avec toutes leurs colonnes : nom et téléphone des passagers, prix,
référence. Vérifié en production : 5 650 réservations lisibles avec la clé publique du site.

La borne et la recherche publique n'ont besoin que des sièges occupés.

1. get_occupied_seats(ids des départs) renvoie seulement, pour chaque réservation non annulée :
   l'identifiant, le départ, les numéros de siège, le nombre de sièges, le statut, et si elle
   appartient à l'utilisateur connecté (is_mine). Ni nom, ni téléphone, ni prix, ni référence.
   Au plus 200 départs par appel.
2. La politique anonyme sur reservations est supprimée. RLS reste activé et les autres
   politiques (personnel, guichet, clients, chauffeurs, bagagistes…) ne changent pas.

L'application utilise get_occupied_seats pour les plans de sièges (borne, site, guichet) et la
recherche de voyages ; tant que cette migration n'est pas appliquée, elle lit la table comme avant.
*/

CREATE OR REPLACE FUNCTION public.get_occupied_seats(p_schedule_ids uuid[])
RETURNS TABLE (
  reservation_id uuid,
  schedule_id uuid,
  seat_numbers text[],
  total_seats integer,
  status text,
  is_mine boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.schedule_id,
    r.seat_numbers,
    COALESCE(r.total_seats, 1)::integer,
    r.status::text,
    (auth.uid() IS NOT NULL AND r.customer_id = auth.uid())
  FROM reservations r
  WHERE r.schedule_id = ANY (p_schedule_ids)
    AND COALESCE(cardinality(p_schedule_ids), 0) <= 200
    AND r.status NOT IN ('annule', 'annulee', 'cancelled');
$$;

REVOKE ALL ON FUNCTION public.get_occupied_seats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_occupied_seats(uuid[]) TO anon, authenticated;

DROP POLICY IF EXISTS "anon can view active reservations" ON public.reservations;

NOTIFY pgrst, 'reload schema';
