/*
# Fix repair auto-tracking from stock sorties

## Problem
When multiple part exits (garage_sorties_pieces) were recorded for the same bus,
only the first one created a repair record (garage_reparations). Subsequent part
exits were silently skipped because the trigger checked for an existing active
repair (statut != 'LIBÉRÉ') and returned early. Additionally:
- piece_id was never set on auto-created repairs, so the piece was invisible
- car_id references garage_cars (which is empty); the trigger passed bus UUIDs
  which would violate the FK, so car_id was left NULL

For bus 0349 WWCI01 on 2026-09-22, 2 sorties were recorded but 0 repairs were
created because 4 existing BROUILLON repairs already existed for that bus.

## Fix
1. Replace auto_create_reparation_from_sortie() trigger function:
   - Always create a new repair per sortie (remove the skip-on-existing logic)
   - Set piece_id from the sortie
   - Set car_id to NULL (garage_cars table is empty; bus_id is the reliable link)
   - Include piece name and quantity in description
2. Backfill: for every sortie with no matching repair (via source_sortie_id),
   create one with piece_id and bus_id set.
3. Update existing auto-created repairs that have source_sortie_id but no piece_id.
*/

-- ===========================================================================
-- 1. Replace trigger function
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.auto_create_reparation_from_sortie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus_id uuid;
  v_reparation_id uuid;
  v_piece_nom text;
  v_description text;
BEGIN
  -- Resolve bus_id: try direct match on buses.id
  SELECT id INTO v_bus_id FROM public.buses WHERE id = NEW.car_id LIMIT 1;

  -- Fallback: match via garage_cars.immatriculation = buses.registration_number
  IF v_bus_id IS NULL THEN
    SELECT b.id INTO v_bus_id
    FROM public.buses b
    JOIN public.garage_cars gc ON gc.immatriculation = b.registration_number
    WHERE gc.id = NEW.car_id
    LIMIT 1;
  END IF;

  IF v_bus_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get piece name for description
  SELECT p.nom INTO v_piece_nom FROM public.garage_pieces p WHERE p.id = NEW.piece_id LIMIT 1;

  v_description := 'Sortie de pièces — ' || COALESCE(v_piece_nom, 'pièce inconnue') ||
                   ' (qté: ' || NEW.quantite || ')';

  -- Always create a new repair for this sortie (one repair per sortie)
  -- car_id is set to NULL because garage_cars is empty; bus_id is the reliable link
  INSERT INTO public.garage_reparations (bus_id, car_id, date, statut, description, source_sortie_id, piece_id)
  VALUES (v_bus_id, NULL, NEW.date, 'BROUILLON', v_description, NEW.id, NEW.piece_id)
  RETURNING id INTO v_reparation_id;

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 2. Backfill: create repairs for sorties that have no corresponding repair
-- ===========================================================================
INSERT INTO public.garage_reparations (bus_id, car_id, date, statut, description, source_sortie_id, piece_id)
SELECT
  b.id,
  NULL,
  sp.date,
  'BROUILLON',
  'Sortie de pièces — ' || COALESCE(p.nom, 'pièce inconnue') || ' (qté: ' || sp.quantite || ')',
  sp.id,
  sp.piece_id
FROM public.garage_sorties_pieces sp
LEFT JOIN public.garage_reparations r ON r.source_sortie_id = sp.id
LEFT JOIN public.buses b ON b.id = sp.car_id
LEFT JOIN public.garage_pieces p ON p.id = sp.piece_id
WHERE r.id IS NULL
  AND b.id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 3. Update existing auto-created repairs that have source_sortie_id but no piece_id
-- ===========================================================================
UPDATE public.garage_reparations r
SET piece_id = sp.piece_id,
    description = CASE
      WHEN r.description = 'Créée automatiquement depuis sortie de pièces'
      THEN 'Sortie de pièces — ' || COALESCE(p.nom, 'pièce inconnue') || ' (qté: ' || sp.quantite || ')'
      ELSE r.description
    END
FROM public.garage_sorties_pieces sp
LEFT JOIN public.garage_pieces p ON p.id = sp.piece_id
WHERE r.source_sortie_id = sp.id
  AND r.piece_id IS NULL;

-- ===========================================================================
-- 4. Reload schema cache
-- ===========================================================================
NOTIFY pgrst, 'reload schema';
