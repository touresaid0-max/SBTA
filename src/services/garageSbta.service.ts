import { supabase } from './supabase'
import type {
  GarageGroupe, GarageCar, GarageBus, GarageCompany, GarageFamille, GarageSousFamille,
  GarageFournisseur, GarageTypeTechnicien, GaragePiece, GarageStock,
  GarageEntreeStock, GarageSortiePiece, GarageReparation,
  GarageCommandePiece, GaragePneu, GarageSetting,
} from '@/types/garage.types'

// ── Groupes ──────────────────────────────────────────────────
export async function fetchGroupes(): Promise<GarageGroupe[]> {
  const { data, error } = await supabase.from('garage_groupes').select('*').order('nom')
  if (error) throw error
  return data ?? []
}
export async function createGroupe(nom: string): Promise<GarageGroupe> {
  const { data, error } = await supabase.from('garage_groupes').insert({ nom }).select().single()
  if (error) throw error
  return data
}
export async function updateGroupe(id: string, nom: string): Promise<GarageGroupe> {
  const { data, error } = await supabase.from('garage_groupes').update({ nom }).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteGroupe(id: string): Promise<void> {
  const { error } = await supabase.from('garage_groupes').delete().eq('id', id)
  if (error) throw error
}

// ── Buses & Companies (from admin tables) ───────────────────
export async function fetchBusesForGarage(): Promise<GarageBus[]> {
  const { data: buses, error } = await supabase
    .from('buses')
    .select('id, registration_number, company_id')
    .order('registration_number')
  if (error) throw error

  const companyIds = [...new Set((buses ?? []).map(b => b.company_id).filter((id): id is string => Boolean(id)))]
  let companiesById = new Map<string, { id: string; name: string }>()
  if (companyIds.length) {
    const { data: companies, error: companiesError } = await supabase
      .from('companies')
      .select('id, name')
      .in('id', companyIds)
    if (!companiesError && companies) {
      companiesById = new Map(companies.map(c => [c.id, c]))
    }
  }

  return (buses ?? []).map((b: { id: string; registration_number: string | null; company_id: string | null }) => ({
    id: b.id,
    immatriculation: b.registration_number ?? '',
    company_id: b.company_id,
    company: b.company_id ? companiesById.get(b.company_id) ?? null : null,
  }))
}
export async function fetchCompaniesForGarage(): Promise<GarageCompany[]> {
  const { data, error } = await supabase.from('companies').select('id, name, parent_id, is_group').order('name')
  if (error) throw error
  return data ?? []
}

// ── Cars (legacy garage_cars table) ──────────────────────────
export async function fetchCars(): Promise<GarageCar[]> {
  const { data, error } = await supabase.from('garage_cars').select('*, groupe:garage_groupes(*)').order('immatriculation')
  if (error) throw error
  return data ?? []
}
export async function createCar(immatriculation: string, groupe_id: string | null): Promise<GarageCar> {
  const { data, error } = await supabase.from('garage_cars').insert({ immatriculation, groupe_id }).select().single()
  if (error) throw error
  return data
}
export async function updateCar(id: string, immatriculation: string, groupe_id: string | null): Promise<GarageCar> {
  const { data, error } = await supabase.from('garage_cars').update({ immatriculation, groupe_id }).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteCar(id: string): Promise<void> {
  const { error } = await supabase.from('garage_cars').delete().eq('id', id)
  if (error) throw error
}

// ── Familles ─────────────────────────────────────────────────
export async function fetchFamilles(): Promise<GarageFamille[]> {
  const { data, error } = await supabase.from('garage_familles').select('*').order('nom')
  if (error) throw error
  return data ?? []
}
export async function createFamille(nom: string): Promise<GarageFamille> {
  const { data, error } = await supabase.from('garage_familles').insert({ nom }).select().single()
  if (error) throw error
  return data
}
export async function updateFamille(id: string, nom: string): Promise<GarageFamille> {
  const { data, error } = await supabase.from('garage_familles').update({ nom }).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteFamille(id: string): Promise<void> {
  const { error } = await supabase.from('garage_familles').delete().eq('id', id)
  if (error) throw error
}

// ── Sous-familles ────────────────────────────────────────────
export async function fetchSousFamilles(): Promise<GarageSousFamille[]> {
  const { data, error } = await supabase.from('garage_sous_familles').select('*, famille:garage_familles(*)').order('nom')
  if (error) throw error
  return data ?? []
}
export async function createSousFamille(nom: string, famille_id: string): Promise<GarageSousFamille> {
  const { data, error } = await supabase.from('garage_sous_familles').insert({ nom, famille_id }).select().single()
  if (error) throw error
  return data
}
export async function updateSousFamille(id: string, nom: string, famille_id: string): Promise<GarageSousFamille> {
  const { data, error } = await supabase.from('garage_sous_familles').update({ nom, famille_id }).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteSousFamille(id: string): Promise<void> {
  const { error } = await supabase.from('garage_sous_familles').delete().eq('id', id)
  if (error) throw error
}

// ── Fournisseurs ─────────────────────────────────────────────
export async function fetchFournisseurs(): Promise<GarageFournisseur[]> {
  const { data, error } = await supabase.from('garage_fournisseurs').select('*').order('nom')
  if (error) throw error
  return data ?? []
}
export async function createFournisseur(f: Omit<GarageFournisseur, 'id' | 'created_at'>): Promise<GarageFournisseur> {
  const { data, error } = await supabase.from('garage_fournisseurs').insert(f).select().single()
  if (error) throw error
  return data
}
export async function updateFournisseur(id: string, f: Partial<Omit<GarageFournisseur, 'id' | 'created_at'>>): Promise<GarageFournisseur> {
  const { data, error } = await supabase.from('garage_fournisseurs').update(f).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteFournisseur(id: string): Promise<void> {
  const { error } = await supabase.from('garage_fournisseurs').delete().eq('id', id)
  if (error) throw error
}

// ── Types techniciens ────────────────────────────────────────
export async function fetchTypesTechniciens(): Promise<GarageTypeTechnicien[]> {
  const { data, error } = await supabase.from('garage_types_techniciens').select('*').order('nom')
  if (error) throw error
  return data ?? []
}
export async function createTypeTechnicien(nom: string): Promise<GarageTypeTechnicien> {
  const { data, error } = await supabase.from('garage_types_techniciens').insert({ nom }).select().single()
  if (error) throw error
  return data
}
export async function updateTypeTechnicien(id: string, nom: string): Promise<GarageTypeTechnicien> {
  const { data, error } = await supabase.from('garage_types_techniciens').update({ nom }).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteTypeTechnicien(id: string): Promise<void> {
  const { error } = await supabase.from('garage_types_techniciens').delete().eq('id', id)
  if (error) throw error
}

// ── Pieces ───────────────────────────────────────────────────
export async function fetchPieces(): Promise<GaragePiece[]> {
  const { data, error } = await supabase
    .from('garage_pieces')
    .select('*, famille:garage_familles(*), sous_famille:garage_sous_familles(*)')
    .order('nom')
  if (error) throw error
  return data ?? []
}
export async function createPiece(p: Omit<GaragePiece, 'id' | 'created_at' | 'famille' | 'sous_famille'>): Promise<GaragePiece> {
  const { data, error } = await supabase.from('garage_pieces').insert(p).select().single()
  if (error) throw error
  // Ensure stock row exists
  await supabase.from('garage_stock').upsert({ piece_id: data.id, quantite: 0 }, { onConflict: 'piece_id' })
  return data
}
export async function updatePiece(id: string, p: Partial<Omit<GaragePiece, 'id' | 'created_at' | 'famille' | 'sous_famille'>>): Promise<GaragePiece> {
  const { data, error } = await supabase.from('garage_pieces').update(p).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deletePiece(id: string): Promise<void> {
  const { error } = await supabase.from('garage_pieces').delete().eq('id', id)
  if (error) throw error
}

// ── Stock ────────────────────────────────────────────────────
export async function fetchStock(): Promise<GarageStock[]> {
  const { data, error } = await supabase
    .from('garage_stock')
    .select('*, piece:garage_pieces(*, famille:garage_familles(*), sous_famille:garage_sous_familles(*))')
    .order('date_maj', { ascending: false })
  if (error) throw error
  return data ?? []
}
export async function correctStock(piece_id: string, quantite: number): Promise<void> {
  const { error } = await supabase.from('garage_stock').update({ quantite, date_maj: new Date().toISOString() }).eq('piece_id', piece_id)
  if (error) throw error
}

// ── Entrees stock ────────────────────────────────────────────
export async function fetchEntrees(): Promise<GarageEntreeStock[]> {
  const { data, error } = await supabase
    .from('garage_entrees_stock')
    .select('*, piece:garage_pieces(*), fournisseur:garage_fournisseurs(*)')
    .order('date', { ascending: false })
  if (error) throw error
  return data ?? []
}
export async function createEntree(e: { piece_id: string; quantite: number; date: string; fournisseur_id: string | null; effectue_par: string }): Promise<void> {
  const { error } = await supabase.from('garage_entrees_stock').insert(e)
  if (error) throw error
}

// ── Sorties pieces ───────────────────────────────────────────
export async function fetchSorties(): Promise<GarageSortiePiece[]> {
  const { data, error } = await supabase
    .from('garage_sorties_pieces')
    .select('*, piece:garage_pieces(*)')
    .order('date', { ascending: false })
  if (error) throw error

  const sorties = data ?? []
  const carIds = [...new Set(sorties.map(row => row.car_id).filter((id): id is string => Boolean(id)))]
  const companyIds = [...new Set(sorties.map(row => row.groupe_id).filter((id): id is string => Boolean(id)))]
  const [{ data: buses, error: busesError }, { data: companies, error: companiesError }] = await Promise.all([
    carIds.length ? supabase.from('buses').select('id, registration_number').in('id', carIds) : Promise.resolve({ data: [], error: null }),
    companyIds.length ? supabase.from('companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (busesError) throw busesError
  if (companiesError) throw companiesError

  const busesById = new Map((buses ?? []).map(bus => [bus.id, bus]))
  const companiesById = new Map((companies ?? []).map(company => [company.id, company]))
  return sorties.map(row => ({
    ...row,
    car: row.car_id ? busesById.get(row.car_id) ?? null : null,
    groupe: row.groupe_id ? companiesById.get(row.groupe_id) ?? null : null,
  }))
}
export async function createSortie(s: {
  date: string; car_id: string | null; groupe_id: string | null; demandeur: string;
  piece_id: string; quantite: number; prix_unitaire: number; effectue_par: string;
}): Promise<void> {
  const { error } = await supabase.from('garage_sorties_pieces').insert(s)
  if (error) throw error
}

export async function createSorties(rows: Array<{
  date: string; car_id: string | null; groupe_id: string | null; demandeur: string;
  piece_id: string; quantite: number; prix_unitaire: number; effectue_par: string;
}>): Promise<void> {
  const { error } = await supabase.from('garage_sorties_pieces').insert(rows)
  if (error) throw error
}

// ── Réparations ──────────────────────────────────────────────
export async function fetchReparations(): Promise<GarageReparation[]> {
  const { data, error } = await supabase
    .from('garage_reparations')
    .select('*, car:garage_cars(*), type_technicien:garage_types_techniciens(*)')
    .order('date', { ascending: false })
  if (error) throw error
  return data ?? []
}
export async function createReparation(r: {
  car_id: string; date: string; statut: 'en cours' | 'terminée';
  type_technicien_id: string | null; description: string;
}): Promise<GarageReparation> {
  const { data, error } = await supabase.from('garage_reparations').insert(r).select().single()
  if (error) throw error
  return data
}
export async function updateReparation(id: string, r: Partial<{
  car_id: string; date: string; statut: 'en cours' | 'terminée';
  type_technicien_id: string | null; description: string;
}>): Promise<GarageReparation> {
  const { data, error } = await supabase.from('garage_reparations').update(r).eq('id', id).select().single()
  if (error) throw error
  return data
}
export async function deleteReparation(id: string): Promise<void> {
  const { error } = await supabase.from('garage_reparations').delete().eq('id', id)
  if (error) throw error
}

// ── Commandes pieces ─────────────────────────────────────────
export async function fetchCommandes(): Promise<GarageCommandePiece[]> {
  const { data, error } = await supabase
    .from('garage_commandes_pieces')
    .select('*')
    .order('date', { ascending: false })
  if (error) throw error

  const rows = data ?? []
  const carIds = [...new Set(rows.map(r => r.car_id).filter((id): id is string => Boolean(id)))]
  const companyIds = [...new Set(rows.map(r => r.groupe_id).filter((id): id is string => Boolean(id)))]
  const [{ data: buses, error: busesError }, { data: companies, error: companiesError }] = await Promise.all([
    carIds.length ? supabase.from('buses').select('id, registration_number').in('id', carIds) : Promise.resolve({ data: [], error: null }),
    companyIds.length ? supabase.from('companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (busesError) throw busesError
  if (companiesError) throw companiesError

  const busesById = new Map((buses ?? []).map(b => [b.id, b]))
  const companiesById = new Map((companies ?? []).map(c => [c.id, c]))
  return rows.map(r => ({
    ...r,
    car: r.car_id ? busesById.get(r.car_id) ?? null : null,
    groupe: r.groupe_id ? companiesById.get(r.groupe_id) ?? null : null,
  }))
}
export async function createCommande(c: {
  date: string; designation: string; car_id: string | null; groupe_id: string | null;
  quantite: number; prix_unitaire: number;
}): Promise<void> {
  const { error } = await supabase.from('garage_commandes_pieces').insert(c)
  if (error) throw error
}

// ── Pneus ────────────────────────────────────────────────────
export async function fetchPneus(): Promise<GaragePneu[]> {
  const { data, error } = await supabase
    .from('garage_pneus')
    .select('*')
    .order('date', { ascending: false })
  if (error) throw error

  const rows = data ?? []
  const carIds = [...new Set(rows.map(r => r.car_id).filter((id): id is string => Boolean(id)))]
  const companyIds = [...new Set(rows.map(r => r.groupe_id).filter((id): id is string => Boolean(id)))]
  const [{ data: buses, error: busesError }, { data: companies, error: companiesError }] = await Promise.all([
    carIds.length ? supabase.from('buses').select('id, registration_number').in('id', carIds) : Promise.resolve({ data: [], error: null }),
    companyIds.length ? supabase.from('companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (busesError) throw busesError
  if (companiesError) throw companiesError

  const busesById = new Map((buses ?? []).map(b => [b.id, b]))
  const companiesById = new Map((companies ?? []).map(c => [c.id, c]))
  return rows.map(r => ({
    ...r,
    car: r.car_id ? busesById.get(r.car_id) ?? null : null,
    groupe: r.groupe_id ? companiesById.get(r.groupe_id) ?? null : null,
  }))
}
export async function createPneu(p: {
  date: string; car_id: string | null; groupe_id: string | null;
  type_pneu: 'MICHELIN' | 'LONG-MARCH'; quantite: number; prix_unitaire: number;
}): Promise<void> {
  const { error } = await supabase.from('garage_pneus').insert(p)
  if (error) throw error
}

// ── Settings ─────────────────────────────────────────────────
export async function fetchSettings(): Promise<GarageSetting[]> {
  const { data, error } = await supabase.from('garage_settings').select('*')
  if (error) throw error
  return data ?? []
}
export async function updateSetting(key: string, value: number): Promise<void> {
  const { error } = await supabase.from('garage_settings').update({ value }).eq('key', key)
  if (error) throw error
}
