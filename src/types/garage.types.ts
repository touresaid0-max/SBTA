export interface GarageGroupe {
  id: string
  nom: string
  created_at: string
}

export interface GarageCar {
  id: string
  immatriculation: string
  groupe_id: string | null
  groupe?: GarageGroupe | null
  created_at: string
}

export interface GarageBus {
  id: string
  immatriculation: string
  company_id: string | null
  company?: { id: string; name: string } | null
}

export interface GarageCompany {
  id: string
  name: string
}

export interface GarageFamille {
  id: string
  nom: string
  created_at: string
}

export interface GarageSousFamille {
  id: string
  nom: string
  famille_id: string
  famille?: GarageFamille | null
  created_at: string
}

export interface GarageFournisseur {
  id: string
  nom: string
  telephone: string
  adresse: string
  email: string
  created_at: string
}

export interface GarageTypeTechnicien {
  id: string
  nom: string
  created_at: string
}

export interface GaragePiece {
  id: string
  reference: string
  nom: string
  modele_serie: string
  marque: string
  seuil_alerte: number
  famille_id: string | null
  sous_famille_id: string | null
  prix_unitaire: number
  famille?: GarageFamille | null
  sous_famille?: GarageSousFamille | null
  created_at: string
}

export interface GarageStock {
  id: string
  piece_id: string
  quantite: number
  date_maj: string
  piece?: GaragePiece | null
}

export interface GarageEntreeStock {
  id: string
  piece_id: string
  quantite: number
  date: string
  fournisseur_id: string | null
  effectue_par: string
  created_at: string
  piece?: GaragePiece | null
  fournisseur?: GarageFournisseur | null
}

export interface GarageSortiePiece {
  id: string
  date: string
  car_id: string | null
  groupe_id: string | null
  demandeur: string
  piece_id: string
  quantite: number
  prix_unitaire: number
  montant: number
  effectue_par: string
  created_at: string
  piece?: GaragePiece | null
  car?: { id: string; registration_number: string } | null
  groupe?: { id: string; name: string } | null
}

export interface GarageReparation {
  id: string
  car_id: string
  date: string
  statut: 'en cours' | 'terminée'
  type_technicien_id: string | null
  description: string
  created_at: string
  car?: GarageCar | null
  type_technicien?: GarageTypeTechnicien | null
}

export interface GarageCommandePiece {
  id: string
  date: string
  designation: string
  car_id: string | null
  groupe_id: string | null
  quantite: number
  prix_unitaire: number
  montant: number
  created_at: string
  car?: { id: string; registration_number: string } | null
  groupe?: { id: string; name: string } | null
}

export interface GaragePneu {
  id: string
  date: string
  car_id: string | null
  groupe_id: string | null
  type_pneu: 'MICHELIN' | 'LONG-MARCH'
  quantite: number
  prix_unitaire: number
  montant: number
  created_at: string
  car?: { id: string; registration_number: string } | null
  groupe?: { id: string; name: string } | null
}

export interface GarageSetting {
  id: string
  key: string
  value: number
}
