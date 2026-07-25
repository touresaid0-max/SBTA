/*
# Période d'essai automatique des chauffeurs (module Logistique)

## But
Mettre en place la gestion automatique de la période d'essai de 3 mois pour
les chauffeurs créés depuis le module Responsable Logistique > Bus / Chauffeurs.

1. Nouvelles colonnes sur `employees`
- `probation_end_date` (date, nullable) — date de fin de la période d'essai,
  calculée automatiquement à `hire_date + 3 mois` lors de la création du chauffeur.
- `probation_treated_at` (timestamptz, nullable) — date à laquelle le Responsable
  Logistique a traité (confirmé) l'alerte de fin de période d'essai. NULL = non traitée.
- `probation_treated_by` (uuid, nullable) — identifiant de l'utilisateur ayant traité l'alerte.

2. Backfill des chauffeurs existants
- Pour tous les chauffeurs (`role = 'chauffeur'`) ayant une `hire_date` et sans
  `probation_end_date`, celle-ci est calculée à `hire_date + 3 mois`.
- Les chauffeurs dont la période est déjà terminée (fin < aujourd'hui) restent
  non traités côté base, mais l'UI ne les affichera plus (la fenêtre d'alerte est passée).

3. Sécurité
- Aucune modification RLS : l'accès se fait via la edge function `logistique-drivers`
  qui utilise la service role (bypass RLS). Les colonnes héritent donc des droits
  déjà accordés aux politiques existantes sur `employees`.

4. Notes importantes
- La période d'essai dure 3 mois à compter de la date d'embauche.
- L'alerte apparaît 10 jours avant la fin et disparaît après la fin de la période
  ou dès qu'elle est traitée par le Responsable Logistique.
- Après la fin de la période d'essai, le chauffeur n'apparaît plus dans les alertes.
*/

ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_treated_at timestamptz;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_treated_by uuid;

-- Backfill : calculer probation_end_date = hire_date + 3 mois pour les chauffeurs existants
UPDATE employees
SET probation_end_date = (hire_date::date + INTERVAL '3 months')::date
WHERE role = 'chauffeur'
  AND hire_date IS NOT NULL
  AND probation_end_date IS NULL;
