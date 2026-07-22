import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bus, Plus, Search, ArrowRight, X, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  fetchVehicles, createVehicle, fetchBuses, fetchCompanies, PLATE_STATUS_LABELS,
} from '@/services/logistics.service'
import type {
  Vehicle, VehicleInput, PlateStatus,
} from '@/types/logistics.types'
import type { LogisticsBus, LogisticsCompany } from '@/services/logistics.service'
import ExportButton from '@/components/shared/ExportButton'

const PLATE_STYLE: Record<PlateStatus, { bg: string; text: string }> = {
  provisoire:             { bg: '#FEF3C7', text: '#B45309' },
  attente_carte_grise:    { bg: '#FEF3C7', text: '#B45309' },
  definitive:             { bg: '#E7F6EC', text: '#0B7439' },
  carte_grise_disponible: { bg: '#DBEAFE', text: '#1D4ED8' },
}

const EMPTY: VehicleInput = {
  bus_id: null, company_id: null, registration_number: null, provisional_number: null,
  brand: null, model: null, total_seats: null, circulation_date: null,
  chassis_number: null, carte_grise_number: null, plate_status: 'provisoire', observation: null,
}

export default function VehiclesList() {
  const navigate = useNavigate()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [buses, setBuses] = useState<LogisticsBus[]>([])
  const [companies, setCompanies] = useState<LogisticsCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [plateFilter, setPlateFilter] = useState<'all' | PlateStatus>('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<VehicleInput>(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([fetchVehicles(), fetchBuses(), fetchCompanies()])
      .then(([v, b, c]) => { setVehicles(v); setBuses(b); setCompanies(c) })
      .catch((err) => { console.error(err); toast.error('Erreur lors du chargement') })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const onPickBus = (busId: string) => {
    const b = buses.find(x => x.id === busId)
    if (!b) { setForm(f => ({ ...f, bus_id: null })); return }
    setForm(f => ({
      ...f,
      bus_id: b.id,
      company_id: b.company_id,
      registration_number: b.registration_number,
      brand: b.brand ?? b.manufacturer,
      model: b.model,
      total_seats: b.total_seats,
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const v = await createVehicle(form)
      toast.success('Fiche véhicule créée')
      setModalOpen(false); setForm(EMPTY)
      navigate(`/logistique/vehicles/${v.id}`)
    } catch (err) { console.error(err); toast.error('Erreur lors de l\'enregistrement') }
    finally { setSaving(false) }
  }

  const filtered = useMemo(() => vehicles.filter(v => {
    if (plateFilter !== 'all' && v.plate_status !== plateFilter) return false
    if (companyFilter !== 'all' && v.company_id !== companyFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return [v.registration_number, v.provisional_number, v.brand, v.model, v.chassis_number, v.company_name]
      .some(x => (x ?? '').toLowerCase().includes(q))
  }), [vehicles, plateFilter, companyFilter, search])

  const activeFilterCount = (plateFilter !== 'all' ? 1 : 0) + (companyFilter !== 'all' ? 1 : 0)

  function resetFilters() {
    setPlateFilter('all'); setCompanyFilter('all'); setSearch('')
  }

  async function exportExcel() {
    const { utils, writeFile } = await import('xlsx')
    const rows = filtered.map(v => ({
      'Immatriculation': v.registration_number ?? '',
      'Numéro provisoire': v.provisional_number ?? '',
      'Marque': v.brand ?? '',
      'Modèle': v.model ?? '',
      'Places': v.total_seats ?? '',
      'Date mise en circulation': v.circulation_date ?? '',
      'Numéro châssis': v.chassis_number ?? '',
      'Numéro carte grise': v.carte_grise_number ?? '',
      'Statut plaque': PLATE_STATUS_LABELS[v.plate_status],
      'Société': v.company_name ?? '',
      'Observation': v.observation ?? '',
    }))
    const ws = utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 8 },
      { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 25 }, { wch: 30 },
    ]
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Parc véhicules')
    writeFile(wb, 'parc_vehicules.xlsx')
  }

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    pdf.setFontSize(16)
    pdf.setTextColor(11, 116, 57)
    pdf.text('Parc véhicules', 14, 18)

    const filterParts: string[] = []
    if (plateFilter !== 'all') filterParts.push(`Plaque: ${PLATE_STATUS_LABELS[plateFilter]}`)
    if (companyFilter !== 'all') filterParts.push(`Société: ${companies.find(c => c.id === companyFilter)?.name ?? ''}`)
    if (search) filterParts.push(`Recherche: ${search}`)
    pdf.setFontSize(9)
    pdf.setTextColor(100, 100, 100)
    if (filterParts.length) pdf.text(filterParts.join('  ·  '), 14, 24)
    pdf.text(`${filtered.length} véhicule(s)`, 14, filterParts.length ? 29 : 24)

    const cols = ['Immat.', 'Prov.', 'Marque', 'Modèle', 'Pl.', 'Mise circul.', 'Châssis', 'Carte grise', 'Statut plaque', 'Société']
    const widths = [22, 22, 20, 18, 10, 22, 28, 22, 28, 30]
    const totalW = widths.reduce((a, b) => a + b, 0)
    let y = filterParts.length ? 36 : 31

    pdf.setFontSize(8)
    pdf.setTextColor(255, 255, 255)
    pdf.setFillColor(11, 116, 57)
    pdf.rect(14, y - 4, totalW, 7, 'F')
    let x = 16
    cols.forEach((c, i) => { pdf.text(c, x, y); x += widths[i] })
    y += 8

    pdf.setTextColor(30, 30, 30)
    filtered.forEach((v, i) => {
      if (y > 195) { pdf.addPage(); y = 20 }
      if (i % 2 === 0) { pdf.setFillColor(247, 250, 248); pdf.rect(14, y - 4, totalW, 7, 'F') }
      x = 16
      pdf.text((v.registration_number ?? '').slice(0, 16), x, y); x += widths[0]
      pdf.text((v.provisional_number ?? '').slice(0, 16), x, y); x += widths[1]
      pdf.text((v.brand ?? '').slice(0, 12), x, y); x += widths[2]
      pdf.text((v.model ?? '').slice(0, 10), x, y); x += widths[3]
      pdf.text(String(v.total_seats ?? ''), x, y); x += widths[4]
      pdf.text(v.circulation_date ?? '', x, y); x += widths[5]
      pdf.text((v.chassis_number ?? '').slice(0, 20), x, y); x += widths[6]
      pdf.text((v.carte_grise_number ?? '').slice(0, 16), x, y); x += widths[7]
      pdf.text(PLATE_STATUS_LABELS[v.plate_status].slice(0, 18), x, y); x += widths[8]
      pdf.text((v.company_name ?? '').slice(0, 20), x, y)
      y += 7
    })
    pdf.save('parc_vehicules.pdf')
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#E7F6EC] flex items-center justify-center">
            <Bus className="w-6 h-6 text-[#0B7439]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1A2E22]">Parc véhicules</h1>
            <p className="text-sm text-[#6B7280]">Fiches bus & immatriculations</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton onExportPDF={exportPdf} onExportExcel={exportExcel} />
          <button onClick={() => { setForm(EMPTY); setModalOpen(true) }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2f] transition-colors">
            <Plus className="w-4 h-4" /> Nouvelle fiche
          </button>
        </div>
      </div>

      {/* Barre de filtres */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30" />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[#6B7280]" />
          <select
            value={plateFilter}
            onChange={e => setPlateFilter(e.target.value as 'all' | PlateStatus)}
            className="px-3 py-2 rounded-xl border border-[#E2EAE5] text-sm text-[#1A2E22] bg-white focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
          >
            <option value="all">Tous les statuts plaque</option>
            {Object.entries(PLATE_STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>

          <select
            value={companyFilter}
            onChange={e => setCompanyFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#E2EAE5] text-sm text-[#1A2E22] bg-white focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
          >
            <option value="all">Toutes les sociétés</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {activeFilterCount > 0 && (
            <button onClick={resetFilters} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-[#6B7280] hover:bg-[#F0F4F1] transition-colors">
              <X className="w-3.5 h-3.5" /> Réinitialiser
            </button>
          )}
        </div>

        {filtered.length !== vehicles.length && (
          <span className="text-xs text-[#6B7280] ml-auto">
            {filtered.length} / {vehicles.length} véhicule(s)
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] text-center py-16 text-[#6B7280]">Aucune fiche véhicule.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(v => {
            const ps = PLATE_STYLE[v.plate_status]
            return (
              <button key={v.id} onClick={() => navigate(`/logistique/vehicles/${v.id}`)} className="bg-white rounded-2xl border border-[#E2EAE5] p-5 text-left hover:shadow-md transition-shadow group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono font-bold text-[#0B7439] text-lg truncate">{v.registration_number || v.provisional_number || 'Sans plaque'}</p>
                    <p className="text-sm text-[#4A6B55] truncate">{[v.brand, v.model].filter(Boolean).join(' ') || '—'}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#0B7439] flex-shrink-0" />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: ps.bg, color: ps.text }}>{PLATE_STATUS_LABELS[v.plate_status]}</span>
                  <span className="text-xs text-[#8AA898]">{v.company_name || '—'}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2EAE5]">
              <h2 className="font-semibold text-[#1A2E22]">Nouvelle fiche véhicule</h2>
              <button onClick={() => setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6]"><X className="w-5 h-5 text-[#6B7280]" /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <Field label="Bus existant (optionnel)">
                <select value={form.bus_id ?? ''} onChange={e => onPickBus(e.target.value)} className={inputCls}>
                  <option value="">— Saisie manuelle —</option>
                  {buses.map(b => <option key={b.id} value={b.id}>{b.registration_number} · {[b.brand, b.model].filter(Boolean).join(' ')}</option>)}
                </select>
              </Field>
              <Field label="Société propriétaire">
                <select value={form.company_id ?? ''} onChange={e => setForm({ ...form, company_id: e.target.value || null })} className={inputCls}>
                  <option value="">— Aucune —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Immatriculation actuelle"><input value={form.registration_number ?? ''} onChange={e => setForm({ ...form, registration_number: e.target.value || null })} className={inputCls} /></Field>
                <Field label="Numéro provisoire WWW"><input value={form.provisional_number ?? ''} onChange={e => setForm({ ...form, provisional_number: e.target.value || null })} className={inputCls} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Marque"><input value={form.brand ?? ''} onChange={e => setForm({ ...form, brand: e.target.value || null })} className={inputCls} /></Field>
                <Field label="Modèle"><input value={form.model ?? ''} onChange={e => setForm({ ...form, model: e.target.value || null })} className={inputCls} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nombre de places"><input type="number" min={0} value={form.total_seats ?? ''} onChange={e => setForm({ ...form, total_seats: e.target.value ? Number(e.target.value) : null })} className={inputCls} /></Field>
                <Field label="Date mise en circulation"><input type="date" value={form.circulation_date ?? ''} onChange={e => setForm({ ...form, circulation_date: e.target.value || null })} className={inputCls} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Numéro châssis"><input value={form.chassis_number ?? ''} onChange={e => setForm({ ...form, chassis_number: e.target.value || null })} className={inputCls} /></Field>
                <Field label="Numéro carte grise"><input value={form.carte_grise_number ?? ''} onChange={e => setForm({ ...form, carte_grise_number: e.target.value || null })} className={inputCls} /></Field>
              </div>
              <Field label="Statut plaque">
                <select value={form.plate_status} onChange={e => setForm({ ...form, plate_status: e.target.value as PlateStatus })} className={inputCls}>
                  {Object.entries(PLATE_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Observation"><textarea rows={2} value={form.observation ?? ''} onChange={e => setForm({ ...form, observation: e.target.value || null })} className={inputCls} /></Field>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#E2EAE5]">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-xl border border-[#E2EAE5] text-[#4A6B55] text-sm font-medium hover:bg-[#F8FAF8]">Annuler</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-[#0B7439] text-white text-sm font-medium hover:bg-[#095e2f] disabled:opacity-60">{saving ? 'Enregistrement...' : 'Créer la fiche'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-[#E2EAE5] text-sm text-[#1A2E22] focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30 focus:border-[#0B7439]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="block text-xs font-medium text-[#4A6B55] mb-1.5">{label}</label>{children}</div>)
}
