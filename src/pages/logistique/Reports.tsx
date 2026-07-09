import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  FileText, Printer, FileCheck, FileWarning, FileX, Tag, CreditCard,
  Building2, Bus, Briefcase, Wallet, RefreshCw, Search, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { formatCurrency } from '@/utils/formatCurrency'
import ExportButton from '@/components/shared/ExportButton'
import {
  fetchDocuments, fetchVehicles, fetchAllPlates,
  effectiveStatus, daysUntil, STATUS_LABELS,
} from '@/services/logistics.service'
import type { VehicleDocument, Vehicle, VehiclePlate } from '@/types/logistics.types'

type ReportKey =
  | 'visite' | 'stationnement' | 'transport' | 'patente'
  | 'provisoires' | 'cartes_grises' | 'expires' | 'a_renouveler'
  | 'par_bus' | 'par_societe' | 'par_prestataire' | 'financier'

const REPORTS: { key: ReportKey; label: string; desc: string; icon: typeof FileText; color: string; bg: string }[] = [
  { key: 'visite',         label: 'Visites techniques',     desc: 'Documents de visite technique',   icon: FileCheck,  color: '#0B7439', bg: '#E7F6EC' },
  { key: 'stationnement',  label: 'Cartes stationnement',   desc: 'Cartes de stationnement',         icon: FileText,   color: '#1D4ED8', bg: '#DBEAFE' },
  { key: 'transport',      label: 'Cartes transport',       desc: 'Cartes de transport (2 ans)',     icon: FileText,   color: '#0B7439', bg: '#E7F6EC' },
  { key: 'patente',        label: 'Patentes',               desc: 'Patentes annuelles',              icon: FileText,   color: '#B45309', bg: '#FEF3C7' },
  { key: 'provisoires',    label: 'Plaques provisoires WWW', desc: 'Immatriculations provisoires',   icon: Tag,        color: '#B45309', bg: '#FEF3C7' },
  { key: 'cartes_grises',  label: 'Cartes grises',          desc: 'Plaques définitives',             icon: CreditCard, color: '#1D4ED8', bg: '#DBEAFE' },
  { key: 'expires',        label: 'Documents expirés',      desc: 'Tous documents dépassés',         icon: FileX,      color: '#B91C1C', bg: '#FEE2E2' },
  { key: 'a_renouveler',   label: 'À renouveler',           desc: 'Échéance dans 90 jours',          icon: FileWarning, color: '#B45309', bg: '#FEF3C7' },
  { key: 'par_bus',        label: 'Par bus',                desc: 'Regroupé par véhicule',           icon: Bus,        color: '#0B7439', bg: '#E7F6EC' },
  { key: 'par_societe',    label: 'Par société',            desc: 'Regroupé par société',            icon: Building2,  color: '#1D4ED8', bg: '#DBEAFE' },
  { key: 'par_prestataire', label: 'Par prestataire',       desc: 'Regroupé par prestataire',        icon: Briefcase,  color: '#0B7439', bg: '#E7F6EC' },
  { key: 'financier',      label: 'Financier logistique',   desc: 'Montants par statut',             icon: Wallet,     color: '#1D4ED8', bg: '#DBEAFE' },
]

interface Column { key: string; label: string; align?: 'right'; width?: string }
interface ReportData {
  title: string
  columns: Column[]
  rows: Record<string, string>[]
  groups?: { label: string; total?: string; rows: Record<string, string>[] }[]
  footer?: string
}

export default function LogistiqueReports() {
  const [documents, setDocuments] = useState<VehicleDocument[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [plates, setPlates] = useState<VehiclePlate[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<ReportKey>('visite')
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([fetchDocuments(), fetchVehicles(), fetchAllPlates()])
      .then(([d, v, p]) => { setDocuments(d); setVehicles(v); setPlates(p) })
      .catch(err => { console.error(err); toast.error('Erreur lors du chargement') })
      .finally(() => setLoading(false))
  }, [])

  const current = useMemo(() => documents.filter(d => d.is_current), [documents])
  const vehMap = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles])

  const report: ReportData = useMemo(() => {
    const docCols: Column[] = [
      { key: 'reg', label: 'Véhicule', width: '14%' },
      { key: 'societe', label: 'Société', width: '14%' },
      { key: 'type', label: 'Type', width: '16%' },
      { key: 'prestataire', label: 'Prestataire', width: '14%' },
      { key: 'etabli', label: 'Établi', width: '12%' },
      { key: 'echeance', label: 'Échéance', width: '12%' },
      { key: 'montant', label: 'Montant', align: 'right', width: '12%' },
      { key: 'statut', label: 'Statut', width: '6%' },
    ]
    const regOf = (d: VehicleDocument) => d.vehicle?.registration_number || d.vehicle?.provisional_number || '—'
    const societeOf = (d: VehicleDocument) => vehMap.get(d.vehicle_id ?? '')?.company_name ?? '—'
    const toRow = (d: VehicleDocument): Record<string, string> => ({
      reg: regOf(d),
      societe: societeOf(d),
      type: d.service_type_name + (d.year_concerned ? ` ${d.year_concerned}` : ''),
      prestataire: d.provider_name ?? '—',
      etabli: d.issue_date ? new Date(d.issue_date).toLocaleDateString('fr-FR') : '—',
      echeance: d.expiry_date ? new Date(d.expiry_date).toLocaleDateString('fr-FR') : '—',
      montant: formatCurrency(d.amount),
      statut: STATUS_LABELS[effectiveStatus(d)],
    })
    const sum = (list: VehicleDocument[]) => list.reduce((s, d) => s + Number(d.amount ?? 0), 0)
    const byType = (kw: string) => current.filter(d => d.service_type_name.toLowerCase().includes(kw))

    const platesReg = (p: VehiclePlate) => {
      const v = vehMap.get(p.vehicle_id ?? '')
      return v?.registration_number || v?.provisional_number || '—'
    }

    switch (active) {
      case 'visite': {
        const list = byType('visite')
        return { title: 'Rapport des visites techniques', columns: docCols, rows: list.map(toRow), footer: `${list.length} document(s) — Total : ${formatCurrency(sum(list))}` }
      }
      case 'stationnement': {
        const list = byType('stationnement')
        return { title: 'Rapport des cartes de stationnement', columns: docCols, rows: list.map(toRow), footer: `${list.length} document(s) — Total : ${formatCurrency(sum(list))}` }
      }
      case 'transport': {
        const list = byType('transport')
        return { title: 'Rapport des cartes de transport', columns: docCols, rows: list.map(toRow), footer: `${list.length} document(s) — Total : ${formatCurrency(sum(list))}` }
      }
      case 'patente': {
        const list = byType('patente')
        return { title: 'Rapport des patentes', columns: docCols, rows: list.map(toRow), footer: `${list.length} document(s) — Total : ${formatCurrency(sum(list))}` }
      }
      case 'provisoires': {
        const cols: Column[] = [
          { key: 'reg', label: 'Véhicule', width: '20%' },
          { key: 'plaque', label: 'N° provisoire WWW', width: '20%' },
          { key: 'recepisse', label: 'Date récépissé', width: '18%' },
          { key: 'expiry', label: 'Expiration récépissé', width: '18%' },
          { key: 'statut', label: 'Statut', width: '14%' },
        ]
        const list = plates.filter(p => p.plate_type === 'provisoire')
        const rows = list.map(p => ({
          reg: platesReg(p),
          plaque: p.plate_number,
          recepisse: p.recepisse_date ? new Date(p.recepisse_date).toLocaleDateString('fr-FR') : '—',
          expiry: p.recepisse_expiry ? new Date(p.recepisse_expiry).toLocaleDateString('fr-FR') : '—',
          statut: p.is_active ? 'Active' : (p.replaced_at ? 'Remplacée' : 'Inactive'),
        }))
        return { title: 'Rapport des plaques provisoires WWW', columns: cols, rows, footer: `${list.length} plaque(s) provisoire(s)` }
      }
      case 'cartes_grises': {
        const cols: Column[] = [
          { key: 'reg', label: 'Véhicule', width: '18%' },
          { key: 'plaque', label: 'Plaque définitive', width: '16%' },
          { key: 'cg', label: 'N° carte grise', width: '18%' },
          { key: 'etabli', label: 'Établissement', width: '16%' },
          { key: 'recu', label: 'Réception', width: '16%' },
          { key: 'statut', label: 'Statut', width: '16%' },
        ]
        const list = plates.filter(p => p.plate_type === 'definitive')
        const rows = list.map(p => ({
          reg: platesReg(p),
          plaque: p.plate_number,
          cg: p.carte_grise_number ?? '—',
          etabli: p.carte_grise_issue_date ? new Date(p.carte_grise_issue_date).toLocaleDateString('fr-FR') : '—',
          recu: p.carte_grise_received_date ? new Date(p.carte_grise_received_date).toLocaleDateString('fr-FR') : '—',
          statut: p.is_active ? 'Active' : 'Inactive',
        }))
        return { title: 'Rapport des cartes grises', columns: cols, rows, footer: `${list.length} carte(s) grise(s)` }
      }
      case 'expires': {
        const list = current.filter(d => effectiveStatus(d) === 'expire').sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date))
        const cols = [...docCols.slice(0, 6), { key: 'retard', label: 'Retard', align: 'right' as const, width: '10%' }]
        const rows = list.map(d => ({ ...toRow(d), retard: Math.abs(daysUntil(d.expiry_date)) + ' j' }))
        return { title: 'Documents expirés', columns: cols, rows, footer: `${list.length} document(s) expiré(s)` }
      }
      case 'a_renouveler': {
        const list = current.filter(d => { const dd = daysUntil(d.expiry_date); return dd >= 0 && dd <= 90 }).sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date))
        const cols = [...docCols.slice(0, 6), { key: 'jours', label: 'Jours restants', align: 'right' as const, width: '10%' }]
        const rows = list.map(d => ({ ...toRow(d), jours: daysUntil(d.expiry_date) + ' j' }))
        return { title: 'Documents à renouveler (90 jours)', columns: cols, rows, footer: `${list.length} document(s) à renouveler` }
      }
      case 'par_bus': {
        const map = new Map<string, VehicleDocument[]>()
        current.forEach(d => { const k = regOf(d); map.set(k, [...(map.get(k) ?? []), d]) })
        const groups = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, list]) => ({ label: `${label} (${list.length})`, total: formatCurrency(sum(list)), rows: list.map(toRow) }))
        return { title: 'Rapport par bus', columns: docCols, rows: current.map(toRow), groups, footer: `Total général : ${formatCurrency(sum(current))}` }
      }
      case 'par_societe': {
        const map = new Map<string, VehicleDocument[]>()
        current.forEach(d => { const k = societeOf(d); map.set(k, [...(map.get(k) ?? []), d]) })
        const groups = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, list]) => ({ label: `${label} (${list.length})`, total: formatCurrency(sum(list)), rows: list.map(toRow) }))
        return { title: 'Rapport par société', columns: docCols, rows: current.map(toRow), groups, footer: `Total général : ${formatCurrency(sum(current))}` }
      }
      case 'par_prestataire': {
        const map = new Map<string, VehicleDocument[]>()
        current.forEach(d => { const k = d.provider_name ?? '—'; map.set(k, [...(map.get(k) ?? []), d]) })
        const groups = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, list]) => ({ label: `${label} (${list.length})`, total: formatCurrency(sum(list)), rows: list.map(toRow) }))
        return { title: 'Rapport par prestataire', columns: docCols, rows: current.map(toRow), groups, footer: `Total général : ${formatCurrency(sum(current))}` }
      }
      case 'financier': {
        const cols: Column[] = [
          { key: 'statut', label: 'Statut', width: '50%' },
          { key: 'count', label: 'Nb documents', align: 'right', width: '25%' },
          { key: 'montant', label: 'Montant total', align: 'right', width: '25%' },
        ]
        const map = new Map<string, VehicleDocument[]>()
        current.forEach(d => { const s = STATUS_LABELS[effectiveStatus(d)]; map.set(s, [...(map.get(s) ?? []), d]) })
        const rows = [...map.entries()].map(([s, list]) => ({ statut: s, count: String(list.length), montant: formatCurrency(sum(list)) }))
        return { title: 'Rapport financier logistique', columns: cols, rows, footer: `Total (documents en cours) : ${formatCurrency(sum(current))}` }
      }
    }
  }, [active, current, plates, vehMap])

  const meta = REPORTS.find(r => r.key === active)!

  const searchPlaceholder = useMemo(() => {
    switch (active) {
      case 'par_bus': return 'Rechercher par plaque d\'immatriculation...'
      case 'cartes_grises': return 'Rechercher par plaque ou n° carte grise...'
      case 'provisoires': return 'Rechercher par plaque provisoire...'
      case 'par_societe': return 'Rechercher par nom de société...'
      case 'par_prestataire': return 'Rechercher par nom de prestataire...'
      case 'financier': return 'Rechercher par statut...'
      default: return 'Rechercher par plaque, prestataire, type...'
    }
  }, [active])

  const filteredReport: ReportData = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return report

    const matchRow = (row: Record<string, string>) =>
      Object.values(row).some(v => v.toLowerCase().includes(q))

    if (report.groups) {
      const filteredGroups = report.groups
        .map(g => {
          const labelMatch = g.label.toLowerCase().includes(q)
          const matchedRows = g.rows.filter(matchRow)
          if (labelMatch) return g
          if (matchedRows.length === 0) return null
          return { ...g, label: `${g.label.split(' (')[0]} (${matchedRows.length})`, rows: matchedRows }
        })
        .filter(Boolean) as ReportData['groups']

      const allFilteredRows = filteredGroups?.flatMap(g => g.rows) ?? []
      return { ...report, groups: filteredGroups, rows: allFilteredRows }
    }

    const filteredRows = report.rows.filter(matchRow)
    return { ...report, rows: filteredRows }
  }, [report, search])

  function buildReportHtml(): string {
    const esc = (s: string) => String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const printedAt = new Date().toLocaleString('fr-FR')
    const colgroup = `<colgroup>${report.columns.map(c => `<col style="width:${c.width ?? 'auto'}" />`).join('')}</colgroup>`
    const headCells = report.columns.map(c => `<th class="${c.align === 'right' ? 'r' : 'l'}">${esc(c.label)}</th>`).join('')
    const rowHtml = (r: Record<string, string>) => `<tr>${report.columns.map(c => `<td class="${c.align === 'right' ? 'r' : 'l'}">${esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`
    let body = ''
    if (report.groups) {
      for (const g of report.groups) {
        body += `<tr class="grp"><td class="grp-l" colspan="${report.columns.length - 1}">${esc(g.label)}</td><td class="grp-t r">${esc(g.total ?? '')}</td></tr>`
        body += g.rows.map(rowHtml).join('')
      }
    } else { body = report.rows.map(rowHtml).join('') }
    const footer = report.footer ? `<tr class="ft"><td colspan="${report.columns.length}" class="r">${esc(report.footer)}</td></tr>` : ''
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8" /><title>${esc(report.title)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #1A2E22; font-size: 11px; }
  .page { padding: 16px 20px; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid #0B7439; padding-bottom: 12px; }
  .brand { font-size: 20px; font-weight: 800; color: #0B7439; letter-spacing: .5px; }
  .brand small { display: block; font-size: 10px; font-weight: 500; color: #6B7280; margin-top: 2px; }
  .title { font-size: 16px; font-weight: 700; margin: 0; text-align: right; }
  .meta { font-size: 10px; color: #6B7280; text-align: right; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; table-layout: fixed; }
  th { background: #0B7439; color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; padding: 7px 8px; }
  th.l, td.l { text-align: left; } th.r, td.r { text-align: right; }
  td { padding: 6px 8px; border-bottom: 1px solid #E2EAE5; word-break: break-word; }
  tr.grp td { background: #E7F6EC; border-top: 2px solid #0B7439; }
  td.grp-l, td.grp-t { font-weight: 800; color: #0B7439; font-size: 12px; }
  tr.ft td { background: #1A2E22; color: #fff; font-weight: 800; font-size: 12px; padding: 9px 10px; }
  .foot-note { margin-top: 10px; font-size: 9px; color: #9CA3AF; text-align: center; }
  @page { size: A4 landscape; margin: 10mm; }
</style></head>
<body><div class="page">
  <div class="head"><div class="brand">SBTA<small>Responsable Logistique</small></div>
  <div><h1 class="title">${esc(report.title)}</h1><div class="meta">Édité le ${esc(printedAt)}</div></div></div>
  <table>${colgroup}<thead><tr>${headCells}</tr></thead><tbody>${body}${footer}</tbody></table>
  <p class="foot-note">Document généré automatiquement — SBTA · Service Logistique</p>
</div></body></html>`
  }

  function handlePrint() {
    const w = window.open('', '_blank', 'width=1200,height=800')
    if (!w) { toast.error('Veuillez autoriser les fenêtres pop-up pour imprimer.'); return }
    w.document.open(); w.document.write(buildReportHtml()); w.document.close(); w.focus()
    setTimeout(() => { try { w.print() } catch { /* noop */ } }, 400)
  }

  async function exportExcel() {
    const { utils, writeFile } = await import('xlsx')
    const header = report.columns.map(c => c.label)
    const aoa: unknown[][] = [[report.title], [], header]
    if (report.groups) {
      for (const g of report.groups) { aoa.push([], [g.label, g.total ?? '']); g.rows.forEach(r => aoa.push(report.columns.map(c => r[c.key] ?? ''))) }
    } else { report.rows.forEach(r => aoa.push(report.columns.map(c => r[c.key] ?? ''))) }
    if (report.footer) aoa.push([], [report.footer])
    const ws = utils.aoa_to_sheet(aoa)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, meta.label.slice(0, 31))
    writeFile(wb, `logistique_${active}.xlsx`)
  }

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const { default: html2canvas } = await import('html2canvas')
    const holder = document.createElement('div')
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1123px;background:#fff;'
    holder.innerHTML = buildReportHtml()
    document.body.appendChild(holder)
    try {
      const target = (holder.querySelector('.page') as HTMLElement) ?? holder
      const canvas = await html2canvas(target, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const imgW = 297, pageH = 210
      const imgH = (canvas.height * imgW) / canvas.width
      let position = 0
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgW, imgH)
      let remaining = imgH - pageH
      while (remaining > 0) { position -= pageH; pdf.addPage(); pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, position, imgW, imgH); remaining -= pageH }
      pdf.save(`logistique_${active}.pdf`)
    } catch (err) { console.error(err); toast.error('Erreur lors de la génération du PDF') }
    finally { document.body.removeChild(holder) }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  const renderRows = (rows: Record<string, string>[]) => rows.map((r, idx) => (
    <tr key={idx} className="even:bg-[#F7FAF8] hover:bg-[#EEF6F1] transition-colors">
      {report.columns.map(c => (
        <td key={c.key} className={'px-3 py-2 text-[#1A2E22] whitespace-nowrap ' + (c.align === 'right' ? 'text-right tabular-nums font-medium' : '')}>{r[c.key] ?? '—'}</td>
      ))}
    </tr>
  ))

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Rapports logistiques</h1>
          <p className="text-sm text-[#6B7280] mt-1">Génération et export des rapports</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-[#E2EAE5] text-[#4A6B55] text-sm font-medium hover:bg-[#F8FAF8] transition-colors">
            <Printer className="w-4 h-4" /> Imprimer
          </button>
          <ExportButton onExportPDF={exportPdf} onExportExcel={exportExcel} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {REPORTS.map(r => {
          const Icon = r.icon
          const isActive = r.key === active
          return (
            <button key={r.key} onClick={() => { setActive(r.key); setSearch('') }}
              className={'flex items-start gap-3 p-4 rounded-2xl border text-left transition-all ' + (isActive ? 'border-[#0B7439] ring-2 ring-[#0B7439]/20 bg-white' : 'border-[#E2EAE5] bg-white hover:bg-[#F8FAF8]')}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: r.bg }}>
                <Icon className="w-5 h-5" style={{ color: r.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1A2E22]">{r.label}</p>
                <p className="text-xs text-[#6B7280] mt-0.5">{r.desc}</p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2EAE5] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#0B7439]" />
            <h2 className="font-semibold text-[#1A2E22]">{report.title}</h2>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-[#E2EAE5] bg-[#F8FAF8] text-[#1A2E22] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1A2E22] transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {filteredReport.rows.length === 0 && !filteredReport.groups?.some(g => g.rows.length) ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#6B7280]">
            <RefreshCw className="w-10 h-10 text-[#9CDAB6] mb-2" />
            <p className="text-sm">{search ? 'Aucun résultat pour cette recherche.' : 'Aucune donnée pour ce rapport.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>{report.columns.map(c => <col key={c.key} style={{ width: c.width ?? 'auto' }} />)}</colgroup>
              <thead>
                <tr className="bg-[#0B7439] text-left text-xs font-semibold text-white uppercase tracking-wide">
                  {report.columns.map(c => <th key={c.key} className={'px-3 py-3 ' + (c.align === 'right' ? 'text-right' : '')}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F4F1]">
                {filteredReport.groups
                  ? filteredReport.groups.map(g => (
                      <Fragment key={g.label}>
                        <tr className="bg-[#E7F6EC] border-t-2 border-[#0B7439]">
                          <td colSpan={report.columns.length - 1} className="px-3 py-2.5 font-extrabold text-[#0B7439] text-[13px] tracking-wide">{g.label}</td>
                          <td className="px-3 py-2.5 text-right font-extrabold text-[#0B7439] text-[13px] tabular-nums">{g.total}</td>
                        </tr>
                        {renderRows(g.rows)}
                      </Fragment>
                    ))
                  : renderRows(filteredReport.rows)}
              </tbody>
            </table>
          </div>
        )}

        {report.footer && <div className="px-5 py-3.5 bg-[#1A2E22] text-sm font-bold text-white text-right tracking-wide">
          {search && filteredReport.rows.length !== report.rows.length
            ? `${filteredReport.rows.length} résultat(s) sur ${report.rows.length}`
            : report.footer}
        </div>}
      </div>
    </div>
  )
}
