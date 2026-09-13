import jsPDF from 'jspdf'
import type { BordereauDepartData, BordereauRecettesData, BordereauRamassageData, BordereauDestinationGroup } from '@/types/counter.types'
import type { Parcel } from '@/types/parcel.types'

export interface BordereauCourrierData {
  station_name:     string
  station_phone:    string
  destination:      string
  date:             string
  bus_registration: string
  driver_name:      string
  parcels:          Pick<Parcel, 'parcel_code' | 'nature' | 'content_description'>[]
  print_date:       string
  print_time:       string
}

// Formateur sûr pour jsPDF : séparateur espace normale (toLocaleString produit
// des espaces fines unicode \u202f que jsPDF interprète comme coupure de mot)
const fmtNum = (n: number): string =>
  Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

const fmt = (n: number): string => fmtNum(n) + ' F'

// ── Logo SBTA : cercle vert avec texte blanc (inline, pas de fetch réseau) ───
function drawLogoSbta(doc: jsPDF, cx: number, cy: number, r: number) {
  doc.setFillColor(11, 116, 57)
  doc.circle(cx, cy, r, 'F')
  doc.setFillColor(212, 175, 55)   // or
  doc.circle(cx, cy, r, 'D')      // anneau doré
  doc.setDrawColor(212, 175, 55)
  doc.setLineWidth(0.6)
  doc.circle(cx, cy, r, 'D')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(r * 1.8)
  const label = 'SBTA'
  const lw = doc.getTextWidth(label)
  doc.text(label, cx - lw / 2, cy + r * 0.4)
  doc.setTextColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)
}

// ═══════════════════════════════════════════════════════════════════
//  BORDEREAU DE DÉPART  (80 mm × hauteur variable)
// ═══════════════════════════════════════════════════════════════════
export function printBorderauDepart(data: BordereauDepartData) {
  const W = 80

  // Rendu du contenu sur un document donné ; renvoie le y final (hauteur utile).
  // Utilisé en 2 passes : mesure (hauteur) puis rendu réel sur page ajustée.
  const render = (doc: jsPDF): number => {
    let y = 4

    const centerText = (text: string, fontSize: number, bold = false) => {
      doc.setFontSize(fontSize)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      const w = doc.getTextWidth(text)
      doc.text(text, (W - w) / 2, y)
      y += fontSize * 0.42 + 0.6
    }

    const labelValue = (label: string, value: string, fs = 7, bold = false) => {
      doc.setFontSize(fs)
      doc.setFont('helvetica', 'bold')
      doc.text(label, 3, y)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.text(value, W - 3, y, { align: 'right' })
      y += fs * 0.42 + 1.35
    }

    // Trait horizontal compact — léger espace avant/après pour ne pas coller le texte
    const line = (thick = false) => {
      y += 1.9
      doc.setLineWidth(thick ? 0.5 : 0.2)
      doc.setDrawColor(0, 0, 0)
      doc.line(3, y, W - 3, y)
      y += 2.8
    }

    // ── EN-TÊTE ────────────────────────────────────────────────────
    centerText('S.B.T.A', 10, true)
    centerText('Soc. Bonkoungou Transport de l\'Agneby', 5.5)
    centerText('BORDEREAU DE DEPART', 8, true)
    line(true)

    // ── GUICHET & TRAJET ───────────────────────────────────────────
    labelValue('GUICHET :', data.station_name)
    labelValue('DEP N° :', String(data.departure_number), 8)
    labelValue('LIGNE :', data.route_name)
    labelValue('DATE :', data.departure_date)
    labelValue('HEURE :', data.departure_time)
    line()

    // ── BUS & CHAUFFEUR ────────────────────────────────────────────
    labelValue('CAR :', data.registration_number)
    labelValue('CHAUFFEUR :', data.driver_name)
    line()

    // ── CONVOI ──────────────────────────────────────────────────
    if (data.is_convoy) {
      doc.setFillColor(255, 247, 237)
      doc.rect(3, y - 3, W - 6, 6.5, 'F')
      doc.setDrawColor(251, 146, 60)
      doc.setLineWidth(0.4)
      doc.rect(3, y - 3, W - 6, 6.5, 'D')
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.2)
      centerText('** DEPART EN CONVOI **', 8, true)
      y += 1.5
    }

    // ── CAPACITÉ ──────────────────────────────────────────────────
    labelValue('NBRE PLACE', fmtNum(data.total_seats))
    labelValue('VENDU(S)', fmtNum(data.seats_sold))
    labelValue('RESTANT(S)', fmtNum(data.seats_remaining))
    line()

    if (data.is_convoy) {
      // Convoy: simplified financial section
      labelValue('MONTANT CONVOI :', fmt(data.convoy_amount), 8, true)
      if (data.total_rations > 0)     labelValue('RATIONS :', fmt(data.total_rations))
      if (data.total_carburant > 0)   labelValue('CARBURANT COMPL. :', fmt(data.total_carburant))
      if (data.total_peages > 0)      labelValue('PEAGES :', fmt(data.total_peages))
      if (data.total_autres > 0)      labelValue('AUTRES :', fmt(data.total_autres))
      labelValue('MT TOTAL DEPENSES(R/P.) :', fmt(data.total_charges), 7)
      labelValue('SOLDE CONVOI :', fmt(data.convoy_amount - data.total_charges), 7, true)
      labelValue('MT TOTAL BAGAGE :', fmt(data.total_baggage), 7)
    } else {
      // Normal: full sales table
      // ── TABLEAU VENTES ─────────────────────────────────────────────
      const C = { dest: 3, sieges: 31, tarifR: 52, montantR: W - 3 }
      doc.setFontSize(6.5)
      doc.setFont('helvetica', 'bold')
      doc.text('DESTINATION', C.dest,    y)
      doc.text('SIEG.',       C.sieges,  y)
      doc.text('TARIF',       C.tarifR,  y, { align: 'right' })
      doc.text('MONTANT',     C.montantR, y, { align: 'right' })
      y += 1.5
      line()

      // Display by destination groups if available
      const groups: BordereauDestinationGroup[] = data.destination_groups && data.destination_groups.length > 0
        ? data.destination_groups
        : [{ destination: data.destination, seats_sold: data.seats_sold, unit_price: data.unit_price, amount: data.total_ticket_amount, seat_numbers: data.sold_seat_numbers }]

      for (const group of groups) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        const destLabel = group.destination.length > 14 ? group.destination.slice(0, 13) + '.' : group.destination
        doc.text(destLabel,                          C.dest,     y)
        doc.text(fmtNum(group.seats_sold),           C.sieges,   y)
        doc.text(fmt(group.unit_price),              C.tarifR,   y, { align: 'right' })
        doc.text(fmt(group.amount),                  C.montantR, y, { align: 'right' })
        y += 3.5

        // Seats for this destination
        if (group.seat_numbers.length > 0) {
          doc.setFontSize(5.5)
          doc.setFont('helvetica', 'italic')
          const perRow = 14
          for (let i = 0; i < group.seat_numbers.length; i += perRow) {
            const chunk = group.seat_numbers.slice(i, i + perRow).join('-')
            doc.text('  ' + chunk, 3, y)
            y += 2.8
          }
        }
        y += 1.2
      }
      line()

      // ── RÉCAPITULATIF FINANCIER ────────────────────────────────────
      labelValue('MT TOTAL TICKET :', fmt(data.total_ticket_amount), 7)
      if (data.total_rations > 0)     labelValue('RATIONS :', fmt(data.total_rations))
      if (data.total_carburant > 0)   labelValue('CARBURANT COMPL. :', fmt(data.total_carburant))
      if (data.total_peages > 0)      labelValue('PEAGES :', fmt(data.total_peages))
      if (data.total_autres > 0)      labelValue('AUTRES :', fmt(data.total_autres))
      labelValue('MT TOTAL DEPENSES(R/P.) :', fmt(data.total_charges), 7)
      labelValue('SOLDE TICKETS :', fmt(data.solde_ticket), 7, true)
      labelValue('MT TOTAL BAGAGE :', fmt(data.total_baggage), 7)
    }

    y += 2.8
    // double ligne
    doc.setLineWidth(0.5)
    doc.line(3, y, W - 3, y)
    y += 1.2
    doc.line(3, y, W - 3, y)
    y += 3.6

    // ── PIED ───────────────────────────────────────────────────────
    doc.setFontSize(5.5)
    doc.setFont('helvetica', 'normal')
    doc.text(`Imprimé le : ${data.print_date} à ${data.print_time}`, 3, y)

    return y
  }

  // Passe 1 : mesure de la hauteur réelle du contenu
  const measure = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, 400] })
  const finalY  = render(measure)

  // Passe 2 : rendu sur une page ajustée au contenu (+ marge basse)
  const H   = Math.ceil(finalY + 4)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, H] })
  render(doc)

  const filename = `bordereau_depart_N${data.departure_number}_${data.departure_date.replace(/\//g, '-')}.pdf`
  doc.save(filename)
}

// ═══════════════════════════════════════════════════════════════════
//  BORDEREAU DES RECETTES  (A4 portrait)
// ═══════════════════════════════════════════════════════════════════
export function printBorderauRecettes(data: BordereauRecettesData) {
  const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W      = 210
  const margin = 14
  let y        = 18

  const ctr = (text: string) => (W - doc.getTextWidth(text)) / 2

  // ── EN-TÊTE ────────────────────────────────────────────────────
  drawLogoSbta(doc, margin + 9, y, 9)

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('S.B.T.A', ctr('S.B.T.A'), y - 3)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Soc. Bonkoungou Transport de l\'Agneby', ctr('Soc. Bonkoungou Transport de l\'Agneby'), y + 3)

  doc.setFontSize(8)
  doc.text('Tél : 07 69 94 88 03 / 07 99 68 60 03', W - margin - 55, y - 3)

  y += 10
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('BORDEREAU DETAILLE DES RECETTES', ctr('BORDEREAU DETAILLE DES RECETTES'), y)
  y += 10

  doc.setDrawColor(11, 116, 57)
  doc.setLineWidth(0.8)
  doc.line(margin, y, W - margin, y)
  doc.setLineWidth(0.2)
  doc.setDrawColor(0, 0, 0)
  y += 6

  // ── INFOS ENTÊTE ───────────────────────────────────────────────
  const infoRow = (label: string, value: string) => {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(label, margin, y)
    doc.text(':', margin + 24, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, margin + 27, y)
    y += 6
  }

  infoRow('GUICHET', data.station_name)
  infoRow('CODE GUICHET', data.station_code || '—')
  infoRow('LIGNE', data.route_name)
  infoRow('DATE', data.date_from === data.date_to ? data.date_from : `${data.date_from} au ${data.date_to}`)
  y += 3

  // ── TABLEAU ────────────────────────────────────────────────────
  const col = {
    ligne:  margin + 2,
    date:   margin + 42,
    mat:    margin + 66,
    num:    margin + 92,
    sieg:   margin + 108,
    ticket: margin + 130,
    dep:    margin + 154,
    solde:  margin + 176,
    bag:    margin + 198,
  }
  const ROW_H = 8

  // En-tête tableau — fond vert
  doc.setFillColor(11, 116, 57)
  doc.rect(margin, y, W - 2 * margin, ROW_H + 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  const hY = y + ROW_H - 1
  doc.text('LIGNE',      col.ligne,   hY)
  doc.text('DATE',       col.date,    hY)
  doc.text('MATRICULE',  col.mat,     hY)
  doc.text('N°',         col.num,     hY, { align: 'center' })
  doc.text('SIEGES',     col.sieg,    hY, { align: 'center' })
  doc.text('MT TICKET',  col.ticket,  hY, { align: 'center' })
  doc.text('DEPENSES',   col.dep,     hY, { align: 'center' })
  doc.text('SOLDE',      col.solde,   hY, { align: 'center' })
  doc.text('BAGAGE',     col.bag,     hY, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  y += ROW_H + 7

  // Lignes de données avec détail dépenses
  data.rows.forEach((row, idx) => {
    // Check if we need a new page
    const rowHeight = row.total_charges > 0 ? ROW_H + 20 : ROW_H
    if (y + rowHeight > 270) {
      doc.addPage()
      y = 18
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 248)
      doc.rect(margin, y - 5, W - 2 * margin, ROW_H, 'F')
    }
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(String(row.route_name || '').slice(0, 20),           col.ligne,   y)
    doc.text(row.departure_date,                                   col.date,    y)
    doc.text(row.registration_number,                             col.mat,     y)
    doc.text(String(row.departure_number),                        col.num,     y, { align: 'center' })
    doc.text(fmtNum(row.seats_sold),                              col.sieg,    y, { align: 'center' })
    doc.text(fmt(row.total_ticket),                               col.ticket,  y, { align: 'center' })
    doc.text(fmt(row.total_charges),                              col.dep,     y, { align: 'center' })
    doc.text(fmt(row.solde_ticket),                               col.solde,   y, { align: 'center' })
    doc.text(fmt(row.total_baggage),                              col.bag,     y, { align: 'center' })

    // Détail dépenses sous la ligne principale
    if (row.total_charges > 0) {
      y += ROW_H - 1
      doc.setFontSize(6.5)
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(80, 80, 80)
      const depX = col.dep - 22
      if (row.total_carburant > 0) {
        doc.text(`Carburant : ${fmt(row.total_carburant)}`, depX, y)
        y += 4
      }
      if (row.total_rations > 0) {
        doc.text(`Complément : ${fmt(row.total_rations)}`, depX, y)
        y += 4
      }
      if (row.total_peages > 0) {
        doc.text(`Péage : ${fmt(row.total_peages)}`, depX, y)
        y += 4
      }
      if (row.total_autres > 0) {
        doc.text(`Autres : ${fmt(row.total_autres)}`, depX, y)
        y += 4
      }
      doc.setTextColor(0, 0, 0)
      y -= (ROW_H - 1)
    }

    // séparateur léger
    doc.setDrawColor(226, 234, 229)
    doc.setLineWidth(0.1)
    const sepY = row.total_charges > 0
      ? y + ROW_H + Math.min(4, [row.total_rations, row.total_carburant, row.total_peages, row.total_autres].filter(v => v > 0).length) * 4
      : y + 2
    doc.line(margin, sepY, W - margin, sepY)
    doc.setDrawColor(0, 0, 0)

    if (row.total_charges > 0) {
      const detailLines = [row.total_rations, row.total_carburant, row.total_peages, row.total_autres].filter(v => v > 0).length
      y += ROW_H + detailLines * 4 + 2
    } else {
      y += ROW_H
    }
  })

  // Check page space for totals + recap
  if (y + 90 > 285) {
    doc.addPage()
    y = 18
  }

  // Ligne TOTAUX
  doc.setFillColor(11, 116, 57)
  doc.rect(margin, y - 5, W - 2 * margin, ROW_H + 1, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('TOTAUX',                              col.ligne,   y)
  doc.text(String(data.totals.departures),        col.num,     y, { align: 'center' })
  doc.text(fmtNum(data.totals.seats_sold),        col.sieg,    y, { align: 'center' })
  doc.text(fmt(data.totals.total_ticket),         col.ticket,  y, { align: 'center' })
  doc.text(fmt(data.totals.total_charges),        col.dep,     y, { align: 'center' })
  doc.text(fmt(data.totals.solde_ticket),         col.solde,   y, { align: 'center' })
  doc.text(fmt(data.totals.total_baggage),        col.bag,     y, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  y += ROW_H + 8

  // ── RÉCAPITULATIF ENCADRÉ ──────────────────────────────────────
  const recapStartY = y - 4
  const RECAP_H = 80
  doc.setDrawColor(11, 116, 57)
  doc.setLineWidth(0.6)
  doc.rect(margin, recapStartY, W - 2 * margin, RECAP_H, 'D')
  doc.setLineWidth(0.2)
  doc.setDrawColor(0, 0, 0)

  y += 4
  const recapRow = (label: string, value: string, bold = false) => {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(label, margin + 4, y)
    doc.text(':', margin + 68, y)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(value, margin + 72, y)
    y += 7
  }

  recapRow('TOTAL MONTANT TICKETS',        fmt(data.totals.total_ticket))
  y += 1
  // Détail dépenses dans le récapitulatif
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)
  doc.text('TOTAL RATIO CARBURANT', margin + 6, y)
  doc.text(':  ' + fmt(data.totals.total_rations), margin + 68, y)
  y += 5.5
  doc.text('TOTAL COMPLEMENT', margin + 6, y)
  doc.text(':  ' + fmt(data.totals.total_carburant), margin + 68, y)
  y += 5.5
  doc.text('TOTAL PEAGE', margin + 6, y)
  doc.text(':  ' + fmt(data.totals.total_peages), margin + 68, y)
  y += 5.5
  doc.text('TOTAL AUTRES DEPENSES', margin + 6, y)
  doc.text(':  ' + fmt(data.totals.total_autres), margin + 68, y)
  y += 3
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.3)
  doc.line(margin + 4, y, margin + 110, y)
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.2)
  y += 4
  doc.setTextColor(0, 0, 0)
  recapRow('TOTAL DEPENSES',               fmt(data.totals.total_charges), true)
  recapRow('SOLDE TICKET',                 fmt(data.totals.solde_ticket), true)
  recapRow('TOTAL BAGAGE',                 fmt(data.totals.total_baggage))
  recapRow('NOMBRE TOTAL DE VEHICULES',    String(data.totals.departures))
  recapRow('NOMBRE TOTAL DE SIEGES',       fmtNum(data.totals.seats_sold))

  // Position below the recap box with margin
  y = recapStartY + RECAP_H + 8
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`Date d'impression : ${data.print_date}  ${data.print_time}`, margin, y)

  const filename = `bordereau_recettes_${data.station_name.replace(/ /g, '_')}_${data.date_from.replace(/\//g, '-')}.pdf`
  doc.save(filename)
}

// ═══════════════════════════════════════════════════════════════════
//  BORDEREAU COURRIER COLIS  (80 mm × hauteur variable)
//  Impression thermique — mise en page fidèle modèle SBTA
// ═══════════════════════════════════════════════════════════════════
export async function printBordereauCourrier(data: BordereauCourrierData) {
  const { printBordereauCourrierThermal } = await import('@/services/pos/printService')
  return printBordereauCourrierThermal(data)
}

// ═══════════════════════════════════════════════════════════════════
//  BORDEREAU DE RAMASSAGE  (80 mm × hauteur variable)
// ═══════════════════════════════════════════════════════════════════
export function printBordereauRamassage(data: BordereauRamassageData) {
  const W   = 80
  const H   = 220
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, H] })
  let y = 5

  const centerText = (text: string, fontSize: number, bold = false) => {
    doc.setFontSize(fontSize)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    const w = doc.getTextWidth(text)
    doc.text(text, (W - w) / 2, y)
    y += fontSize * 0.42 + 1
  }

  const labelValue = (label: string, value: string, fs = 7, bold = false) => {
    doc.setFontSize(fs)
    doc.setFont('helvetica', 'bold')
    doc.text(label, 3, y)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(value, W - 3, y, { align: 'right' })
    y += fs * 0.42 + 1.8
  }

  const line = (thick = false) => {
    doc.setLineWidth(thick ? 0.5 : 0.2)
    doc.setDrawColor(0, 0, 0)
    doc.line(3, y, W - 3, y)
    y += 2
  }

  // ── EN-TÊTE
  centerText('S.B.T.A', 10, true)
  centerText('Soc. Bonkoungou Transport de l\'Agneby', 5.5)
  y += 1
  doc.setFillColor(234, 88, 12)
  doc.rect(3, y - 3, W - 6, 8, 'F')
  doc.setTextColor(255, 255, 255)
  centerText('BORDEREAU DE RAMASSAGE', 8, true)
  doc.setTextColor(0, 0, 0)
  y += 1
  line(true)

  // ── GUICHET & TRAJET
  labelValue('GUICHET :', data.station_name)
  labelValue('DEP N° :', String(data.departure_number), 8)
  labelValue('LIGNE :', data.route_name)
  labelValue('DATE :', data.departure_date)
  labelValue('HEURE :', data.departure_time)
  y += 0.5
  line()

  // ── BUS & CHAUFFEUR
  labelValue('CAR :', data.registration_number)
  labelValue('CHAUFFEUR :', data.driver_name)
  y += 0.5
  line()

  // ── CAPACITÉ
  labelValue('NBRE PLACE', fmtNum(data.total_seats))
  labelValue('VENDU(S)', fmtNum(data.seats_sold))
  labelValue('RESTANT(S)', fmtNum(data.seats_remaining))
  y += 0.5
  line()

  // ── TABLEAU VENTES
  const C = { dest: 3, sieges: 31, tarifR: 52, montantR: W - 3 }
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'bold')
  doc.text('DESTINATION', C.dest,    y)
  doc.text('SIEG.',       C.sieges,  y)
  doc.text('TARIF',       C.tarifR,  y, { align: 'right' })
  doc.text('MONTANT',     C.montantR, y, { align: 'right' })
  y += 1.5
  line()

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.text(data.destination,              C.dest,     y)
  doc.text(fmtNum(data.seats_sold),       C.sieges,   y)
  doc.text(fmt(data.unit_price),          C.tarifR,   y, { align: 'right' })
  doc.text(fmt(data.total_ticket_amount), C.montantR, y, { align: 'right' })
  y += 5

  // ── SIÈGES OCCUPÉS
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'bold')
  doc.text('SIEGES OCCUPES :', 3, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  const perRow = 12
  for (let i = 0; i < data.sold_seat_numbers.length; i += perRow) {
    const chunk = data.sold_seat_numbers.slice(i, i + perRow).join('-')
    doc.text(chunk, 3, y)
    y += 3.5
  }
  y += 1
  line()

  // ── RÉCAPITULATIF FINANCIER
  labelValue('MT TOTAL TICKET :', fmt(data.total_ticket_amount), 7)
  labelValue('MT TOTAL DEPENSES :', fmt(data.total_charges), 7)
  labelValue('SOLDE TICKETS :', fmt(data.solde_ticket), 7, true)
  labelValue('MT TOTAL BAGAGE :', fmt(data.total_baggage), 7)
  y += 1
  line()

  // ── MONTANT RAMASSAGE (section mise en évidence)
  y += 1
  doc.setFillColor(255, 247, 237)
  doc.rect(3, y - 3.5, W - 6, 10, 'F')
  doc.setDrawColor(234, 88, 12)
  doc.setLineWidth(0.5)
  doc.rect(3, y - 3.5, W - 6, 10, 'D')
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.2)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('MONTANT RAMASSAGE :', 6, y + 1)
  doc.text(fmt(data.ramassage_amount), W - 6, y + 1, { align: 'right' })
  y += 10

  y += 1
  // double ligne
  doc.setLineWidth(0.5)
  doc.line(3, y, W - 3, y)
  y += 1.2
  doc.line(3, y, W - 3, y)
  y += 3

  // ── PIED
  doc.setFontSize(5.5)
  doc.setFont('helvetica', 'normal')
  doc.text(`Imprimé le : ${data.print_date} à ${data.print_time}`, 3, y)

  const filename = `bordereau_ramassage_N${data.departure_number}_${data.departure_date.replace(/\//g, '-')}.pdf`
  doc.save(filename)
}
