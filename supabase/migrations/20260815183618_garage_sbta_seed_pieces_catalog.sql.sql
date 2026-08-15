/*
# Garage SBTA — Seed complet du catalogue de pièces détachées

## Objectif
Peupler le catalogue de pièces détachées du module Gérant Principal → Gestion des pièces
avec 69 articles classés par famille et sous-famille, conformément au catalogue fourni.

## Changements
1. Crée la famille CARROSSERIE (si absente).
2. Crée 11 sous-familles manquantes sous leurs familles respectatives :
   - MECANIQUE : EMBRAYAGE, MOTEUR, INJECTION, BOITE DE VITESSE, COMMANDES, COURROIE, REFROIDISSEMENT
   - ELECTRICITE : ECLAIRAGE
   - AIR : COMPRESSEUR
   - CARROSSERIE : VITRAGE, ESSUIE GLACE, QUINCAILLERIE
3. Insère 69 pièces avec référence unique (REF-MEC-###, REF-ELE-###, REF-AIR-###, REF-CAR-###),
   prix unitaire, seuil d'alerte (5 par défaut), et liens famille/sous-famille.

## Intégrité
- Chaque pièce référence une famille et une sous-famille existantes.
- Les insertions sont idempotentes : une pièce portant la même référence n'est pas réinsérée.
- Le trigger de cohérence famille/sous-famille (déjà en place) valide chaque insertion.
- Aucune donnée existante n'est modifiée ou supprimée.
- Les politiques RLS existantes ne sont pas touchées.
*/

-- 1. Famille CARROSSERIE
INSERT INTO garage_familles (nom)
SELECT 'CARROSSERIE'
WHERE NOT EXISTS (SELECT 1 FROM garage_familles WHERE nom = 'CARROSSERIE');

-- 2. Sous-familles manquantes
INSERT INTO garage_sous_familles (nom, famille_id)
SELECT seed.nom, f.id
FROM (
  VALUES
    ('EMBRAYAGE', 'MECANIQUE'),
    ('MOTEUR', 'MECANIQUE'),
    ('INJECTION', 'MECANIQUE'),
    ('BOITE DE VITESSE', 'MECANIQUE'),
    ('COMMANDES', 'MECANIQUE'),
    ('COURROIE', 'MECANIQUE'),
    ('REFROIDISSEMENT', 'MECANIQUE'),
    ('ECLAIRAGE', 'ELECTRICITE'),
    ('COMPRESSEUR', 'AIR'),
    ('VITRAGE', 'CARROSSERIE'),
    ('ESSUIE GLACE', 'CARROSSERIE'),
    ('QUINCAILLERIE', 'CARROSSERIE')
) AS seed(nom, famille_nom)
JOIN garage_familles AS f ON f.nom = seed.famille_nom
WHERE NOT EXISTS (
  SELECT 1 FROM garage_sous_familles AS existing
  WHERE lower(trim(existing.nom)) = lower(trim(seed.nom))
);

-- 3. Pièces détachées
INSERT INTO garage_pieces (reference, nom, famille_id, sous_famille_id, prix_unitaire, seuil_alerte)
SELECT p.reference, p.nom, f.id, sf.id, p.prix, 5
FROM (
  VALUES
    -- MECANIQUE
    ('REF-MEC-001', 'Amortisseur arriere', 'MECANIQUE', 'AMORTISSEUR', 20000),
    ('REF-MEC-002', 'Amortisseur arrieres', 'MECANIQUE', 'AMORTISSEUR', 10000),
    ('REF-MEC-003', 'Gros roulement arriere', 'MECANIQUE', 'ARBRE ARRIERE', 10000),
    ('REF-MEC-004', 'Gros roulement avant', 'MECANIQUE', 'ARBRE AVANT', 10000),
    ('REF-MEC-005', 'Arret a graisse', 'MECANIQUE', 'ARBRE ARRIERE', 10000),
    ('REF-MEC-006', 'Tambours arriere', 'MECANIQUE', 'ARBRE ARRIERE', 60000),
    ('REF-MEC-007', 'Tambours arrieres', 'MECANIQUE', 'ARBRE ARRIERE', 60000),
    ('REF-MEC-008', 'Bouchons arrieres', 'MECANIQUE', 'ARBRE ARRIERE', 2000),
    ('REF-MEC-009', 'Bouchons avant', 'MECANIQUE', 'ARBRE AVANT', 2000),
    ('REF-MEC-010', 'Disque d''Embrayage', 'MECANIQUE', 'EMBRAYAGE', 50000),
    ('REF-MEC-011', 'Fourchette', 'MECANIQUE', 'EMBRAYAGE', 50000),
    ('REF-MEC-012', 'Plateau', 'MECANIQUE', 'EMBRAYAGE', 75000),
    ('REF-MEC-013', 'Volant Moteur', 'MECANIQUE', 'EMBRAYAGE', 50000),
    ('REF-MEC-014', 'Chemise', 'MECANIQUE', 'MOTEUR', 20000),
    ('REF-MEC-015', 'Chemise + Segments', 'MECANIQUE', 'MOTEUR', 80000),
    ('REF-MEC-016', 'Pistons', 'MECANIQUE', 'MOTEUR', 20000),
    ('REF-MEC-017', 'Segments', 'MECANIQUE', 'MOTEUR', 20000),
    ('REF-MEC-018', 'Pieces de moteur', 'MECANIQUE', 'MOTEUR', 180000),
    ('REF-MEC-019', 'Poulie centrale', 'MECANIQUE', 'MOTEUR', 75000),
    ('REF-MEC-020', 'Poulie de Compresseur', 'MECANIQUE', 'MOTEUR', 50000),
    ('REF-MEC-021', 'Poulie de clim', 'MECANIQUE', 'MOTEUR', 75000),
    ('REF-MEC-022', 'Pompe Injecteur cummins', 'MECANIQUE', 'INJECTION', 400000),
    ('REF-MEC-023', 'Bitier de boite', 'MECANIQUE', 'BOITE DE VITESSE', 50000),
    ('REF-MEC-024', 'Pommeau', 'MECANIQUE', 'BOITE DE VITESSE', 20000),
    ('REF-MEC-025', 'Pommeaux', 'MECANIQUE', 'BOITE DE VITESSE', 15000),
    ('REF-MEC-026', 'Cable de vitesse', 'MECANIQUE', 'COMMANDES', 20000),
    ('REF-MEC-027', 'Cable d''accelerateur', 'MECANIQUE', 'COMMANDES', 20000),
    ('REF-MEC-028', 'Courroie 1125', 'MECANIQUE', 'COURROIE', 3000),
    ('REF-MEC-029', 'Courroie 1450', 'MECANIQUE', 'COURROIE', 3000),
    ('REF-MEC-030', 'Courroie 1550', 'MECANIQUE', 'COURROIE', 3000),
    ('REF-MEC-031', 'Courroie 1850', 'MECANIQUE', 'COURROIE', 3000),
    ('REF-MEC-032', 'Courroie 1500', 'MECANIQUE', 'COURROIE', 3000),
    ('REF-MEC-033', 'Intercoolie', 'MECANIQUE', 'REFROIDISSEMENT', 200000),
    -- ELECTRICITE
    ('REF-ELE-001', 'Boitier de Tehlmar', 'ELECTRICITE', 'APPAREIL', 75000),
    ('REF-ELE-002', 'Dynamo de charge', 'ELECTRICITE', 'APPAREIL', 150000),
    ('REF-ELE-003', 'Dynamo de clim', 'ELECTRICITE', 'APPAREIL', 150000),
    ('REF-ELE-004', 'Gros Compresseur de clim', 'ELECTRICITE', 'APPAREIL', 400000),
    ('REF-ELE-005', 'Ventilateur de clim', 'ELECTRICITE', 'APPAREIL', 20000),
    ('REF-ELE-006', 'Poste de radio', 'ELECTRICITE', 'APPAREIL', 45000),
    ('REF-ELE-007', 'Mano d''Huile', 'ELECTRICITE', 'APPAREIL', 5000),
    ('REF-ELE-008', 'Mano de Kilometrage', 'ELECTRICITE', 'APPAREIL', 10000),
    ('REF-ELE-009', 'Mano de Stop', 'ELECTRICITE', 'APPAREIL', 5000),
    ('REF-ELE-010', 'Mano de Temperature', 'ELECTRICITE', 'APPAREIL', 5000),
    ('REF-ELE-011', 'Mano de contour', 'ELECTRICITE', 'APPAREIL', 5000),
    ('REF-ELE-012', 'Commodo de phare', 'ELECTRICITE', 'ECLAIRAGE', 15000),
    ('REF-ELE-013', 'Feux + cabine', 'ELECTRICITE', 'ECLAIRAGE', 180000),
    ('REF-ELE-014', 'Feux d''ail', 'ELECTRICITE', 'ECLAIRAGE', 5000),
    ('REF-ELE-015', 'Phare Zhongtong', 'ELECTRICITE', 'ECLAIRAGE', 200000),
    ('REF-ELE-016', 'Phares', 'ELECTRICITE', 'ECLAIRAGE', 200000),
    -- AIR
    ('REF-AIR-001', 'Peter', 'AIR', 'APPAREIL PETER', 15000),
    ('REF-AIR-002', 'Appareil d''application', 'AIR', 'APPAREIL DE FREIN PEDALE', 15000),
    ('REF-AIR-003', 'Appareil de porte', 'AIR', 'APPAREIL DE PORTIERE', 15000),
    ('REF-AIR-004', 'Appareil portier', 'AIR', 'APPAREIL DE PORTIERE', 15000),
    ('REF-AIR-005', 'Appareil de vitesse', 'AIR', 'APPAREIL A MAIN', 15000),
    ('REF-AIR-006', 'Compresseur d''air', 'AIR', 'COMPRESSEUR', 200000),
    -- CARROSSERIE
    ('REF-CAR-001', 'Baie vitre laterale', 'CARROSSERIE', 'VITRAGE', 50000),
    ('REF-CAR-002', 'Pare-Brise arriere', 'CARROSSERIE', 'VITRAGE', 180000),
    ('REF-CAR-003', 'Pare-Brise cote gauche', 'CARROSSERIE', 'VITRAGE', 230000),
    ('REF-CAR-004', 'Pare-Brise droite', 'CARROSSERIE', 'VITRAGE', 230000),
    ('REF-CAR-005', 'Vitre de retroviseur grand', 'CARROSSERIE', 'VITRAGE', 8000),
    ('REF-CAR-006', 'Vitre de retroviseur petit', 'CARROSSERIE', 'VITRAGE', 4000),
    ('REF-CAR-007', 'Vitre laterale rectangle', 'CARROSSERIE', 'VITRAGE', 40000),
    ('REF-CAR-008', 'Balai Essuie glace', 'CARROSSERIE', 'ESSUIE GLACE', 20000),
    ('REF-CAR-009', 'Tige de balai', 'CARROSSERIE', 'ESSUIE GLACE', 20000),
    ('REF-CAR-010', 'Compart de coffre 65 cm', 'CARROSSERIE', 'QUINCAILLERIE', 4000),
    ('REF-CAR-011', 'Compart a gaz 65 cm', 'CARROSSERIE', 'QUINCAILLERIE', 4000),
    ('REF-CAR-012', 'Poigne de coffre laterale', 'CARROSSERIE', 'QUINCAILLERIE', 8000),
    ('REF-CAR-013', 'Serrure de coffre Exterieure', 'CARROSSERIE', 'QUINCAILLERIE', 8000),
    ('REF-CAR-014', 'Serrure de coffre Interieure', 'CARROSSERIE', 'QUINCAILLERIE', 8000)
) AS p(reference, nom, famille_nom, sous_famille_nom, prix)
JOIN garage_familles AS f ON f.nom = p.famille_nom
JOIN garage_sous_familles AS sf ON sf.nom = p.sous_famille_nom AND sf.famille_id = f.id
WHERE NOT EXISTS (
  SELECT 1 FROM garage_pieces AS existing WHERE existing.reference = p.reference
);
