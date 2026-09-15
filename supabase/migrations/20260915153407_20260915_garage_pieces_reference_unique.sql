DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.garage_pieces'::regclass
      AND conname = 'garage_pieces_reference_key'
  ) THEN
    ALTER TABLE public.garage_pieces
      ADD CONSTRAINT garage_pieces_reference_key UNIQUE (reference);
  END IF;
END $$;