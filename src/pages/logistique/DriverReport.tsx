import { useState, useEffect, useMemo } from 'react'
import {
  Search, X, Building2, Route as RouteIcon, FileText, Filter,
  ChevronDown, Users as UsersIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import { resolveCompanyIds, type CompanyWithHierarchy } from '@/utils/companyGroups'
import { fetchBusesWithDrivers, type LogistiqueDriver } from '@/services/logistiqueDrivers.service'
import ExportButton from '@/components/shared/ExportButton'

interface Company extends CompanyWithHierarchy {}
interface RouteOption { id: string; name: string }
interface BusOption { id: string; registration_number: string; company_id: string | null }

interface ReportRow {
  id: string
  first_name: string
  last_name: string
  full_name: string
  phone: string | null
  company_id: string | null
  bus_registration: string | null
  contract_type: string | null
  assigned_route_name: string | null
  contract_nature: string | null
  company_name: string | null
  company_code: string | null
  subgroup_name: string | null
}

const selectCls = 'w-full border border-[#E2EAE5] rounded-xl px-3 py-2.5 text-sm text-[#374151] bg-white appearance-none pr-8 focus:outline-none focus:border-[#0B7439] transition-colors'

function SelectWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="absolute right-2.5 top-3 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
    </div>
  )
}

function statusLabel(nature: string | null): string {
  if (nature === 'salarie') return 'Salarié'
  if (nature === 'non_salarie') return 'Non salarié'
  return '—'
}

function statusBadgeClass(nature: string | null): string {
  if (nature === 'salarie') return 'bg-[#D4EDDA] text-[#0B7439]'
  if (nature === 'non_salarie') return 'bg-[#FEF3C7] text-[#B45309]'
  return 'bg-[#F4F7F5] text-[#6B7280]'
}

function contractLabel(ct: string | null): string {
  if (ct === 'titulaire') return 'Titulaire'
  if (ct === 'contractuel') return 'Contractuel'
  return '—'
}

export default function DriverReport() {
  const [drivers, setDrivers] = useState<LogistiqueDriver[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [buses, setBuses] = useState<BusOption[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [routeFilter, setRouteFilter] = useState('')
  const [contractFilter, setContractFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [driverData, companiesRes, routesRes, busesRes] = await Promise.all([
          fetchBusesWithDrivers(),
          supabase.from('companies').select('id, name, code, parent_id, is_group').order('name'),
          supabase.from('routes').select('id, name').eq('is_active', true).order('name'),
          supabase.from('buses').select('id, registration_number, company_id').order('registration_number'),
        ])
        const allDrivers: LogistiqueDriver[] = []
        for (const bus of driverData.buses) {
          for (const d of bus.drivers) {
            allDrivers.push({ ...d, bus_registration: bus.registration_number })
          }
        }
        for (const d of driverData.unassignedDrivers) {
          if (!allDrivers.find(x => x.id === d.id)) allDrivers.push(d)
        }
        setDrivers(allDrivers)
        if (companiesRes.data) setCompanies(companiesRes.data as Company[])
        if (routesRes.data) setRoutes(routesRes.data as RouteOption[])
        if (busesRes.data) setBuses(busesRes.data as BusOption[])
      } catch {
        toast.error('Erreur lors du chargement des chauffeurs')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Build lookup maps
  const routeNameMap = useMemo(() => {
    const m = new Map<string, string>()
    routes.forEach(r => m.set(r.id, r.name))
    return m
  }, [routes])

  const busRegMap = useMemo(() => {
    const m = new Map<string, string>()
    buses.forEach(b => m.set(b.id, b.registration_number))
    return m
  }, [buses])

  const companyMap = useMemo(() => {
    const m = new Map<string, Company>()
    companies.forEach(c => m.set(c.id, c))
    return m
  }, [companies])

  // Resolve subgroup name (parent company name if company has a parent)
  function getSubgroupName(companyId: string | null): string | null {
    if (!companyId) return null
    const comp = companyMap.get(companyId)
    if (!comp) return null
    if (comp.parent_id) {
      const parent = companyMap.get(comp.parent_id)
      return parent?.name ?? null
    }
    return null
  }

  // Build report rows
  const reportRows: ReportRow[] = useMemo(() => {
    return drivers.map(d => ({
      id: d.id,
      first_name: d.first_name ?? '',
      last_name: d.last_name ?? '',
      full_name: `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(),
      phone: d.phone ?? null,
      company_id: d.company_id ?? null,
      bus_registration: d.bus_registration ?? (d.bus_id ? busRegMap.get(d.bus_id) ?? null : null),
      contract_type: d.contract_type ?? null,
      assigned_route_name: d.assigned_route_name ?? (d.assigned_route_id ? routeNameMap.get(d.assigned_route_id) ?? null : null),
      contract_nature: d.contract_nature ?? null,
      company_name: d.company_name ?? (d.company_id ? companyMap.get(d.company_id)?.name ?? null : null),
      company_code: d.company_code ?? (d.company_id ? companyMap.get(d.company_id)?.code ?? null : null),
      subgroup_name: getSubgroupName(d.company_id),
    }))
  }, [drivers, busRegMap, routeNameMap, companyMap])

  // Apply filters
  const filtered = useMemo(() => {
    let result = reportRows

    if (companyFilter) {
      const ids = resolveCompanyIds(companyFilter, companies)
      result = result.filter(r => r.company_id != null && ids.includes(r.company_id))
    }

    if (routeFilter) {
      result = result.filter(r => r.assigned_route_name === routeFilter)
    }

    if (contractFilter) {
      result = result.filter(r => r.contract_type === contractFilter)
    }

    if (statusFilter) {
      result = result.filter(r => r.contract_nature === statusFilter)
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter(r =>
        r.full_name.toLowerCase().includes(q) ||
        (r.phone ?? '').toLowerCase().includes(q) ||
        (r.bus_registration ?? '').toLowerCase().includes(q) ||
        (r.assigned_route_name ?? '').toLowerCase().includes(q) ||
        (r.company_name ?? '').toLowerCase().includes(q) ||
        (r.subgroup_name ?? '').toLowerCase().includes(q) ||
        (r.company_code ?? '').toLowerCase().includes(q)
      )
    }

    return result
  }, [reportRows, companyFilter, routeFilter, contractFilter, statusFilter, search, companies])

  // Filter option lists
  const routeOptions = useMemo(() => {
    const names = new Set<string>()
    reportRows.forEach(r => { if (r.assigned_route_name) names.add(r.assigned_route_name) })
    return Array.from(names).sort()
  }, [reportRows])

  // Export Excel
  async function exportExcel() {
    const { utils, writeFile } = await import('xlsx')
    const headers = ['Nom et Prénom', 'Téléphone', 'Matricule du car', 'Type', 'Ligne', 'Statut', 'Société', 'Sous-groupe']
    const aoa: unknown[][] = [
      ['RAPPORT CONDUCTEUR — SBTA'],
      [`Date: ${new Date().toLocaleDateString('fr-FR')}`],
      [`Total: ${filtered.length} chauffeur(s)`],
      [],
      headers,
      ...filtered.map(r => [
        r.full_name,
        r.phone ?? '—',
        r.bus_registration ?? '—',
        contractLabel(r.contract_type),
        r.assigned_route_name ?? '—',
        statusLabel(r.contract_nature),
        r.company_name ?? '—',
        r.subgroup_name ?? '—',
      ]),
    ]
    const ws = utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 22 }]
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Rapport Conducteur')
    writeFile(wb, 'rapport_conducteur.xlsx')
  }

  // Export PDF — landscape, matching reference layout
  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pageW = 297
    const margin = 10
    const contentW = pageW - margin * 2

    // Header band
    pdf.setFillColor(11, 116, 57)
    pdf.rect(margin, margin, contentW, 16, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(14)
    pdf.setFont('helvetica', 'bold')
    pdf.text('RAPPORT CONDUCTEUR', margin + 5, margin + 7)
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'normal')
    pdf.text(`SBTA — ${new Date().toLocaleDateString('fr-FR')}`, pageW - margin - 5, margin + 7, { align: 'right' })
    pdf.text(`Total: ${filtered.length} chauffeur(s)`, pageW - margin - 5, margin + 13, { align: 'right' })

    // Column positions
    const cols = [
      { label: 'Nom et Prénom', x: margin + 3, w: 48 },
      { label: 'Téléphone',     x: margin + 52, w: 26 },
      { label: 'Matricule',     x: margin + 79, w: 22 },
      { label: 'Type',          x: margin + 102, w: 24 },
      { label: 'Ligne',         x: margin + 127, w: 38 },
      { label: 'Statut',        x: margin + 166, w: 26 },
      { label: 'Société',       x: margin + 193, w: 42 },
      { label: 'Sous-groupe',   x: margin + 236, w: 51 },
    ]

    let y = margin + 22

    // Table header
    pdf.setFillColor(11, 116, 57)
    pdf.rect(margin, y - 4, contentW, 7, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'bold')
    cols.forEach(c => pdf.text(c.label, c.x, y))
    y += 6

    // Rows
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(30, 30, 30)

    filtered.forEach((r, i) => {
      if (y > 200) {
        pdf.addPage()
        y = margin + 5
        // repeat header
        pdf.setFillColor(11, 116, 57)
        pdf.rect(margin, y - 4, contentW, 7, 'F')
        pdf.setTextColor(255, 255, 255)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        cols.forEach(c => pdf.text(c.label, c.x, y))
        y += 6
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(7.5)
        pdf.setTextColor(30, 30, 30)
      }

      if (i % 2 === 0) {
        pdf.setFillColor(247, 250, 248)
        pdf.rect(margin, y - 4, contentW, 6, 'F')
      }

      const vals = [
        r.full_name,
        r.phone ?? '—',
        r.bus_registration ?? '—',
        contractLabel(r.contract_type),
        r.assigned_route_name ?? '—',
        statusLabel(r.contract_nature),
        r.company_name ?? '—',
        r.subgroup_name ?? '—',
      ]
      vals.forEach((v, idx) => {
        const text = v.length > 22 ? v.substring(0, 21) + '…' : v
        pdf.text(text, cols[idx].x, y)
      })

      y += 6
    })

    // Footer line
    y += 2
    pdf.setDrawColor(11, 116, 57)
    pdf.setLineWidth(0.3)
    pdf.line(margin, y, pageW - margin, y)
    y += 5
    pdf.setFontSize(7)
    pdf.setTextColor(100, 100, 100)
    pdf.text(`Généré le ${new Date().toLocaleString('fr-FR')} — SBTA Rapport Conducteur`, margin, y)

    pdf.save('rapport_conducteur.pdf')
  }

  const hasActiveFilters = companyFilter || routeFilter || contractFilter || statusFilter || search

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Rapport conducteur</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Consultation, filtrage et export des informations chauffeurs
          </p>
        </div>
        <ExportButton onExportPDF={exportPdf} onExportExcel={exportExcel} />
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total chauffeurs', value: filtered.length, color: '#0B7439' },
          { label: 'Titulaires', value: filtered.filter(r => r.contract_type === 'titulaire').length, color: '#1D6FA4' },
          { label: 'Contractuels', value: filtered.filter(r => r.contract_type === 'contractuel').length, color: '#D97706' },
          { label: 'Salariés', value: filtered.filter(r => r.contract_nature === 'salarie').length, color: '#059669' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-[#E2EAE5] p-4 flex items-center gap-3">
            <div className="w-2 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: kpi.color }} />
            <div>
              <p className="text-xs text-[#6B7280] font-medium">{kpi.label}</p>
              <p className="text-xl font-bold text-[#1A2E22]">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters panel */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-[#0B7439]" />
          <h2 className="font-semibold text-[#1A2E22] text-sm">Filtres</h2>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setCompanyFilter(''); setRouteFilter(''); setContractFilter(''); setStatusFilter('') }}
              className="ml-auto text-xs text-[#0B7439] hover:underline flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Réinitialiser
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Company filter */}
          <div>
            <label className="block text-xs font-medium text-[#4A6B55] mb-1.5 flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Société
            </label>
            <SelectWrap>
              <select
                value={companyFilter}
                onChange={e => setCompanyFilter(e.target.value)}
                className={selectCls}
              >
                <option value="">Toutes les sociétés</option>
                {companies.filter(c => !c.is_group).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                {companies.filter(c => c.is_group).map(g => (
                  <option key={g.id} value={g.id}>[Groupe] {g.name}</option>
                ))}
              </select>
            </SelectWrap>
          </div>

          {/* Route filter */}
          <div>
            <label className="block text-xs font-medium text-[#4A6B55] mb-1.5 flex items-center gap-1">
              <RouteIcon className="w-3 h-3" /> Ligne
            </label>
            <SelectWrap>
              <select
                value={routeFilter}
                onChange={e => setRouteFilter(e.target.value)}
                className={selectCls}
              >
                <option value="">Toutes les lignes</option>
                {routeOptions.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </SelectWrap>
          </div>

          {/* Contract type filter */}
          <div>
            <label className="block text-xs font-medium text-[#4A6B55] mb-1.5">
              Type de contrat
            </label>
            <SelectWrap>
              <select
                value={contractFilter}
                onChange={e => setContractFilter(e.target.value)}
                className={selectCls}
              >
                <option value="">Tous les contrats</option>
                <option value="titulaire">Titulaire</option>
                <option value="contractuel">Contractuel</option>
              </select>
            </SelectWrap>
          </div>

          {/* Status filter */}
          <div>
            <label className="block text-xs font-medium text-[#4A6B55] mb-1.5">
              Statut
            </label>
            <SelectWrap>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className={selectCls}
              >
                <option value="">Tous les statuts</option>
                <option value="salarie">Salarié</option>
                <option value="non_salarie">Non salarié</option>
              </select>
            </SelectWrap>
          </div>
        </div>

        {/* Search bar */}
        <div className="mt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par nom, prénom, téléphone, matricule, ligne, société, sous-groupe..."
              className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl border border-[#E2EAE5] bg-[#F8FAF8] text-[#1A2E22] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1A2E22]">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-[#6B7280]">
            <UsersIcon className="w-8 h-8 mb-2 text-[#9CA3AF]" />
            <p className="text-sm">Aucun chauffeur trouvé avec ces critères</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0B7439] text-left text-xs font-semibold text-white uppercase tracking-wide">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Nom et Prénom</th>
                  <th className="px-4 py-3">Téléphone</th>
                  <th className="px-4 py-3">Matricule du car</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Ligne</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Société</th>
                  <th className="px-4 py-3">Sous-groupe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1]">
                {filtered.map((r, idx) => (
                  <tr key={r.id} className="even:bg-[#F7FAF8] hover:bg-[#EEF6F1] transition-colors">
                    <td className="px-4 py-3 text-[#6B7280] font-medium tabular-nums">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-[#1A2E22]">{r.full_name || '—'}</td>
                    <td className="px-4 py-3 text-[#4A6B55] tabular-nums">{r.phone ?? '—'}</td>
                    <td className="px-4 py-3 font-mono font-bold text-[#0B7439]">
                      {r.bus_registration ?? <span className="text-[#9CA3AF] font-normal">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.contract_type ? (
                        <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                          r.contract_type === 'titulaire' ? 'bg-[#D4EDDA] text-[#0B7439]' : 'bg-[#DBEAFE] text-[#1D6FA4]'
                        }`}>
                          {contractLabel(r.contract_type)}
                        </span>
                      ) : <span className="text-[#9CA3AF]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[#4A6B55]">
                      {r.assigned_route_name ? (
                        <span className="flex items-center gap-1">
                          <RouteIcon className="w-3 h-3 text-[#0B7439]" />
                          {r.assigned_route_name}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-lg text-xs font-medium ${statusBadgeClass(r.contract_nature)}`}>
                        {statusLabel(r.contract_nature)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#1A2E22]">{r.company_name ?? '—'}</div>
                      {r.company_code && <div className="text-xs text-[#8AA898]">{r.company_code}</div>}
                    </td>
                    <td className="px-4 py-3 text-[#4A6B55]">{r.subgroup_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!loading && (
          <div className="px-4 py-3 border-t border-[#E2EAE5] bg-[#F8FAF8]">
            <p className="text-xs text-[#6B7280]">
              {filtered.length} chauffeur(s) affiché(s) sur {reportRows.length} au total
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
