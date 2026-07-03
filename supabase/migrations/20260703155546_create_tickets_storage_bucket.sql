/*
# Create public storage bucket for e-tickets

This migration creates a Supabase Storage bucket used to host generated
e-ticket files (PDF and PNG). Hosting the files on a real HTTPS URL is
required so that the SBTA mobile app running inside the WebToNative Android
WebView can (a) download the PDF through Android's native DownloadManager and
(b) share the PNG through the native share sheet — both of which fail with
in-memory blob URLs inside that wrapper.

1. Storage
   - New bucket `tickets` (public read) for generated e-ticket files.
2. Security
   - Public read access to files in the `tickets` bucket (needed so the
     hosted HTTPS URL can be opened / shared by any recipient).
   - Authenticated users may upload files into the `tickets` bucket.
   - Authenticated users may update/overwrite their uploaded files (allows
     regenerating a ticket export with the same name).

## Notes
1. The bucket is public so the resulting links work when shared to WhatsApp,
   Messages, mail, etc. Files only contain the e-ticket the user already sees.
2. No destructive operations are performed.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('tickets', 'tickets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "public_read_tickets" ON storage.objects;
CREATE POLICY "public_read_tickets" ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'tickets');

DROP POLICY IF EXISTS "authenticated_insert_tickets" ON storage.objects;
CREATE POLICY "authenticated_insert_tickets" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'tickets');

DROP POLICY IF EXISTS "authenticated_update_tickets" ON storage.objects;
CREATE POLICY "authenticated_update_tickets" ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'tickets')
WITH CHECK (bucket_id = 'tickets');
