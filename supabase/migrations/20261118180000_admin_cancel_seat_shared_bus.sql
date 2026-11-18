/*
# Annulation d'un siège par l'admin : bus partagé, et annulation visible partout

Demande (18/11/2026) : sur un bus partagé (même bus, même heure de départ), plusieurs guichets
peuvent vendre le même siège. L'admin doit pouvoir choisir lequel des tickets il annule, et
l'annulation doit se répercuter au guichet, chez l'admin et chez le DAF.

## Constat
- Admin › Bus › Gestion des sièges affiche les sièges de tous les départs du bus partagé, mais
  admin_cancel_seat n'acceptait que les tickets du départ affiché : un ticket vendu par l'autre
  gare (siège 5 du bus 1136WWCI01, vendu à ADJAME-BOUAKE et à DAOUKRO) était refusé
  (« Reservation introuvable ou deja annulee »).
- Le ticket annulé par l'admin restait « payée » (payment_status = 'payee'), alors qu'une
  annulation au guichet le passe « remboursée ». Les rapports qui comptent les tickets payés
  (rapport des ventes, rapport financier, recettes ABG) comptaient encore les 23 tickets annulés
  par l'admin en production (100 000 F).
- La fonction pouvait être appelée par n'importe quel compte connecté.

## Changements
- admin_cancel_seat : réservé aux comptes admin et super_admin ; accepte un ticket du départ
  affiché ou d'un départ du même bus partagé (get_sibling_schedule_ids) ; l'annulation est
  enregistrée sur le départ du ticket ; un ticket entièrement annulé passe « remboursée », comme au
  guichet. La ligne du ticket est verrouillée pendant l'annulation (deux clics simultanés).
- Les tickets déjà annulés par l'admin (présents dans seat_cancellations) et restés « payée » passent
  « remboursée ». Retour arrière possible : remettre payment_status = 'payee' sur les réservations
  de seat_cancellations (action_type = 'cancel') dont le statut est 'annulee'.

Les guichets reçoivent l'annulation à leur prochaine synchronisation : le ticket passe annulé sur
l'appareil, le siège est libéré et MT Ticket / Caisse du départ sont recalculés.
Aucune règle d'accès (RLS) ne change.
*/

CREATE OR REPLACE FUNCTION public.admin_cancel_seat(
  p_reservation_id uuid,
  p_schedule_id uuid,
  p_seat_label text,
  p_reason text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id         uuid := auth.uid();
  v_res_schedule_id  uuid;
  v_bus_id           uuid;
  v_total_price      numeric;
  v_total_seats      integer;
  v_seat_numbers     text[];
  v_passenger        text;
  v_price_per_seat   numeric;
  v_new_seat_numbers text[];
BEGIN
  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_admin_id AND u.role IN ('admin', 'super_admin')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Action réservée aux administrateurs');
  END IF;

  -- The ticket: on the departure shown, or on another departure of the same shared bus
  SELECT r.schedule_id, r.total_price, r.total_seats, r.seat_numbers, r.passenger_name
  INTO v_res_schedule_id, v_total_price, v_total_seats, v_seat_numbers, v_passenger
  FROM reservations r
  WHERE r.id = p_reservation_id
    AND (r.schedule_id = p_schedule_id
         OR r.schedule_id = ANY (coalesce(get_sibling_schedule_ids(p_schedule_id), ARRAY[]::uuid[])))
    AND r.status IN ('confirmee', 'confirme', 'en_attente', 'payee', 'embarquee', 'embarque')
  FOR UPDATE OF r;

  IF v_seat_numbers IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Ticket introuvable sur ce bus ou déjà annulé');
  END IF;

  IF NOT (p_seat_label = ANY (v_seat_numbers)) THEN
    RETURN json_build_object('success', false, 'error', 'Ce siège ne fait pas partie de ce ticket');
  END IF;

  SELECT s.bus_id INTO v_bus_id FROM schedules s WHERE s.id = v_res_schedule_id;

  v_price_per_seat := CASE WHEN coalesce(v_total_seats, 0) > 0 THEN v_total_price / v_total_seats ELSE coalesce(v_total_price, 0) END;
  v_new_seat_numbers := array_remove(v_seat_numbers, p_seat_label);

  IF coalesce(array_length(v_new_seat_numbers, 1), 0) = 0 THEN
    -- Last seat of the ticket: the whole ticket is cancelled and refunded, as at the guichet
    UPDATE reservations
    SET status = 'annulee',
        payment_status = 'remboursee',
        updated_at = now()
    WHERE id = p_reservation_id;
  ELSE
    -- Other seats remain on the ticket: only this seat is removed
    UPDATE reservations
    SET seat_numbers = v_new_seat_numbers,
        total_seats = array_length(v_new_seat_numbers, 1),
        total_price = v_price_per_seat * array_length(v_new_seat_numbers, 1),
        updated_at = now()
    WHERE id = p_reservation_id;
  END IF;

  INSERT INTO seat_cancellations (schedule_id, bus_id, reservation_id, seat_label, action_type, reason, amount_deducted, passenger_name, admin_user_id)
  VALUES (v_res_schedule_id, v_bus_id, p_reservation_id, p_seat_label, 'cancel', p_reason, v_price_per_seat, v_passenger, v_admin_id);

  RETURN json_build_object(
    'success', true,
    'amount_deducted', v_price_per_seat,
    'passenger_name', v_passenger,
    'schedule_id', v_res_schedule_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_seat(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_seat(uuid, uuid, text, text) TO authenticated;

-- Tickets already cancelled by the admin and still counted as paid in the sales reports
UPDATE public.reservations r
SET payment_status = 'remboursee', updated_at = now()
WHERE r.status = 'annulee'
  AND r.payment_status = 'payee'
  AND EXISTS (
    SELECT 1 FROM public.seat_cancellations sc
    WHERE sc.reservation_id = r.id AND sc.action_type = 'cancel'
  );

NOTIFY pgrst, 'reload schema';
