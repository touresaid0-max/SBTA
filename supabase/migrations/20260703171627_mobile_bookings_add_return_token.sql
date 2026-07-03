/*
# Add secure return token to mobile bookings

Adds an opaque, single-use-style return token to `mobile_bookings` so the
Wave payment redirect (success_url / error_url) can reference a booking via a
non-guessable token instead of exposing the raw booking id / reference in the
link. This protects ticket and payment information in the URL that transits
through the Wave checkout and the mobile WebView.

1. Modified Tables
   - `mobile_bookings`
     - `return_token` (text, nullable): random token generated when a Wave
       checkout session is created. Used only to resolve the booking on the
       payment-return screen. Does NOT change any ticket data or amounts.
2. Indexes
   - Unique index on `return_token` (ignoring NULLs) for fast, unambiguous
     lookups.
3. Security
   - No RLS change: the existing owner-scoped SELECT policy still governs
     access, so a user can only resolve a token for a booking they own.

## Notes
1. Purely additive and idempotent. No data is modified or removed.
2. Confirmation logic and payment calculations are untouched.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mobile_bookings' AND column_name = 'return_token'
  ) THEN
    ALTER TABLE mobile_bookings ADD COLUMN return_token text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS mobile_bookings_return_token_key
  ON mobile_bookings (return_token)
  WHERE return_token IS NOT NULL;
