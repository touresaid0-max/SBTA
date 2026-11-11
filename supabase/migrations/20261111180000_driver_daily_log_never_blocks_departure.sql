/*
# Journée du chauffeur contractuel : ne bloque plus la clôture d'un départ

Constat (logs production, 11/11/2026) : « null value in column "company_id" of relation
"driver_daily_logs" violates not-null constraint », plusieurs fois par minute.

Quand un départ passe à « terminé », le trigger trg_log_contractual_driver_day enregistre la
journée du chauffeur contractuel (taux journalier) dans driver_daily_logs, avec la société lue
sur la fiche users du chauffeur. Pour des chauffeurs sans société sur leur fiche, l'ajout
échouait et toute la mise à jour du départ était refusée : le départ ne pouvait pas être clôturé
sur le serveur, le guichet renvoyait la clôture sans fin, et la journée n'était pas comptée.

La société est maintenant cherchée sur la fiche users, puis sur la fiche employé (RH), puis sur
le bus du départ. Si aucune n'est trouvée, ou si l'ajout échoue pour une autre raison, la
journée n'est pas enregistrée (avertissement dans les logs) mais le départ est clôturé. Le reste
du calcul est inchangé (migration 085).

Les départs refusés jusqu'ici seront clôturés au prochain envoi du guichet.
*/

CREATE OR REPLACE FUNCTION public.log_contractual_driver_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id     uuid;
  v_contract_type text;
  v_daily_rate    decimal(10,2);
  v_company_id    uuid;
  v_route_id      uuid;
  v_route_name    varchar(255);
  v_ticket_price  decimal(10,2);
  v_work_date     date;
  v_year_month    int;
BEGIN
  -- Only when the trip becomes 'termine'
  IF NEW.status = 'termine' AND (OLD.status IS NULL OR OLD.status != 'termine') THEN

    IF NEW.driver_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT u.contract_type, u.daily_rate, u.company_id
    INTO v_contract_type, v_daily_rate, v_company_id
    FROM users u WHERE u.id = NEW.driver_id;

    IF v_contract_type = 'contractuel' AND v_daily_rate IS NOT NULL THEN

      -- Company: the user's, else the employee record's, else the bus's
      IF v_company_id IS NULL THEN
        SELECT e.company_id INTO v_company_id
        FROM employees e
        WHERE (e.auth_user_id = NEW.driver_id OR e.id = NEW.driver_id) AND e.company_id IS NOT NULL
        LIMIT 1;
      END IF;
      IF v_company_id IS NULL AND NEW.bus_id IS NOT NULL THEN
        SELECT b.company_id INTO v_company_id FROM buses b WHERE b.id = NEW.bus_id;
      END IF;
      IF v_company_id IS NULL THEN
        RAISE WARNING 'Journée non enregistrée : chauffeur % sans société (départ %)', NEW.driver_id, NEW.id;
        RETURN NEW;
      END IF;

      v_driver_id  := NEW.driver_id;
      v_work_date  := (NEW.departure_datetime AT TIME ZONE 'UTC')::date;
      v_year_month := EXTRACT(YEAR FROM v_work_date)::int * 100
                    + EXTRACT(MONTH FROM v_work_date)::int;

      IF NEW.route_id IS NOT NULL THEN
        SELECT r.id, r.name, r.base_price
        INTO v_route_id, v_route_name, v_ticket_price
        FROM routes r WHERE r.id = NEW.route_id;
      END IF;

      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM driver_daily_logs
          WHERE driver_id = v_driver_id AND schedule_id = NEW.id
        ) THEN
          INSERT INTO driver_daily_logs (
            driver_id, company_id, schedule_id, route_id,
            work_date, work_year_month,
            daily_rate, route_name, ticket_price
          ) VALUES (
            v_driver_id, v_company_id, NEW.id, v_route_id,
            v_work_date, v_year_month,
            v_daily_rate, v_route_name, v_ticket_price
          );

          UPDATE users SET
            days_worked_this_month = (
              SELECT COUNT(DISTINCT work_date)
              FROM driver_daily_logs
              WHERE driver_id = v_driver_id
                AND work_year_month = (EXTRACT(YEAR FROM CURRENT_DATE)::int * 100
                                     + EXTRACT(MONTH FROM CURRENT_DATE)::int)
                AND payment_status != 'annule'
            ),
            current_month_earnings = (
              SELECT COALESCE(SUM(daily_rate), 0)
              FROM driver_daily_logs
              WHERE driver_id = v_driver_id
                AND work_year_month = (EXTRACT(YEAR FROM CURRENT_DATE)::int * 100
                                     + EXTRACT(MONTH FROM CURRENT_DATE)::int)
                AND payment_status != 'annule'
            )
          WHERE id = v_driver_id;
        END IF;
      EXCEPTION WHEN others THEN
        -- The pay record failing must never refuse the departure's closing
        RAISE WARNING 'Journée non enregistrée pour le chauffeur % (départ %) : %', v_driver_id, NEW.id, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
