/*
# Garage SBTA — seed des sous-familles et cohérence famille/sous-famille

## Objectif
Compléter le référentiel des sous-familles du module Gérant Principal → Paramètres
avec les associations demandées dans le catalogue GARAGE SBTA.

## Données ajoutées
Les lignes suivantes sont créées uniquement si une sous-famille portant le même nom
n'existe pas déjà, afin de préserver les données et associations existantes :
- AMORTISSEUR → MECANIQUE (déjà présent, conservé)
- APPAREIL → ELECTRICITE
- APPAREIL A MAIN → AIR
- APPAREIL BOXER → AIR
- APPAREIL DE FREIN PEDALE → AIR
- APPAREIL DE PORTIERE → AIR
- APPAREIL PETER → AIR
- ARBRE ARRIERE → MECANIQUE
- ARBRE ARRIERE NOUVEAU MODEL → MECANIQUE
- ARBRE AVANT → MECANIQUE

## Intégrité
- Chaque nouvelle sous-famille référence une famille existante par `famille_id`.
- La contrainte `NOT NULL` existante de `garage_sous_familles.famille_id` est conservée.
- Une fonction et un trigger empêchent désormais une pièce d'enregistrer une
  sous-famille appartenant à une famille différente de celle de la pièce.
- Les lectures existantes du module utilisent déjà la relation `famille:garage_familles(*)`
  et le formulaire des pièces filtre les sous-familles par famille sélectionnée.

## Sécurité et conservation
- Aucune donnée existante n'est supprimée, renommée ou modifiée.
- Les politiques RLS existantes ne sont pas modifiées.
- Les insertions sont idempotentes et ne créent pas de doublons pour les noms fournis.
*/

INSERT INTO garage_sous_familles (nom, famille_id)
SELECT seed.nom, famille.id
FROM (
  VALUES
    ('APPAREIL', 'ELECTRICITE'),
    ('APPAREIL A MAIN', 'AIR'),
    ('APPAREIL BOXER', 'AIR'),
    ('APPAREIL DE FREIN PEDALE', 'AIR'),
    ('APPAREIL DE PORTIERE', 'AIR'),
    ('APPAREIL PETER', 'AIR'),
    ('ARBRE ARRIERE', 'MECANIQUE'),
    ('ARBRE ARRIERE NOUVEAU MODEL', 'MECANIQUE'),
    ('ARBRE AVANT', 'MECANIQUE')
) AS seed(nom, famille_nom)
JOIN garage_familles AS famille ON famille.nom = seed.famille_nom
WHERE NOT EXISTS (
  SELECT 1
  FROM garage_sous_familles AS existing
  WHERE lower(trim(existing.nom)) = lower(trim(seed.nom))
);

CREATE OR REPLACE FUNCTION garage_validate_piece_family_relation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sous_famille_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM garage_sous_familles AS sous_famille
    WHERE sous_famille.id = NEW.sous_famille_id
      AND sous_famille.famille_id = NEW.famille_id
  ) THEN
    RAISE EXCEPTION 'La sous-famille sélectionnée n''appartient pas à la famille sélectionnée';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_garage_piece_family_relation ON garage_pieces;
CREATE TRIGGER trg_garage_piece_family_relation
  BEFORE INSERT OR UPDATE OF famille_id, sous_famille_id ON garage_pieces
  FOR EACH ROW
  EXECUTE FUNCTION garage_validate_piece_family_relation();
