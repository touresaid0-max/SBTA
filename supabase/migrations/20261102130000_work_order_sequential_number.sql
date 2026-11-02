/*
# Ordres de travail : numérotation continue pour les OT saisis par les mécaniciens

Constat (audit du 02/11/2026) : la page « Nouvel OT » du mécanicien tirait un numéro au hasard
(OT-AAAAMMJJ-xxxx). La colonne work_order_number étant UNIQUE, un tirage déjà utilisé faisait
échouer l'enregistrement, et la numérotation ne suivait aucun ordre. Les OT créés depuis un devis
validé ont déjà un numéro continu OT-AAAA-NNNN (trigger de la migration 156).

Ce trigger donne la même numérotation continue aux autres OT : quand le numéro est vide ou de
l'ancien format aléatoire, il est remplacé par OT-AAAA-NNNN (suivant de l'année en cours).
Les numéros déjà au bon format (OT créés depuis un devis) ne sont pas modifiés.
Un verrou empêche deux enregistrements simultanés de prendre le même numéro.
*/

CREATE OR REPLACE FUNCTION public.assign_work_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_seq  int;
BEGIN
  IF NEW.work_order_number IS NOT NULL
     AND NEW.work_order_number <> ''
     AND NEW.work_order_number !~ '^OT-[0-9]{8}-[0-9]{4}$' THEN
    RETURN NEW;
  END IF;

  -- One numbering at a time for the whole table, released at the end of the transaction
  PERFORM pg_advisory_xact_lock(hashtext('maintenance_work_orders.work_order_number'));

  SELECT COALESCE(MAX(
    CASE WHEN work_order_number ~ ('^OT-' || v_year || '-[0-9]+$')
    THEN CAST(SPLIT_PART(work_order_number, '-', 3) AS int)
    ELSE 0 END
  ), 0) + 1
  INTO v_seq
  FROM maintenance_work_orders;

  NEW.work_order_number := 'OT-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_work_order_number ON public.maintenance_work_orders;
CREATE TRIGGER trg_assign_work_order_number
  BEFORE INSERT ON public.maintenance_work_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_work_order_number();
