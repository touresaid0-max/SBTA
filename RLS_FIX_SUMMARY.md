# Correction du Problème RLS - Récursion Infinie

## Problème Identifié

### Erreurs Rencontrées:
1. **Admin:** `infinite recursion detected in policy for relation "users"`
2. **Autres profils:** `Database error querying schema`

### Cause Racine:
Les politiques RLS (Row Level Security) créaient une **récursion infinie** :

```sql
-- Ancienne politique (PROBLÉMATIQUE)
CREATE POLICY "Enable read access for admin to all users"
  ON users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users  -- ⚠️ RÉCURSION!
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

**Explication de la récursion:**
1. Utilisateur essaie de se connecter → requête `SELECT * FROM users WHERE id = auth.uid()`
2. RLS vérifie la politique → `EXISTS (SELECT FROM users WHERE ...)`
3. Cette sous-requête déclenche à nouveau les politiques RLS
4. Boucle infinie → PostgreSQL détecte et bloque

## Solution Appliquée

### Migration 018: Suppression de la Récursion

**Stratégie:**
- Supprimer TOUTES les politiques qui interrogent la table `users` dans leur clause `USING`
- Garder uniquement les politiques simples basées sur `auth.uid() = id`

**Nouvelles Politiques RLS:**

```sql
-- 1. Lecture de son propre profil (CRITIQUE pour connexion)
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 2. Modification de son propre profil
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3. Insertion lors de l'inscription
CREATE POLICY "users_insert_own"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);
```

### Migration 019: Fonctions Admin Sécurisées

Pour permettre aux admins/staff de voir tous les utilisateurs, création de fonctions `SECURITY DEFINER` qui contournent RLS de manière sécurisée :

```sql
-- Fonction pour vérifier si l'utilisateur a un rôle spécifique
CREATE FUNCTION has_role(required_role TEXT) RETURNS BOOLEAN
  SECURITY DEFINER;

-- Fonction pour récupérer tous les utilisateurs (admin/staff uniquement)
CREATE FUNCTION get_all_users() RETURNS SETOF users
  SECURITY DEFINER;

-- Fonction pour récupérer un utilisateur par ID
CREATE FUNCTION get_user_by_id(user_id UUID) RETURNS SETOF users
  SECURITY DEFINER;
```

**Sécurité:**
- `SECURITY DEFINER` : la fonction s'exécute avec les privilèges du créateur (bypass RLS)
- Vérification du rôle à l'intérieur de la fonction
- Seuls les rôles autorisés peuvent voir tous les utilisateurs

## État Actuel

### ✅ Politiques RLS Actives

| Politique | Type | Condition |
|-----------|------|-----------|
| `users_select_own` | SELECT | `auth.uid() = id` |
| `users_update_own` | UPDATE | `auth.uid() = id` |
| `users_insert_own` | INSERT | `auth.uid() = id` |

**Avantages:**
- ✅ Aucune récursion possible
- ✅ Performance optimale
- ✅ Sécurité maintenue
- ✅ Connexion fonctionne pour tous les profils

### 🔑 Comptes de Test Validés

Tous les comptes ont été vérifiés et fonctionnent :

| Email | Rôle | Auth Account | Status |
|-------|------|--------------|--------|
| admin@sbta.ci | admin | ✅ | ✅ Opérationnel |
| daf@sbta.ci | daf | ✅ | ✅ Opérationnel |
| comptable@sbta.ci | comptable | ✅ | ✅ Opérationnel |
| gest.express@sbta.ci | gestionnaire | ✅ | ✅ Opérationnel |
| planif1@sbta.ci | planificateur | ✅ | ✅ Opérationnel |
| guichet1@sbta.ci | guichetier | ✅ | ✅ Opérationnel |
| chauffeur1@sbta.ci | chauffeur | ✅ | ✅ Opérationnel |
| chefgarage1@sbta.ci | chef_garage | ✅ | ✅ Opérationnel |
| meca1@sbta.ci | mecanicien | ✅ | ✅ Opérationnel |
| pompiste1@sbta.ci | pompiste | ✅ | ✅ Opérationnel |

**Mot de passe unique:** `Password123!`

## Utilisation dans l'Application

### Connexion (fonctionne automatiquement)

Le code actuel dans `authStore.ts` fonctionne sans modification :

```typescript
const { data: userData, error: userError } = await supabase
  .from('users')
  .select('*')
  .eq('id', authData.user.id)
  .maybeSingle();
```

Cette requête retourne le profil de l'utilisateur grâce à la politique `users_select_own`.

### Accès Admin aux Utilisateurs

Pour les pages admin qui doivent lister tous les utilisateurs, il faudra utiliser la fonction :

```typescript
// Au lieu de:
const { data } = await supabase.from('users').select('*');

// Utiliser:
const { data } = await supabase.rpc('get_all_users');
```

La fonction vérifie automatiquement si l'utilisateur a les droits.

## Tests de Connexion

### Test 1: Admin
```
Email: admin@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
Résultat attendu: ✅ Connexion réussie → /admin/dashboard
```

### Test 2: DAF
```
Email: daf@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
Résultat attendu: ✅ Connexion réussie → /daf/dashboard
```

### Test 3: Comptable
```
Email: comptable@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
Résultat attendu: ✅ Connexion réussie → /comptable/dashboard
```

### Test 4: Gestionnaire
```
Email: gest.express@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
Résultat attendu: ✅ Connexion réussie → /gestionnaire/dashboard
```

## Migrations Appliquées

1. **Migration 016** - Fix get_user_role() avec SECURITY DEFINER
2. **Migration 017** - Tentative de simplification RLS (récursion subsistait)
3. **Migration 018** - ✅ Suppression complète de la récursion
4. **Migration 019** - ✅ Ajout des fonctions admin sécurisées

## Résumé

**Problème:** Récursion infinie dans les politiques RLS
**Solution:** Politiques simples + Fonctions SECURITY DEFINER pour admin
**Résultat:** ✅ Tous les profils peuvent se connecter sans erreur

---

**Date:** 8 Avril 2026
**Status:** ✅ RÉSOLU
