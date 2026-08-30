ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS delivery_recipient_name   text,
  ADD COLUMN IF NOT EXISTS delivery_recipient_phone  text,
  ADD COLUMN IF NOT EXISTS delivery_id_type          text CHECK (delivery_id_type IS NULL OR delivery_id_type = ANY (ARRAY['cni', 'phone', 'name'])),
  ADD COLUMN IF NOT EXISTS delivery_id_number        text;

COMMENT ON COLUMN public.parcels.delivery_recipient_name  IS 'Nom du client ayant retiré le colis (traçabilité du retrait)';
COMMENT ON COLUMN public.parcels.delivery_recipient_phone IS 'Numéro de téléphone du client ayant retiré le colis';
COMMENT ON COLUMN public.parcels.delivery_id_type         IS 'Type de pièce d''identité fournie: cni, phone, ou name';
COMMENT ON COLUMN public.parcels.delivery_id_number       IS 'Numéro de la pièce d''identité (CNI ou téléphone) du client ayant retiré';
