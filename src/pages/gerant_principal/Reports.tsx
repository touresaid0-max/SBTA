import { useEffect, useState, useMemo } from 'react'
import { FileText, Download, Printer } from 'lucide-react'
import jsPDF from 'jspdf'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import {
  fetchSorties, fetchPneus, fetchCommandes, fetchSettings, updateSetting, fetchCompaniesForGarage, fetchTireStock,
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

function formatPdfNumber(value: number | string | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(value ?? 0)).replace(/[\u00A0\u202F]/g, ' ')
}

function formatPdfAmount(value: number | string | null | undefined): string {
  return `${formatPdfNumber(value)} F CFA`
}

function drawPdfRight(doc: jsPDF, text: string, right: number, y: number): void {
  doc.text(text, right - doc.getTextWidth(text), y)
}

export default function GarageReports({ groupes: propGroupes, settings: propSettings, onReload, forcedGroupeId }: {
  groupes: GarageGroupe[]; settings: GarageSetting[]; onReload: () => void; forcedGroupeId?: string | null;
}) {
  const { user } = useAuthStore()
  const [reportType, setReportType] = useState<ReportType>('pieces_groupe')
  const [sorties, setSorties] = useState<GarageSortiePiece[]>([])
  const [pneus, setPneus] = useState<GaragePneu[]>([])
  const [tireStock, setTireStock] = useState<{ nom: string; stock_actuel: number }[]>([])
  const [commandes, setCommandes] = useState<GarageCommandePiece[]>([])
  const [companies, setCompanies] = useState<GarageCompany[]>([])
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    dateTo: new Date().toISOString().slice(0, 10),
    groupeId: forcedGroupeId ?? null,
  })
  const [loading, setLoading] = useState(true)
  const [prixMichelin, setPrixMichelin] = useState(325000)
  const [prixLongMarch, setPrixLongMarch] = useState(135000)
  const [editingPrices, setEditingPrices] = useState(false)

  useEffect(() => {
    Promise.all([fetchSorties(), fetchPneus(), fetchCommandes(), fetchCompaniesForGarage(), fetchTireStock()])
      .then(([s, p, c, comps, ts]) => { setSorties(s); setPneus(p); setCommandes(c); setCompanies(comps); setTireStock(ts) })
      .catch(() => toast.error('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  const societes = useMemo(() => {
    if (forcedGroupeId) {
      // Restrict to the forced company and its children
      const forced = companies.find(c => c.id === forcedGroupeId)
      if (forced && !forced.parent_id) {
        return [forced, ...companies.filter(c => c.parent_id === forcedGroupeId).sort((a, b) => a.name.localeCompare(b.name))]
      }
      return forced ? [forced] : []
    }
    return companies.filter(c => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name))
  }, [companies, forcedGroupeId])
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

    const isTirePiece = (s: GarageSortiePiece) => {
      const nom = s.piece?.nom?.toUpperCase() ?? ''
      return nom === 'PNEU MICHELIN' || nom === 'LONG-MARCH'
    }
    if (reportType === 'pieces_groupe') return sorties.filter(s => {
      if (!inRange(s.date) || !byGroupe(s.groupe_id)) return false
      return !isTirePiece(s)
    })
    if (reportType === 'pneus_michelin') return sorties.filter(s => inRange(s.date) && byGroupe(s.groupe_id) && s.piece?.nom?.toUpperCase() === 'PNEU MICHELIN')
    if (reportType === 'pneus_long_march') return sorties.filter(s => inRange(s.date) && byGroupe(s.groupe_id) && s.piece?.nom?.toUpperCase() === 'LONG-MARCH')
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

  const titles: Record<ReportType, string> = {
    pieces_groupe: 'Point financier des sorties de pièces de rechange par groupe',
    pneus_michelin: 'Fiche de point des pneus MICHELIN (GARAGE-SBTA)',
    pneus_long_march: 'Fiche de point des pneus LONG-MARCH (GARAGE-SBTA)',
    commandes_groupe: 'Point des nouvelles pièces de commande par groupe',
  }

  const handleSavePrices = async () => {
    try {
      await updateSetting('prix_michelin', prixMichelin)
      await updateSetting('prix_long_march', prixLongMarch)
      toast.success('Prix mis à jour')
      setEditingPrices(false)
      onReload()
    } catch (err: unknown) { toast.error((err as Error).message || 'Erreur') }
  }

  // ── PDF generation ──
  const generatePDF = () => {
    const doc = new jsPDF()
    const pw = doc.internal.pageSize.getWidth()
    const ph = doc.internal.pageSize.getHeight()
    const margin = 10
    const contentW = pw - 2 * margin

    let y = addReportHeader(doc, {
      title: titles[reportType],
      subtitle: filters.groupeId ? `Groupe : ${companies.find(c => c.id === filters.groupeId)?.name ?? propGroupes.find(g => g.id === filters.groupeId)?.nom ?? '—'}` : undefined,
      userName: user?.full_name ?? '—',
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    }, pw)

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
      const colCar = margin + contentW * 0.34
      const colQty = margin + contentW * 0.58
      const colPrix = margin + contentW * 0.72
      const colMontant = margin + contentW * 0.86
      const colRight = pw - margin
      let totalQty = 0
      let totalMontant = 0

      doc.setFillColor(255, 232, 158); doc.setDrawColor(20, 20, 20); doc.setLineWidth(0.6)
      doc.rect(margin, y - 5, contentW, 8, 'FD')
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
      doc.text(titles[reportType].toUpperCase(), pw / 2, y, { align: 'center' }); y += 8
      doc.setFontSize(9); doc.setFont('helvetica', 'normal')
      doc.text(`Période du ${formatDate(filters.dateFrom)} au ${formatDate(filters.dateTo)}`, pw / 2, y, { align: 'center' }); y += 7

      const drawTireHeader = () => {
        const headerTop = y - 6
        const headerHeight = 20
        const headerSplit = headerTop + 10
        doc.setFillColor(247, 248, 250); doc.setDrawColor(20, 20, 20); doc.setLineWidth(0.35)
        doc.rect(margin, headerTop, contentW, headerHeight, 'FD')
        doc.line(colLibelle, headerTop, colLibelle, headerTop + headerHeight)
        doc.line(colQty, headerTop, colQty, headerTop + headerHeight)
        doc.line(colPrix, headerTop, colPrix, headerTop + headerHeight)
        doc.line(colMontant, headerTop, colMontant, headerTop + headerHeight)
        doc.line(colRight, headerTop, colRight, headerTop + headerHeight)
        doc.line(colCar, headerSplit, colCar, headerTop + headerHeight)
        doc.line(colLibelle, headerSplit, colQty, headerSplit)
        doc.setFontSize(8); doc.setFont('helvetica', 'bold')
        doc.text('DATES', colDate + 2, headerTop + 12)
        doc.text('DESIGNATIONS', colLibelle + 2, headerTop + 7)
        doc.text('LIBELLES', colLibelle + 2, headerTop + 17)
        doc.text('N° DE CARS', colCar + 2, headerTop + 17)
        drawPdfRight(doc, 'QTE', colPrix - 2, headerTop + 12)
        drawPdfRight(doc, 'P.UNITAIRE', colMontant - 2, headerTop + 12)
        drawPdfRight(doc, 'MONTANTS', colRight - 2, headerTop + 12)
        y = headerTop + headerHeight + 7
      }

      for (const [gname, items] of Object.entries(grouped)) {
        const tireItems = items as GarageSortiePiece[]
        y = ensureSpace(doc, y, 28, ph, pw)
        doc.setFillColor(255, 232, 158); doc.setDrawColor(20, 20, 20)
        doc.rect(margin, y - 4, contentW, 7, 'FD')
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
        doc.text(`GROUPE ${gname.toUpperCase()}`, margin + 2, y + 1); y += 8
        drawTireHeader()
        let groupQty = 0; let groupMontant = 0
        doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
        tireItems.forEach(p => {
          const rowHeight = 11
          y = ensureSpace(doc, y, rowHeight + 3, ph, pw)
          const rowTop = y - 7
          doc.setDrawColor(40, 40, 40); doc.rect(margin, rowTop, contentW, rowHeight)
          doc.line(colLibelle, rowTop, colLibelle, rowTop + rowHeight)
          doc.line(colCar, rowTop, colCar, rowTop + rowHeight)
          doc.line(colQty, rowTop, colQty, rowTop + rowHeight)
          doc.line(colPrix, rowTop, colPrix, rowTop + rowHeight)
          doc.setFontSize(8)
          doc.text(formatDate(p.date), colDate + 2, rowTop + 7)
          doc.text(typeLabel, colLibelle + 2, rowTop + 7)
          doc.text(p.car?.registration_number ?? '—', colCar + 2, rowTop + 7)
          drawPdfRight(doc, formatPdfNumber(p.quantite), colPrix - 2, rowTop + 7)
          drawPdfRight(doc, formatPdfNumber(p.prix_unitaire), colMontant - 2, rowTop + 7)
          drawPdfRight(doc, formatPdfNumber(p.montant), colRight - 2, rowTop + 7)
          groupQty += p.quantite; groupMontant += Number(p.montant); y = rowTop + rowHeight + 3
        })
        y = ensureSpace(doc, y, 16, ph, pw)
        const totalTop = y - 7
        doc.setFillColor(255, 224, 205); doc.rect(margin, totalTop, contentW, 11, 'FD')
        doc.line(colLibelle, totalTop, colLibelle, totalTop + 11)
        doc.line(colCar, totalTop, colCar, totalTop + 11)
        doc.line(colQty, totalTop, colQty, totalTop + 11)
        doc.line(colPrix, totalTop, colPrix, totalTop + 11)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
        doc.text('TOTAL', margin + 2, totalTop + 7)
        drawPdfRight(doc, formatPdfNumber(groupQty), colPrix - 2, totalTop + 7)
        drawPdfRight(doc, formatPdfNumber(groupMontant), colRight - 2, totalTop + 7)
        totalQty += groupQty; totalMontant += groupMontant; y = totalTop + 15
      }

      y = ensureSpace(doc, y, 20, ph, pw)
      const totalsTop = y - 7
      doc.setFillColor(255, 244, 161); doc.rect(margin, totalsTop, contentW, 11, 'FD')
      doc.line(colLibelle, totalsTop, colLibelle, totalsTop + 11)
      doc.line(colCar, totalsTop, colCar, totalsTop + 11)
      doc.line(colQty, totalsTop, colQty, totalsTop + 11)
      doc.line(colPrix, totalsTop, colPrix, totalsTop + 11)
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(20, 20, 20)
      doc.text('TOTAUX', margin + 2, totalsTop + 7)
      drawPdfRight(doc, formatPdfNumber(totalQty), colPrix - 2, totalsTop + 7)
      drawPdfRight(doc, formatPdfNumber(totalMontant), colRight - 2, totalsTop + 7)
      y = totalsTop + 18
      doc.setFontSize(8); doc.setFont('helvetica', 'normal')
      const tireNom = reportType === 'pneus_michelin' ? 'PNEU MICHELIN' : 'LONG-MARCH'
      const searchKey = tireNom.includes('MICHELIN') ? 'MICHELIN' : 'LONG-MARCH'
      const stockRow = tireStock.find(ts => ts.nom?.toUpperCase().includes(searchKey))
      const arrivage = stockRow?.stock_actuel ?? 0
      const allSorties = sorties.filter(s => s.piece?.nom?.toUpperCase() === tireNom)
      const pneusSortis = allSorties.reduce((sum, s) => sum + s.quantite, 0)
      const stockActuel = arrivage - pneusSortis
      doc.text(`ARRIVAGE ACTUEL = ${formatPdfNumber(arrivage)} pcs`, margin, y); y += 5
      doc.text(`PNEUS SORTIS = ${formatPdfNumber(pneusSortis)} pcs`, margin, y); y += 5
      doc.text(`STOCK ACTUEL = ${formatPdfNumber(stockActuel)} pcs`, margin, y)
      doc.text(`Fait à Abidjan le ${formatDate(new Date())}`, pw - margin, y, { align: 'right' })
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
          {!forcedGroupeId && (
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
          )}
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
          ) : (reportType === 'pneus_michelin' || reportType === 'pneus_long_march') ? (
            <TireReportPreview reportType={reportType} grouped={grouped} filters={filters} titles={titles} tireStock={tireStock} allSorties={sorties} />
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

// ── Tire report preview (Michelin / Long-March) ──────────────
function TireReportPreview({ reportType, grouped, filters, titles, tireStock, allSorties }: {
  reportType: 'pneus_michelin' | 'pneus_long_march'
  grouped: Record<string, GarageSortiePiece[] | GaragePneu[] | GarageCommandePiece[]>
  filters: ReportFilters
  titles: Record<ReportType, string>
  tireStock: { nom: string; stock_actuel: number }[]
  allSorties: GarageSortiePiece[]
}) {
  const typeLabel = reportType === 'pneus_michelin' ? 'PNEU MICHELIN' : 'LONG-MARCH'
  const fmtNum = (n: number | string | null | undefined) =>
    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n ?? 0))

  let grandQty = 0
  let grandMontant = 0

  return (
    <div className="space-y-4">
      {/* Titre encadré jaune */}
      <div className="bg-[#FFE89E] border-2 border-black text-center py-2 rounded">
        <h2 className="text-base font-bold uppercase text-black tracking-wide">{titles[reportType]}</h2>
        <p className="text-xs text-black/80 mt-0.5">
          Période du {formatDate(filters.dateFrom)} au {formatDate(filters.dateTo)}
        </p>
      </div>

      {Object.entries(grouped).map(([gname, items]) => {
        const tireItems = items as GarageSortiePiece[]
        const groupQty = tireItems.reduce((s, p) => s + p.quantite, 0)
        const groupMontant = tireItems.reduce((s, p) => s + Number(p.montant), 0)
        grandQty += groupQty
        grandMontant += groupMontant
        return (
          <div key={gname} className="border border-black overflow-x-auto">
            {/* Bannière groupe jaune */}
            <div className="bg-[#FFE89E] px-3 py-1.5 font-bold uppercase text-black text-sm border-b border-black">
              GROUPE {gname.toUpperCase()}
            </div>
            <table className="garage-tire-report-table w-full text-sm border-collapse" style={{ lineHeight: 1.3 }}>
              <thead>
                <tr className="bg-[#F7F8FA] text-black border-b border-black">
                  <th rowSpan={2} className="px-2 py-2 text-center font-bold border border-black align-middle" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>DATES</th>
                  <th colSpan={2} className="px-2 py-2 text-center font-bold border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>DESIGNATIONS</th>
                  <th rowSpan={2} className="px-2 py-2 text-center font-bold border border-black align-middle" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>QTE</th>
                  <th rowSpan={2} className="px-2 py-2 text-center font-bold border border-black align-middle" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>P.UNITAIRE</th>
                  <th rowSpan={2} className="px-2 py-2 text-center font-bold border border-black align-middle" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>MONTANTS</th>
                </tr>
                <tr className="bg-[#F7F8FA] text-black border-b border-black">
                  <th className="px-2 py-2 text-center font-bold border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>LIBELLES</th>
                  <th className="px-2 py-2 text-center font-bold border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>N° DE CARS</th>
                </tr>
              </thead>
              <tbody>
                {tireItems.map((p, i) => (
                  <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFC]'} style={{ height: 'auto' }}>
                    <td className="px-2 py-2 text-center border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>{formatDate(p.date)}</td>
                    <td className="px-2 py-2 border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>{typeLabel}</td>
                    <td className="px-2 py-2 font-mono border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>{p.car?.registration_number ?? '—'}</td>
                    <td className="px-2 py-2 text-right border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>{fmtNum(p.quantite)}</td>
                    <td className="px-2 py-2 text-right border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>{fmtNum(p.prix_unitaire)}</td>
                    <td className="px-2 py-2 text-right font-semibold border border-black" style={{ minHeight: '28px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>{fmtNum(p.montant)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#FFE0CD] font-bold" style={{ marginTop: '4px' }}>
                  <td colSpan={3} className="px-2 py-2.5 text-right border border-black" style={{ minHeight: '32px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>TOTAL</td>
                  <td className="px-2 py-2.5 text-right border border-black" style={{ minHeight: '32px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>{fmtNum(groupQty)}</td>
                  <td className="px-2 py-2.5 border border-black" style={{ minHeight: '32px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}></td>
                  <td className="px-2 py-2.5 text-right border border-black" style={{ minHeight: '32px', verticalAlign: 'middle', lineHeight: 1.3, padding: '8px 6px' }}>{fmtNum(groupMontant)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      })}

      {/* Bilan / Stock */}
      <div className="border-2 border-black">
        <div className="bg-[#FFF4A1] px-3 py-1.5 font-bold uppercase text-black text-sm border-b border-black text-center">
          BILAN DES PNEUS
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-black">
          {(() => {
            const searchKey = typeLabel.includes('MICHELIN') ? 'MICHELIN' : 'LONG-MARCH'
            const stockRow = tireStock.find(ts => ts.nom?.toUpperCase().includes(searchKey))
            const arrivage = stockRow?.stock_actuel ?? 0
            const totalSortis = allSorties.filter(s => s.piece?.nom?.toUpperCase() === typeLabel).reduce((sum, s) => sum + s.quantite, 0)
            const stockActuel = arrivage - totalSortis
            return (
              <>
                <div className="px-3 py-2 text-sm text-black">
                  ARRIVAGE ACTUEL = <span className="font-bold">{fmtNum(arrivage)}</span> pcs
                </div>
                <div className="px-3 py-2 text-sm text-black">
                  PNEUS SORTIS = <span className="font-bold">{fmtNum(totalSortis)}</span> pcs
                </div>
                <div className="px-3 py-2 text-sm text-black">
                  STOCK ACTUEL = <span className="font-bold">{fmtNum(stockActuel)}</span> pcs
                </div>
              </>
            )
          })()}
        </div>
        <div className="border-t border-black px-3 py-2 flex items-center justify-between">
          <span className="font-bold text-black text-sm">TOTAUX {fmtNum(grandMontant)}</span>
          <span className="text-xs text-black/80">Fait à Abidjan le {formatDate(new Date())}</span>
        </div>
      </div>
    </div>
  )
}
