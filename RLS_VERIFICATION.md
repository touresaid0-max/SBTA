# SBTA Platform - Vérification RLS (Row Level Security)

## 🔒 Importance Critique de RLS

**Row Level Security (RLS)** est LA sécurité de la plateforme SBTA. Sans RLS correctement configuré, n'importe quel utilisateur pourrait voir/modifier les données d'autres utilisateurs.

## ✅ Checklist Complète par Table

### Tables Principales

#### 1. `users`

- [x] RLS activé
- [x] Politique SELECT : Utilisateurs peuvent lire leur propre profil + admin peut tout lire
- [x] Politique UPDATE : Utilisateurs peuvent mettre à jour leur profil uniquement
- [x] Politique INSERT : Seulement lors inscription (gérée par trigger Supabase Auth)
- [x] Politique DELETE : Admin uniquement

**Test** :
```sql
-- En tant que client A
SELECT * FROM users WHERE id = '<client-b-id>';
-- Doit retourner 0 résultats
```

#### 2. `companies`

- [x] RLS activé
- [x] Politique SELECT : Tous les utilisateurs authentifiés peuvent lire
- [x] Politique INSERT/UPDATE/DELETE : Admin uniquement

**Test** :
```sql
-- En tant que gestionnaire
UPDATE companies SET name = 'Test' WHERE id = '<company-id>';
-- Doit échouer
```

#### 3. `buses`

- [x] RLS activé
- [x] Politique SELECT : Tous authentifiés lisent
- [x] Politique UPDATE : Admin + gestionnaire de la société propriétaire
- [x] Politique INSERT/DELETE : Admin uniquement

**Test** :
```sql
-- En tant que gestionnaire société A
UPDATE buses SET status = 'disponible' WHERE company_id = '<societe-b-id>';
-- Doit échouer
```

#### 4. `routes`

- [x] RLS activé
- [x] Politique SELECT : Public (non authentifiés aussi) pour recherche voyages
- [x] Politique INSERT/UPDATE/DELETE : Admin uniquement

#### 5. `schedules`

- [x] RLS activé
- [x] Politique SELECT : Public pour recherche
- [x] Politique INSERT : Planificateur + admin
- [x] Politique UPDATE : Planificateur + admin + chauffeur (pour statut uniquement)
- [x] Politique DELETE : Admin uniquement

**Test** :
```sql
-- En tant que client
DELETE FROM schedules WHERE id = '<schedule-id>';
-- Doit échouer
```

#### 6. `reservations`

- [x] RLS activé
- [x] Politique SELECT :
  - Client voit ses propres réservations
  - Admin, comptable, guichetier voient tout
  - Gestionnaire voit réservations de sa société
- [x] Politique INSERT : Client + guichetier
- [x] Politique UPDATE : Client (annulation), guichetier (embarquement), admin
- [x] Politique DELETE : Admin uniquement

**Test critique** :
```sql
-- En tant que client A
SELECT * FROM reservations WHERE client_id = '<client-b-id>';
-- Doit retourner 0 résultats

-- En tant que client A
UPDATE reservations SET total_amount = 1000 WHERE client_id = '<client-a-id>';
-- Doit échouer (sauf pour annulation)
```

### Tables Financières

#### 7. `expenses`

- [x] RLS activé
- [x] Politique SELECT :
  - DAF, comptable, admin : tout
  - Gestionnaire : seulement sa société
  - Créateur : sa propre dépense
- [x] Politique INSERT : Tous roles internes
- [x] Politique UPDATE : Comptable (validation), créateur (brouillon uniquement)
- [x] Politique DELETE : Admin uniquement (soft delete préféré)

**Test** :
```sql
-- En tant que DAF
UPDATE expenses SET status = 'validee' WHERE id = '<expense-id>';
-- Doit échouer (seul comptable valide)

-- En tant que DAF
SELECT * FROM expenses;
-- Doit réussir (lecture seule)
```

#### 8. `fuel_vouchers`

- [x] RLS activé
- [x] Politique SELECT :
  - Chauffeur : ses propres bons
  - Pompiste : tous les bons
  - Comptable, admin : tous
- [x] Politique INSERT : Auto (trigger depuis schedule)
- [x] Politique UPDATE :
  - Chauffeur : remplir ses bons (status en_attente → soumis)
  - Pompiste : valider distribution
  - Comptable : validation finale
- [x] Politique DELETE : Admin uniquement

**Test** :
```sql
-- En tant que chauffeur A
UPDATE fuel_vouchers SET status = 'validee' WHERE driver_id = '<chauffeur-a-id>';
-- Doit échouer (seul comptable valide)

-- En tant que chauffeur A
SELECT * FROM fuel_vouchers WHERE driver_id = '<chauffeur-b-id>';
-- Doit retourner 0 résultats
```

### Tables Maintenance

#### 9. `breakdown_reports`

- [x] RLS activé
- [x] Politique SELECT : Chauffeur (ses rapports), chef garage, mécanicien, admin
- [x] Politique INSERT : Chauffeur
- [x] Politique UPDATE : Chef garage, mécanicien (assigné)
- [x] Politique DELETE : Admin

#### 10. `maintenance_work_orders`

- [x] RLS activé
- [x] Politique SELECT : Mécanicien (ses OT), chef garage, comptable, admin
- [x] Politique INSERT : Chef garage, mécanicien
- [x] Politique UPDATE :
  - Comptable : validation budget
  - Mécanicien : exécution
  - Chef garage : contrôle qualité
- [x] Politique DELETE : Admin

**Test** :
```sql
-- En tant que mécanicien A
UPDATE maintenance_work_orders SET status = 'approuvee'
WHERE mechanic_id = '<mecanicien-a-id>';
-- Doit échouer (seul chef garage approuve)
```

### Tables Stock

#### 11. `parts`

- [x] RLS activé
- [x] Politique SELECT : Tous roles internes
- [x] Politique INSERT/UPDATE : Chef garage, admin
- [x] Politique DELETE : Admin

#### 12. `stock_movements`

- [x] RLS activé
- [x] Politique SELECT : Tous roles internes
- [x] Politique INSERT : Mécanicien (consommation), gestionnaire stock
- [x] Politique UPDATE/DELETE : Admin uniquement (traçabilité)

#### 13. `purchase_orders`

- [x] RLS activé
- [x] Politique SELECT : Comptable, admin, gestionnaire stock
- [x] Politique INSERT : Gestionnaire stock
- [x] Politique UPDATE : Comptable (validation), gestionnaire stock (réception)
- [x] Politique DELETE : Admin

### Tables Fidélité

#### 14. `loyalty_points_log`

- [x] RLS activé
- [x] Politique SELECT : Client (son historique), admin
- [x] Politique INSERT : Système (trigger auto)
- [x] Politique UPDATE/DELETE : Interdit (immuable)

**Test** :
```sql
-- En tant que client A
SELECT * FROM loyalty_points_log WHERE user_id = '<client-b-id>';
-- Doit retourner 0 résultats

-- En tant que client A
DELETE FROM loyalty_points_log WHERE user_id = '<client-a-id>';
-- Doit échouer
```

#### 15. `loyalty_redemptions`

- [x] RLS activé
- [x] Politique SELECT : Client (ses échanges), guichetier, admin
- [x] Politique INSERT : Client
- [x] Politique UPDATE : Guichetier (utilisation)
- [x] Politique DELETE : Admin

#### 16. `loyalty_rewards_catalog`

- [x] RLS activé
- [x] Politique SELECT : Public (tous voient catalogue)
- [x] Politique INSERT/UPDATE/DELETE : Admin

#### 17. `driver_reviews`

- [x] RLS activé
- [x] Politique SELECT :
  - Client : ses propres évaluations
  - Chauffeur : évaluations le concernant
  - Admin : tout
- [x] Politique INSERT : Client (avec réservation valide)
- [x] Politique UPDATE/DELETE : Admin uniquement

**Test** :
```sql
-- En tant que client A
INSERT INTO driver_reviews (client_id, driver_id, rating, reservation_id)
VALUES ('<client-b-id>', '<driver-id>', 5, '<reservation-id>');
-- Doit échouer (ne peut pas usurper identité)
```

## 🧪 Tests de Sécurité à Effectuer

### Test 1 : Isolation Client

```sql
-- Se connecter comme client A
-- Tenter d'accéder données client B
SELECT * FROM reservations WHERE client_id != auth.uid();
SELECT * FROM loyalty_points_log WHERE user_id != auth.uid();

-- Résultat attendu : 0 lignes
```

### Test 2 : Lecture Seule DAF

```sql
-- Se connecter comme DAF
-- Lecture doit fonctionner
SELECT * FROM expenses;
SELECT * FROM fuel_vouchers;

-- Écriture doit échouer
UPDATE expenses SET status = 'validee' WHERE id = '<any-id>';
DELETE FROM expenses WHERE id = '<any-id>';

-- Résultat attendu : SELECT OK, UPDATE/DELETE FAIL
```

### Test 3 : Validation Comptable

```sql
-- Se connecter comme comptable
-- Validation doit fonctionner
UPDATE expenses SET status = 'validee' WHERE id = '<pending-expense>';
UPDATE fuel_vouchers SET status = 'validee' WHERE id = '<submitted-voucher>';

-- Suppression doit échouer
DELETE FROM expenses WHERE id = '<any-id>';

-- Résultat attendu : UPDATE OK, DELETE FAIL
```

### Test 4 : Gestionnaire Société

```sql
-- Se connecter comme gestionnaire société A
-- Voir seulement sa société
SELECT * FROM buses WHERE company_id = '<current-user-company>';
SELECT * FROM reservations
WHERE schedule_id IN (
  SELECT id FROM schedules WHERE bus_id IN (
    SELECT id FROM buses WHERE company_id = '<current-user-company>'
  )
);

-- Ne peut pas voir société B
SELECT * FROM buses WHERE company_id = '<other-company>';

-- Résultat attendu : Société A visible, société B = 0 lignes
```

### Test 5 : Chauffeur Limité

```sql
-- Se connecter comme chauffeur A
-- Voir ses bons uniquement
SELECT * FROM fuel_vouchers WHERE driver_id = auth.uid();

-- Ne peut voir bons d'autres chauffeurs
SELECT * FROM fuel_vouchers WHERE driver_id != auth.uid();

-- Résultat attendu : Ses bons visibles, autres = 0 lignes
```

## 🛡️ Vérification Automatique

Script SQL pour vérifier que RLS est activé partout :

```sql
-- Lister tables SANS RLS activé
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN (
    SELECT tablename
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.rowsecurity = true
  );

-- Résultat attendu : Liste vide
```

## ⚠️ Alertes Sécurité

### 🔴 CRITIQUE

Si UNE SEULE table n'a pas RLS activé :
- **Toutes les données sont exposées**
- **N'importe quel utilisateur peut tout lire/modifier**

### 🟠 IMPORTANT

Politiques RLS mal configurées = failles :
- `USING (true)` → Pas de restriction
- Pas de `WITH CHECK` sur UPDATE → Modification non contrôlée
- Oubli de vérifier `auth.uid()` → Usurpation possible

### ✅ BON

- Chaque politique vérifie `auth.uid()` ou `auth.jwt()`
- `USING` pour SELECT
- `WITH CHECK` pour INSERT/UPDATE
- Tests de sécurité passés

## 📋 Commandes Utiles

### Vérifier RLS d'une table

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'reservations';
```

### Lister politiques d'une table

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'reservations';
```

### Activer RLS manuellement

```sql
ALTER TABLE nom_table ENABLE ROW LEVEL SECURITY;
```

## ✅ Validation Finale

Avant mise en production, vérifier :

- [ ] RLS activé sur les 25+ tables
- [ ] Au moins 3 politiques par table (SELECT, INSERT/UPDATE, DELETE)
- [ ] Tests sécurité passés pour chaque rôle
- [ ] Logs Supabase sans erreurs RLS
- [ ] Audit de sécurité effectué
- [ ] Documentation RLS à jour

**RLS = LIGNE DE DÉFENSE #1 de la plateforme SBTA !**

---

# Tests de Connexion - 8 Avril 2026

## Migration 020 Appliquée - Correction Récursion

### Corrections Effectuées

**Problème identifié:**
- Tables `driver_performance_badges` et `loyalty_redemptions` avaient des politiques avec récursion
- Pattern problématique: `EXISTS (SELECT FROM users WHERE id = auth.uid() AND role = ...)`

**Solution appliquée:**
- Remplacement par la fonction `has_role()` qui utilise `SECURITY DEFINER`
- Suppression de toutes les sous-requêtes sur la table `users`

### Politiques Corrigées

#### driver_performance_badges
- ✅ `admin_view_performance` - Utilise `has_role('admin')` au lieu de sous-requête
- ✅ `driver_view_own_badges` - Simple comparaison `driver_id = auth.uid()`

#### loyalty_redemptions
- ✅ `staff_view_redemptions` - Utilise `has_role()` au lieu de sous-requête
- ✅ `staff_update_redemptions` - Utilise `has_role()` au lieu de sous-requête
- ✅ `customer_view_own_redemptions` - Simple comparaison `customer_id = auth.uid()`

## ✅ Vérification Finale - Aucune Récursion Détectée

**Requête de vérification:**
```sql
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename != 'users'
  AND (qual::text LIKE '%EXISTS%SELECT%FROM users%')
```

**Résultat:** 0 lignes (aucune politique récursive trouvée)

## ✅ Tous les Comptes Prêts

| Email | Rôle | Profil | Auth | Status |
|-------|------|--------|------|--------|
| admin@sbta.ci | admin | ✅ | ✅ | READY |
| daf@sbta.ci | daf | ✅ | ✅ | READY |
| comptable@sbta.ci | comptable | ✅ | ✅ | READY |
| gest.express@sbta.ci | gestionnaire | ✅ | ✅ | READY |
| planif1@sbta.ci | planificateur | ✅ | ✅ | READY |
| guichet1@sbta.ci | guichetier | ✅ | ✅ | READY |
| chauffeur1@sbta.ci | chauffeur | ✅ | ✅ | READY |
| chefgarage1@sbta.ci | chef_garage | ✅ | ✅ | READY |
| meca1@sbta.ci | mecanicien | ✅ | ✅ | READY |
| pompiste1@sbta.ci | pompiste | ✅ | ✅ | READY |

**Mot de passe pour tous:** `Password123!`

## Tests de Connexion à Effectuer

### Test Admin (Déjà validé ✅)
```
Email: admin@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /admin/dashboard
```

### Test DAF
```
Email: daf@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /daf/dashboard
```

### Test Comptable
```
Email: comptable@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /comptable/dashboard
```

### Test Gestionnaire
```
Email: gest.express@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /gestionnaire/dashboard
```

### Test Planificateur
```
Email: planif1@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /planificateur/dashboard
```

### Test Guichetier
```
Email: guichet1@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /guichetier/dashboard
```

### Test Chauffeur
```
Email: chauffeur1@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /chauffeur/dashboard
```

### Test Chef Garage
```
Email: chefgarage1@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /garage/dashboard
```

### Test Mécanicien
```
Email: meca1@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /mecanicien/dashboard
```

### Test Pompiste
```
Email: pompiste1@sbta.ci
Password: (voir le gestionnaire de mots de passe)
Attendu: /pompiste/dashboard
```

## Migrations Appliquées

1. **018_fix_infinite_recursion_rls** - Politiques simples sur table users
2. **019_add_admin_functions** - Fonctions SECURITY DEFINER
3. **020_fix_all_rls_recursion** - Correction politiques sur autres tables

**Status:** ✅ Prêt pour tests de connexion
