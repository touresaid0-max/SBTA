import { useEffect, useState } from 'react'
import { Pencil, AlertTriangle, ArrowDownToLine, ArrowUpCircle, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import ListPage from '@/components/garage/ListPage'
import { fetchStock, correctStock, fetchEntrees, fetchSorties, createEntree, createSortie, fetchPieces, fetchFournisseurs, fetchCars, fetchGroupes } from '@/services/garageSbta.service'
import type { GarageStock, GaragePiece, GarageFournisseur, GarageCar, GarageGroupe, GarageEntreeStock, GarageSortiePiece } from '@/types/garage.types'
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
  const [cars, setCars] = useState<GarageCar[]>([])
  const [groupes, setGroupes] = useState<GarageGroupe[]>([])
  const [loading, setLoading] = useState(true)
  const [correcting, setCorrecting] = useState<GarageStock | null>(null)
  const [correctQty, setCorrectQty] = useState(0)
  const [showEntry, setShowEntry] = useState(false)
  const [showExit, setShowExit] = useState(false)
  const { user } = useAuthStore()

  const [entryForm, setEntryForm] = useState({ piece_id: '', quantite: 1, date: new Date().toISOString().slice(0, 10), fournisseur_id: '', effectue_par: '' })
  const [exitForm, setExitForm] = useState({ piece_id: '', quantite: 1, date: new Date().toISOString().slice(0, 10), car_id: '', groupe_id: '', demandeur: '', prix_unitaire: 0, effectue_par: '' })

  const load = () => {
    setLoading(true)
    Promise.all([fetchStock(), fetchEntrees(), fetchSorties(), fetchPieces(), fetchFournisseurs(), fetchCars(), fetchGroupes()])
      .then(([s, e, so, p, f, c, g]) => { setStock(s); setEntrees(e); setSorties(so); setPieces(p); setFournisseurs(f); setCars(c); setGroupes(g) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
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
    if (!exitForm.piece_id || exitForm.quantite <= 0) { toast.error('Pièce et quantité requises'); return }
    try {
      await createSortie({ ...exitForm, car_id: exitForm.car_id || null, groupe_id: exitForm.groupe_id || null, prix_unitaire: exitForm.prix_unitaire, effectue_par: exitForm.effectue_par || user?.full_name || '' })
      toast.success('Sortie enregistrée'); setShowExit(false); load()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

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
          <button onClick={() => setShowExit(true)} className="flex items-center gap-2 px-4 py-2.5 bg-[#0B7439] text-white rounded-xl font-medium hover:bg-[#095e2e] transition-colors">
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
          searchFields={['piece.reference', 'piece.nom', 'demandeur', 'car.immatriculation']}
          columns={[
            { key: 'date', label: 'Date', render: (s: GarageSortiePiece) => formatDate(s.date) },
            { key: 'piece.reference', label: 'Référence', render: (s: GarageSortiePiece) => <span className="font-mono text-[#0B7439]">{s.piece?.reference ?? '—'}</span> },
            { key: 'piece.nom', label: 'Pièce', render: (s: GarageSortiePiece) => s.piece?.nom ?? '—' },
            { key: 'car.immatriculation', label: 'N° Car', render: (s: GarageSortiePiece) => <span className="font-mono text-[#0B7439]">{s.car?.immatriculation ?? '—'}</span> },
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
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-[#E2EAE5]">
              <h2 className="text-lg font-bold text-[#1A2E22]">Nouvelle sortie de pièce</h2>
              <button onClick={() => setShowExit(false)} className="p-1 rounded-lg hover:bg-[#F4F7F5]"><ArrowUpCircle className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#4A6B55] mb-1">Pièce *</label>
                <select value={exitForm.piece_id} onChange={e => {
                  const p = pieces.find(p => p.id === e.target.value)
                  setExitForm({ ...exitForm, piece_id: e.target.value, prix_unitaire: p ? Number(p.prix_unitaire) : 0 })
                }} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                  <option value="">—</option>
                  {pieces.map(p => <option key={p.id} value={p.id}>{p.reference} — {p.nom}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Quantité *</label>
                  <input type="number" min={1} value={exitForm.quantite} onChange={e => setExitForm({ ...exitForm, quantite: Number(e.target.value) })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Prix unitaire</label>
                  <input type="number" min={0} value={exitForm.prix_unitaire} onChange={e => setExitForm({ ...exitForm, prix_unitaire: Number(e.target.value) })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Date</label>
                  <input type="date" value={exitForm.date} onChange={e => setExitForm({ ...exitForm, date: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Groupe</label>
                  <select value={exitForm.groupe_id} onChange={e => setExitForm({ ...exitForm, groupe_id: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                    <option value="">—</option>
                    {groupes.map(g => <option key={g.id} value={g.id}>{g.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Car</label>
                  <select value={exitForm.car_id} onChange={e => setExitForm({ ...exitForm, car_id: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm">
                    <option value="">—</option>
                    {cars.map(c => <option key={c.id} value={c.id}>{c.immatriculation}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Demandeur</label>
                  <input value={exitForm.demandeur} onChange={e => setExitForm({ ...exitForm, demandeur: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4A6B55] mb-1">Effectué par</label>
                  <input value={exitForm.effectue_par || user?.full_name || ''} onChange={e => setExitForm({ ...exitForm, effectue_par: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-[#E2EAE5]">
              <button onClick={() => setShowExit(false)} className="px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8]">Annuler</button>
              <button onClick={handleExit} className="px-6 py-2.5 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2e]">Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
