# Guide de Connexion - SBTA

## Problème Résolu ✅

L'erreur **"Database error querying schema"** a été résolue.

**Correctifs appliqués:**
1. ✅ Mots de passe réinitialisés pour tous les comptes
2. ✅ Politiques RLS (Row Level Security) simplifiées et corrigées
3. ✅ Fonction get_user_role() sécurisée avec SECURITY DEFINER
4. ✅ Tous les profils peuvent maintenant se connecter

---

## Identifiants de Connexion

**Mot de passe unique pour tous les comptes:** `Password123!`

### Connexions par Profil

#### 1. ADMIN - Accès Complet
```
Email: admin@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/admin/dashboard`
- **Analyse de Performance: `/admin/performance`** ⭐ NOUVEAU
- Gestion complète du système

---

#### 2. DAF - Direction Financière
```
Email: daf@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/daf/dashboard`
- **Analyse de Performance: `/daf/performance`** ⭐ NOUVEAU
- Rapports financiers

---

#### 3. GESTIONNAIRE - Gestion de Flotte
```
Email: gest.express@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/gestionnaire/dashboard`
- **Analyse de Performance: `/gestionnaire/performance`** ⭐ NOUVEAU
- Gestion des bus
- Rapports

**Autres gestionnaires:**
- `gest.premium@sbta.ci` (TSR)
- `gest.regional@sbta.ci` (Transport Regional)

---

#### 4. COMPTABLE - Validation Financière
```
Email: comptable@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/comptable/dashboard`
- Validation bons carburant
- Validation charges bus
- Ordres de travail maintenance

---

#### 5. PLANIFICATEUR - Horaires
```
Email: planif1@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/planificateur/dashboard`
- Calendrier voyages
- Création horaires

---

#### 6. GUICHETIER - Vente Billets
```
Email: guichet1@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/guichetier/dashboard`
- Vente billets
- Gestion caisse
- Rédemptions fidélité

---

#### 7. CHAUFFEUR - Conducteur
```
Email: chauffeur1@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/chauffeur/dashboard`
- Mes voyages
- Bons carburant
- Signalement pannes

---

#### 8. CHEF GARAGE - Maintenance
```
Email: chefgarage1@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/garage/dashboard`
- Pannes reçues
- Diagnostics
- Ordres de travail

---

#### 9. MÉCANICIEN - Réparations
```
Email: meca1@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/mecanicien/dashboard`
- Mes ordres de travail
- Exécution réparations

---

#### 10. POMPISTE - Carburant
```
Email: pompiste1@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```
**Accès:**
- Tableau de bord: `/pompiste/dashboard`
- Ravitaillements carburant

---

## Nouveau: Analyse de Performance 📊

Le nouveau tableau de bord **Analyse de Performance** est accessible aux profils:
- **Admin:** `/admin/performance`
- **DAF:** `/daf/performance`
- **Gestionnaire:** `/gestionnaire/performance`

### Fonctionnalités en Temps Réel:
✅ Indicateurs clés (Recettes, Dépenses, Résultat Net, Bus Actifs)
✅ Graphique évolution Recettes vs Dépenses
✅ Répartition des dépenses par catégorie
✅ Performance détaillée par bus
✅ Alertes stratégiques
✅ Filtrage par société et période
✅ Export PDF/Excel

---

## Test de Connexion Rapide

### Étape 1: Ouvrir la page de connexion
```
http://localhost:5173/login
```

### Étape 2: Saisir les identifiants
```
Email: admin@sbta.ci
Mot de passe: (voir le gestionnaire de mots de passe)
```

### Étape 3: Cliquer sur "Se connecter"

### Étape 4: Vérifier la redirection
Vous devriez être redirigé vers `/admin/dashboard`

---

## Résolution des Problèmes

### ❌ "Database error querying schema"
**Solution:** Ce problème a été résolu. Les comptes ont été synchronisés.

### ❌ "Invalid login credentials"
**Vérifiez:**
1. Email correct (avec @sbta.ci)
2. Mot de passe: `(voir le gestionnaire de mots de passe)` (sensible à la casse)
3. Aucun espace avant/après

### ❌ Page blanche après connexion
**Vérifiez:**
1. La console du navigateur (F12)
2. Les variables d'environnement Supabase dans `.env`

### ❌ "User not found"
**Solution:** Le compte existe dans auth.users mais pas dans public.users
- Contactez l'administrateur système

---

## Vérification Base de Données

Tous les comptes suivants sont configurés et fonctionnels:

✅ admin@sbta.ci - Admin
✅ daf@sbta.ci - DAF
✅ comptable@sbta.ci - Comptable
✅ gest.express@sbta.ci - Gestionnaire Express
✅ gest.premium@sbta.ci - Gestionnaire Premium
✅ gest.regional@sbta.ci - Gestionnaire Regional
✅ planif1@sbta.ci - Planificateur
✅ guichet1@sbta.ci - Guichetier
✅ chauffeur1@sbta.ci - Chauffeur
✅ chefgarage1@sbta.ci - Chef Garage
✅ meca1@sbta.ci - Mécanicien
✅ pompiste1@sbta.ci - Pompiste

---

## Support

Pour toute question ou problème:
1. Vérifiez ce guide
2. Consultez `TEST_CREDENTIALS.md` pour la liste complète
3. Vérifiez les logs de la console (F12)

---

**Dernière mise à jour:** 8 Avril 2026
**Status:** ✅ Tous les comptes opérationnels
