/*
# Photos des courriers : espace de stockage privé (audit m3)

L'espace `parcel-photos` est PUBLIC : toute personne qui a le lien d'une photo peut la voir,
sans compte. Il sert aussi aux justificatifs de dépenses des agents courrier (liens publics
enregistrés) : le rendre privé casserait ces liens.

Les photos des courriers vont donc dans un nouvel espace PRIVÉ, `courrier-photos` :
- lecture réservée aux comptes connectés, par liens signés de courte durée (1 h) ;
- dépôt uniquement dans le dossier du compte qui dépose : <id du compte>/<id du courrier>/<id>.jpg ;
- suppression uniquement par ce compte ;
- JPEG uniquement, 2 Mo au maximum (les photos sont réduites sur le poste : ≈ 200 à 600 ko).

Aucune photo de courrier n'existait avant (la prise de photo n'était proposée nulle part) :
rien à déplacer. L'application lit encore les anciennes photos publiques par leur lien.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('courrier-photos', 'courrier-photos', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/jpeg'];

-- Lecture (et liens signés) : comptes connectés
DROP POLICY IF EXISTS "Courrier photos readable by signed-in users" ON storage.objects;
CREATE POLICY "Courrier photos readable by signed-in users"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'courrier-photos');

-- Dépôt : dans son propre dossier seulement
DROP POLICY IF EXISTS "Courrier photos uploaded into own folder" ON storage.objects;
CREATE POLICY "Courrier photos uploaded into own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'courrier-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Suppression : ses propres photos seulement
DROP POLICY IF EXISTS "Courrier photos deleted by their author" ON storage.objects;
CREATE POLICY "Courrier photos deleted by their author"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'courrier-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
