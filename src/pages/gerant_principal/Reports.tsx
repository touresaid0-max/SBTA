import { useEffect, useState, useMemo } from 'react'
import { FileText, Download, Printer, CircleDot } from 'lucide-react'
import jsPDF from 'jspdf'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import {
  fetchSorties, fetchPneus, fetchCommandes, fetchGroupes, fetchSettings, updateSetting, fetchStock, fetchCompaniesForGarage,
} from '@/services/garageSbta.service'
import type { GarageSortiePiece, GaragePneu, GarageCommandePiece, GarageGroupe, GarageSetting, GarageCompany } from '@/types/garage.types'
import { addReportHeader, addReportFooter, ensureSpace, formatDate, formatFCFA, formatFCFAShort, type ReportFilters } from '@/components/garage/reportHelpers'

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

  // ── PDF generation ──
  const generatePDF = () => {
    const doc = new jsPDF()
    const pw = doc.internal.pageSize.getWidth()
    const ph = doc.internal.pageSize.getHeight()
    const margin = 14

    const titles: Record<ReportType, string> = {
      pieces_groupe: 'Point financier des sorties de pièces de rechange par groupe',
      pneus_michelin: 'Fiche de point des pneus MICHELIN (GARAGE-SBTA)',
      pneus_long_march: 'Fiche de point des pneus LONG-MARCH (GARAGE-SBTA)',
      commandes_groupe: 'Point des nouvelles pièces de commande par groupe',
    }

    let y = addReportHeader(doc, {
      title: titles[reportType],
      subtitle: filters.groupeId ? `Groupe : ${companies.find(c => c.id === filters.groupeId)?.name ?? propGroupes.find(g => g.id === filters.groupeId)?.nom ?? '—'}` : undefined,
      userName: user?.full_name ?? '—',
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    }, pw)

    if (reportType === 'pieces_groupe') {
      let grandTotal = 0
      for (const [gname, items] of Object.entries(grouped)) {
        y = ensureSpace(doc, y, 30, ph, pw)
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
        doc.text(`GROUPE : ${gname}`, margin, y); y += 6

        const cols = [margin, margin + 10, margin + 80, margin + 105, margin + 130, margin + 160]
        let groupTotal = 0
        for (const { registration, items: carItems } of groupItemsByCar(items as GarageSortiePiece[])) {
          y = ensureSpace(doc, y, 18, ph, pw)
          doc.setFillColor(190, 190, 190); doc.rect(margin, y - 4, pw - 2 * margin, 6, 'F')
          doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
          doc.text(`CAR : ${registration}`, margin + 2, y); y += 5
          doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(74, 107, 85)
          doc.text('#', cols[0], y); doc.text('Pièces', cols[1], y); doc.text('Qté', cols[3], y, { align: 'right' })
          doc.text('Prix unit.', cols[4], y, { align: 'right' }); doc.text('Total', cols[5], y, { align: 'right' })
          y += 3; doc.line(margin, y, pw - margin, y); y += 4
          doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40)
          carItems.forEach((s, i) => {
            y = ensureSpace(doc, y, 6, ph, pw)
            doc.text(String(i + 1), cols[0], y)
            doc.text(`${s.piece?.nom ?? '—'}${s.piece?.marque ? ` ${s.piece.marque}` : ''}`, cols[1], y, { max_width: 65 })
            doc.text(String(s.quantite), cols[3], y, { align: 'right' })
            doc.text(formatFCFAShort(s.prix_unitaire), cols[4], y, { align: 'right' })
            doc.text(formatFCFAShort(s.montant), cols[5], y, { align: 'right' })
            groupTotal += Number(s.montant); y += 5
          })
        }
        y = ensureSpace(doc, y, 10, ph, pw)
        doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 116, 57)
        doc.text(`TOTAL DU GROUPE : ${gname} — ${formatFCFA(groupTotal)}`, pw - margin, y, { align: 'right' })
        grandTotal += groupTotal; y += 8
      }
      y = ensureSpace(doc, y, 10, ph, pw)
      doc.setFillColor(11, 116, 57); doc.rect(margin, y - 4, pw - 2 * margin, 8, 'F')
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
      doc.text(`TOTAL GÉNÉRAL : ${formatFCFA(grandTotal)}`, pw - margin, y, { align: 'right' })
    }

    if (reportType === 'pneus_michelin' || reportType === 'pneus_long_march') {
      const typeLabel = reportType === 'pneus_michelin' ? 'PNEU MICHELIN' : 'PNEU LONG-MARCH'
      let totalQty = 0; let totalMontant = 0

      for (const [gname, items] of Object.entries(grouped)) {
        y = ensureSpace(doc, y, 30, ph, pw)
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
        doc.text(`GROUPE : ${gname}`, margin, y); y += 6

        let subQty = 0; let subMontant = 0
        for (const { registration, items: carItems } of groupItemsByCar(items as GaragePneu[])) {
          y = ensureSpace(doc, y, 18, ph, pw)
          doc.setFillColor(190, 190, 190); doc.rect(margin, y - 4, pw - 2 * margin, 6, 'F')
          doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
          doc.text(`CAR : ${registration}`, margin + 2, y); y += 5
          doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(74, 107, 85)
          doc.text('Date', margin, y); doc.text('Désignation', margin + 30, y)
          doc.text('Qté', margin + 130, y, { align: 'right' }); doc.text('Prix unit.', margin + 155, y, { align: 'right' }); doc.text('Montant', pw - margin, y, { align: 'right' })
          y += 3; doc.line(margin, y, pw - margin, y); y += 4
          doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40)
          carItems.forEach(p => {
            y = ensureSpace(doc, y, 6, ph, pw)
            doc.text(formatDate(p.date), margin, y)
            doc.text(typeLabel, margin + 30, y, { max_width: 90 })
            doc.text(String(p.quantite), margin + 130, y, { align: 'right' })
            doc.text(formatFCFAShort(p.prix_unitaire), margin + 155, y, { align: 'right' })
            doc.text(formatFCFAShort(p.montant), pw - margin, y, { align: 'right' })
            subQty += p.quantite; subMontant += Number(p.montant); y += 5
          })
        }
        y = ensureSpace(doc, y, 10, ph, pw)
        doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 116, 57)
        doc.text(`Sous-total quantité : ${subQty}`, margin + 130, y, { align: 'right' })
        doc.text(`TOTAL ${gname} : ${formatFCFA(subMontant)}`, pw - margin, y, { align: 'right' })
        totalQty += subQty; totalMontant += subMontant; y += 8
      }

      // Récap
      y = ensureSpace(doc, y, 30, ph, pw)
      y += 4; doc.line(margin, y, pw - margin, y); y += 6
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
      doc.text('RÉCAPITULATIF', margin, y); y += 6
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      doc.text(`Pneus sortis (total) : ${totalQty} pièces`, margin, y); y += 5
      doc.text(`Montant total : ${formatFCFA(totalMontant)}`, margin, y); y += 5
      const stockPneu = reportType === 'pneus_michelin' ? 'Voir gestion stock' : 'Voir gestion stock'
      doc.text(`Stock actuel : ${stockPneu}`, margin, y)
    }

    if (reportType === 'commandes_groupe') {
      let grandQty = 0; let grandMontant = 0
      for (const [gname, items] of Object.entries(grouped)) {
        y = ensureSpace(doc, y, 30, ph, pw)
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
        doc.text(`GROUPE : ${gname}`, margin, y); y += 6

        let gQty = 0; let gMontant = 0
        for (const { registration, items: carItems } of groupItemsByCar(items as GarageCommandePiece[])) {
          y = ensureSpace(doc, y, 18, ph, pw)
          doc.setFillColor(190, 190, 190); doc.rect(margin, y - 4, pw - 2 * margin, 6, 'F')
          doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 34)
          doc.text(`CAR : ${registration}`, margin + 2, y); y += 5
          doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(74, 107, 85)
          doc.text('Date', margin, y); doc.text('Désignation/Type', margin + 30, y)
          doc.text('Qté', margin + 130, y, { align: 'right' }); doc.text('Prix unit.', margin + 155, y, { align: 'right' }); doc.text('Montant', pw - margin, y, { align: 'right' })
          y += 3; doc.line(margin, y, pw - margin, y); y += 4
          doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40)
          carItems.forEach(c => {
            y = ensureSpace(doc, y, 6, ph, pw)
            doc.text(formatDate(c.date), margin, y)
            doc.text(c.designation, margin + 30, y, { max_width: 60 })
            doc.text(String(c.quantite), margin + 130, y, { align: 'right' })
            doc.text(formatFCFAShort(c.prix_unitaire), margin + 155, y, { align: 'right' })
            doc.text(formatFCFAShort(c.montant), pw - margin, y, { align: 'right' })
            gQty += c.quantite; gMontant += Number(c.montant); y += 5
          })
        }
        y = ensureSpace(doc, y, 10, ph, pw)
        doc.setFont('helvetica', 'bold'); doc.setTextColor(11, 116, 57)
        doc.text(`TOTAL ${gname} : ${gQty} pièces — ${formatFCFA(gMontant)}`, pw - margin, y, { align: 'right' })
        grandQty += gQty; grandMontant += gMontant; y += 8
      }
      y = ensureSpace(doc, y, 10, ph, pw)
      doc.setFillColor(11, 116, 57); doc.rect(margin, y - 4, pw - 2 * margin, 8, 'F')
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
      doc.text(`TOTAL GÉNÉRAL : ${grandQty} pièces — ${formatFCFA(grandMontant)}`, pw - margin, y, { align: 'right' })
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
                          {reportType === 'pneus_michelin' || reportType === 'pneus_long_march' ? <th className="px-2 py-1 text-left font-medium">Désignation</th> : null}
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
                            {reportType === 'pneus_michelin' || reportType === 'pneus_long_march' ? <td className="px-2 py-1">{reportType === 'pneus_michelin' ? 'PNEU MICHELIN' : 'PNEU LONG-MARCH'}</td> : null}
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
