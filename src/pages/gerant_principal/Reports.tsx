import { useEffect, useState, useMemo } from 'react'
import { FileText, Download, Printer } from 'lucide-react'
import jsPDF from 'jspdf'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import {
  fetchSorties, fetchPneus, fetchCommandes, fetchSettings, updateSetting, fetchCompaniesForGarage,
} from '@/services/garageSbta.service'
import type { GarageSortiePiece, GaragePneu, GarageCommandePiece, GarageGroupe, GarageSetting, GarageCompany } from '@/types/garage.types'
import { addReportHeader, addReportFooter, ensureSpace, formatDate, formatFCFA, type ReportFilters } from '@/components/garage/reportHelpers'

type ReportType = 'pieces_groupe' | 'pneus_michelin' | 'pneus_long_march' | 'commandes_groupe'
type GarageReportItem = GarageSortiePiece | GaragePneu | GarageCommandePiece

function groupItemsByCar<T extends GarageReportItem>(items: T[]): Array<{ registration: string; items: T[] }> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const registration = item.car?.registration_number ?? 'Sans car'
    const current = groups.get(registration) ?? []
    current.push(item)
    groups.set(registration, current)
  }
  return Array.from(groups, ([registration, groupedItems]) => ({ registration, items: groupedItems }))
}

function formatPdfAmount(value: number | string | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(value ?? 0)).replace(/[\u00A0\u202F]/g, ' ') + ' F CFA'
}

function drawPdfRight(doc: jsPDF, text: string, right: number, y: number): void {
  doc.text(text, right - doc.getTextWidth(text), y)
}

export default function GarageReports({ groupes: propGroupes, settings: propSettings, onReload }: {
  groupes: GarageGroupe[]; settings: GarageSetting[]; onReload: () => void;
}) {
  const { user } = useAuthStore()
  const [reportType, setReportType] = useState<ReportType>('pieces_groupe')
  const [sorties, setSorties] = useState<GarageSortiePiece[]>([])
  const [pneus, setPneus] = useState<GaragePneu[]>([])
  const [commandes, setCommandes] = useState<GarageCommandePiece[]>([])
  const [companies, setCompanies] = useState<GarageCompany[]>([])
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    dateTo: new Date().toISOString().slice(0, 10),
    groupeId: null,
  })
  const [loading, setLoading] = useState(true)
  const [prixMichelin, setPrixMichelin] = useState(325000)
  const [prixLongMarch, setPrixLongMarch] = useState(135000)
  const [editingPrices, setEditingPrices] = useState(false)

  useEffect(() => {
    Promise.all([fetchSorties(), fetchPneus(), fetchCommandes(), fetchCompaniesForGarage()])
      .then(([s, p, c, comps]) => { setSorties(s); setPneus(p); setCommandes(c); setCompanies(comps) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  const societes = useMemo(() => companies.filter(c => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name)), [companies])
  const sousGroupesBySociete = useMemo(() => {
    return new Map(societes.map(societe => [
      societe.id,
      companies.filter(company => company.parent_id === societe.id).sort((a, b) => a.name.localeCompare(b.name)),
    ]))
  }, [companies, societes])

  const handleSelectSociete = (id: string) => {
    setFilters(f => ({ ...f, groupeId: id || null }))
  }

  useEffect(() => {
    const pm = propSettings.find(s => s.key === 'prix_michelin')
    const plm = propSettings.find(s => s.key === 'prix_long_march')
    if (pm) setPrixMichelin(Number(pm.value))
    if (plm) setPrixLongMarch(Number(plm.value))
  }, [propSettings])

  const filteredData = useMemo(() => {
    const from = new Date(filters.dateFrom)
    const to = new Date(filters.dateTo)
    const inRange = (d: string) => new Date(d) >= from && new Date(d) <= to
    const byGroupe = (gid: string | null) => {
      if (!filters.groupeId) return true
      if (gid === filters.groupeId) return true
      // If filter is a group/societe, also match all its children
      const isChildOfFilter = companies.some(c => c.id === gid && c.parent_id === filters.groupeId)
      return isChildOfFilter
    }

    if (reportType === 'pieces_groupe') return sorties.filter(s => inRange(s.date) && byGroupe(s.groupe_id))
    if (reportType === 'pneus_michelin') return pneus.filter(p => inRange(p.date) && p.type_pneu === 'MICHELIN' && byGroupe(p.groupe_id))
    if (reportType === 'pneus_long_march') return pneus.filter(p => inRange(p.date) && p.type_pneu === 'LONG-MARCH' && byGroupe(p.groupe_id))
    if (reportType === 'commandes_groupe') return commandes.filter(c => inRange(c.date) && byGroupe(c.groupe_id))
    return []
  }, [reportType, sorties, pneus, commandes, filters])

  const grouped = useMemo(() => {
    const groups: Record<string, GarageSortiePiece[] | GaragePneu[] | GarageCommandePiece[]> = {}
    for (const item of filteredData) {
      const gid = (item as GarageSortiePiece).groupe_id ?? null
      const gname = companies.find(c => c.id === gid)?.name ?? propGroupes.find(g => g.id === gid)?.nom ?? 'Sans groupe'
      if (!groups[gname]) groups[gname] = []
      groups[gname].push(item as GarageSortiePiece)
    }
    return groups
  }, [filteredData, propGroupes, companies])

  const reportTypes: { key: ReportType; label: string }[] = [
    { key: 'pieces_groupe', label: 'Point financier des sorties de pièces par groupe' },
    { key: 'pneus_michelin', label: 'Fiche de point des pneus MICHELIN' },
    { key: 'pneus_long_march', label: 'Fiche de point des pneus LONG-MARCH' },
    { key: 'commandes_groupe', label: 'Point des nouvelles pièces de commande par groupe' },
    ]

  const handleSavePrices = async () => {
    try {
      await updateSetting('prix_michelin', prixMichelin)
      await updateSetting('prix_long_march', prixLongMarch)
      toast.success('Prix mis à jour')
      setEditingPrices(false)
      onReload()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  const isTireReport = reportType === 'pneus_michelin' || reportType === 'pneus_long_march'
  const tireLabel = reportType === 'pneus_michelin' ? 'PNEU MICHELIN' : 'LONG-MARCH'

  // ── PDF generation ──
  const generatePDF = () => {
    const doc = new jsPDF()
    const pw = doc.internal.pageSize.getWidth()
    const ph = doc.internal.pageSize.getHeight()
    const margin = 10
    const contentW = pw - 2 * margin

    const titles: Record<ReportType, string> = {
      pieces_groupe: 'Point financier des sorties de pièces de rechange par groupe',
      pneus_michelin: 'Fiche de point des pneus MICHELIN (GARAGE-SBTA)',
      pneus_long_march: 'Fiche de point des pneus LONG-MARCH (GARAGE-SBTA)',
      commandes_groupe: 'Point des nouvelles pièces de commande par groupe',
    }

    let y: number
    if (isTireReport) {
      const tireTitle = reportType === 'pneus_michelin'
        ? 'FICHE DE POINT DES PNEUS MICHELINS (GARAGE-SBTA)'
        : 'FICHE DE POINT DES PNEUS LONG-MARCH (GARAGE-SBTA)'
      doc.setFillColor(255, 232, 166); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.8)
      doc.rect(margin, 12, contentW, 10, 'FD')
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
      doc.text(tireTitle, pw / 2, 19, { align: 'center' })
      doc.setFontSize(10); doc.setFont('helvetica', 'normal')
      doc.text(`Période du ${formatDate(filters.dateFrom)} au ${formatDate(filters.dateTo)}`, pw / 2, 29, { align: 'center' })
      y = 35
    } else {
      y = addReportHeader(doc, {
        title: titles[reportType],
        subtitle: filters.groupeId ? `Groupe : ${companies.find(c => c.id === filters.groupeId)?.name ?? propGroupes.find(g => g.id === filters.groupeId)?.nom ?? '—'}` : undefined,
        userName: user?.full_name ?? '—',
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
      }, pw)
    }

    if (reportType === 'pieces_groupe') {
      const cols = [margin, margin + 8, margin + contentW * 0.46, margin + contentW * 0.60, margin + contentW * 0.80]
      let grandTotal = 0
      for (const [gname, items] of Object.entries(grouped)) {
        y = ensureSpace(doc, y, 30, ph, pw)
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
        doc.text(`GROUPE : ${gname}`, margin, y); y += 6

        let groupTotal = 0
        for (const { registration, items: carItems } of groupItemsByCar(items as GarageSortiePiece[])) {
          y = ensureSpace(doc, y, 18, ph, pw)
          doc.setFillColor(190, 190, 190); doc.rect(margin, y - 4, contentW, 6, 'F')
          doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
          doc.text(`CAR : ${registration}`, margin + 2, y); y += 5
          doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(74, 107, 85)
          doc.text('#', cols[0], y); doc.text('Pièces', cols[1], y)
          drawPdfRight(doc, 'Qté', cols[2], y)
          drawPdfRight(doc, 'Prix unit.', cols[3], y)
          drawPdfRight(doc, 'Total', cols[4], y)
          y += 3; doc.line(margin, y, pw - margin, y); y += 4
          doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40)
          carItems.forEach((s, i) => {
            y = ensureSpace(doc, y, 6, ph, pw)
            doc.text(String(i + 1), cols[0], y)
            doc.text(`${s.piece?.nom ?? '—'}${s.piece?.marque ? ` ${s.piece.marque}` : ''}`, cols[1], y, { max_width: cols[2] - cols[1] - 4 })
            drawPdfRight(doc, String(s.quantite), cols[2], y)
            drawPdfRight(doc, formatPdfAmount(s.prix_unitaire), cols[3], y)
            drawPdfRight(doc, formatPdfAmount(s.montant), cols[4], y)
            groupTotal += Number(s.montant); y += 5
          })
        }
        y = ensureSpace(doc, y, 10, ph, pw)
        doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 116, 57)
        drawPdfRight(doc, `TOTAL DU GROUPE : ${gname} — ${formatPdfAmount(groupTotal)}`, pw - margin, y)
        grandTotal += groupTotal; y += 8
      }
      y = ensureSpace(doc, y, 10, ph, pw)
      doc.setFillColor(11, 116, 57); doc.rect(margin, y - 4, contentW, 8, 'F')
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
      drawPdfRight(doc, `TOTAL GÉNÉRAL : ${formatPdfAmount(grandTotal)}`, pw - margin, y)
    }

    if (reportType === 'pneus_michelin' || reportType === 'pneus_long_march') {
      const typeLabel = reportType === 'pneus_michelin' ? 'PNEU MICHELIN' : 'LONG-MARCH'
      const colDate = margin
      const colLibelle = margin + contentW * 0.18
      const colCar = margin + contentW * 0.38
      const colQty = margin + contentW * 0.62
      const colPrix = margin + contentW * 0.80
      const colMontant = pw - margin
      let totalQty = 0; let totalMontant = 0

      for (const [gname, items] of Object.entries(grouped)) {
        y = ensureSpace(doc, y, 28, ph, pw)
        doc.setFillColor(255, 232, 166); doc.setDrawColor(0, 0, 0); doc.rect(margin, y - 4, contentW, 7, 'FD')
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
        doc.text(`GROUPE ${gname}`, margin + 2, y + 1); y += 7

        const groupItems = items as GaragePneu[]
        let groupQty = 0; let groupMontant = 0
        y = ensureSpace(doc, y, 18, ph, pw)
        doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 40, 70)
        doc.rect(margin, y - 4, contentW, 12)
        doc.line(colLibelle, y - 4, colLibelle, y + 8); doc.line(colCar, y - 4, colCar, y + 8)
        doc.line(colQty, y - 4, colQty, y + 8); doc.line(colPrix, y - 4, colPrix, y + 8)
        doc.line(colMontant, y - 4, colMontant, y + 8)
        doc.text('DATES', margin + 2, y + 3)
        doc.text('DESIGNATIONS', colLibelle + 2, y)
        doc.text('LIBELLES', colLibelle + 2, y + 5)
        doc.text('N° DE CARS', colCar + 2, y + 5)
        drawPdfRight(doc, 'QTE', colQty, y + 3)
        drawPdfRight(doc, 'P.UNITAIRE', colPrix, y + 3)
        drawPdfRight(doc, 'MONTANTS', colMontant, y + 3)
        y += 12

        doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
        groupItems.forEach(p => {
          y = ensureSpace(doc, y, 6, ph, pw)
          doc.rect(margin, y - 4, contentW, 6)
          doc.line(colLibelle, y - 4, colLibelle, y + 2); doc.line(colCar, y - 4, colCar, y + 2)
          doc.line(colQty, y - 4, colQty, y + 2); doc.line(colPrix, y - 4, colPrix, y + 2); doc.line(colMontant, y - 4, colMontant, y + 2)
          doc.text(formatDate(p.date), margin + 2, y)
          doc.text(typeLabel, colLibelle + 2, y)
          doc.text(p.car?.registration_number ?? '—', colCar + 2, y)
          drawPdfRight(doc, String(p.quantite), colQty, y)
          drawPdfRight(doc, formatPdfAmount(p.prix_unitaire), colPrix, y)
          drawPdfRight(doc, formatPdfAmount(p.montant), colMontant, y)
          groupQty += p.quantite; groupMontant += Number(p.montant); y += 6
        })

        y = ensureSpace(doc, y, 9, ph, pw)
        doc.setFont('helvetica', 'bold'); doc.setFillColor(255, 226, 204)
        doc.rect(colQty, y - 4, colMontant - colQty, 8, 'FD')
        doc.setTextColor(20, 20, 20)
        drawPdfRight(doc, String(groupQty), colQty - 2, y + 1)
        doc.text('TOTAL', colQty + 2, y + 1)
        drawPdfRight(doc, formatPdfAmount(groupMontant), colMontant - 2, y + 1)
        totalQty += groupQty; totalMontant += groupMontant; y += 10
      }

      y = ensureSpace(doc, y, 35, ph, pw)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(20, 20, 20)
      doc.setFillColor(255, 255, 255); doc.rect(margin, y, contentW * 0.34, 18, 'FD')
      doc.setFillColor(255, 226, 204); doc.rect(margin, y + 6, contentW * 0.34, 6, 'FD'); doc.rect(margin, y + 12, contentW * 0.34, 6, 'FD')
      doc.text('ARRIVAGE ACTUEL = — pcs', margin + 2, y + 4)
      doc.text(`PNEUS SORTIS = ${totalQty} pcs`, margin + 2, y + 10)
      doc.text('STOCK ACTUEL = — pcs', margin + 2, y + 16)

      const totalX = margin + contentW * 0.62
      doc.setFillColor(255, 246, 0); doc.rect(totalX, y, pw - margin - totalX, 9, 'FD')
      doc.setFontSize(10); doc.setTextColor(20, 40, 70)
      drawPdfRight(doc, `TOTAUX ${formatPdfAmount(totalMontant)}`, pw - margin - 2, y + 6)
      doc.setFontSize(8); doc.setTextColor(20, 20, 20)
      doc.text(`Fait à Abidjan, le ${formatDate(new Date())}`, pw / 2, y + 25, { align: 'center' })
    }

    if (reportType === 'commandes_groupe') {
      const colDate = margin
      const colDesign = margin + contentW * 0.18
      const colQty = margin + contentW * 0.62
      const colPrix = margin + contentW * 0.80
      const colMontant = pw - margin
      let grandQty = 0; let grandMontant = 0
      for (const [gname, items] of Object.entries(grouped)) {
        y = ensureSpace(doc, y, 30, ph, pw)
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
        doc.text(`GROUPE : ${gname}`, margin, y); y += 6

        let gQty = 0; let gMontant = 0
        for (const { registration, items: carItems } of groupItemsByCar(items as GarageCommandePiece[])) {
          y = ensureSpace(doc, y, 18, ph, pw)
          doc.setFillColor(190, 190, 190); doc.rect(margin, y - 4, contentW, 6, 'F')
          doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
          doc.text(`CAR : ${registration}`, margin + 2, y); y += 5
          doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(74, 107, 85)
          doc.text('Date', colDate, y); doc.text('Désignation/Type', colDesign, y)
          drawPdfRight(doc, 'Qté', colQty, y); drawPdfRight(doc, 'Prix unit.', colPrix, y); drawPdfRight(doc, 'Montant', colMontant, y)
          y += 3; doc.line(margin, y, pw - margin, y); y += 4
          doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40)
          carItems.forEach(c => {
            y = ensureSpace(doc, y, 6, ph, pw)
            doc.text(formatDate(c.date), colDate, y)
            doc.text(c.designation, colDesign, y, { max_width: colQty - colDesign - 4 })
            drawPdfRight(doc, String(c.quantite), colQty, y)
            drawPdfRight(doc, formatPdfAmount(c.prix_unitaire), colPrix, y)
            drawPdfRight(doc, formatPdfAmount(c.montant), colMontant, y)
            gQty += c.quantite; gMontant += Number(c.montant); y += 5
          })
        }
        y = ensureSpace(doc, y, 10, ph, pw)
        doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 116, 57)
        drawPdfRight(doc, `TOTAL ${gname} : ${gQty} pièces — ${formatPdfAmount(gMontant)}`, pw - margin, y)
        grandQty += gQty; grandMontant += gMontant; y += 8
      }
      y = ensureSpace(doc, y, 10, ph, pw)
      doc.setFillColor(11, 116, 57); doc.rect(margin, y - 4, contentW, 8, 'F')
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
      drawPdfRight(doc, `TOTAL GÉNÉRAL : ${grandQty} pièces — ${formatPdfAmount(grandMontant)}`, pw - margin, y)
    }

    addReportFooter(doc, ph, pw)
    doc.save(`rapport_garage_${reportType}_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-[#1A2E22]">Rapports</h2>
        <p className="text-sm text-[#6B7280] mt-1">Génération de rapports garage</p>
      </div>

      {/* Report type selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {reportTypes.map(r => (
          <button key={r.key} onClick={() => setReportType(r.key)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-medium transition-colors ${reportType === r.key ? 'bg-[#0B7439] text-white' : 'bg-white border border-[#E2EAE5] text-[#4A6B55] hover:bg-[#F8FAF8]'}`}>
            <FileText className="w-5 h-5 flex-shrink-0" /> {r.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#4A6B55] mb-1">Du</label>
            <input type="date" value={filters.dateFrom} onChange={e => setFilters({ ...filters, dateFrom: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4A6B55] mb-1">Au</label>
            <input type="date" value={filters.dateTo} onChange={e => setFilters({ ...filters, dateTo: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4A6B55] mb-1">Société (optionnel)</label>
            <select value={filters.groupeId ?? ''} onChange={e => handleSelectSociete(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20">
              <option value="">Toutes les sociétés</option>
              {societes.map(s => (
                <optgroup key={s.id} label={s.name}>
                  <option value={s.id}>{s.name}</option>
                  {sousGroupesBySociete.get(s.id)?.map(sg => (
                    <option key={sg.id} value={sg.id}>  └ {sg.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={generatePDF} disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#0B7439] text-white rounded-xl font-medium hover:bg-[#095e2e] disabled:opacity-50 transition-colors">
            <Download className="w-4 h-4" /> Exporter PDF
          </button>
          <button onClick={() => window.print()} disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8] disabled:opacity-50 transition-colors">
            <Printer className="w-4 h-4" /> Imprimer
          </button>
        </div>
      </div>

      {/* Tire price settings (visible for tire reports) */}
      {(reportType === 'pneus_michelin' || reportType === 'pneus_long_march') && (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-[#1A2E22]">Prix de référence des pneus</h3>
            <button onClick={() => setEditingPrices(!editingPrices)} className="text-sm text-[#0B7439] hover:underline">
              {editingPrices ? 'Annuler' : 'Modifier'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#4A6B55] mb-1">Prix Michelin (FCFA)</label>
              <input type="number" disabled={!editingPrices} value={prixMichelin} onChange={e => setPrixMichelin(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm disabled:bg-[#F8FAF8]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4A6B55] mb-1">Prix Long-March (FCFA)</label>
              <input type="number" disabled={!editingPrices} value={prixLongMarch} onChange={e => setPrixLongMarch(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm disabled:bg-[#F8FAF8]" />
            </div>
          </div>
          {editingPrices && (
            <button onClick={handleSavePrices} className="mt-3 px-4 py-2 bg-[#0B7439] text-white rounded-xl text-sm font-medium hover:bg-[#095e2e]">Enregistrer les prix</button>
          )}
        </div>
      )}

      {/* On-screen preview */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2EAE5] bg-[#F8FAF8]">
          <h3 className="font-bold text-[#1A2E22]">{reportTypes.find(r => r.key === reportType)?.label}</h3>
          <p className="text-xs text-[#6B7280] mt-1">
            Edité par : {user?.full_name ?? '—'} (Le {new Date().toLocaleString('fr-FR')}) Via : Logiciel GARAGE SBTA
          </p>
        </div>
        <div className="p-5">
          {Object.keys(grouped).length === 0 ? (
            <p className="text-center py-12 text-[#8AA898]">Aucune donnée pour cette période</p>
          ) : isTireReport ? (
            <div className="space-y-4">
              {Object.entries(grouped).map(([gname, items]) => {
                const groupItems = items as GaragePneu[]
                const groupQty = groupItems.reduce((s, i) => s + i.quantite, 0)
                const groupMontant = groupItems.reduce((s, i) => s + Number(i.montant), 0)
                return (
                  <div key={gname} className="border border-gray-300 rounded overflow-hidden">
                    <div className="bg-[#FFE8A6] border-b-2 border-black px-3 py-2 font-bold text-gray-900 uppercase">
                      GROUPE {gname}
                    </div>
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b-2 border-gray-700 bg-gray-50 text-gray-800">
                          <th className="px-2 py-1.5 text-center font-bold border-r border-gray-300" rowSpan={2}>DATES</th>
                          <th className="px-2 py-1 text-center font-bold border-r border-gray-300" colSpan={2}>DESIGNATIONS</th>
                          <th className="px-2 py-1.5 text-center font-bold border-r border-gray-300" rowSpan={2}>QTE</th>
                          <th className="px-2 py-1.5 text-center font-bold border-r border-gray-300" rowSpan={2}>P.UNITAIRE</th>
                          <th className="px-2 py-1.5 text-center font-bold" rowSpan={2}>MONTANTS</th>
                        </tr>
                        <tr className="border-b border-gray-300 bg-gray-50 text-gray-700 text-xs">
                          <th className="px-2 py-1 text-center font-semibold border-r border-gray-300">LIBELLES</th>
                          <th className="px-2 py-1 text-center font-semibold border-r border-gray-300">N° DE CARS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupItems.map(p => (
                          <tr key={p.id} className="border-b border-gray-200 text-gray-900">
                            <td className="px-2 py-1 text-center border-r border-gray-200">{formatDate(p.date)}</td>
                            <td className="px-2 py-1 border-r border-gray-200">{tireLabel}</td>
                            <td className="px-2 py-1 border-r border-gray-200">{p.car?.registration_number ?? '—'}</td>
                            <td className="px-2 py-1 text-center border-r border-gray-200">{p.quantite}</td>
                            <td className="px-2 py-1 text-right border-r border-gray-200">{formatFCFA(p.prix_unitaire)}</td>
                            <td className="px-2 py-1 text-right font-bold">{formatFCFA(p.montant)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#FFE2CC] border-t-2 border-gray-700 font-bold text-gray-900">
                          <td className="px-2 py-1.5 text-right border-r border-gray-300" colSpan={3}>TOTAL</td>
                          <td className="px-2 py-1.5 text-center border-r border-gray-300">{groupQty}</td>
                          <td className="px-2 py-1.5 border-r border-gray-300"></td>
                          <td className="px-2 py-1.5 text-right">{formatFCFA(groupMontant)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              })}
              {(() => {
                const allItems = Object.values(grouped).flat() as GaragePneu[]
                const totalQty = allItems.reduce((s, i) => s + i.quantite, 0)
                const totalMontant = allItems.reduce((s, i) => s + Number(i.montant), 0)
                return (
                  <div className="mt-4 border-t-2 border-gray-300 pt-4">
                    <div className="flex justify-between items-end">
                      <div className="space-y-1 text-sm text-gray-700">
                        <div className="px-3 py-1 bg-gray-100 rounded">ARRIVAGE ACTUEL = — pcs</div>
                        <div className="px-3 py-1 bg-[#FFE2CC] rounded font-semibold">PNEUS SORTIS = {totalQty} pcs</div>
                        <div className="px-3 py-1 bg-gray-100 rounded">STOCK ACTUEL = — pcs</div>
                      </div>
                      <div className="bg-yellow-400 border border-black px-4 py-2 text-right">
                        <div className="text-xs font-semibold text-gray-700 uppercase">Totaux</div>
                        <div className="text-lg font-bold text-gray-900">{formatFCFA(totalMontant)}</div>
                      </div>
                    </div>
                    <p className="text-center text-xs text-gray-500 mt-3">Fait à Abidjan, le {formatDate(new Date())}</p>
                  </div>
                )
              })()}
            </div>
          ) : Object.entries(grouped).map(([gname, items]) => (
            <div key={gname} className="mb-6">
              <div className="bg-[#B8B8B8] px-3 py-2 font-bold text-[#1A2E22]">GROUPE : {gname}</div>
              {groupItemsByCar(items as GarageReportItem[]).map(({ registration, items: carItems }) => (
                <div key={`${gname}-${registration}`} className="border-x border-[#9CA3AF]">
                  <div className="bg-[#D1D1D1] px-3 py-2 font-bold text-[#1A2E22]">CAR : {registration}</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-y border-[#9CA3AF] text-[#1A2E22]">
                          <th className="px-2 py-1 text-left font-medium w-10">#</th>
                          {reportType === 'pieces_groupe' && <th className="px-2 py-1 text-left font-medium">Pièces</th>}
                          {reportType === 'commandes_groupe' && <th className="px-2 py-1 text-left font-medium">Désignation/Type</th>}
                          {reportType === 'pieces_groupe' && <th className="px-2 py-1 text-right font-medium">Quantité</th>}
                          {reportType !== 'pieces_groupe' && <th className="px-2 py-1 text-right font-medium">Qté</th>}
                          <th className="px-2 py-1 text-right font-medium">Prix unitaire (FCFA)</th>
                          <th className="px-2 py-1 text-right font-medium">Total (FCFA)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {carItems.map((item, i) => (
                          <tr key={item.id} className="border-b border-[#E5E7EB] text-[#1A2E22]">
                            <td className="px-2 py-1">{i + 1}</td>
                            {reportType === 'pieces_groupe' && <td className="px-2 py-1">{(item as GarageSortiePiece).piece?.nom ?? '—'}{(item as GarageSortiePiece).piece?.marque ? ` ${(item as GarageSortiePiece).piece?.marque}` : ''}</td>}
                            {reportType === 'commandes_groupe' && <td className="px-2 py-1">{(item as GarageCommandePiece).designation}</td>}
                            <td className="px-2 py-1 text-right">{item.quantite}</td>
                            <td className="px-2 py-1 text-right">{formatFCFA(item.prix_unitaire)}</td>
                            <td className="px-2 py-1 text-right font-bold">{formatFCFA(item.montant)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <div className="text-right mt-2 font-bold text-[#0B7439]">
                TOTAL {gname} : {formatFCFA((items as GarageReportItem[]).reduce((sum, item) => sum + Number(item.montant), 0))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
