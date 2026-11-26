/*
# Pannes vues par le chef de gare (audit chef de gare B4, 26/11/2026)

La page « Pannes » du chef de gare restait vide (« Aucun signalement ») : elle lit la colonne
received_at, absente en test comme en production (migration 042 jamais appliquée), et la
requête échouait (400). Le bouton « Marquer reçue » échouait aussi : il écrit received_at, et
le chef de gare n'a pas le droit de modifier une panne (migration 041 non appliquée).

1. Colonne received_at (heure de réception de la panne), comme la migration 042.
2. mark_breakdown_received(id) : passe une panne « signalée » à « reçue » avec l'heure de
   réception. Le chef de gare ne peut le faire que pour les pannes qu'il voit déjà (même règle
   que la policy « Chef gare can view station breakdown reports » : les départs de sa gare,
   ou une panne sans départ). Aucune policy n'est ajoutée ni modifiée : le chef de gare ne
   reçoit pas le droit de modifier le reste de la panne.

Aucune donnée existante n'est modifiée. Les policies RLS ne sont pas touchées.
*/

ALTER TABLE public.breakdown_reports
  ADD COLUMN IF NOT EXISTS received_at timestamptz DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.mark_breakdown_received(p_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := coalesce(public.get_user_role(), '');
  v_now timestamptz := now();
BEGIN
  IF v_role NOT IN ('chef_gare', 'chef_garage', 'admin') THEN
    RAISE EXCEPTION 'Réception des pannes réservée au chef de gare' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'chef_gare' AND NOT EXISTS (
    SELECT 1 FROM breakdown_reports b
    WHERE b.id = p_id
      AND (b.schedule_id IS NULL
           OR EXISTS (SELECT 1 FROM schedules s
                      WHERE s.id = b.schedule_id
                        AND s.departure_station_id = public.get_my_station_id()))
  ) THEN
    RAISE EXCEPTION 'Panne introuvable pour votre gare' USING ERRCODE = '42501';
  END IF;

  UPDATE breakdown_reports
     SET status = 'recu_garage',
         received_at = v_now
   WHERE id = p_id
     AND status = 'signale';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cette panne n''est plus au statut « signalée »' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_breakdown_received(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_breakdown_received(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
