/*
# Add the concerned part to garage repairs

## Purpose
Make the part concerned by a repair explicit and keep it linked to the spare-part
catalog used by garage part exits.

## Database changes
1. Modified table `garage_reparations`
   - Add nullable `piece_id`, referencing `garage_pieces`.
   - Existing repairs remain valid; the field is nullable for repairs created
     before this feature or repairs that do not come from a part exit.
2. Data backfill
   - Repairs created from a part exit inherit the part from their source exit.
3. Automatic part-exit tracking
   - New repairs created automatically from `garage_sorties_pieces` now store
     the exit's `piece_id`.

## Security
- No new table or policy is introduced.
- Existing RLS policies remain in force.
- Deleting a catalog part only clears the repair link and never deletes repair history.

## Important notes
1. The existing repair status workflow is unchanged.
2. Existing repair creation, editing, deletion, stock handling, and notifications
   continue to work as before.
*/

ALTER TABLE public.garage_reparations
  ADD COLUMN IF NOT EXISTS piece_id uuid REFERENCES public.garage_pieces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_garage_reparations_piece
  ON public.garage_reparations(piece_id);

UPDATE public.garage_reparations r
SET piece_id = s.piece_id
FROM public.garage_sorties_pieces s
WHERE r.source_sortie_id = s.id
  AND r.piece_id IS NULL;

CREATE OR REPLACE FUNCTION public.auto_create_reparation_from_sortie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus_id uuid;
  v_existing_reparation_id uuid;
BEGIN
  SELECT id INTO v_bus_id FROM public.buses WHERE id = NEW.car_id LIMIT 1;

  IF v_bus_id IS NULL THEN
    SELECT b.id INTO v_bus_id
    FROM public.buses b
    JOIN public.garage_cars gc ON gc.immatriculation = b.registration_number
    WHERE gc.id = NEW.car_id
    LIMIT 1;
  END IF;

  IF v_bus_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_existing_reparation_id
  FROM public.garage_reparations
  WHERE bus_id = v_bus_id AND statut != 'LIBÉRÉ'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_reparation_id IS NOT NULL THEN RETURN NEW; END IF;

  INSERT INTO public.garage_reparations (
    bus_id, car_id, piece_id, date, statut, description, source_sortie_id
  ) VALUES (
    v_bus_id, NEW.car_id, NEW.piece_id, NEW.date, 'BROUILLON',
    'Créée automatiquement depuis sortie de pièces', NEW.id
  );

  RETURN NEW;
END;
$$;
