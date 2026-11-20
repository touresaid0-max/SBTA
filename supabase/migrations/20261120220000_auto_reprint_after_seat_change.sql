/*
# Réimpression automatique d'un billet déplacé (20/11/2026)

Un billet dont le siège ou le départ change (car remplacé par un plus petit, billets transférés au
départ suivant) doit être réimprimé avec ses nouvelles informations. Jusqu'ici l'admin devait
autoriser chaque réimpression (Bus → gestion des sièges → « Autoriser réimpression »).

Déclencheur sur reservations : quand le siège (seat_numbers) ou le départ (schedule_id) d'un billet
actif change, une autorisation de réimpression est créée automatiquement (ticket_reprint_
authorizations, motif « Siège ou départ modifié »). Le guichet voit le bandeau bleu « Réimprimer »
sur l'écran Vente du départ ; le ticket sort en DUPLICATA et l'autorisation ne sert qu'une fois,
comme avant. Seulement pour les départs d'hier et après (pas pour une correction d'archives).

Les 5 billets replacés le 20/11/2026 (départs #4 et #6 de DALOA) reçoivent aussi leur autorisation.
*/

CREATE OR REPLACE FUNCTION public.trg_auto_reprint_after_seat_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seat text;
BEGIN
  BEGIN
    IF coalesce(NEW.status, '') IN ('annulee', 'annule', 'cancelled', 'remboursee') OR NEW.schedule_id IS NULL THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM schedules s WHERE s.id = NEW.schedule_id
                    AND s.departure_datetime >= now() - interval '1 day') THEN
      RETURN NULL;
    END IF;
    SELECT trim(x) INTO v_seat FROM unnest(NEW.seat_numbers) x WHERE trim(x) <> '' LIMIT 1;
    IF v_seat IS NULL THEN
      RETURN NULL;
    END IF;
    INSERT INTO ticket_reprint_authorizations (schedule_id, reservation_id, seat_label, reason, authorized_by)
    SELECT NEW.schedule_id, NEW.id, v_seat,
           'Siège ou départ modifié' ||
             CASE WHEN OLD.schedule_id IS DISTINCT FROM NEW.schedule_id THEN ' (autre départ)' ELSE '' END ||
             ' : siège ' || coalesce(array_to_string(OLD.seat_numbers, ','), '?') || ' → ' || v_seat,
           NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM ticket_reprint_authorizations a
       WHERE a.reservation_id = NEW.id AND a.seat_label = v_seat AND a.status = 'pending');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Autorisation de réimpression non créée (billet %) : %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservations_auto_reprint ON public.reservations;
CREATE TRIGGER trg_reservations_auto_reprint
  AFTER UPDATE OF seat_numbers, schedule_id ON public.reservations
  FOR EACH ROW
  WHEN (OLD.seat_numbers IS DISTINCT FROM NEW.seat_numbers OR OLD.schedule_id IS DISTINCT FROM NEW.schedule_id)
  EXECUTE FUNCTION public.trg_auto_reprint_after_seat_change();

-- Les billets replacés le 20/11/2026 (2_CORRIGER_sieges_hors_car), s'il y en a
DO $$
BEGIN
  IF to_regclass('public.reservations_seat_backup_20261120') IS NOT NULL THEN
    INSERT INTO ticket_reprint_authorizations (schedule_id, reservation_id, seat_label, reason, authorized_by)
    SELECT r.schedule_id, r.id, trim(r.seat_numbers[1]),
           'Siège modifié (changement de car) : siège ' || array_to_string(b.seat_numbers, ',') || ' → ' || trim(r.seat_numbers[1]),
           NULL
    FROM reservations_seat_backup_20261120 b
    JOIN reservations r ON r.id = b.reservation_id
    WHERE r.seat_numbers IS DISTINCT FROM b.seat_numbers
      AND coalesce(r.status, '') NOT IN ('annulee', 'annule', 'cancelled', 'remboursee')
      AND NOT EXISTS (SELECT 1 FROM ticket_reprint_authorizations a
                       WHERE a.reservation_id = r.id AND a.seat_label = trim(r.seat_numbers[1]) AND a.status = 'pending');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
