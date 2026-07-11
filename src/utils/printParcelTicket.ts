import jsPDF from 'jspdf'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { ParcelReceiptData, Parcel } from '@/types/parcel.types'
import type { ScheduledBus } from '@/components/parcel/BusSelector'

async function buildQrDataUri(text: string, size = 220): Promise<string | null> {
  try {
    const { QRCodeCanvas } = await import('qrcode.react')
    const { createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')

    return await new Promise((resolve) => {
      const container = document.createElement('div')
      container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden'
      document.body.appendChild(container)

      const root = createRoot(container)
      root.render(createElement(QRCodeCanvas, { value: text, size, level: 'M' }))

      setTimeout(() => {
        const canvas = container.querySelector('canvas') as HTMLCanvasElement | null
        const uri = canvas ? canvas.toDataURL('image/png') : null
        root.unmount()
        document.body.removeChild(container)
        resolve(uri)
      }, 50)
    })
  } catch {
    return null
  }
}

const W  = 80
const ML = 3
const MR = W - 3

function fmt(n: number): string {
  return Number(n)
    .toLocaleString('fr-FR')
    .replace(/\u202f|\u00a0/g, '\u0020') + ' F'
}

export async function printParcelTicket(data: ParcelReceiptData) {
  const qrUri = await buildQrDataUri(data.parcel_code, 220)

  const estimatedH = 195

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [W, estimatedH] })
  let y = 3
  const mid = W / 2
  const CW  = MR - ML

  /* ── helpers ── */
  const fn = (size: number) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(30, 30, 30) }
  const fb = (size: number) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(20, 20, 20) }
  const lh = (size: number) => size * 0.35 + 0.8

  const dashLine = (yy: number) => {
    doc.setDrawColor(120, 120, 120)
    doc.setLineWidth(0.15)
    doc.setLineDashPattern([1.2, 0.8], 0)
    doc.line(ML, yy, MR, yy)
    doc.setLineDashPattern([], 0)
  }

  const solidLine = (yy: number) => {
    doc.setDrawColor(100, 100, 100)
    doc.setLineWidth(0.2)
    doc.line(ML, yy, MR, yy)
  }

  const solidLineV = (x: number, y1: number, y2: number) => {
    doc.setDrawColor(100, 100, 100)
    doc.setLineWidth(0.2)
    doc.line(x, y1, x, y2)
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * HEADER : Logo | VILLE EXP / VILLE DES
   * ═══════════════════════════════════════════════════════════════════════════ */
  const logoW = 24, logoH = 22
  const headerTop = y

  try {
    doc.addImage('/logo_sbta02_full.JPG', 'JPEG', ML, y, logoW, logoH)
  } catch {
    try {
      doc.addImage('/logo_sbta02 copy.JPG', 'JPEG', ML, y, logoW, logoH)
    } catch {
      fb(10)
      doc.text('S.B.T.A', ML + 3, y + 12)
    }
  }

  const infoX = ML + logoW + 1.5
  solidLineV(infoX - 0.5, headerTop + 2, headerTop + logoH - 2)

  fb(6.5)
  doc.text('VILLE EXP :', infoX + 1, headerTop + 7)
  fb(8)
  doc.text(data.origin_agent_phone ?? '', MR - 1, headerTop + 7, { align: 'right' })

  fb(6.5)
  doc.text('VILLE DES :', infoX + 1, headerTop + 13)
  fb(8)
  doc.text(data.destination_agent_phone ?? '', MR - 1, headerTop + 13, { align: 'right' })

  y = headerTop + logoH + 2

  /* ═══════════════════════════════════════════════════════════════════════════
   * STATION NAME + DATE
   * ═══════════════════════════════════════════════════════════════════════════ */
  fb(11)
  doc.text(data.agency_name, mid - 3, y, { align: 'center' })
  fn(7)
  doc.text(data.print_date, MR - 1, y, { align: 'right' })
  y += lh(11) + 1
  dashLine(y)
  y += 4.5

  /* ═══════════════════════════════════════════════════════════════════════════
   * RECU COURRIER
   * ═══════════════════════════════════════════════════════════════════════════ */
  fb(14)
  doc.text(data.receipt_type, mid, y, { align: 'center' })
  y += lh(14) + 2.5
  dashLine(y)
  y += 2.5

  /* ═══════════════════════════════════════════════════════════════════════════
   * DESTINATION (gray background row)
   * ═══════════════════════════════════════════════════════════════════════════ */
  const destRowH = 6
  doc.setFillColor(235, 235, 235)
  doc.rect(ML, y - 1, CW, destRowH, 'F')

  fn(7.5)
  doc.text('DESTINATION', ML + 3, y + 2.5)
  fb(9)
  doc.text(data.destination.toUpperCase(), MR - 3, y + 2.5, { align: 'right' })
  y += destRowH + 1.5

  /* ═══════════════════════════════════════════════════════════════════════════
   * TRANSPORT: BUS + CHAUFFEUR (if set)
   * ═══════════════════════════════════════════════════════════════════════════ */
  if (data.bus_registration || data.driver_name) {
    const transRowH = 6
    doc.setFillColor(245, 245, 245)
    doc.rect(ML, y - 1, CW, transRowH, 'F')

    fn(7)
    const transLeft = data.bus_registration ? `BUS: ${data.bus_registration}` : ''
    const transRight = data.driver_name ? `CHAUFFEUR: ${data.driver_name.toUpperCase()}` : ''
    if (transLeft) doc.text(transLeft, ML + 3, y + 2.5)
    if (transRight) doc.text(transRight, MR - 3, y + 2.5, { align: 'right' })
    y += transRowH + 1.5
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * CODE | REFERENCE (boxed)
   * ═══════════════════════════════════════════════════════════════════════════ */
  const codeBoxTop = y
  const codeBoxH = 12

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.rect(ML, codeBoxTop, CW, codeBoxH)
  solidLineV(mid, codeBoxTop, codeBoxTop + codeBoxH)

  fn(6.5)
  doc.text('CODE', ML + 3, codeBoxTop + 3.5)
  doc.text('REFERENCE', mid + 3, codeBoxTop + 3.5)

  fb(14)
  doc.text(data.parcel_code, ML + 3, codeBoxTop + 9.5)
  fb(8.5)
  doc.text(data.reference, mid + 3, codeBoxTop + 9.5)

  y = codeBoxTop + codeBoxH + 1.5

  /* ═══════════════════════════════════════════════════════════════════════════
   * EXPEDITEUR | DESTINATAIRE (boxed)
   * ═══════════════════════════════════════════════════════════════════════════ */
  const personBoxTop = y
  const senderW = mid - ML - 6
  const recipW  = MR - mid - 6

  fb(7)
  const sLines = doc.splitTextToSize(data.sender_name.toUpperCase(), senderW)
  const rLines = doc.splitTextToSize(data.recipient_name.toUpperCase(), recipW)
  const nameRows = Math.max(sLines.length, rLines.length)
  const personBoxH = 5.5 + nameRows * lh(7) + 1.5

  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.rect(ML, personBoxTop, CW, personBoxH)
  solidLineV(mid, personBoxTop, personBoxTop + personBoxH)

  fn(6.5)
  doc.text('EXPEDITEUR', ML + 3, personBoxTop + 3.5)
  doc.text('DESTINATAIRE', mid + 3, personBoxTop + 3.5)

  fb(7)
  let ny = personBoxTop + 7
  for (let i = 0; i < nameRows; i++) {
    if (sLines[i]) doc.text(sLines[i], ML + 3, ny)
    if (rLines[i]) doc.text(rLines[i], mid + 3, ny)
    ny += lh(7)
  }

  y = personBoxTop + personBoxH + 2
  dashLine(y)
  y += 2

  /* ═══════════════════════════════════════════════════════════════════════════
   * FINANCES
   * ═══════════════════════════════════════════════════════════════════════════ */
  const finRow = (label: string, val: string) => {
    fn(7)
    doc.text(label, ML + 3, y)
    doc.text(val, MR - 3, y, { align: 'right' })
    y += lh(7) + 0.8
  }

  finRow('Valeur declaree :', fmt(data.declared_value))
  finRow('Frais :', fmt(data.delivery_fee))
  finRow('Frais suivi SMS :', fmt(data.sms_tracking_fee))

  y += 0.5
  solidLine(y)
  y += 3

  fb(9)
  doc.text('TOTAL RECU', ML + 3, y)
  fb(11)
  doc.text(fmt(data.delivery_fee + data.sms_tracking_fee), MR - 3, y, { align: 'right' })
  y += lh(11) + 2
  solidLine(y)
  y += 2.5

  /* ═══════════════════════════════════════════════════════════════════════════
   * TABLE: NATURE / DESIGNATION
   * ═══════════════════════════════════════════════════════════════════════════ */
  const rowH   = 5
  const tblL   = ML + 0.5
  const tblR   = MR - 0.5
  const tblW   = tblR - tblL
  const tblMid = tblL + tblW * 0.42

  // Header row
  doc.setFillColor(215, 215, 215)
  doc.setDrawColor(100, 100, 100)
  doc.setLineWidth(0.2)
  doc.rect(tblL, y, tblW, rowH, 'FD')
  doc.line(tblMid, y, tblMid, y + rowH)

  fb(6.5)
  doc.text('NATURE', tblL + 2.5, y + 3.2)
  doc.text('DESIGNATION', tblMid + 2.5, y + 3.2)
  y += rowH

  // Data row
  doc.setFillColor(255, 255, 255)
  doc.rect(tblL, y, tblW, rowH, 'FD')
  doc.line(tblMid, y, tblMid, y + rowH)

  fn(6.5)
  const natTxt = doc.splitTextToSize(data.nature.toUpperCase(), tblMid - tblL - 5)
  const desTxt = doc.splitTextToSize(data.designation.toUpperCase(), tblR - tblMid - 5)
  doc.text(natTxt[0] || '', tblL + 2.5, y + 3.2)
  doc.text(desTxt[0] || '', tblMid + 2.5, y + 3.2)
  y += rowH + 2.5

  /* ═══════════════════════════════════════════════════════════════════════════
   * LEGAL NOTES (boxed)
   * ═══════════════════════════════════════════════════════════════════════════ */
  fb(5)
  doc.setTextColor(40, 40, 40)
  const n1Lines = doc.splitTextToSize(data.legal_note_1, CW - 8)
  const n2Lines = doc.splitTextToSize('NB: ' + data.legal_note_2, CW - 8)
  const allNoteLines = [...n1Lines, ...n2Lines]
  const noteBlockH = allNoteLines.length * 2.3 + 3

  doc.setDrawColor(120, 120, 120)
  doc.setLineWidth(0.15)
  doc.rect(ML + 1, y, CW - 2, noteBlockH)

  let noteY = y + 2.5
  for (const line of n1Lines) {
    doc.text(line, ML + 4, noteY)
    noteY += 2.3
  }
  for (const line of n2Lines) {
    doc.text(line, ML + 4, noteY)
    noteY += 2.3
  }
  doc.setTextColor(30, 30, 30)

  y += noteBlockH + 2.5

  /* ═══════════════════════════════════════════════════════════════════════════
   * QR CODE
   * ═══════════════════════════════════════════════════════════════════════════ */
  if (qrUri) {
    dashLine(y)
    y += 3

    const qrSize = 22
    const qrX = (W - qrSize) / 2
    doc.addImage(qrUri, 'PNG', qrX, y, qrSize, qrSize)
    y += qrSize + 1.5

    fn(5.5)
    doc.text('Scannez pour confirmer la reception', mid, y, { align: 'center' })
    y += lh(5.5) + 0.5

    fb(9)
    doc.text(data.parcel_code, mid, y, { align: 'center' })
    y += lh(9) + 1.5
  }

  /* ═══════════════════════════════════════════════════════════════════════════
   * FOOTER
   * ═══════════════════════════════════════════════════════════════════════════ */
  dashLine(y)
  y += 2.5

  fb(7)
  doc.text('Merci de votre confiance !', mid, y, { align: 'center' })
  y += lh(7) + 1.2

  fb(7)
  const supervisorPhone = data.supervisor_phone ?? '0508257529'
  doc.text(`Superviseur : ${supervisorPhone}`, mid, y, { align: 'center' })
  y += lh(7) + 1

  doc.save(`recu_colis_${data.parcel_code}.pdf`)
}

// ─────────────────────────────────────────────────────────────────────────────
// buildReceiptData
// ─────────────────────────────────────────────────────────────────────────────
export interface ParcelAgentInfo {
  origin_agent_phone:      string | null
  destination_agent_phone: string | null
  supervisor_name:         string | null
  supervisor_email:        string | null
  supervisor_phone:        string | null
}

export function buildReceiptData(
  parcel: Parcel,
  stationName: string,
  stationPhone: string,
  selectedBus?: ScheduledBus | null,
  driverNameOverride?: string | null,
  agentInfo?: ParcelAgentInfo | null,
): ParcelReceiptData {
  const busReg  = selectedBus?.registration_number ?? parcel.bus_registration ?? null
  const driver  = driverNameOverride ?? selectedBus?.driver_name ?? null
  const depTime = selectedBus?.departure_datetime
    ? format(new Date(selectedBus.departure_datetime), 'HH:mm — dd/MM/yyyy', { locale: fr })
    : null

  return {
    agency_name:      stationName,
    agency_phone:     stationPhone,
    print_date:       new Date().toLocaleDateString('fr-CI'),
    receipt_type:     'RECU COURRIER',
    destination:      parcel.recipient_city.toUpperCase(),
    declared_value:   parcel.declared_value,
    delivery_fee:     parcel.delivery_fee,
    parcel_code:      parcel.parcel_code,
    reference:        parcel.reference,
    sms_tracking_fee: parcel.sms_tracking_fee,
    sender_name:      parcel.sender_name,
    sender_phone:     parcel.sender_phone,
    recipient_name:   parcel.recipient_name,
    recipient_phone:  parcel.recipient_phone,
    nature:           parcel.nature,
    designation:      parcel.content_description,
    legal_note_1:     "AUCUN REMBOURSEMENT N'EST POSSIBLE APRES ENCAISSEMENT",
    legal_note_2:     "PASSE UN DELAI DE 14 JOURS, SBTA N'EST PAS RESPONSABLE EN CAS DE PERTE DE COLIS.",
    bus_registration: busReg,
    driver_name:      driver,
    departure_time:   depTime,
    origin_station:   stationName || null,
    origin_agent_phone:      agentInfo?.origin_agent_phone      ?? null,
    destination_agent_phone: agentInfo?.destination_agent_phone ?? null,
    supervisor_name:         agentInfo?.supervisor_name         ?? null,
    supervisor_email:        agentInfo?.supervisor_email        ?? null,
    supervisor_phone:        agentInfo?.supervisor_phone        ?? null,
  }
}
