/*
# Fix automatic repair creation from part exits

## Purpose
Prevent part exits from failing when the selected vehicle is a row from `buses`.
The exit form stores the selected bus ID in `garage_sorties_pieces.car_id`, while
`garage_reparations.car_id` references the legacy `garage_cars` table.

## Modified behavior
1. Resolve the selected bus from the exit's `car_id`.
2. Resolve a matching legacy `garage_cars` row by registration number when one exists.
3. Insert the repair with the resolved legacy car ID or NULL, and always use the
   resolved bus ID in `bus_id`.
4. Preserve the selected `piece_id` from the exit on the automatic repair.

## Security
- The existing SECURITY DEFINER trigger function remains protected with a fixed
  `public` search path.
- No RLS policy is changed.

## Data safety
- No rows are deleted or changed retroactively.
- Existing repair status, notification, and stock logic is unchanged.
- New bus-based exits no longer violate the legacy `car_id` foreign key.
*/

CREATE OR REPLACE FUNCTION public.auto_create_reparation_from_sortie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bus_id uuid;
  v_garage_car_id uuid;
  v_existing_reparation_id uuid;
BEGIN
  SELECT id INTO v_bus_id
  FROM public.buses
  WHERE id = NEW.car_id
  LIMIT 1;

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

  SELECT gc.id INTO v_garage_car_id
  FROM public.garage_cars gc
  JOIN public.buses b ON b.registration_number = gc.immatriculation
  WHERE b.id = v_bus_id
  LIMIT 1;

  SELECT id INTO v_existing_reparation_id
  FROM public.garage_reparations
  WHERE bus_id = v_bus_id
    AND statut != 'LIBÉRÉ'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_reparation_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.garage_reparations (
    bus_id,
    car_id,
    piece_id,
    date,
    statut,
    description,
    source_sortie_id
  ) VALUES (
    v_bus_id,
    v_garage_car_id,
    NEW.piece_id,
    NEW.date,
    'BROUILLON',
    'Créée automatiquement depuis sortie de pièces',
    NEW.id
  );

  RETURN NEW;
END;
$$;
