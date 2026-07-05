/*
# Système d'archivage intelligent SBTA/EAFRIBUS — Partie 3: Planification & index

## Résumé
Active la planification automatique (Cron Job nocturne) et ajoute des index de
performance sur les colonnes d'ancienneté des tables volumineuses, afin
d'accélérer à la fois l'archivage et les recherches, sans modifier la logique métier.

## Changements
1. Extension `pg_cron` activée (si disponible dans l'environnement).
2. Tâche planifiée `sbta-nightly-archive` — exécute `run_archive('auto', NULL)`
   chaque nuit à 02h00 (heure serveur). Idempotent: recréée proprement.
   L'ensemble est protégé: si pg_cron n'est pas disponible, la migration réussit
   quand même et l'archivage reste déclenchable manuellement (bouton "Archiver maintenant").
3. Index de performance (IF NOT EXISTS) sur les colonnes de date des tables actives
   principales: reservations, payments, schedules, parcels, mobile_bookings,
   baggage_tickets. Accélère l'éligibilité à l'archivage et les rapports par période.

## Notes importantes
1. Aucune donnée n'est supprimée ni déplacée par cette migration.
2. Le partitionnement physique des tables existantes n'est PAS appliqué ici: il
   nécessiterait une réécriture des tables et présenterait un risque pour la
   logique métier. L'extension `pg_partman` reste disponible pour une évolution future.
*/

-- 1. Performance indexes on active tables (safe, additive)
CREATE INDEX IF NOT EXISTS idx_reservations_created_at ON reservations (created_at);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at);
CREATE INDEX IF NOT EXISTS idx_schedules_departure_dt ON schedules (departure_datetime);
CREATE INDEX IF NOT EXISTS idx_parcels_created_at ON parcels (created_at);
CREATE INDEX IF NOT EXISTS idx_mobile_bookings_created_at ON mobile_bookings (created_at);
CREATE INDEX IF NOT EXISTS idx_baggage_tickets_created_at ON baggage_tickets (created_at);

-- 2. Nightly scheduler (best-effort; won't fail the migration if pg_cron is unavailable)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  -- Recreate the job idempotently
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sbta-nightly-archive') THEN
    PERFORM cron.unschedule('sbta-nightly-archive');
  END IF;

  PERFORM cron.schedule(
    'sbta-nightly-archive',
    '0 2 * * *',
    $cron$ SELECT public.run_archive('auto', NULL); $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponible, planification ignorée: %', SQLERRM;
END $$;
