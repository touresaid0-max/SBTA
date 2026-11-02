/*
# Bons de commande de pièces : numérotation, droits et réception en une transaction

Constat (02/11/2026) : les écrans Stock utilisaient des tables et colonnes absentes de la base
(parts_inventory, spare_parts_purchase_order_items, po_number…). Ils ont été adaptés au schéma
réel : les lignes du bon sont dans la colonne JSON `items`, les pièces dans `spare_parts`.

1. Numérotation : l'écran enregistre un numéro provisoire unique (BC-TEMP-xxxxxxxx). Ce trigger le
   remplace par le suivant de l'année : BC-AAAA-NNNN. Les numéros existants ne changent pas.

2. Droits : seule la politique « Comptable can validate purchase orders » autorisait la
   modification des bons, et aucune leur suppression, alors que les écrans sont réservés à
   l'admin et au chef garage. Les politiques ajoutées ci-dessous complètent l'existant
   (aucune politique n'est supprimée ni désactivée) :
   - admin et chef garage peuvent modifier un bon ;
   - admin et chef garage peuvent supprimer un bon encore en brouillon (en_attente) ;
   - le chef garage peut gérer les fournisseurs (l'écran Fournisseurs lui est ouvert).

3. Réception : receive_purchase_order() enregistre en une seule transaction les mouvements
   d'entrée, la hausse du stock et les quantités reçues du bon. Si une étape échoue, rien n'est
   enregistré : le stock ne peut pas être compté deux fois. La fonction s'exécute avec les droits
   de l'utilisateur (SECURITY INVOKER) : les politiques RLS s'appliquent.
*/

-- ---------------------------------------------------------------------------
-- 1. Numérotation continue BC-AAAA-NNNN
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_purchase_order_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_seq  int;
BEGIN
  IF NEW.order_number IS NOT NULL
     AND NEW.order_number <> ''
     AND NEW.order_number NOT LIKE 'BC-TEMP-%' THEN
    RETURN NEW;
  END IF;

  -- One numbering at a time for the whole table, released at the end of the transaction
  PERFORM pg_advisory_xact_lock(hashtext('spare_parts_purchase_orders.order_number'));

  SELECT COALESCE(MAX(
    CASE WHEN order_number ~ ('^BC-' || v_year || '-[0-9]+$')
    THEN CAST(SPLIT_PART(order_number, '-', 3) AS int)
    ELSE 0 END
  ), 0) + 1
  INTO v_seq
  FROM spare_parts_purchase_orders;

  NEW.order_number := 'BC-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_purchase_order_number ON public.spare_parts_purchase_orders;
CREATE TRIGGER trg_assign_purchase_order_number
  BEFORE INSERT ON public.spare_parts_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_purchase_order_number();

-- ---------------------------------------------------------------------------
-- 2. Droits complémentaires (ajouts uniquement)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Garage can update purchase orders" ON public.spare_parts_purchase_orders;
CREATE POLICY "Garage can update purchase orders"
  ON public.spare_parts_purchase_orders FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'chef_garage'))
  WITH CHECK (public.get_user_role() IN ('admin', 'chef_garage'));

DROP POLICY IF EXISTS "Garage can delete draft purchase orders" ON public.spare_parts_purchase_orders;
CREATE POLICY "Garage can delete draft purchase orders"
  ON public.spare_parts_purchase_orders FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin', 'chef_garage') AND status = 'en_attente');

DROP POLICY IF EXISTS "Chef garage can manage suppliers" ON public.spare_parts_suppliers;
CREATE POLICY "Chef garage can manage suppliers"
  ON public.spare_parts_suppliers FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'chef_garage')
  WITH CHECK (public.get_user_role() = 'chef_garage');

-- ---------------------------------------------------------------------------
-- 3. Réception d'un bon de commande
--    p_lines : [{"index": 0, "quantity": 5}, ...]  (index = position de la ligne dans items)
--    Retourne le nouveau statut : 'livree' si tout est reçu, sinon 'validee'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_order_id uuid, p_lines jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order    spare_parts_purchase_orders%ROWTYPE;
  v_items    jsonb;
  v_line     jsonb;
  v_item     jsonb;
  v_idx      int;
  v_qty      int;
  v_received int;
  v_part_id  uuid;
  v_status   text;
  v_rows     int;
BEGIN
  SELECT * INTO v_order
  FROM spare_parts_purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bon de commande introuvable ou droits insuffisants';
  END IF;

  IF v_order.status <> 'validee' THEN
    RAISE EXCEPTION 'Seul un bon commandé (validee) peut être réceptionné (statut actuel : %)', v_order.status;
  END IF;

  v_items := COALESCE(v_order.items, '[]'::jsonb);

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_idx := (v_line->>'index')::int;
    v_item := v_items->v_idx;
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'Ligne % absente du bon de commande', v_idx;
    END IF;

    v_received := COALESCE((v_item->>'received_quantity')::numeric, 0)::int;
    v_qty := LEAST(
      COALESCE((v_line->>'quantity')::numeric, 0)::int,
      COALESCE((v_item->>'quantity')::numeric, 0)::int - v_received
    );
    CONTINUE WHEN v_qty <= 0;

    -- Lines saved without part_id (older orders) are matched by the part reference
    v_part_id := NULLIF(v_item->>'part_id', '')::uuid;
    IF v_part_id IS NULL THEN
      SELECT id INTO v_part_id FROM spare_parts WHERE part_number = v_item->>'part_number';
    END IF;
    IF v_part_id IS NULL THEN
      RAISE EXCEPTION 'Pièce % introuvable dans le stock', v_item->>'part_number';
    END IF;

    INSERT INTO spare_parts_stock_movements
      (part_id, movement_type, quantity, reference_type, reference_id, notes, performed_by)
    VALUES
      (v_part_id, 'entree', v_qty, 'purchase_order', v_order.id,
       'Réception BC ' || v_order.order_number, auth.uid());

    UPDATE spare_parts
    SET stock_quantity = COALESCE(stock_quantity, 0) + v_qty,
        updated_at = now()
    WHERE id = v_part_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'Droits insuffisants pour modifier le stock de la pièce %', v_item->>'part_number';
    END IF;

    v_items := jsonb_set(
      v_items,
      ARRAY[v_idx::text],
      v_item || jsonb_build_object('part_id', v_part_id, 'received_quantity', v_received + v_qty)
    );
  END LOOP;

  SELECT CASE WHEN bool_and(
           COALESCE((e->>'received_quantity')::numeric, 0) >= COALESCE((e->>'quantity')::numeric, 0)
         ) THEN 'livree' ELSE 'validee' END
  INTO v_status
  FROM jsonb_array_elements(v_items) e;

  UPDATE spare_parts_purchase_orders
  SET items = v_items,
      status = COALESCE(v_status, 'validee')
  WHERE id = v_order.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Droits insuffisants pour modifier le bon de commande';
  END IF;

  RETURN COALESCE(v_status, 'validee');
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb) TO authenticated;
