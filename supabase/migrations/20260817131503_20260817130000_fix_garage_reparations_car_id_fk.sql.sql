/*
# Fix garage_reparations foreign key constraint error

1. Purpose
   When a part exit (garage_sorties_pieces) is created with a bus_id (from the
   `buses` table) stored in car_id, the auto_create_reparation trigger copied
   that bus id into garage_reparations.car_id — but car_id references
   `garage_cars`, not `buses`. This caused:
   "insert or update on table garage_reparations violates foreign key
   constraint garage_reparations_car_id_fkey".

2. Root cause
   - garage_reparations.car_id is NOT NULL and FK → garage_cars(id).
   - The frontend selects cars from `buses` and stores the bus id in car_id
     on garage_sorties_pieces (the sorties table's car_id FK was relaxed to
     accept bus ids in a prior migration).
   - The trigger then inserted that same bus id into garage_reparations.car_id,
     which still has the strict FK to garage_cars.

3. Fix (server side)
   - Make garage_reparations.car_id nullable (it already has bus_id as the
     primary link to `buses`). Old rows keep their garage_cars id; new rows
     from the trigger set car_id = NULL and bus_id = the resolved bus id.
   - Drop the strict FK garage_reparations_car_id_fkey (→ garage_cars) and
     recreate it as ON DELETE SET NULL so nulls are allowed.
   - Update the trigger to NOT copy NEW.car_id into garage_reparations.car_id.
     Instead, try to resolve a garage_cars row matching the bus registration;
     if found use that garage_car id, otherwise leave car_id NULL and only set
     bus_id.

4. Data safety
   - No data is deleted. Existing car_id values pointing to garage_cars remain
     valid. The column simply becomes nullable so new bus-based rows can omit it.

5. Note on fetchReparations
   The `technicien:users(...)` join is also removed from the service query
   because there is no direct FK between garage_reparations and auth.users
   (technicien_id references auth.users but PostgREST does not expose auth.users
   to the anon key). The frontend already falls back to '—' when technicien is
   null.
*/

-- 1. Make car_id nullable
ALTER TABLE public.garage_reparations ALTER COLUMN car_id DROP NOT NULL;

-- 2. Recreate the FK as ON DELETE SET NULL (allows NULL car_id)
ALTER TABLE public.garage_reparations DROP CONSTRAINT IF EXISTS garage_reparations_car_id_fkey;
ALTER TABLE public.garage_reparations
  ADD CONSTRAINT garage_reparations_car_id_fkey
  FOREIGN KEY (car_id) REFERENCES public.garage_cars(id) ON DELETE SET NULL;

-- 3. Update the trigger function to avoid inserting a bus id into car_id
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
  v_reparation_id uuid;
BEGIN
  -- Resolve bus_id: NEW.car_id may be a bus id directly
  SELECT id INTO v_bus_id FROM public.buses WHERE id = NEW.car_id LIMIT 1;

  -- Fallback: match by registration_number via garage_cars
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

  -- Try to find a matching garage_cars row for this bus (for car_id compat)
  SELECT gc.id INTO v_garage_car_id
  FROM public.garage_cars gc
  JOIN public.buses b ON b.registration_number = gc.immatriculation
  WHERE b.id = v_bus_id
  LIMIT 1;

  -- Check for an active repair (statut != LIBÉRÉ)
  SELECT id INTO v_existing_reparation_id
  FROM public.garage_reparations
  WHERE bus_id = v_bus_id AND statut != 'LIBÉRÉ'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_reparation_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Create a new BROUILLON repair; car_id only set if a garage_cars match exists
  INSERT INTO public.garage_reparations (bus_id, car_id, date, statut, description, source_sortie_id)
  VALUES (v_bus_id, v_garage_car_id, NEW.date, 'BROUILLON', 'Créée automatiquement depuis sortie de pièces', NEW.id)
  RETURNING id INTO v_reparation_id;

  RETURN NEW;
END;
$$;
