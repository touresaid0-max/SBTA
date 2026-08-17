import { useEffect, useState } from 'react'
import { Pencil, AlertTriangle, ArrowDownToLine, ArrowUpCircle, Wrench, Plus, Trash2, X, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import ListPage from '@/components/garage/ListPage'
import { fetchStock, correctStock, fetchEntrees, fetchSorties, createEntree, createSortie, createSorties, fetchPieces, fetchFournisseurs, fetchBusesForGarage, fetchCompaniesForGarage, fetchCarsDisponibles } from '@/services/garageSbta.service'
import type { GarageStock, GaragePiece, GarageFournisseur, GarageBus, GarageCompany, GarageEntreeStock, GarageSortiePiece } from '@/types/garage.types'
import { formatDate, formatFCFA } from '@/components/garage/reportHelpers'
import { useAuthStore } from '@/store/authStore'

type Tab = 'stock' | 'entrees' | 'sorties'

export default function GarageStockPage() {
  const [tab, setTab] = useState<Tab>('stock')
  const [stock, setStock] = useState<GarageStock[]>([])
  const [entrees, setEntrees] = useState<GarageEntreeStock[]>([])
  const [sorties, setSorties] = useState<GarageSortiePiece[]>([])
  const [pieces, setPieces] = useState<GaragePiece[]>([])
  const [fournisseurs, setFournisseurs] = useState<GarageFournisseur[]>([])
  const [cars, setCars] = useState<GarageBus[]>([])
  const [carsLoading, setCarsLoading] = useState(false)
  const [groupes, setGroupes] = useState<GarageCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [correcting, setCorrecting] = useState<GarageStock | null>(null)
  const [correctQty, setCorrectQty] = useState(0)
  const [showEntry, setShowEntry] = useState(false)
  const [showExit, setShowExit] = useState(false)
  const { user } = useAuthStore()

  const [entryForm, setEntryForm] = useState({ piece_id: '', quantite: 1, date: new Date().toISOString().slice(0, 10), fournisseur_id: '', effectue_par: '' })
  const [exitRows, setExitRows] = useState<Array<{
    piece_id: string; quantite: number; prix_unitaire: number; car_id: string; groupe_id: string;
    pieceSearch: string; carSearch: string;
  }>>([{
    piece_id: '', quantite: 1, prix_unitaire: 0, car_id: '', groupe_id: '',
    pieceSearch: '', carSearch: '',
  }])
  const [exitDate, setExitDate] = useState(new Date().toISOString().slice(0, 10))
  const [exitDemandeur, setExitDemandeur] = useState('')
  const [exitEffectuePar, setExitEffectuePar] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([fetchStock(), fetchEntrees(), fetchSorties(), fetchPieces(), fetchFournisseurs(), fetchCompaniesForGarage()])
      .then(([s, e, so, p, f, g]) => { setStock(s); setEntrees(e); setSorties(so); setPieces(p); setFournisseurs(f); setGroupes(g) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))

    setCarsLoading(true)
    fetchCarsDisponibles()
      .then(disponibles => {
        // Conserver fetchBusesForGarage pour les infos société, mais filtrer sur les cars disponibles
        fetchBusesForGarage().then(allBuses => {
          const dispoIds = new Set(disponibles.map(d => d.id))
          setCars(allBuses.filter(b => dispoIds.has(b.id)))
        }).catch(() => setCars([]))
      })
      .catch(() => toast.error('Impossible de charger la liste des cars'))
      .finally(() => setCarsLoading(false))
  }

  useEffect(() => { load() }, [])

  const openCorrect = (s: GarageStock) => { setCorrecting(s); setCorrectQty(s.quantite) }
  const handleCorrect = async () => {
    if (!correcting) return
    try { await correctStock(correcting.piece_id, correctQty); toast.success('Stock corrigé'); setCorrecting(null); load() }
    catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  const handleEntry = async () => {
    if (!entryForm.piece_id || entryForm.quantite <= 0) { toast.error('Pièce et quantité requises'); return }
    try {
      await createEntree({ piece_id: entryForm.piece_id, quantite: entryForm.quantite, date: entryForm.date, fournisseur_id: entryForm.fournisseur_id || null, effectue_par: entryForm.effectue_par || user?.full_name || '' })
      toast.success('Entrée enregistrée'); setShowEntry(false); load()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  const handleExit = async () => {
    const validRows = exitRows.filter(r => r.piece_id && r.quantite > 0)
    if (validRows.length === 0) { toast.error('Au moins une ligne avec pièce et quantité est requise'); return }
    try {
      const rows = validRows.map(r => ({
        date: exitDate,
        piece_id: r.piece_id,
        quantite: r.quantite,
        prix_unitaire: r.prix_unitaire,
        car_id: r.car_id || null,
        groupe_id: r.groupe_id || null,
        demandeur: exitDemandeur,
        effectue_par: exitEffectuePar || user?.full_name || '',
      }))
      await createSorties(rows)
      toast.success(`${rows.length} sortie(s) enregistrée(s)`)
      setShowExit(false)
      resetExitForm()
      load()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  const resetExitForm = () => {
    setExitRows([{ piece_id: '', quantite: 1, prix_unitaire: 0, car_id: '', groupe_id: '', pieceSearch: '', carSearch: '' }])
    setExitDate(new Date().toISOString().slice(0, 10))
    setExitDemandeur('')
    setExitEffectuePar('')
  }

  const openExitModal = () => {
    resetExitForm()
    setShowExit(true)
  }

  const addExitRow = () => {
    setExitRows([...exitRows, { piece_id: '', quantite: 1, prix_unitaire: 0, car_id: '', groupe_id: '', pieceSearch: '', carSearch: '' }])
  }

  const removeExitRow = (idx: number) => {
    if (exitRows.length === 1) return
    setExitRows(exitRows.filter((_, i) => i !== idx))
  }

  const updateExitRow = (idx: number, patch: Partial<typeof exitRows[0]>) => {
    setExitRows(exitRows.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  const selectPieceForRow = (idx: number, pieceId: string) => {
    const p = pieces.find(p => p.id === pieceId)
    updateExitRow(idx, {
      piece_id: pieceId,
      pieceSearch: p ? `${p.reference} — ${p.nom}` : '',
      prix_unitaire: p ? Number(p.prix_unitaire) : 0,
    })
  }

  const selectCarForRow = (idx: number, carId: string) => {
    const c = cars.find(c => c.id === carId)
    updateExitRow(idx, {
      car_id: carId,
      carSearch: c?.immatriculation ?? '',
      groupe_id: c?.company_id ?? '',
    })
  }

  const exitTotal = exitRows.reduce((sum, r) => sum + (r.piece_id ? r.quantite * r.prix_unitaire : 0), 0)

  const lowStockCount = stock.filter(s => s.quantite <= (s.piece?.seuil_alerte ?? 0)).length

  const tabs: { key: Tab; label: string; icon: typeof Wrench; count?: number }[] = [
    { key: 'stock', label: 'Stock', icon: Wrench, count: stock.length },
    { key: 'entrees', label: 'Entrées', icon: ArrowDownToLine, count: entrees.length },
    { key: 'sorties', label: 'Sorties', icon: ArrowUpCircle, count: sorties.length },
  ]

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Gestion du stock</h1>
          <p className="text-sm text-[#6B7280] mt-1">{stock.length} pièce(s) en stock · {lowStockCount} en alerte</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowEntry(true)} className="flex items-center gap-2 px-4 py-2.5 bg-[#0E7490] text-white rounded-xl font-medium hover:bg-[#0c6377] transition-colors">
            <ArrowDownToLine className="w-4 h-4" /> Nouvelle entrée
          </button>
          <button onClick={() => openExitModal()} className="flex items-center gap-2 px-4 py-2.5 bg-[#0B7439] text-white rounded-xl font-medium hover:bg-[#095e2e] transition-colors">
            <ArrowUpCircle className="w-4 h-4" /> Nouvelle sortie
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === t.key ? 'bg-[#0B7439] text-white' : 'bg-white border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8]'}`}>
              <Icon className="w-4 h-4" /> {t.label} {t.count !== undefined && <span className="opacity-70">({t.count})</span>}
            </button>
          )
        })}
      </div>

      {tab === 'stock' && (
        <ListPage
          title="" data={stock} loading={loading}
          searchFields={['piece.reference', 'piece.nom', 'piece.marque']}
          columns={[
            { key: 'piece.reference', label: 'Référence', render: (s: GarageStock) => <span className="font-mono font-medium text-[#0B7439]">{s.piece?.reference ?? '—'}</span> },
            { key: 'piece.nom', label: 'Nom', render: (s: GarageStock) => <span className="font-medium text-[#1A2E22]">{s.piece?.nom ?? '—'}</span> },
            { key: 'piece.marque', label: 'Marque', render: (s: GarageStock) => s.piece?.marque ?? '—' },
            { key: 'piece.famille.nom', label: 'Famille', render: (s: GarageStock) => s.piece?.famille?.nom ?? '—' },
            { key: 'quantite', label: 'Quantité', className: 'text-right', render: (s: GarageStock) => {
              const isLow = s.quantite <= (s.piece?.seuil_alerte ?? 0)
              return <span className={`font-bold ${isLow ? 'text-[#AF3029]' : 'text-[#1A2E22]'}`}>{s.quantite}</span>
            }},
            { key: 'piece.seuil_alerte', label: 'Seuil', className: 'text-right', render: (s: GarageStock) => s.piece?.seuil_alerte ?? '—' },
            { key: 'piece.prix_unitaire', label: 'Prix unitaire', className: 'text-right', render: (s: GarageStock) => formatFCFA(s.piece?.prix_unitaire) },
            { key: 'date_maj', label: 'Date MAJ', render: (s: GarageStock) => formatDate(s.date_maj) },
          ]}
          rowActions={(s: GarageStock) => (
            <div className="flex items-center justify-center gap-1">
              {s.quantite <= (s.piece?.seuil_alerte ?? 0) && <AlertTriangle className="w-4 h-4 text-[#AF3029]" />}
              <button onClick={() => openCorrect(s)} className="p-1.5 rounded-lg hover:bg-[#FEF3C7] text-[#D97706]" title="Corriger le stock">
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
        />
      )}

      {tab === 'entrees' && (
        <ListPage
          title="" data={entrees} loading={loading}
          searchFields={['piece.reference', 'piece.nom', 'fournisseur.nom', 'effectue_par']}
          columns={[
            { key: 'date', label: 'Date', render: (e: GarageEntreeStock) => formatDate(e.date) },
            { key: 'piece.reference', label: 'Référence', render: (e: GarageEntreeStock) => <span className="font-mono text-[#0B7439]">{e.piece?.reference ?? '—'}</span> },
            { key: 'piece.nom', label: 'Pièce', render: (e: GarageEntreeStock) => e.piece?.nom ?? '—' },
            { key: 'quantite', label: 'Quantité', className: 'text-right', render: (e: GarageEntreeStock) => <span className="font-bold text-[#0E7490]">+{e.quantite}</span> },
            { key: 'fournisseur.nom', label: 'Fournisseur', render: (e: GarageEntreeStock) => e.fournisseur?.nom ?? '—' },
            { key: 'effectue_par', label: 'Effectué par' },
          ]}
        />
      )}

      {tab === 'sorties' && (
        <ListPage
          title="" data={sorties} loading={loading}
          searchFields={['piece.reference', 'piece.nom', 'demandeur', 'car.registration_number']}
          columns={[
            { key: 'date', label: 'Date', render: (s: GarageSortiePiece) => formatDate(s.date) },
            { key: 'piece.reference', label: 'Référence', render: (s: GarageSortiePiece) => <span className="font-mono text-[#0B7439]">{s.piece?.reference ?? '—'}</span> },
            { key: 'piece.nom', label: 'Pièce', render: (s: GarageSortiePiece) => s.piece?.nom ?? '—' },
            { key: 'car.registration_number', label: 'N° Car', render: (s: GarageSortiePiece) => <span className="font-mono text-[#0B7439]">{s.car?.registration_number ?? '—'}</span> },
            { key: 'quantite', label: 'Quantité', className: 'text-right', render: (s: GarageSortiePiece) => <span className="font-bold text-[#AF3029]">-{s.quantite}</span> },
            { key: 'prix_unitaire', label: 'Prix unitaire', className: 'text-right', render: (s: GarageSortiePiece) => formatFCFA(s.prix_unitaire) },
            { key: 'montant', label: 'Montant', className: 'text-right', render: (s: GarageSortiePiece) => <span className="font-bold text-[#1A2E22]">{formatFCFA(s.montant)}</span> },
            { key: 'demandeur', label: 'Demandeur' },
          ]}
        />
      )}

      {/* Correct stock modal */}
      {correcting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5]">
              <h2 className="text-lg font-bold text-[#1A2E22]">Corriger le stock</h2>
              <button onClick={() => setCorrecting(null)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><Pencil className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-[#4A6B55]">Pièce : <span className="font-medium text-[#1A2E22]">{correcting.piece?.nom} ({correcting.piece?.reference})</span></p>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Nouvelle quantité</label>
                <input type="number" value={correctQty} onChange={e => setCorrectQty(Number(e.target.value))}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-[#E2EAE5]">
              <button onClick={() => setCorrecting(null)} className="px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8]">Annuler</button>
              <button onClick={handleCorrect} className="px-6 py-2.5 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2e]">Corriger</button>
            </div>
          </div>
        </div>
      )}

      {/* Entry modal */}
      {showEntry && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5]">
              <h2 className="text-lg font-bold text-[#1A2E22]">Nouvelle entrée de stock</h2>
              <button onClick={() => setShowEntry(false)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><ArrowDownToLine className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Pièce *</label>
                <select value={entryForm.piece_id} onChange={e => setEntryForm({ ...entryForm, piece_id: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                  <option value="">—</option>
                  {pieces.map(p => <option key={p.id} value={p.id}>{p.reference} — {p.nom}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Quantité *</label>
                  <input type="number" min={1} value={entryForm.quantite} onChange={e => setEntryForm({ ...entryForm, quantite: Number(e.target.value) })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Date</label>
                  <input type="date" value={entryForm.date} onChange={e => setEntryForm({ ...entryForm, date: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Fournisseur</label>
                <select value={entryForm.fournisseur_id} onChange={e => setEntryForm({ ...entryForm, fournisseur_id: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                  <option value="">—</option>
                  {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Effectué par</label>
                <input value={entryForm.effectue_par || user?.full_name || ''} onChange={e => setEntryForm({ ...entryForm, effectue_par: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-[#E2EAE5]">
              <button onClick={() => setShowEntry(false)} className="px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8]">Annuler</button>
              <button onClick={handleEntry} className="px-6 py-2.5 rounded-xl bg-[#0E7490] text-white text-sm font-medium hover:bg-[#0c6377]">Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Exit modal */}
      {showExit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5] sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-[#1A2E22]">Nouvelle sortie de pièce</h2>
              <button onClick={() => setShowExit(false)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Common fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Date</label>
                  <input type="date" value={exitDate} onChange={e => setExitDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Demandeur</label>
                  <input value={exitDemandeur} onChange={e => setExitDemandeur(e.target.value)} placeholder="Nom du demandeur"
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Effectué par</label>
                  <input value={exitEffectuePar || user?.full_name || ''} onChange={e => setExitEffectuePar(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
                </div>
              </div>

              {/* Multi-line exit rows */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#4A6B55]">Pièces à sortir</h3>
                  <span className="text-sm font-bold text-[#0B7439]">Total : {formatFCFA(exitTotal)}</span>
                </div>

                {exitRows.map((row, idx) => (
                  <ExitRow
                    key={idx}
                    row={row}
                    pieces={pieces}
                    cars={cars}
                    carsLoading={carsLoading}
                    groupes={groupes}
                    onChange={(patch) => updateExitRow(idx, patch)}
                    onSelectPiece={(pieceId) => selectPieceForRow(idx, pieceId)}
                    onSelectCar={(carId) => selectCarForRow(idx, carId)}
                    onRemove={() => removeExitRow(idx)}
                    canRemove={exitRows.length > 1}
                  />
                ))}

                <button onClick={addExitRow}
                  className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-[#0B7439]/30 rounded-xl text-sm font-medium text-[#0B7439] hover:bg-[#0B7439]/5 transition-colors w-full justify-center">
                  <Plus className="w-4 h-4" /> Ajouter une pièce
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-[#E2EAE5] sticky bottom-0 bg-white">
              <button onClick={() => setShowExit(false)} className="px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8]">Annuler</button>
              <button onClick={handleExit} className="px-6 py-2.5 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2e]">
                Enregistrer ({exitRows.filter(r => r.piece_id && r.quantite > 0).length} ligne(s))
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Autocomplete exit row ────────────────────────────────────
function ExitRow({
  row, pieces, cars, carsLoading, groupes, onChange, onSelectPiece, onSelectCar, onRemove, canRemove,
}: {
  row: { piece_id: string; quantite: number; prix_unitaire: number; car_id: string; groupe_id: string; pieceSearch: string; carSearch: string }
  pieces: GaragePiece[]
  cars: GarageBus[]
  carsLoading: boolean
  groupes: GarageCompany[]
  onChange: (patch: Partial<typeof row>) => void
  onSelectPiece: (pieceId: string) => void
  onSelectCar: (carId: string) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const [showPieceList, setShowPieceList] = useState(false)
  const [showCarList, setShowCarList] = useState(false)

  const filteredPieces = row.pieceSearch.trim()
    ? pieces.filter(p => {
        const q = row.pieceSearch.toLowerCase()
        return p.nom.toLowerCase().includes(q) ||
               p.reference.toLowerCase().includes(q) ||
               (p.famille?.nom ?? '').toLowerCase().includes(q) ||
               (p.sous_famille?.nom ?? '').toLowerCase().includes(q)
      }).slice(0, 10)
    : pieces.slice(0, 10)

  const carQuery = row.carSearch.trim().toLowerCase()
  const filteredCars = carQuery
    ? cars.filter(c =>
        c.immatriculation.toLowerCase().includes(carQuery) ||
        (c.company?.name ?? '').toLowerCase().includes(carQuery)
      ).slice(0, 20)
    : cars.slice(0, 20)

  const selectedPiece = pieces.find(p => p.id === row.piece_id)
  const selectedBus = cars.find(c => c.id === row.car_id)
  const selectedGroupe = groupes.find(g => g.id === row.groupe_id)
  const lineTotal = row.piece_id ? row.quantite * row.prix_unitaire : 0

  return (
    <div className="border border-[#E2EAE5] rounded-xl p-4 space-y-3 bg-[#F8FAF8]">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-[#6B7280]">Ligne</span>
        {canRemove && (
          <button onClick={onRemove} className="p-1 rounded-lg hover:bg-[#FEF2F2] text-[#AF3029]" title="Supprimer cette ligne">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Pièce autocomplete */}
        <div className="lg:col-span-2 relative">
          <label className="block text-xs font-medium text-[#4A6B55] mb-1">Pièce</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              value={row.pieceSearch}
              onChange={e => { onChange({ pieceSearch: e.target.value, piece_id: '' }); setShowPieceList(true) }}
              onFocus={() => setShowPieceList(true)}
              onBlur={() => setTimeout(() => setShowPieceList(false), 200)}
              placeholder="Rechercher une pièce..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20"
            />
          </div>
          {showPieceList && filteredPieces.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2EAE5] rounded-xl shadow-lg max-h-56 overflow-y-auto">
              {filteredPieces.map(p => (
                <button
                  key={p.id}
                  onMouseDown={() => onSelectPiece(p.id)}
                  className="w-full text-left px-3 py-2 hover:bg-[#F0F7F2] border-b border-[#F0F4F1] last:border-0"
                >
                  <div className="text-sm font-medium text-[#1A2E22]">{p.nom}</div>
                  <div className="text-xs text-[#6B7280]">
                    {p.reference}
                    {p.famille?.nom && ` · ${p.famille.nom}`}
                    {p.sous_famille?.nom && ` / ${p.sous_famille.nom}`}
                  </div>
                </button>
              ))}
            </div>
          )}
          {selectedPiece && (
            <div className="text-xs text-[#6B7280] mt-1">
              {selectedPiece.reference} · {selectedPiece.famille?.nom ?? '—'} / {selectedPiece.sous_famille?.nom ?? '—'}
            </div>
          )}
        </div>

        {/* Quantité */}
        <div>
          <label className="block text-xs font-medium text-[#4A6B55] mb-1">Qté</label>
          <input type="number" min={1} value={row.quantite}
            onChange={e => onChange({ quantite: Number(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
        </div>

        {/* Prix unitaire */}
        <div>
          <label className="block text-xs font-medium text-[#4A6B55] mb-1">Prix unit.</label>
          <input type="number" min={0} value={row.prix_unitaire}
            onChange={e => onChange({ prix_unitaire: Number(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
        </div>

        {/* Montant ligne */}
        <div>
          <label className="block text-xs font-medium text-[#4A6B55] mb-1">Montant</label>
          <div className="px-3 py-2 rounded-lg bg-[#E8F5EC] text-sm font-bold text-[#0B7439] text-right">
            {formatFCFA(lineTotal)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Car autocomplete */}
        <div className="relative">
          <label className="block text-xs font-medium text-[#4A6B55] mb-1">Car</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              value={row.carSearch}
              onChange={e => { onChange({ carSearch: e.target.value, car_id: '', groupe_id: '' }); setShowCarList(true) }}
              onFocus={() => setShowCarList(true)}
              onBlur={() => setTimeout(() => setShowCarList(false), 200)}
              placeholder="Matricule ou société..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20"
            />
            {carsLoading && (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          {showCarList && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2EAE5] rounded-xl shadow-lg max-h-56 overflow-y-auto">
              {carsLoading ? (
                <div className="px-3 py-4 text-sm text-[#6B7280] flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
                  Chargement des cars...
                </div>
              ) : filteredCars.length > 0 ? (
                filteredCars.map(c => (
                  <button
                    key={c.id}
                    onMouseDown={() => onSelectCar(c.id)}
                    className="w-full text-left px-3 py-2 hover:bg-[#F0F7F2] border-b border-[#F0F4F1] last:border-0"
                  >
                    <div className="text-sm font-medium text-[#1A2E22]">{c.immatriculation}</div>
                    <div className="text-xs text-[#6B7280]">{c.company?.name ?? '—'}</div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-sm text-[#6B7280]">Aucun car trouvé</div>
              )}
            </div>
          )}
        </div>

        {/* Groupe auto-filled */}
        <div>
          <label className="block text-xs font-medium text-[#4A6B55] mb-1">Groupe / Société</label>
          <div className="px-3 py-2 rounded-lg bg-[#F0F4F1] text-sm text-[#1A2E22] border border-[#E2EAE5]">
            {selectedGroupe?.name ?? selectedBus?.company?.name ?? '—'}
          </div>
        </div>

        {/* Line total display */}
        <div className="flex items-end">
          <div className="w-full text-right text-sm font-bold text-[#1A2E22]">
            {formatFCFA(lineTotal)}
          </div>
        </div>
      </div>
    </div>
  )
}
