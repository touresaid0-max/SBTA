import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/services/supabase'
import {
  fetchBordereaux, fetchBordereauLignes, fetchSocietes, fetchSegments, fetchGuichetSrcs,
  importBordereau, verifyBordereau,
  type Bordereau, type BordereauLigne, type AbgSociete, type AbgSegment, type AbgGuichetSrc,
  formatCFA,
} from '@/services/abg.service'
import {
  FileText, Search, Download, Upload, ChevronRight, CheckCircle2, AlertTriangle,
  X, Plus, Trash2, Eye, Filter,
} from 'lucide-react'
import toast from 'react-hot-toast'

type StatusFilter = 'all' | 'recu' | 'verifie' | 'ecart'

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  recu:    { label: 'Reçu',    bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  verifie: { label: 'Vérifié', bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
  ecart:   { label: 'Écart',   bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
}

const SOURCE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  auto:   { label: 'Auto',   bg: 'bg-emerald-50', text: 'text-emerald-600' },
  import: { label: 'Import', bg: 'bg-amber-50',   text: 'text-amber-600' },
}

export default function Bordereaux() {
  const [bordereaux, setBordereaux] = useState<Bordereau[]>([])
  const [societes, setSocietes] = useState<AbgSociete[]>([])
  const [segments, setSegments] = useState<AbgSegment[]>([])
  const [guichets, setGuichets] = useState<AbgGuichetSrc[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Bordereau | null>(null)
  const [lignes, setLignes] = useState<BordereauLigne[]>([])
  const [loadingLignes, setLoadingLignes] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const [filters, setFilters] = useState({
    gare: '',
    societe: '',
    segment: '',
    status: 'all' as StatusFilter,
    dateFrom: '',
    dateTo: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bords, socs, segs, guichs] = await Promise.all([
        fetchBordereaux({
          gare: filters.gare || undefined,
          societe: filters.societe || undefined,
          segment: filters.segment || undefined,
          status: filters.status === 'all' ? undefined : filters.status,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        }),
        fetchSocietes(),
        fetchSegments(),
        fetchGuichetSrcs(),
      ])
      setBordereaux(bords)
      setSocietes(socs)
      setSegments(segs)
      setGuichets(guichs)
    } catch (e) {
      toast.error('Erreur lors du chargement des bordereaux')
    }
    setLoading(false)
  }, [filters])

  useEffect(() => { load() }, [load])

  const openDetail = async (bordereau: Bordereau) => {
    setSelected(bordereau)
    setLoadingLignes(true)
    try {
      const lines = await fetchBordereauLignes(bordereau.id)
      setLignes(lines)
    } catch {
      toast.error('Erreur lors du chargement des lignes')
      setLignes([])
    }
    setLoadingLignes(false)
  }

  const handleVerify = async (bordereau: Bordereau) => {
    try {
      const result = await verifyBordereau(bordereau.id, 'verify')
      if (result.error) {
        toast.error(result.error)
        if (result.ecarts && result.ecarts.length > 0) {
          setSelected(null)
          await load()
        }
      } else {
        toast.success('Bordereau vérifié avec succès')
        setSelected(null)
        await load()
      }
    } catch {
      toast.error('Erreur lors de la vérification')
    }
  }

  const handleDispute = async (bordereau: Bordereau) => {
    const comment = prompt('Commentaire d\'écart:')
    if (!comment) return
    try {
      await verifyBordereau(bordereau.id, 'dispute', comment)
      toast.success('Écart signalé')
      setSelected(null)
      await load()
    } catch {
      toast.error('Erreur lors du signalement')
    }
  }

  const gareOptions = [...new Set(guichets.map(g => g.gare_label))].sort()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2a22]">Bordereaux</h1>
          <p className="text-sm mt-0.5 text-[#6B7280]">Bordereaux de départ — ligne Agboville</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(s => !s)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E2EAE5] rounded-xl text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8] transition-colors"
          >
            <Filter className="w-4 h-4" /> Filtrer
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] transition-colors"
          >
            <Upload className="w-4 h-4" /> Import d'appoint
          </button>
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total bordereaux" value={bordereaux.length.toString()} color="bg-[#0B7439]" />
        <StatCard label="Reçus" value={bordereaux.filter(b => b.status === 'recu').length.toString()} color="bg-blue-500" />
        <StatCard label="Vérifiés" value={bordereaux.filter(b => b.status === 'verifie').length.toString()} color="bg-green-500" />
        <StatCard label="Écarts" value={bordereaux.filter(b => b.status === 'ecart').length.toString()} color="bg-orange-500" />
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <FilterSelect label="Gare" value={filters.gare} onChange={v => setFilters(p => ({ ...p, gare: v }))}
              options={gareOptions.map(g => ({ value: g, label: g }))} />
            <FilterSelect label="Société" value={filters.societe} onChange={v => setFilters(p => ({ ...p, societe: v }))}
              options={societes.map(s => ({ value: s.code, label: s.code }))} />
            <FilterSelect label="Segment" value={filters.segment} onChange={v => setFilters(p => ({ ...p, segment: v }))}
              options={segments.map(s => ({ value: s.code, label: s.label }))} />
            <FilterSelect label="Statut" value={filters.status} onChange={v => setFilters(p => ({ ...p, status: v as StatusFilter }))}
              options={[{ value: 'all', label: 'Tous' }, { value: 'recu', label: 'Reçu' }, { value: 'verifie', label: 'Vérifié' }, { value: 'ecart', label: 'Écart' }]} />
            <FilterDate label="Du" value={filters.dateFrom} onChange={v => setFilters(p => ({ ...p, dateFrom: v }))} />
            <FilterDate label="Au" value={filters.dateTo} onChange={v => setFilters(p => ({ ...p, dateTo: v }))} />
          </div>
          <div className="flex justify-end">
            <button onClick={() => setFilters({ gare: '', societe: '', segment: '', status: 'all', dateFrom: '', dateTo: '' })}
              className="text-xs text-[#6B7280] hover:text-[#0B7439] underline">Réinitialiser</button>
          </div>
        </div>
      )}

      {/* Bordereaux table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : bordereaux.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-center">
            <FileText className="w-10 h-10 text-gray-300 mb-2" />
            <p className="text-sm text-[#9CA3AF]">Aucun bordereau reçu. Les bordereaux apparaissent automatiquement après la clôture d'un départ.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F8FAF8]">
                <tr>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Date</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Gare</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Société</th>
                  <th className="text-left px-4 py-3 text-[#4A6B55] font-semibold">Segment</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">MT Ticket</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Dép. P/R</th>
                  <th className="text-right px-4 py-3 text-[#4A6B55] font-semibold">Solde</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Source</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Statut</th>
                  <th className="text-center px-4 py-3 text-[#4A6B55] font-semibold">Détail</th>
                </tr>
              </thead>
              <tbody>
                {bordereaux.map(b => {
                  const st = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.recu
                  const src = SOURCE_CONFIG[b.source] ?? SOURCE_CONFIG.auto
                  return (
                    <tr key={b.id} className="border-t border-[#E2EAE5] hover:bg-[#F8FAF8] transition-colors cursor-pointer"
                      onClick={() => openDetail(b)}>
                      <td className="px-4 py-3 text-[#374151] whitespace-nowrap">{new Date(b.bordereau_date).toLocaleDateString('fr-FR')}</td>
                      <td className="px-4 py-3 text-[#374151] font-medium">{b.gare_label}</td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0B7439]">{b.societe_code}</td>
                      <td className="px-4 py-3 text-[#6B7280]">{b.segment_code ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-[#374151] font-medium">{formatCFA(b.total_mt_ticket)}</td>
                      <td className="px-4 py-3 text-right text-[#6B7280]">{formatCFA(b.total_depense_pr)}</td>
                      <td className="px-4 py-3 text-right text-[#374151] font-semibold">{formatCFA(b.total_solde)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${src.bg} ${src.text}`}>{src.label}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Eye className="w-4 h-4 text-[#6B7280] inline" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <BordereauDetail
          bordereau={selected}
          lignes={lignes}
          loading={loadingLignes}
          onClose={() => setSelected(null)}
          onVerify={() => handleVerify(selected)}
          onDispute={() => handleDispute(selected)}
        />
      )}

      {/* Import modal */}
      {showImport && (
        <ImportModal
          societes={societes}
          segments={segments}
          guichets={guichets}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load() }}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#E2EAE5] p-3">
      <div className={`w-1.5 h-1.5 rounded-full ${color} mb-1.5`} />
      <p className="text-xs text-[#6B7280]">{label}</p>
      <p className="text-xl font-bold text-[#1a2a22]">{value}</p>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="text-xs text-[#6B7280] mb-1 block">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439]">
        <option value="">Tous</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function FilterDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-[#6B7280] mb-1 block">{label}</label>
      <input type="date" value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439]" />
    </div>
  )
}

function BordereauDetail({ bordereau, lignes, loading, onClose, onVerify, onDispute }: {
  bordereau: Bordereau
  lignes: BordereauLigne[]
  loading: boolean
  onClose: () => void
  onVerify: () => void
  onDispute: () => void
}) {
  const st = STATUS_CONFIG[bordereau.status] ?? STATUS_CONFIG.recu

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div className="relative w-full max-w-2xl bg-white shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-[#E2EAE5] px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-[#1a2a22]">Bordereau du {new Date(bordereau.bordereau_date).toLocaleDateString('fr-FR')}</h2>
            <p className="text-sm text-[#6B7280]">{bordereau.gare_label} · {bordereau.societe_code} · {bordereau.segment_code ?? '—'}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#F8FAF8] rounded-lg"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Status + source */}
          <div className="flex gap-2 items-center">
            <span className={`inline-flex px-3 py-1 rounded-full text-sm font-semibold border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>
            <span className="inline-flex px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-600">
              Source: {bordereau.source === 'auto' ? 'Automatique' : 'Import'}
            </span>
          </div>

          {/* Totaux */}
          <div className="grid grid-cols-3 gap-3">
            <TotalCard label="Tickets" value={bordereau.total_tickets.toString()} />
            <TotalCard label="Sièges" value={bordereau.total_seats.toString()} />
            <TotalCard label="Bagage" value={formatCFA(bordereau.total_baggage)} />
            <TotalCard label="MT Ticket" value={formatCFA(bordereau.total_mt_ticket)} highlight />
            <TotalCard label="Dépense P/R" value={formatCFA(bordereau.total_depense_pr)} />
            <TotalCard label="Solde" value={formatCFA(bordereau.total_solde)} highlight />
          </div>

          {/* Ecart comment */}
          {bordereau.ecart_comment && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <span className="text-sm font-semibold text-orange-700">Commentaire d'écart</span>
              </div>
              <p className="text-sm text-orange-800">{bordereau.ecart_comment}</p>
            </div>
          )}

          {/* Lignes détaillées */}
          <div>
            <h3 className="text-sm font-semibold text-[#4A6B55] mb-2">Lignes par car</h3>
            {loading ? (
              <div className="flex items-center justify-center h-24">
                <div className="w-6 h-6 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : lignes.length === 0 ? (
              <p className="text-sm text-[#9CA3AF] text-center py-6">Aucune ligne détaillée</p>
            ) : (
              <div className="overflow-x-auto border border-[#E2EAE5] rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-[#F8FAF8]">
                    <tr>
                      <th className="text-left px-3 py-2 text-[#4A6B55] font-semibold">Car (matricule)</th>
                      <th className="text-center px-3 py-2 text-[#4A6B55] font-semibold">N° Départ</th>
                      <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Sièges</th>
                      <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">MT Ticket</th>
                      <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Dép. P/R</th>
                      <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Solde</th>
                      <th className="text-right px-3 py-2 text-[#4A6B55] font-semibold">Bagage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map(l => (
                      <tr key={l.id} className="border-t border-[#E2EAE5]">
                        <td className="px-3 py-2 font-mono text-xs font-semibold text-[#0B7439]">{l.car_matricule}</td>
                        <td className="px-3 py-2 text-center text-[#6B7280]">{l.departure_number ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-[#374151]">{l.seats}</td>
                        <td className="px-3 py-2 text-right text-[#374151] font-medium">{formatCFA(l.mt_ticket)}</td>
                        <td className="px-3 py-2 text-right text-[#6B7280]">{formatCFA(l.depense_pr)}</td>
                        <td className="px-3 py-2 text-right text-[#374151] font-semibold">{formatCFA(l.solde_ticket)}</td>
                        <td className="px-3 py-2 text-right text-[#6B7280]">{formatCFA(l.bagage)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#F8FAF8] border-t-2 border-[#E2EAE5]">
                    <tr>
                      <td className="px-3 py-2 font-semibold text-[#4A6B55]" colSpan={2}>Total</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#374151]">{bordereau.total_seats}</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#374151]">{formatCFA(bordereau.total_mt_ticket)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#374151]">{formatCFA(bordereau.total_depense_pr)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#374151]">{formatCFA(bordereau.total_solde)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#374151]">{formatCFA(bordereau.total_baggage)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Actions */}
          {bordereau.status === 'recu' && (
            <div className="flex gap-3 pt-2">
              <button onClick={onVerify}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors">
                <CheckCircle2 className="w-4 h-4" /> Vérifier
              </button>
              <button onClick={onDispute}
                className="flex items-center gap-1.5 px-4 py-2 bg-orange-100 text-orange-700 rounded-xl text-sm font-medium hover:bg-orange-200 transition-colors">
                <AlertTriangle className="w-4 h-4" /> Signaler un écart
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TotalCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'bg-[#0B7439]/5 border-[#0B7439]/20' : 'bg-[#F8FAF8] border-[#E2EAE5]'}`}>
      <p className="text-xs text-[#6B7280] mb-0.5">{label}</p>
      <p className={`text-lg font-bold ${highlight ? 'text-[#0B7439]' : 'text-[#1a2a22]'}`}>{value}</p>
    </div>
  )
}

interface ImportLine {
  car_matricule: string
  departure_number: string
  seats: string
  mt_ticket: string
  depense_pr: string
  bagage: string
}

function ImportModal({ societes, segments, guichets, onClose, onImported }: {
  societes: AbgSociete[]
  segments: AbgSegment[]
  guichets: AbgGuichetSrc[]
  onClose: () => void
  onImported: () => void
}) {
  const [form, setForm] = useState({
    bordereau_date: new Date().toISOString().split('T')[0],
    guichet_src_id: '',
    gare_label: '',
    segment_code: '',
    societe_code: '',
  })
  const [lignes, setLignes] = useState<ImportLine[]>([
    { car_matricule: '', departure_number: '', seats: '', mt_ticket: '', depense_pr: '', bagage: '' },
  ])
  const [saving, setSaving] = useState(false)

  const inputCls = 'w-full border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-[#374151] focus:outline-none focus:border-[#0B7439]'

  const addLine = () => setLignes(p => [...p, { car_matricule: '', departure_number: '', seats: '', mt_ticket: '', depense_pr: '', bagage: '' }])
  const removeLine = (idx: number) => setLignes(p => p.filter((_, i) => i !== idx))
  const updateLine = (idx: number, field: keyof ImportLine, value: string) =>
    setLignes(p => p.map((l, i) => i === idx ? { ...l, [field]: value } : l))

  const selectGuichet = (id: string) => {
    setForm(p => ({ ...p, guichet_src_id: id }))
    const g = guichets.find(x => x.id === id)
    if (g) {
      setForm(p => ({ ...p, gare_label: g.gare_label }))
      const soc = societes.find(s => s.id === g.societe_id)
      if (soc) setForm(p => ({ ...p, societe_code: soc.code }))
    }
  }

  const save = async () => {
    if (!form.bordereau_date || !form.gare_label || !form.societe_code) {
      toast.error('Date, gare et société sont obligatoires')
      return
    }
    if (lignes.length === 0 || lignes.every(l => !l.car_matricule.trim())) {
      toast.error('Au moins une ligne avec un matricule est requise')
      return
    }
    setSaving(true)
    try {
      await importBordereau({
        bordereau_date: form.bordereau_date,
        guichet_src_id: form.guichet_src_id || null,
        gare_label: form.gare_label,
        segment_code: form.segment_code || undefined,
        societe_code: form.societe_code,
        lignes: lignes.filter(l => l.car_matricule.trim()).map(l => ({
          car_matricule: l.car_matricule.trim(),
          departure_number: l.departure_number,
          seats: l.seats ? parseInt(l.seats) : 0,
          mt_ticket: l.mt_ticket ? parseFloat(l.mt_ticket) : 0,
          depense_pr: l.depense_pr ? parseFloat(l.depense_pr) : 0,
          bagage: l.bagage ? parseFloat(l.bagage) : 0,
        })),
      })
      toast.success('Bordereau importé avec succès')
      onImported()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur lors de l\'import')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-[#E2EAE5] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-[#1a2a22]">Import d'appoint — bordereau manuel</h2>
          <button onClick={onClose} className="p-2 hover:bg-[#F8FAF8] rounded-lg"><X className="w-5 h-5 text-[#6B7280]" /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-[#6B7280] bg-amber-50 border border-amber-200 rounded-xl p-3">
            Cet import est utilisé pour les sociétés non encore branchées au module Guichet. Le bordereau sera marqué <strong>source = import</strong>.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Date *</label>
              <input type="date" value={form.bordereau_date} onChange={e => setForm(p => ({ ...p, bordereau_date: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Guichet source (optionnel)</label>
              <select value={form.guichet_src_id} onChange={e => selectGuichet(e.target.value)} className={inputCls}>
                <option value="">— Aucun (saisie libre) —</option>
                {guichets.map(g => <option key={g.id} value={g.id}>{g.gare_label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Gare *</label>
              <input value={form.gare_label} onChange={e => setForm(p => ({ ...p, gare_label: e.target.value }))} placeholder="ex: Yopougon" className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Société *</label>
              <select value={form.societe_code} onChange={e => setForm(p => ({ ...p, societe_code: e.target.value }))} className={inputCls}>
                <option value="">— Choisir —</option>
                {societes.map(s => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#6B7280] mb-1 block">Segment</label>
              <select value={form.segment_code} onChange={e => setForm(p => ({ ...p, segment_code: e.target.value }))} className={inputCls}>
                <option value="">— Aucun —</option>
                {segments.map(s => <option key={s.id} value={s.code}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Lignes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-[#4A6B55]">Lignes par car</h3>
              <button onClick={addLine} className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#0B7439] hover:bg-[#0B7439]/5 rounded-lg">
                <Plus className="w-3 h-3" /> Ajouter une ligne
              </button>
            </div>
            <div className="space-y-2">
              {lignes.map((l, idx) => (
                <div key={idx} className="grid grid-cols-7 gap-2 items-center">
                  <input value={l.car_matricule} onChange={e => updateLine(idx, 'car_matricule', e.target.value)} placeholder="Matricule" className={inputCls} />
                  <input value={l.departure_number} onChange={e => updateLine(idx, 'departure_number', e.target.value)} placeholder="N° dép." className={inputCls} />
                  <input value={l.seats} onChange={e => updateLine(idx, 'seats', e.target.value)} placeholder="Sièges" type="number" className={inputCls} />
                  <input value={l.mt_ticket} onChange={e => updateLine(idx, 'mt_ticket', e.target.value)} placeholder="MT Ticket" type="number" className={inputCls} />
                  <input value={l.depense_pr} onChange={e => updateLine(idx, 'depense_pr', e.target.value)} placeholder="Dép. P/R" type="number" className={inputCls} />
                  <input value={l.bagage} onChange={e => updateLine(idx, 'bagage', e.target.value)} placeholder="Bagage" type="number" className={inputCls} />
                  <button onClick={() => removeLine(idx)} className="p-2 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[#E2EAE5] px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-[#E2EAE5] text-[#6B7280] rounded-xl text-sm font-medium hover:bg-[#F8FAF8]">Annuler</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#085c2d] disabled:opacity-50">
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download className="w-4 h-4" />}
            Importer
          </button>
        </div>
      </div>
    </div>
  )
}


export default ImportModal