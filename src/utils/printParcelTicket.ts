import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { ParcelReceiptData, Parcel } from '@/types/parcel.types'
import type { ScheduledBus } from '@/components/parcel/BusSelector'

function fmt(n: number): string {
  return Number(n)
    .toLocaleString('fr-FR')
    .replace(/\u202f|\u00a0/g, '\u0020') + ' F'
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function printParcelTicket(data: ParcelReceiptData) {
  const totalRecu = data.delivery_fee + data.sms_tracking_fee

  const transportRow = (data.bus_registration || data.driver_name)
    ? `<tr class="transport-row">
        <td>${data.bus_registration ? `BUS: ${escHtml(data.bus_registration)}` : ''}</td>
        <td style="text-align:right">${data.driver_name ? `CHAUFFEUR: ${escHtml(data.driver_name.toUpperCase())}` : ''}</td>
       </tr>`
    : ''

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
    font-family: 'Courier New', monospace;
    font-size: 11px;
    width: 80mm;
    padding: 2mm 3mm;
    color: #1a1a1a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 3mm;
    border-bottom: 1px dashed #666;
    padding-bottom: 2mm;
    margin-bottom: 2mm;
  }
  .header img {
    width: 22mm;
    height: 20mm;
    object-fit: contain;
  }
  .header-info {
    flex: 1;
    border-left: 1px solid #666;
    padding-left: 2mm;
    font-size: 9px;
  }
  .header-info .label { font-weight: normal; }
  .header-info .value { font-weight: bold; font-size: 11px; }
  .header-info div { margin-bottom: 2px; }
  .station-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 1mm;
  }
  .station-name { font-weight: bold; font-size: 14px; }
  .date { font-size: 9px; }
  .title {
    text-align: center;
    font-weight: bold;
    font-size: 16px;
    margin: 2mm 0;
    padding: 1mm 0;
    border-top: 1px dashed #666;
    border-bottom: 1px dashed #666;
  }
  .dest-row {
    background: #eee;
    padding: 1.5mm 3mm;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5mm;
  }
  .dest-row .label { font-size: 10px; }
  .dest-row .value { font-weight: bold; font-size: 12px; }
  table.transport-row td {
    font-size: 9px;
    padding: 1mm 0;
  }
  .transport-row {
    background: #f5f5f5;
    margin-bottom: 1.5mm;
  }
  .transport-row td {
    padding: 1.5mm 3mm;
    font-size: 9px;
  }
  .code-box {
    border: 1px solid #666;
    display: flex;
    margin-bottom: 2mm;
  }
  .code-box .cell {
    flex: 1;
    padding: 1.5mm 3mm;
  }
  .code-box .cell:first-child {
    border-right: 1px solid #666;
  }
  .code-box .cell-label {
    font-size: 8px;
    color: #444;
  }
  .code-box .cell-value {
    font-weight: bold;
    font-size: 14px;
  }
  .code-box .cell:last-child .cell-value {
    font-size: 11px;
  }
  .person-box {
    border: 1px solid #666;
    display: flex;
    margin-bottom: 2mm;
  }
  .person-box .cell {
    flex: 1;
    padding: 1.5mm 3mm;
  }
  .person-box .cell:first-child {
    border-right: 1px solid #666;
  }
  .person-box .cell-label {
    font-size: 8px;
    color: #444;
    margin-bottom: 1px;
  }
  .person-box .cell-value {
    font-weight: bold;
    font-size: 9px;
    word-break: break-word;
  }
  .fin-row {
    display: flex;
    justify-content: space-between;
    padding: 0.5mm 3mm;
    font-size: 10px;
  }
  .total-row {
    border-top: 1px solid #666;
    border-bottom: 1px solid #666;
    padding: 1.5mm 3mm;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 1.5mm 0;
  }
  .total-row .label { font-weight: bold; font-size: 12px; }
  .total-row .value { font-weight: bold; font-size: 14px; }
  .nature-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 2mm;
    font-size: 9px;
  }
  .nature-table th, .nature-table td {
    border: 1px solid #666;
    padding: 1.5mm 2.5mm;
    text-align: left;
  }
  .nature-table th {
    background: #ddd;
    font-weight: bold;
    font-size: 8px;
  }
  .notes-box {
    border: 1px solid #888;
    padding: 2mm 3mm;
    font-size: 7px;
    margin-bottom: 2mm;
    line-height: 1.5;
  }
  .qr-section {
    text-align: center;
    border-top: 1px dashed #666;
    padding-top: 2mm;
    margin-top: 1mm;
  }
  .qr-section canvas { margin: 0 auto; }
  .qr-label { font-size: 8px; margin-top: 1mm; }
  .qr-code-text { font-weight: bold; font-size: 12px; margin-top: 1mm; }
  .footer {
    border-top: 1px dashed #666;
    padding-top: 2mm;
    margin-top: 2mm;
    text-align: center;
    font-weight: bold;
    font-size: 10px;
  }
  .footer .supervisor {
    margin-top: 1.5mm;
    font-size: 10px;
  }
  @media print {
    body { width: 80mm; }
  }
</style>
</head>
<body>
  <div class="header">
    <img src="/logo_sbta02_full.JPG" onerror="this.onerror=null;this.src='/logo_sbta02 copy.JPG'" alt="SBTA">
    <div class="header-info">
      <div><span class="label">VILLE EXP :</span> <span class="value">${escHtml(data.origin_agent_phone ?? '')}</span></div>
      <div><span class="label">VILLE DES :</span> <span class="value">${escHtml(data.destination_agent_phone ?? '')}</span></div>
    </div>
  </div>

  <div class="station-row">
    <span class="station-name">${escHtml(data.agency_name)}</span>
    <span class="date">${escHtml(data.print_date)}</span>
  </div>

  <div class="title">${escHtml(data.receipt_type)}</div>

  <div class="dest-row">
    <span class="label">DESTINATION</span>
    <span class="value">${escHtml(data.destination.toUpperCase())}</span>
  </div>

  ${transportRow ? `<table style="width:100%;margin-bottom:1.5mm"><tbody>${transportRow}</tbody></table>` : ''}

  <div class="code-box">
    <div class="cell">
      <div class="cell-label">CODE</div>
      <div class="cell-value">${escHtml(data.parcel_code)}</div>
    </div>
    <div class="cell">
      <div class="cell-label">REFERENCE</div>
      <div class="cell-value">${escHtml(data.reference)}</div>
    </div>
  </div>

  <div class="person-box">
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
    ${escHtml(data.legal_note_1)}<br>
    NB: ${escHtml(data.legal_note_2)}
  </div>

  <div class="qr-section" id="qr-section">
    <div id="qr-container"></div>
    <div class="qr-label">Scannez pour confirmer la reception</div>
    <div class="qr-code-text">${escHtml(data.parcel_code)}</div>
  </div>

  <div class="footer">
    Merci de votre confiance !
    <div class="supervisor">Superviseur : ${escHtml(data.supervisor_phone ?? '0508257529')}</div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"><\/script>
  <script>
    (function() {
      var container = document.getElementById('qr-container');
      var canvas = document.createElement('canvas');
      container.appendChild(canvas);
      if (window.QRCode) {
        QRCode.toCanvas(canvas, '${data.parcel_code.replace(/'/g, "\\'")}', {
          width: 80,
          margin: 0,
          errorCorrectionLevel: 'M'
        }, function() {
          setTimeout(function() { window.print(); window.close(); }, 200);
        });
      } else {
        setTimeout(function() { window.print(); window.close(); }, 300);
      }
    })();
  <\/script>
</body>
</html>`

  const printWindow = window.open('', '_blank', 'width=350,height=700')
  if (!printWindow) {
    window.alert('Veuillez autoriser les popups pour imprimer le ticket.')
    return
  }
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
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
