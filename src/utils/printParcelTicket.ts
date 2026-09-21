import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { QRCodeCanvas } from 'qrcode.react'
import type { ParcelReceiptData, Parcel } from '@/types/parcel.types'
import type { ScheduledBus } from '@/components/parcel/BusSelector'
import { setPrintingGuard } from '@/store/authStore'
import { getPrintCustomization } from '@/services/printCustomization'
import { getPrintSettings } from '@/services/pos/printService'
import { buildParcelReceiptESCPOS } from '@/services/pos/escpos'

function generateQRDataUrl(value: string, size = 100): Promise<string> {
  return new Promise((resolve) => {
    const container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.top = '-9999px'
    container.style.left = '-9999px'
    document.body.appendChild(container)

    const root = createRoot(container)
    root.render(
      React.createElement(QRCodeCanvas, {
        value,
        size,
        level: 'M',
        includeMargin: false,
      })
    )

    setTimeout(() => {
      const canvas = container.querySelector('canvas')
      const dataUrl = canvas ? canvas.toDataURL('image/png') : ''
      root.unmount()
      container.remove()
      resolve(dataUrl)
    }, 100)
  })
}

function fmt(n: number): string {
  return Number(n)
    .toLocaleString('fr-FR')
    .replace(/\u202f|\u00a0/g, '\u0020') + ' F'
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function sendThermalESCPOS(
  data: Uint8Array,
  settings: { backend: string; qz_host: string; qz_port: number; printer_name?: string },
): Promise<boolean> {
  const nav = navigator as any

  // 1) WebSerial — reuse already-authorized ports only (no picker)
  if (nav.serial) {
    try {
      const ports = await nav.serial.getPorts()
      for (const port of ports) {
        try {
          if (!port.writable || port.writable.locked) continue
          const wasOpen = Boolean(port.opened)
          if (!wasOpen) await port.open({ baudRate: 9600 })
          const writer = port.writable?.getWriter()
          if (!writer) {
            if (!wasOpen) await port.close()
            continue
          }
          try {
            await writer.write(data)
            return true
          } finally {
            writer.releaseLock()
            if (!wasOpen) await port.close()
          }
        } catch {
          // try next port
        }
      }
    } catch {
      // ignore
    }
  }

  // 2) WebUSB — reuse already-authorized devices only
  if (nav.usb) {
    try {
      const devices = await nav.usb.getDevices()
      for (const device of devices) {
        try {
          if (!device.opened) await device.open()
          if (device.configuration === null) await device.selectConfiguration(1)
          await device.claimInterface(0)
          await device.transferOut(1, data)
          await device.close()
          return true
        } catch {
          // try next device
        }
      }
    } catch {
      // ignore
    }
  }

  // 3) QZ Tray — optional local WebSocket bridge
  try {
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const ws = new WebSocket(`ws://${settings.qz_host}:${settings.qz_port}`)
        const timeout = setTimeout(() => { ws.close(); resolve(false) }, 2000)
        ws.onopen = () => {
          clearTimeout(timeout)
          const b64 = btoa(String.fromCharCode(...data))
          ws.send(JSON.stringify({ type: 'print', data: b64, printer: settings.printer_name }))
          setTimeout(() => { ws.close(); resolve(true) }, 400)
        }
        ws.onerror = () => { clearTimeout(timeout); resolve(false) }
      } catch {
        resolve(false)
      }
    })
    if (ok) return true
  } catch {
    // ignore
  }

  return false
}

export async function printParcelTicket(data: ParcelReceiptData) {
  const totalRecu = data.delivery_fee + data.sms_tracking_fee
  const qrDataUrl = data.courier_qr_enabled ? await generateQRDataUrl(data.parcel_code, 100) : ''
  const logoUrl = window.location.origin + '/logo-sbta.JPG'
  const customization = await getPrintCustomization()
  const customNotes = customization.parcel_notes
  const notesHtml = customNotes.length > 0
    ? customNotes.map(n => escHtml(n)).join('<br>')
    : `${escHtml(data.legal_note_1)}<br>\n    NB: ${escHtml(data.legal_note_2)}`

  // Try thermal ESC/POS first so the printer performs an automatic paper cut
  // between the two copies (partial cut) and after the second copy (full cut).
  // Falls back silently to the HTML browser print below if no thermal printer
  // is reachable.
  try {
    const settings = await getPrintSettings()
    const escposBytes = buildParcelReceiptESCPOS({
      agency_name: data.agency_name,
      print_date: data.print_date,
      receipt_type: data.receipt_type,
      destination: data.destination,
      declared_value: data.declared_value,
      delivery_fee: data.delivery_fee,
      parcel_code: data.parcel_code,
      reference: data.reference,
      sms_tracking_fee: data.sms_tracking_fee,
      sender_name: data.sender_name,
      recipient_name: data.recipient_name,
      nature: data.nature,
      designation: data.designation,
      legal_note_1: data.legal_note_1,
      legal_note_2: data.legal_note_2,
      origin_agent_phone: data.origin_agent_phone,
      destination_agent_phone: data.destination_agent_phone,
      supervisor_phone: data.supervisor_phone,
      courier_qr_enabled: data.courier_qr_enabled,
      custom_notes: customNotes.length > 0 ? customNotes : undefined,
    }, settings)

    if (await sendThermalESCPOS(escposBytes, settings)) {
      return
    }
  } catch {
    // Ignore and fall back to browser print
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Recu ${escHtml(data.parcel_code)}</title>
<style>
  @page {
    size: 80mm auto;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    width: 80mm;
    padding: 2mm 4mm;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header {
    display: flex;
    align-items: center;
    margin-bottom: 1.5mm;
  }
  .logo-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 26mm;
    min-width: 26mm;
  }
  .header .logo-img {
    width: 22mm;
    height: auto;
    object-fit: contain;
    margin-bottom: 0.5mm;
  }
  .header .logo-text {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: 2px;
    text-align: center;
  }
  .header-right {
    flex: 1;
    text-align: right;
    font-size: 10px;
    line-height: 1.8;
  }
  .header-right .label { font-weight: normal; }
  .header-right .value { font-weight: bold; font-size: 13px; }
  .station-row {
    text-align: center;
    margin-bottom: 1mm;
  }
  .station-name { font-weight: bold; font-size: 13px; }
  .station-date { font-size: 10px; margin-left: 4mm; }
  .title {
    text-align: center;
    font-weight: bold;
    font-size: 20px;
    margin: 1mm 0;
    padding: 1mm 0;
    border-bottom: 1px solid #000;
  }
  .dest-row {
    border: 1px solid #000;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1mm 3mm;
    margin-bottom: 1mm;
  }
  .dest-row .label { font-size: 10px; }
  .dest-row .value { font-weight: bold; font-size: 14px; }
  .info-grid {
    display: flex;
    border: 1px solid #000;
    margin-bottom: 1mm;
  }
  .info-grid .cell {
    flex: 1;
    padding: 1mm 3mm;
  }
  .info-grid .cell + .cell {
    border-left: 1px solid #000;
  }
  .info-grid .cell-label {
    font-size: 8px;
    font-weight: bold;
    color: #333;
    margin-bottom: 1px;
  }
  .info-grid .cell-value {
    font-weight: bold;
    font-size: 16px;
  }
  .info-grid .cell-value.ref {
    font-size: 11px;
  }
  .person-grid {
    display: flex;
    border: 1px solid #000;
    margin-bottom: 1.5mm;
  }
  .person-grid .cell {
    flex: 1;
    padding: 1mm 3mm;
  }
  .person-grid .cell + .cell {
    border-left: 1px solid #000;
  }
  .person-grid .cell-label {
    font-size: 8px;
    font-weight: bold;
    color: #333;
    margin-bottom: 1px;
  }
  .person-grid .cell-value {
    font-weight: bold;
    font-size: 10px;
  }
  .fin-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.5mm 0;
    font-size: 11px;
    border-bottom: 1px dotted #999;
  }
  .fin-row:last-of-type { border-bottom: none; }
  .total-row {
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
    padding: 1mm 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 1mm 0 1.5mm 0;
  }
  .total-row .label { font-weight: bold; font-size: 13px; }
  .total-row .value { font-weight: bold; font-size: 16px; }
  .nature-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1.5mm;
    font-size: 10px;
  }
  .nature-table th, .nature-table td {
    border: 1px solid #000;
    padding: 1mm 3mm;
    text-align: left;
  }
  .nature-table th {
    background: #ddd;
    font-weight: bold;
    font-size: 9px;
  }
  .notes-box {
    border: 1px solid #000;
    padding: 1mm 3mm;
    font-size: 8px;
    margin-bottom: 1.5mm;
    line-height: 1.4;
  }
  .qr-section {
    text-align: center;
    padding: 1.5mm 0;
    border-top: 1px solid #000;
  }
  .qr-section canvas {
    display: block;
    margin: 0 auto 2mm auto;
  }
  .qr-label {
    font-size: 8px;
    font-style: italic;
    margin-bottom: 0.5mm;
  }
  .qr-code-text {
    font-weight: bold;
    font-size: 14px;
  }
  .footer {
    border-top: 1px solid #000;
    padding-top: 1mm;
    margin-top: 1mm;
    text-align: center;
    font-weight: bold;
    font-size: 11px;
  }
  .footer .supervisor {
    margin-top: 1mm;
    font-size: 10px;
    font-weight: bold;
  }
  .ticket-copy + .ticket-copy {
    border-top: 2px dashed #000;
    padding-top: 2mm;
    margin-top: 2mm;
  }
  .copy-label {
    text-align: center;
    font-size: 8px;
    font-weight: bold;
    margin-bottom: 1mm;
    letter-spacing: 1px;
  }
  @media print {
    body { width: 80mm; }
  }
</style>
</head>
<body>
${[1, 2].map(copyNum => `
  <div class="ticket-copy">
  <div class="copy-label">${copyNum === 1 ? 'EXEMPLAIRE CLIENT' : 'EXEMPLAIRE AGENCE'}</div>
  <div class="header">
    <div class="logo-container">
      <img class="logo-img" id="logo-img-${copyNum}" src="${logoUrl}" alt="SBTA" onerror="this.style.display='none';">
      <div class="logo-text">SBTA</div>
    </div>
    <div class="header-right">
      <div><span class="label">VILLE EXP :</span>&nbsp;&nbsp;<span class="value">${escHtml(data.origin_agent_phone ?? '')}</span></div>
      <div><span class="label">VILLE DES :</span>&nbsp;&nbsp;<span class="value">${escHtml(data.destination_agent_phone ?? '')}</span></div>
    </div>
  </div>

  <div class="station-row">
    <span class="station-name">${escHtml(data.agency_name)}</span>
    <span class="station-date">${escHtml(data.print_date)}</span>
  </div>

  <div class="title">${escHtml(data.receipt_type)}</div>

  <div class="dest-row">
    <span class="label">DESTINATION</span>
    <span class="value">${escHtml(data.destination.toUpperCase())}</span>
  </div>

  <div class="info-grid">
    <div class="cell">
      <div class="cell-label">CODE</div>
      <div class="cell-value">${escHtml(data.parcel_code)}</div>
    </div>
    <div class="cell">
      <div class="cell-label">REFERENCE</div>
      <div class="cell-value ref">${escHtml(data.reference)}</div>
    </div>
  </div>

  <div class="person-grid">
    <div class="cell">
      <div class="cell-label">EXPEDITEUR</div>
      <div class="cell-value">${escHtml(data.sender_name.toUpperCase())}</div>
    </div>
    <div class="cell">
      <div class="cell-label">DESTINATAIRE</div>
      <div class="cell-value">${escHtml(data.recipient_name.toUpperCase())}</div>
    </div>
  </div>

  <div class="fin-row"><span>Valeur declaree :</span><span>${fmt(data.declared_value)}</span></div>
  <div class="fin-row"><span>Frais :</span><span>${fmt(data.delivery_fee)}</span></div>
  <div class="fin-row"><span>Frais suivi SMS :</span><span>${fmt(data.sms_tracking_fee)}</span></div>

  <div class="total-row">
    <span class="label">TOTAL RECU</span>
    <span class="value">${fmt(totalRecu)}</span>
  </div>

  <table class="nature-table">
    <thead><tr><th>NATURE</th><th>DESIGNATION</th></tr></thead>
    <tbody><tr><td>${escHtml(data.nature.toUpperCase())}</td><td>${escHtml(data.designation.toUpperCase())}</td></tr></tbody>
  </table>

  <div class="notes-box">
    ${notesHtml}
  </div>

  ${data.courier_qr_enabled ? `
  <div class="qr-section">
    <img src="${qrDataUrl}" width="100" height="100" alt="QR" style="display:block;margin:0 auto 1mm auto;">
    <div class="qr-label">Scannez pour confirmer la reception</div>
    <div class="qr-code-text">${escHtml(data.parcel_code)}</div>
  </div>` : ''}

  <div class="footer">
    Merci de votre confiance !
    <div class="supervisor">Superviseur : ${escHtml(data.supervisor_phone ?? '0508257529')}</div>
  </div>
  </div>
`).join('')}
</body>
</html>`

  const existingFrame = document.getElementById('parcel-print-frame')
  if (existingFrame) existingFrame.remove()

  setPrintingGuard(true)

  const iframe = document.createElement('iframe')
  iframe.id = 'parcel-print-frame'
  iframe.style.position = 'fixed'
  iframe.style.top = '-10000px'
  iframe.style.left = '-10000px'
  iframe.style.width = '80mm'
  iframe.style.height = '0'
  iframe.style.border = 'none'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) {
    iframe.remove()
    setPrintingGuard(false)
    return
  }
  doc.open()
  doc.write(html)
  doc.close()

  await new Promise(r => setTimeout(r, 200))
  try {
    iframe.contentWindow?.print()
  } finally {
    setTimeout(() => {
      iframe.remove()
      setPrintingGuard(false)
    }, 2000)
  }
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
  courierQrEnabled?: boolean,
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
    courier_qr_enabled:      courierQrEnabled ?? true,
  }
}
