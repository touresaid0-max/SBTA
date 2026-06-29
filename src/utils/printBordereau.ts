import jsPDF from 'jspdf'
import type { BordereauDepartData, BordereauRecettesData, BordereauRamassageData } from '@/types/counter.types'
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
  const W   = 80
  const H   = 280
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, H] })
  let y = 6

  // helpers — espacements augmentés ~15 % pour une meilleure lisibilité
  const centerText = (text: string, fontSize: number, bold = false) => {
    doc.setFontSize(fontSize)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    const w = doc.getTextWidth(text)
    doc.text(text, (W - w) / 2, y)
    y += fontSize * 0.42 + 1.15
  }

  const labelValue = (label: string, value: string, fs = 7, bold = false) => {
    doc.setFontSize(fs)
    doc.setFont('helvetica', 'bold')
    doc.text(label, 3, y)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.text(value, W - 3, y, { align: 'right' })
    y += fs * 0.42 + 2.6
  }

  // Trait horizontal avec marge avant/après pour aérer le texte
  const line = (thick = false) => {
    y += 1.5
    doc.setLineWidth(thick ? 0.5 : 0.2)
    doc.setDrawColor(0, 0, 0)
    doc.line(3, y, W - 3, y)
    y += 3
  }

  // ── EN-TÊTE ────────────────────────────────────────────────────
  centerText('S.B.T.A', 10, true)
  centerText('Soc. Bonkoungou Transport de l\'Agneby', 5.5)
  y += 1.5
  centerText('BORDEREAU DE DEPART', 8, true)
  y += 1.5
  line(true)

  // ── GUICHET & TRAJET ───────────────────────────────────────────
  y += 1.5
  labelValue('GUICHET :', data.station_name)
  labelValue('DEP N° :', String(data.departure_number), 8)
  labelValue('LIGNE :', data.route_name)
  labelValue('DATE :', data.departure_date)
  labelValue('HEURE :', data.departure_time)
  y += 1.5
  line()

  // ── BUS & CHAUFFEUR ────────────────────────────────────────────
  y += 1.5
  labelValue('CAR :', data.registration_number)
  labelValue('CHAUFFEUR :', data.driver_name)
  y += 1.5
  line()

  // ── CONVOI ──────────────────────────────────────────────────
  if (data.is_convoy) {
    y += 2
    doc.setFillColor(255, 247, 237)
    doc.rect(3, y - 3.5, W - 6, 8, 'F')
    doc.setDrawColor(251, 146, 60)
    doc.setLineWidth(0.4)
    doc.rect(3, y - 3.5, W - 6, 8, 'D')
    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.2)
    centerText('** DEPART EN CONVOI **', 8, true)
    y += 3
  }

  // ── CAPACITÉ ──────────────────────────────────────────────────
  y += 1.5
  labelValue('NBRE PLACE', fmtNum(data.total_seats))
  labelValue('VENDU(S)', fmtNum(data.seats_sold))
  labelValue('RESTANT(S)', fmtNum(data.seats_remaining))
  y += 1.5
  line()

  if (data.is_convoy) {
    // Convoy: simplified financial section
    y += 1.5
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
    y += 2
    const C = { dest: 3, sieges: 31, tarifR: 52, montantR: W - 3 }
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'bold')
    doc.text('DESTINATION', C.dest,    y)
    doc.text('SIEG.',       C.sieges,  y)
    doc.text('TARIF',       C.tarifR,  y, { align: 'right' })
    doc.text('MONTANT',     C.montantR, y, { align: 'right' })
    y += 2
    line()

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text(data.destination,                 C.dest,     y)
    doc.text(fmtNum(data.seats_sold),          C.sieges,   y)
    doc.text(fmt(data.unit_price),             C.tarifR,   y, { align: 'right' })
    doc.text(fmt(data.total_ticket_amount),    C.montantR, y, { align: 'right' })
    y += 7

    // ── SIÈGES OCCUPÉS ─────────────────────────────────────────────
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'bold')
    doc.text('SIEGES OCCUPES :', 3, y)
    y += 4.5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    const perRow = 12
    for (let i = 0; i < data.sold_seat_numbers.length; i += perRow) {
      const chunk = data.sold_seat_numbers.slice(i, i + perRow).join('-')
      doc.text(chunk, 3, y)
      y += 4
    }
    y += 2.5
    line()

    // ── RÉCAPITULATIF FINANCIER ────────────────────────────────────
    y += 1.5
    labelValue('MT TOTAL TICKET :', fmt(data.total_ticket_amount), 7)
    if (data.total_rations > 0)     labelValue('RATIONS :', fmt(data.total_rations))
    if (data.total_carburant > 0)   labelValue('CARBURANT COMPL. :', fmt(data.total_carburant))
    if (data.total_peages > 0)      labelValue('PEAGES :', fmt(data.total_peages))
    if (data.total_autres > 0)      labelValue('AUTRES :', fmt(data.total_autres))
    labelValue('MT TOTAL DEPENSES(R/P.) :', fmt(data.total_charges), 7)
    labelValue('SOLDE TICKETS :', fmt(data.solde_ticket), 7, true)
    labelValue('MT TOTAL BAGAGE :', fmt(data.total_baggage), 7)
  }

  y += 3
  // double ligne
  doc.setLineWidth(0.5)
  doc.line(3, y, W - 3, y)
  y += 1.4
  doc.line(3, y, W - 3, y)
  y += 5

  // ── PIED ───────────────────────────────────────────────────────
  doc.setFontSize(5.5)
  doc.setFont('helvetica', 'normal')
  doc.text(`Imprimé le : ${data.print_date} à ${data.print_time}`, 3, y)

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
  // Logo gauche
  drawLogoSbta(doc, margin + 9, y, 9)

  // Titre centré
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('S.B.T.A', ctr('S.B.T.A'), y - 3)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('Soc. Bonkoungou Transport de l\'Agneby', ctr('Soc. Bonkoungou Transport de l\'Agneby'), y + 3)

  // Téléphone aligné à droite
  doc.setFontSize(8)
  doc.text('Tél : 07 69 94 88 03 / 07 99 68 60 03', W - margin - 55, y - 3)

  y += 10
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('BORDEREAU DETAILLE DES RECETTES', ctr('BORDEREAU DETAILLE DES RECETTES'), y)
  y += 10

  // Ligne séparatrice verte
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
  infoRow('LIGNE', data.route_name)
  infoRow('DATE', data.date_from === data.date_to ? data.date_from : `${data.date_from} au ${data.date_to}`)
  y += 3

  // ── TABLEAU ────────────────────────────────────────────────────
  // Bords GAUCHES pour les colonnes texte, bords DROITS pour les colonnes numériques
  // MATRICULE / TOTAUX alignés à gauche ; colonnes numériques centrées
  const col = {
    matL:   margin + 3,   // MATRICULE / TOTAUX (gauche)
    num:    60,           // N°       (centré)
    sieg:   85,           // SIEGES   (centré)
    ticket: 110,          // MT TICKET(centré)
    dep:    135,          // DEPENSES (centré)
    solde:  160,          // SOLDE    (centré)
    bag:    184,          // BAGAGE   (centré)
  }
  const ROW_H = 8

  // En-tête tableau — fond vert
  doc.setFillColor(11, 116, 57)
  doc.rect(margin, y, W - 2 * margin, ROW_H + 2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  const hY = y + ROW_H - 1
  doc.text('MATRICULE',    col.matL,    hY)
  doc.text('N°',           col.num,     hY, { align: 'center' })
  doc.text('SIEGES',       col.sieg,    hY, { align: 'center' })
  doc.text('MT TICKET',    col.ticket,  hY, { align: 'center' })
  doc.text('DEPENSES',     col.dep,     hY, { align: 'center' })
  doc.text('SOLDE',        col.solde,   hY, { align: 'center' })
  doc.text('BAGAGE',       col.bag,     hY, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  y += ROW_H + 3

  // Lignes de données
  data.rows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 248)
      doc.rect(margin, y - 5, W - 2 * margin, ROW_H, 'F')
    }
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(row.registration_number,         col.matL,    y)
    doc.text(String(row.departure_number),    col.num,     y, { align: 'center' })
    doc.text(fmtNum(row.seats_sold),          col.sieg,    y, { align: 'center' })
    doc.text(fmt(row.total_ticket),           col.ticket,  y, { align: 'center' })
    doc.text(fmt(row.total_charges),          col.dep,     y, { align: 'center' })
    doc.text(fmt(row.solde_ticket),           col.solde,   y, { align: 'center' })
    doc.text(fmt(row.total_baggage),          col.bag,     y, { align: 'center' })
    // séparateur léger
    doc.setDrawColor(226, 234, 229)
    doc.setLineWidth(0.1)
    doc.line(margin, y + 2, W - margin, y + 2)
    doc.setDrawColor(0, 0, 0)
    y += ROW_H
  })

  // Ligne TOTAUX
  doc.setFillColor(11, 116, 57)
  doc.rect(margin, y - 5, W - 2 * margin, ROW_H + 1, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('TOTAUX',                              col.matL,    y)
  doc.text(String(data.totals.departures),        col.num,     y, { align: 'center' })
  doc.text(fmtNum(data.totals.seats_sold),        col.sieg,    y, { align: 'center' })
  doc.text(fmt(data.totals.total_ticket),         col.ticket,  y, { align: 'center' })
  doc.text(fmt(data.totals.total_charges),        col.dep,     y, { align: 'center' })
  doc.text(fmt(data.totals.solde_ticket),         col.solde,   y, { align: 'center' })
  doc.text(fmt(data.totals.total_baggage),        col.bag,     y, { align: 'center' })
  doc.setTextColor(0, 0, 0)
  y += ROW_H + 8

  // ── RÉCAPITULATIF ENCADRÉ ──────────────────────────────────────
  const RECAP_H = 52
  doc.setDrawColor(11, 116, 57)
  doc.setLineWidth(0.6)
  doc.rect(margin, y - 4, W - 2 * margin, RECAP_H, 'D')
  doc.setLineWidth(0.2)
  doc.setDrawColor(0, 0, 0)

  y += 4
  const recapRow = (label: string, value: string) => {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(label, margin + 4, y)
    doc.text(':', margin + 68, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, margin + 72, y)
    y += 7
  }

  recapRow('TOTAL MONTANT TICKETS',        fmt(data.totals.total_ticket))
  recapRow('TOTAL DEPENSES',               fmt(data.totals.total_charges))
  recapRow('SOLDE TICKET',                 fmt(data.totals.solde_ticket))
  recapRow('TOTAL BAGAGE',                 fmt(data.totals.total_baggage))
  recapRow('NOMBRE TOTAL DE VEHICULES',    String(data.totals.departures))
  recapRow('NOMBRE TOTAL DE SIEGES',       fmtNum(data.totals.seats_sold))

  y += 6
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
export function printBordereauCourrier(data: BordereauCourrierData) {
  const W  = 80
  const ML = 3       // marge gauche mm
  const MR = W - 3   // marge droite mm
  const CW = MR - ML // largeur utile = 74 mm

  // Colonnes tableau (positions absolues depuis ML)
  // CODE : 0‥22 mm  NATURE : 22‥38 mm  DESIG : 38‥74 mm
  const C_CODE_L   = ML           // texte aligné gauche
  const C_NAT_L    = ML + 22      // texte aligné gauche
  const C_DES_R    = MR           // texte aligné droite
  const C_NAT_W    = 14           // largeur max nature
  const C_DES_W    = MR - (ML + 38) // largeur max désignation ≈ 36 mm

  // Hauteur d'une ligne de tableau
  const ROW_H = 6    // mm — taille fixe, une seule ligne de texte par colis

  // Calcul de la hauteur totale du document
  const nRows  = Math.max(data.parcels.length, 1)
  const H      = 68 + ROW_H * nRows + 22   // en-tête ~68, pied ~22
  const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, H] })
  let y        = 4

  /* ── helpers ─────────────────────────────────────────────── */
  // Positionne le curseur + applique style ; renvoie la hauteur de ligne
  const f = (style: 'bold' | 'normal', size: number, rgb = 0) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(rgb, rgb, rgb)
  }

  // Hauteur de ligne pour une taille de police donnée
  const lh = (size: number) => size * 0.352 + 1.0

  // Texte centré, avance y
  const cx = (txt: string, size: number, style: 'bold' | 'normal' = 'normal') => {
    f(style, size)
    doc.text(txt, W / 2, y, { align: 'center' })
    y += lh(size)
  }

  // Trait horizontal
  const hline = (thick = false) => {
    doc.setLineWidth(thick ? 0.6 : 0.2)
    doc.setDrawColor(0, 0, 0)
    doc.line(ML, y, MR, y)
    y += thick ? 2.5 : 2.0
  }

  // Ligne label : valeur sur la même ligne
  const infoRow = (label: string, value: string, labelSize = 7.5, valueSize = 8) => {
    f('bold', labelSize)
    doc.text(label, ML, y)
    f('bold', valueSize)
    // Tronquer la valeur si trop longue
    const maxW = CW - doc.getTextWidth(label) - 2
    let val = value
    while (val.length > 2 && doc.getTextWidth(val) > maxW) {
      val = val.slice(0, -1)
    }
    if (val !== value) val = val.slice(0, -1) + '…'
    doc.text(val, MR, y, { align: 'right' })
    y += lh(Math.max(labelSize, valueSize)) + 0.8
  }

  /* ── TÉLÉPHONE (haut à droite) ───────────────────────────── */
  f('normal', 6)
  doc.text(data.station_phone, MR, y, { align: 'right' })
  y += lh(6) + 0.5

  /* ── SBTA  +  Nom gare ───────────────────────────────────── */
  f('bold', 12)
  doc.text('SBTA', ML, y)
  y += lh(12)
  f('normal', 7)
  doc.text(data.station_name.toUpperCase(), ML, y)
  y += lh(7) + 0.5

  /* ── TITRE ───────────────────────────────────────────────── */
  cx('BORDEREAU COURRIER', 10, 'bold')
  hline(true)
  y += 1.5

  /* ── INFOS VOYAGE ────────────────────────────────────────── */
  infoRow('DESTINATION :', data.destination.toUpperCase(), 7.5, 8.5)
  infoRow('DATE :', data.date, 7.5, 8)
  infoRow('MATRICULE :', (data.bus_registration || '—').toUpperCase(), 7.5, 9)

  /* ── CHAUFFEUR ───────────────────────────────────────────── */
  y += 0.5
  cx('CHAUFFEUR', 7, 'bold')
  y -= 0.5
  cx((data.driver_name || '—').toUpperCase(), 9, 'bold')
  hline(true)
  y += 2

  /* ── TITRE TABLE ─────────────────────────────────────────── */
  cx('LISTE COLIS', 8, 'bold')
  y += 1.5

  /* ── EN-TÊTE TABLE ───────────────────────────────────────── */
  // Le rect est dessiné DEPUIS y courant, hauteur = ROW_H
  doc.setFillColor(30, 30, 30)
  doc.rect(ML, y, CW, ROW_H, 'F')

  // Les traits séparateurs de colonnes dans l'en-tête
  doc.setDrawColor(80, 80, 80)
  doc.setLineWidth(0.2)
  doc.line(C_NAT_L - 0.5, y, C_NAT_L - 0.5, y + ROW_H)
  doc.line(C_NAT_L + C_NAT_W + 0.5, y, C_NAT_L + C_NAT_W + 0.5, y + ROW_H)

  // Texte en-tête — aligné verticalement au centre de ROW_H
  const thTxt = y + ROW_H * 0.62
  f('bold', 6.5, 255)
  doc.text('CODE',        C_CODE_L + 1, thTxt)
  doc.text('NATURE',      C_NAT_L + 1,  thTxt)
  doc.text('DESIGNATION', C_DES_R,      thTxt, { align: 'right' })
  f('normal', 6.5, 0)

  y += ROW_H

  /* ── LIGNES DONNÉES ──────────────────────────────────────── */
  data.parcels.forEach((p, idx) => {
    // Fond alterné
    if (idx % 2 === 1) {
      doc.setFillColor(242, 242, 242)
      doc.rect(ML, y, CW, ROW_H, 'F')
    } else {
      doc.setFillColor(255, 255, 255)
      doc.rect(ML, y, CW, ROW_H, 'F')
    }

    // Traits de colonnes
    doc.setDrawColor(210, 210, 210)
    doc.setLineWidth(0.15)
    doc.line(C_NAT_L - 0.5, y, C_NAT_L - 0.5, y + ROW_H)
    doc.line(C_NAT_L + C_NAT_W + 0.5, y, C_NAT_L + C_NAT_W + 0.5, y + ROW_H)

    // Position verticale du texte dans la ligne
    const tY = y + ROW_H * 0.62

    f('normal', 6, 0)

    // CODE — tronqué à la largeur de la colonne
    const codeMaxW = C_NAT_L - C_CODE_L - 3
    let code = p.parcel_code || ''
    while (code.length > 1 && doc.getTextWidth(code) > codeMaxW) code = code.slice(0, -1)
    doc.text(code, C_CODE_L + 1, tY)

    // NATURE — tronqué à C_NAT_W
    const nat = (NATURE_LABELS[p.nature] ?? 'AUTRE').toUpperCase()
    let natTxt = nat
    while (natTxt.length > 1 && doc.getTextWidth(natTxt) > C_NAT_W - 2) natTxt = natTxt.slice(0, -1)
    doc.text(natTxt, C_NAT_L + 1, tY)

    // DESIGNATION — tronqué à C_DES_W, aligné à droite
    let des = (p.content_description || '').toUpperCase()
    while (des.length > 1 && doc.getTextWidth(des) > C_DES_W - 1) des = des.slice(0, -1)
    if (des !== (p.content_description || '').toUpperCase()) des = des.slice(0, -1) + '…'
    doc.text(des, C_DES_R - 1, tY, { align: 'right' })

    // Trait de séparation de ligne (bas)
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.1)
    doc.line(ML, y + ROW_H, MR, y + ROW_H)

    y += ROW_H
  })

  // Bordure basse du tableau
  doc.setDrawColor(30, 30, 30)
  doc.setLineWidth(0.3)
  doc.line(ML, y, MR, y)
  y += 3

  /* ── TOTAL ───────────────────────────────────────────────── */
  f('bold', 7.5)
  doc.text(`TOTAL COLIS : ${data.parcels.length}`, ML, y)
  y += lh(7.5) + 1.5

  /* ── PIED DE PAGE ────────────────────────────────────────── */
  f('normal', 5.5)
  doc.text(`Imprimé le : ${data.print_date} à ${data.print_time}`, ML, y)

  const filename = `bordereau_courrier_${data.destination.replace(/ /g, '_')}_${data.date.replace(/\//g, '-')}.pdf`
  doc.save(filename)
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

const NATURE_LABELS: Record<string, string> = {
  autre:          'AUTRE',
  electronique:   'ELEC.',
  vetement:       'VET.',
  document:       'DOC.',
  alimentaire:    'ALIM.',
  medicament:     'MEDIC.',
  electromenager: 'ELECTROM.',
  fragile:        'FRAGILE',
}
