# 🚀 SBTA Platform - Démarrage Rapide

## ⚡ En 5 Minutes

### 1️⃣ Installation Locale

```bash
npm install
npm run dev
```

Ouvrir http://localhost:5173

### 2️⃣ Configuration Supabase (Première fois)

1. Créer un projet sur https://supabase.com
2. Copier URL + Anon Key
3. Créer `.env.local` :

```bash
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-anon-key
```

### 3️⃣ Appliquer les Migrations

Dans Supabase Dashboard > SQL Editor, exécuter dans l'ordre :

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_rls_policies.sql`
3. `supabase/migrations/003_triggers.sql`
4. `supabase/migrations/004_update_fuel_voucher_trigger.sql`
5. `supabase/migrations/005_driver_reviews_performance.sql`
6. `supabase/migrations/006_loyalty_enhancements.sql`

### 4️⃣ Créer le Compte Admin

**Option A : Via Supabase Dashboard**

1. **Authentication** > **Users** > **Add user**
2. Email: `admin@sbta.ci`
3. Password: `(voir le gestionnaire de mots de passe)`
4. ✅ Auto Confirm User
5. Copier l'UUID généré
6. Dans **SQL Editor** :

```sql
INSERT INTO users (id, email, full_name, phone, role, company_id, is_active)
VALUES (
  'UUID-ICI',  -- Remplacer
  'admin@sbta.ci',
  'Administrateur SBTA',
  '+225 07 00 00 00 01',
  'admin',
  NULL,
  true
);
```

**Option B : Via l'application**

1. Aller sur `/register`
2. S'inscrire : admin@sbta.ci / Admin@SBTA2026
3. Dans SQL Editor :

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@sbta.ci';
```

### 5️⃣ Se Connecter

- Email : `admin@sbta.ci`
- Mot de passe : `(voir le gestionnaire de mots de passe)`

## 📚 Documentation Complète

- **DEPLOYMENT.md** - Guide déploiement complet
- **TESTING.md** - Tests des 7 flux critiques
- **REALTIME.md** - Configuration temps réel
- **RLS_VERIFICATION.md** - Sécurité RLS
- **ADMIN_CREDENTIALS.md** - Identifiants admin

## 🔧 Commandes Utiles

```bash
npm run dev          # Développement
npm run build        # Build production
npm run preview      # Prévisualiser build
npm run typecheck    # Vérifier TypeScript
```

## 🎯 Accès Rapide

- **Admin Dashboard** : `/admin/dashboard`
- **Planification** : `/planificateur/calendar`
- **Réservations** : `/client/booking`
- **Rapports** : `/reports`

## ⚠️ Important

1. **Toujours créer le compte admin en premier**
2. **RLS doit être activé sur toutes les tables**
3. **Ne jamais commiter les fichiers .env**
4. **Changer le mot de passe admin après première connexion**

## 🆘 Problèmes Fréquents

### "Email not confirmed"
→ Dans Supabase Auth, cocher "Auto Confirm User"

### "Permission denied"
→ Vérifier que RLS est activé et politiques appliquées

### "User not found"
→ Vérifier que l'utilisateur est dans la table `users`

### Build errors
→ Exécuter `npm run typecheck` pour voir les erreurs TypeScript

## 🚀 Déploiement Production

Voir **DEPLOYMENT.md** pour déployer sur Vercel + Supabase Cloud.

---

**Besoin d'aide ?** Consultez les fichiers de documentation dans le projet.
