# SBTA Platform - Guide de Déploiement

## 📋 Prérequis

- Compte Supabase (https://supabase.com)
- Compte Vercel (https://vercel.com)
- Node.js 18+ installé localement

## 🗄️ Configuration Supabase

### 1. Créer un nouveau projet Supabase

1. Se connecter à https://app.supabase.com
2. Créer un nouveau projet
3. Noter les informations de connexion :
   - Project URL
   - Anon/Public Key
   - Service Role Key (gardée secrète)

### 2. Appliquer les migrations

Les migrations sont dans `/supabase/migrations/` :

1. **001_initial_schema.sql** - Schéma complet de la base de données
2. **002_rls_policies.sql** - Politiques de sécurité Row Level Security
3. **003_triggers.sql** - Triggers automatiques
4. **004_update_fuel_voucher_trigger.sql** - Mise à jour triggers carburant
5. **005_driver_reviews_performance.sql** - Système d'évaluation chauffeurs
6. **006_loyalty_enhancements.sql** - Améliorations programme fidélité

#### Application via l'interface Supabase :

1. Aller dans **SQL Editor**
2. Copier-coller le contenu de chaque migration dans l'ordre
3. Exécuter avec **Run**

#### Ou via CLI Supabase :

```bash
# Installer Supabase CLI
npm install -g supabase

# Se connecter
supabase login

# Lier au projet
supabase link --project-ref <votre-project-ref>

# Appliquer les migrations
supabase db push
```

### 3. Activer Row Level Security (RLS)

**CRITIQUE** : RLS doit être activé sur TOUTES les tables.

Vérifier dans Supabase Dashboard > Authentication > Policies que chaque table a :
- ✅ RLS activé (bouton toggle vert)
- ✅ Politiques définies pour chaque rôle

Tables principales :
- `users`, `companies`, `buses`, `routes`, `schedules`
- `reservations`, `loyalty_*`, `fuel_vouchers`, `expenses`
- `work_orders`, `parts`, `stock_movements`, `purchase_orders`
- `driver_reviews`, `breakdown_reports`

### 4. Activer Supabase Realtime

Pour les mises à jour en temps réel, activer Realtime sur :

1. Aller dans **Database** > **Replication**
2. Activer les tables suivantes :
   - ✅ `schedules` (affichage gare)
   - ✅ `reservations` (réservations temps réel)
   - ✅ `fuel_vouchers` (bons carburant)
   - ✅ `breakdown_reports` (pannes)
   - ✅ `maintenance_work_orders` (ordres de travail)
   - ✅ `buses` (statuts bus)

### 5. Configuration Auth

1. Aller dans **Authentication** > **Settings**
2. **Email Auth** :
   - ✅ Enable Email Signup
   - ❌ Confirm Email (désactivé pour démo, activer en production)
3. **Password Requirements** :
   - Minimum 8 caractères
4. **Email Templates** :
   - Personnaliser avec logo SBTA si souhaité

### 6. Storage (Optionnel)

Pour stocker photos et documents :

1. Aller dans **Storage**
2. Créer les buckets :
   - `fuel-voucher-photos` (photos bons carburant)
   - `breakdown-photos` (photos pannes)
   - `bus-documents` (documents bus)
3. Configurer les politiques d'accès (RLS)

### 7. Créer le compte administrateur

**IMPORTANT** : Créez d'abord le compte admin pour accéder à la plateforme.

#### Méthode 1 : Via Supabase Dashboard (Recommandé)

1. Aller dans **Authentication** > **Users**
2. Cliquer sur **Add user** > **Create new user**
3. Entrer :
   - Email: `admin@sbta.ci`
   - Password: `(voir le gestionnaire de mots de passe)`
   - ✅ Auto Confirm User (cocher cette case)
4. Cliquer **Create user**
5. Copier l'UUID généré (ex: `a1b2c3d4-...`)
6. Aller dans **SQL Editor** et exécuter :

```sql
INSERT INTO users (
  id,
  email,
  full_name,
  phone,
  role,
  company_id,
  is_active
) VALUES (
  'UUID-COPIÉ-ICI',  -- Remplacer par l'UUID copié
  'admin@sbta.ci',
  'Administrateur SBTA',
  '+225 07 00 00 00 01',
  'admin',
  NULL,
  true
);
```

#### Méthode 2 : Via inscription + SQL

1. Sur la plateforme, aller sur `/register`
2. S'inscrire avec : admin@sbta.ci / Admin@SBTA2026
3. Dans Supabase SQL Editor, exécuter :

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@sbta.ci';
```

**Identifiants Admin** :
- Email: `admin@sbta.ci`
- Mot de passe: `(voir le gestionnaire de mots de passe)`

### 8. Charger les données de démonstration (Optionnel)

Exécuter le fichier `/supabase/seed.sql` dans SQL Editor pour :
- 3 sociétés de transport
- 15 villes de Côte d'Ivoire
- 20 bus répartis
- Personnel complet (DAF, comptable, gestionnaires, chauffeurs, etc.)
- 30 clients avec programmes fidélité
- Données opérationnelles

## 🚀 Déploiement Vercel

### 1. Préparer les variables d'environnement

Créer un fichier `.env.local` (ou configurer dans Vercel Dashboard) :

```bash
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-anon-key-ici
```

### 2. Déployer sur Vercel

#### Via GitHub (Recommandé) :

1. Pousser le code sur GitHub
2. Se connecter à https://vercel.com
3. **Import Project** > sélectionner le repo GitHub
4. Configurer :
   - Framework Preset: **Vite**
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. Ajouter les variables d'environnement dans **Settings** > **Environment Variables**
6. Déployer

#### Via Vercel CLI :

```bash
# Installer Vercel CLI
npm install -g vercel

# Se connecter
vercel login

# Déployer
vercel

# Production
vercel --prod
```

### 3. Configuration post-déploiement

Dans Vercel Dashboard :

1. **Settings** > **Environment Variables** :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

2. **Domains** :
   - Ajouter un domaine personnalisé si souhaité (ex: app.sbta.ci)

## ✅ Checklist de Déploiement

### Base de données Supabase

- [ ] Projet Supabase créé
- [ ] Migration 001 appliquée (schéma)
- [ ] Migration 002 appliquée (RLS policies)
- [ ] Migration 003 appliquée (triggers)
- [ ] Migration 004 appliquée (fuel voucher trigger)
- [ ] Migration 005 appliquée (driver reviews)
- [ ] Migration 006 appliquée (loyalty)
- [ ] RLS activé sur TOUTES les tables
- [ ] Realtime activé sur tables clés
- [ ] Auth email activé
- [ ] **Compte admin créé** (admin@sbta.ci)
- [ ] Storage configuré (optionnel)
- [ ] Seed data chargée (optionnel)

### Application

- [ ] Build local réussi (`npm run build`)
- [ ] Variables d'environnement configurées
- [ ] `vercel.json` présent (SPA routing)
- [ ] Déploiement Vercel réussi
- [ ] Variables d'env configurées sur Vercel
- [ ] Application accessible en ligne

### Tests fonctionnels

- [ ] **Flux 1** : Inscription client → réservation → paiement → QR code → points fidélité
- [ ] **Flux 2** : Planification → bon carburant auto → remplissage → validation comptable
- [ ] **Flux 3** : Panne signalée → workflow garage complet → bus disponible
- [ ] **Flux 4** : Voyage terminé → évaluation client → points chauffeur mis à jour
- [ ] **Flux 5** : Cumul 10 voyages → bon gratuit → échange guichet
- [ ] **Flux 6** : Chauffeur 9h conduite → repos obligatoire → blocage planification
- [ ] **Flux 7** : Affichage gare → mise à jour temps réel (Realtime)

## Comptes de Connexion

### Compte Administrateur Principal (Obligatoire)

**Email** : `admin@sbta.ci`
**Mot de passe** : `(voir le gestionnaire de mots de passe)`
**Rôle** : Administrateur avec accès complet

**Créez ce compte via la section 7 ci-dessus avant première connexion !**

### Comptes Personnel Additionnels (Optionnel - via seed.sql)

Les comptes ci-dessous sont créés si vous chargez `seed.sql` :

- **DAF** : daf@sbta.ci
- **Comptable** : comptable@sbta.ci
- **Gestionnaire Express** : gest.express@sbta.ci
- **Chauffeur 1** : chauffeur1@sbta.ci
- **Guichetier 1** : guichet1@sbta.ci
- **Chef Garage 1** : chefgarage1@sbta.ci
- **Mécanicien 1** : meca1@sbta.ci
- **Pompiste 1** : pompiste1@sbta.ci
- **Planificateur 1** : planif1@sbta.ci

### Clients

- **Client Platinum** : client01@gmail.com (12500 points, 45 voyages)
- **Client Gold** : client03@gmail.com (6800 points, 28 voyages)
- **Client Silver** : client08@gmail.com (2800 points, 14 voyages)
- **Client Bronze** : client16@gmail.com (850 points, 5 voyages)

**Note** : Les mots de passe doivent être définis via Supabase Auth au premier login ou via l'interface admin.

## 🛠️ Maintenance

### Sauvegardes

Supabase fait des sauvegardes automatiques. Pour sauvegardes manuelles :

```bash
# Export base de données
supabase db dump -f backup.sql

# Restaurer
supabase db reset
```

### Monitoring

- **Supabase Dashboard** : Métriques en temps réel
- **Vercel Analytics** : Performances frontend
- **Logs** : Accessible dans les deux dashboards

### Mises à jour

```bash
# Nouvelle migration
supabase migration new nom_migration

# Appliquer
supabase db push

# Redéployer Vercel (automatique si GitHub)
git push origin main
```

## 🆘 Support

Pour toute question :
- Documentation Supabase : https://supabase.com/docs
- Documentation Vercel : https://vercel.com/docs
- Documentation React : https://react.dev
