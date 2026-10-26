/*
# Associate bagagistes using TPE with guichet to a POS counter

1. Purpose
- Store the POS counter selected by an administrator for a bagagiste who uses the deferred-payment mode.
- Keep the association optional so existing bagagistes and the direct-payment mode are unchanged.

2. Modified tables
- `public.users`
- Add `tpe_counter_id` (uuid, nullable): the POS counter that receives deferred baggage payments for this bagagiste.
- Add a foreign key to `public.counters(id)` so only an existing counter can be selected.

3. Security
- No new table or policy is created.
- Existing `users` table RLS and grants remain in force.
- The application writes this field through the existing administrator account-management flow.

4. Important behavior
- This field is used only when `tpe_pos_enabled` is true and `tpe_mode` is `avec_guichet`.
- Clearing TPE-POS access clears the association in the application.
*/

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tpe_counter_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_tpe_counter_id_fkey'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_tpe_counter_id_fkey
      FOREIGN KEY (tpe_counter_id) REFERENCES public.counters(id)
      ON DELETE SET NULL;
  END IF;
END $$;
