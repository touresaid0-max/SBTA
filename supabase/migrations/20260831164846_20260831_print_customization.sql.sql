/*
# Print Customization — Admin-managed text for bus tickets, parcel receipts, baggage receipts

1. New Tables
- `print_customization` (singleton, id = 1)
  - `bus_ticket_phones` (text[]) — phone lines shown in bus ticket header
  - `bus_ticket_notes` (text[]) — custom notes printed on bus tickets
  - `parcel_notes` (text[]) — custom notes printed on parcel receipts
  - `baggage_notes` (text[]) — custom notes printed on baggage receipts
  - `updated_at` (timestamptz) — last modification timestamp
  - `updated_by` (uuid) — user who last modified

2. Security
- Enable RLS on `print_customization`.
- Only `authenticated` users can read (all roles need to read for printing).
- Only `admin` role can insert/update/delete.
*/

CREATE TABLE IF NOT EXISTS print_customization (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bus_ticket_phones text[] NOT NULL DEFAULT ARRAY['01 14 34 60 / 01 14 34 87'],
  bus_ticket_notes text[] NOT NULL DEFAULT ARRAY[
    'NB : Tout ticket encaisse n''est plus remboursable.',
    'SBTA n''est pas responsable de ces bagages sans ticket.',
    'VEUILLEZ CONSERVER LES TICKETS JUSQU''A DESTINATION.'
  ],
  parcel_notes text[] NOT NULL DEFAULT ARRAY[
    'AUCUN REMBOURSEMENT N''EST POSSIBLE APRES ENCAISSEMENT.',
    'NB : PASSE UN DELAI DE 14 JOURS, SBTA N''EST PAS RESPONSABLE EN CAS DE PERTE DE COLIS.'
  ],
  baggage_notes text[] NOT NULL DEFAULT ARRAY[
    'AUCUN REMBOURSEMENT N''EST POSSIBLE APRES ENCAISSEMENT.',
    'NB : PASSE UN DELAI DE 14 JOURS, SBTA N''EST PAS RESPONSABLE EN CAS DE PERTE DE COLIS.'
  ],
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE print_customization ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_print_customization" ON print_customization;
CREATE POLICY "read_print_customization"
  ON print_customization FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "admin_insert_print_customization" ON print_customization;
CREATE POLICY "admin_insert_print_customization"
  ON print_customization FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS "admin_update_print_customization" ON print_customization;
CREATE POLICY "admin_update_print_customization"
  ON print_customization FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS "admin_delete_print_customization" ON print_customization;
CREATE POLICY "admin_delete_print_customization"
  ON print_customization FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
  );
