/*
# Enrich parcel tracking event for delivery (livre) with recipient info and agent name

## Purpose
When a courier is marked as "Retiré par le client" (status = livre), the
automatic tracking event recorded in `parcel_tracking_events` should include:
- The agent's name (performer_name) who processed the withdrawal
- The recipient identification info (CNI, name, or phone) in the description
- The delivery info in the metadata JSON column for full traceability

## Changes
1. Replaces the `log_parcel_status_change()` SECURITY DEFINER trigger function
   so that for status = 'livre':
   - It looks up the agent's `full_name` from `users` (via auth.uid()) and
     populates `performer_name`.
   - It builds a description like:
     "Colis remis au destinataire par Agent <name> – CNI : <number>"
     (or Nom / Téléphone depending on which info was provided).
   - It stores `delivery_recipient_name`, `delivery_recipient_phone`,
     `delivery_id_number`, and `delivery_id_type` in the `metadata` JSONB column.
2. Other statuses keep their existing behaviour (no description change).

## Notes
- The function remains SECURITY DEFINER with `search_path = public` as before.
- No new tables or columns. No RLS changes.
- Idempotent: uses CREATE OR REPLACE FUNCTION and recreates the trigger.
*/

CREATE OR REPLACE FUNCTION log_parcel_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_performer_name varchar(255) := NULL;
  v_id_label       text := '';
  v_id_value       text := '';
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN

    -- Resolve agent name for the performer (auth.uid())
    IF NEW.status = 'livre' THEN
      BEGIN
        SELECT u.full_name INTO v_performer_name
        FROM public.users u
        WHERE u.id = auth.uid()
        LIMIT 1;
      EXCEPTION WHEN OTHERS THEN
        v_performer_name := NULL;
      END;
    END IF;

    -- Determine which recipient id info to show in the description
    IF NEW.status = 'livre' THEN
      IF NEW.delivery_id_number IS NOT NULL AND NEW.delivery_id_number <> '' THEN
        v_id_label := 'CNI';
        v_id_value := NEW.delivery_id_number;
      ELSIF NEW.delivery_recipient_phone IS NOT NULL AND NEW.delivery_recipient_phone <> '' THEN
        v_id_label := 'Téléphone';
        v_id_value := NEW.delivery_recipient_phone;
      ELSIF NEW.delivery_recipient_name IS NOT NULL AND NEW.delivery_recipient_name <> '' THEN
        v_id_label := 'Nom';
        v_id_value := NEW.delivery_recipient_name;
      END IF;
    END IF;

    INSERT INTO parcel_tracking_events (
      parcel_id,
      event_type,
      description,
      station_id,
      performed_by,
      performer_name,
      event_at,
      metadata
    ) VALUES (
      NEW.id,
      NEW.status,
      CASE NEW.status
        WHEN 'enregistre'    THEN 'Colis enregistré'
        WHEN 'mis_en_paquet' THEN 'Colis mis en paquet'
        WHEN 'expedie'       THEN 'Colis expédié'
        WHEN 'arrive'        THEN 'Colis arrivé à destination'
        WHEN 'livre'         THEN
          CASE
            WHEN v_performer_name IS NOT NULL AND v_id_value <> '' THEN
              'Colis remis au destinataire par Agent ' || v_performer_name || ' – ' || v_id_label || ' : ' || v_id_value
            WHEN v_performer_name IS NOT NULL THEN
              'Colis remis au destinataire par Agent ' || v_performer_name
            WHEN v_id_value <> '' THEN
              'Colis remis au destinataire – ' || v_id_label || ' : ' || v_id_value
            ELSE
              'Colis remis au destinataire'
          END
        WHEN 'retourne'      THEN 'Colis retourné à l''expéditeur'
        WHEN 'perdu'         THEN 'Colis déclaré perdu'
        ELSE NEW.status
      END,
      CASE NEW.status
        WHEN 'enregistre'    THEN NEW.origin_station_id
        WHEN 'mis_en_paquet' THEN NEW.origin_station_id
        WHEN 'expedie'       THEN NEW.origin_station_id
        ELSE NEW.destination_station_id
      END,
      auth.uid(),
      v_performer_name,
      now(),
      CASE WHEN NEW.status = 'livre' THEN
        jsonb_build_object(
          'delivery_recipient_name',  NEW.delivery_recipient_name,
          'delivery_recipient_phone', NEW.delivery_recipient_phone,
          'delivery_id_number',       NEW.delivery_id_number,
          'delivery_id_type',         NEW.delivery_id_type
        )
      ELSE '{}'::jsonb END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_parcel_tracking ON parcels;
CREATE TRIGGER trg_log_parcel_tracking
  AFTER UPDATE ON parcels
  FOR EACH ROW EXECUTE FUNCTION log_parcel_status_change();
