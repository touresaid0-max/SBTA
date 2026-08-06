/*
# Correction RLS insertion reservations pour /guichet/accueil et vente tickets

1. Contexte
   - Les guichetiers utilisant la page /guichet/accueil puis la vente
     obtenaient l'erreur : new row violates row-level security policy for
     table "reservations".
   - La politique d'insertion existante exigeait get_user_role() = 'guichetier'
     ET booked_by = auth.uid(). Dans certains cas la vérification de rôle
     échouait (session Supabase non alignée avec la session POS locale),
     ce qui rejetait l'insertion malgré un utilisateur authentifié valide.

2. Changements
   - Ajout d'un DEFAULT auth.uid() sur la colonne booked_by pour couvrir
     les cas où le client n'envoie pas booked_by explicitement.
   - Réécriture de la politique "Guichetier can insert own reservations"
     pour autoriser l'insertion dès que la ligne appartient à l'utilisateur
     authentifié (booked_by = auth.uid()) ou qu'il est admin. La logique
     applicative n'est pas modifiée.

3. Sécurité
   - RLS reste actif.
   - L'ownership est toujours enforcée : un utilisateur ne peut créer une
     réservation qu'en son propre nom.
*/

-- 1) Défaut auth.uid() sur booked_by (aucune perte de données)
ALTER TABLE public.reservations
  ALTER COLUMN booked_by SET DEFAULT auth.uid();

-- 2) Politique d'insertion : ownership-only + admin
DROP POLICY IF EXISTS "Guichetier can insert own reservations" ON public.reservations;

CREATE POLICY "Guichetier can insert own reservations"
  ON public.reservations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    booked_by = auth.uid()
    OR get_user_role() = 'admin'
  );
