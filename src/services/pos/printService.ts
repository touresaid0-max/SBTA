import { db, type PrintSettings, type TicketRecord, type BagageRecord, type DepartRecord } from './db';
import { buildESCPOS, buildTicketESCPOS, buildBagageESCPOS, type PrintTicketData, type PrintBagageData } from './escpos';

export type { PrintTicketData, PrintBagageData };

const SETTINGS_ID = 'default';
const DEFAULT_SETTINGS: PrintSettings = {
  id: SETTINGS_ID,
  backend: 'browser',
  printer_name: '',
  width_mm: 58,
  header_lines: ['SIEGE SOCIAL ABIDJAN', 'Tel: 27 22 44 88 00'],
  footer_lines: ['Merci de votre confiance'],
  auto_cut: true,
  qz_host: 'localhost',
  qz_port: 8181,
};

export async function getPrintSettings(): Promise<PrintSettings> {
  const s = await db.print_settings.get(SETTINGS_ID);
  if (s) return s;
  await db.print_settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function savePrintSettings(settings: PrintSettings): Promise<void> {
  await db.print_settings.put({ ...settings, id: SETTINGS_ID });
}

type PrintBackendType = 'ticket' | 'bagage';

interface PrintPayload {
  type: PrintBackendType;
  ticket?: TicketRecord;
  bagage?: BagageRecord;
  depart: DepartRecord;
  stationName?: string;
}

async function sendWebSerial(data: Uint8Array): Promise<boolean> {
  const nav = navigator as any;
  if (!nav.serial) return false;
  try {
    const port = await nav.serial.requestPort({ filters: [] });
    await port.open({ baudRate: 9600 });
    const writer = port.writable?.getWriter();
    if (!writer) throw new Error('Serial writer unavailable');
    await writer.write(data);
    writer.releaseLock();
    await port.close();
    return true;
  } catch {
    return false;
  }
}

async function sendWebUSB(data: Uint8Array): Promise<boolean> {
  const nav = navigator as any;
  if (!nav.usb) return false;
  try {
    const device = await nav.usb.requestDevice({ filters: [{ classCode: 7 }] });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    await device.transferOut(1, data);
    await device.close();
    return true;
  } catch {
    return false;
  }
}

async function sendQzTray(data: Uint8Array, settings: PrintSettings): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://${settings.qz_host}:${settings.qz_port}`);
      const timeout = setTimeout(() => { ws.close(); resolve(false); }, 3000);
      ws.onopen = () => {
        clearTimeout(timeout);
        const b64 = btoa(String.fromCharCode(...data));
        ws.send(JSON.stringify({ type: 'print', data: b64, printer: settings.printer_name }));
        setTimeout(() => { ws.close(); resolve(true); }, 500);
      };
      ws.onerror = () => { clearTimeout(timeout); resolve(false); };
    } catch {
      resolve(false);
    }
  });
}

function buildHTMLTicket(data: PrintTicketData, settings: PrintSettings): string {
  const { ticket, depart, stationName } = data;
  const widthPx = settings.width_mm === 80 ? 320 : 224;
  const headerHtml = settings.header_lines.map(l => `<div class="hdr">${escapeHtml(l)}</div>`).join('');
  const footerHtml = settings.footer_lines.map(l => `<div class="ftr">${escapeHtml(l)}</div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: ${settings.width_mm}mm auto; margin: 0; }
  * { font-family: 'Courier New', monospace; font-size: 12px; }
  body { width: ${widthPx}px; margin: 0 auto; padding: 4px; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .large { font-size: 16px; font-weight: bold; }
  .hdr { text-align: center; }
  .ftr { text-align: center; margin-top: 4px; }
  .dash { border-top: 1px dashed #000; margin: 4px 0; text-align:center; }
  .row { display:flex; justify-content:space-between; }
  .label { font-weight:bold; }
  .qr { text-align:center; margin: 4px 0; }
  .tag { display:inline-block; border:1px solid #000; padding:0 4px; font-size:10px; margin:1px; }
</style></head><body>
  ${headerHtml}
  <div class="center bold">SBTA TRANSPORT</div>
  <div class="center">${escapeHtml(stationName ?? 'Gare')}</div>
  <div class="dash">-</div>
  <div class="center bold">TICKET PASSAGER</div>
  <div class="dash">-</div>
  <div class="row"><span class="label">Gare:</span><span>${escapeHtml(stationName ?? '-')}</span></div>
  <div class="row"><span class="label">Ligne:</span><span>${escapeHtml(depart.route_name ?? '-')}</span></div>
  <div class="row"><span class="label">Destination:</span><span>${escapeHtml(ticket.destination)}</span></div>
  <div class="row"><span class="label">N° Siège:</span><span>${ticket.seat_number}</span></div>
  <div class="row"><span class="label">Climatisé:</span><span>${ticket.is_ac ? 'OUI' : 'NON'}</span></div>
  ${ticket.is_reduced ? '<div class="center bold">** REDUCTION **</div>' : ''}
  ${ticket.is_reported ? '<div class="center bold">** TICKET REPORTE **</div>' : ''}
  <div class="dash">-</div>
  <div class="center large">${ticket.price} FCFA</div>
  <div class="dash">-</div>
  <div class="row"><span class="label">N° Ticket:</span><span>${escapeHtml(ticket.ticket_number)}</span></div>
  <div class="row"><span class="label">Date:</span><span>${formatDateTime(depart.departure_datetime)}</span></div>
  <div class="row"><span class="label">Départ N°:</span><span>${depart.departure_number}</span></div>
  <div class="dash">-</div>
  <div class="qr">${makeQRText(ticket.ticket_number)}</div>
  ${footerHtml}
  <div class="center">Bon voyage!</div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}</script>
</body></html>`;
}

function buildHTMLBagage(data: PrintBagageData, settings: PrintSettings): string {
  const { bagage, depart, stationName } = data;
  const widthPx = settings.width_mm === 80 ? 320 : 224;
  const headerHtml = settings.header_lines.map(l => `<div class="hdr">${escapeHtml(l)}</div>`).join('');
  const footerHtml = settings.footer_lines.map(l => `<div class="ftr">${escapeHtml(l)}</div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: ${settings.width_mm}mm auto; margin: 0; }
  * { font-family: 'Courier New', monospace; font-size: 12px; }
  body { width: ${widthPx}px; margin: 0 auto; padding: 4px; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .hdr { text-align: center; }
  .ftr { text-align: center; margin-top: 4px; }
  .dash { border-top: 1px dashed #000; margin: 4px 0; text-align:center; }
  .row { display:flex; justify-content:space-between; }
  .label { font-weight:bold; }
  .qr { text-align:center; margin: 4px 0; }
</style></head><body>
  ${headerHtml}
  <div class="center bold">SBTA TRANSPORT</div>
  <div class="center">${escapeHtml(stationName ?? 'Gare')}</div>
  <div class="dash">-</div>
  <div class="center bold">RECU BAGAGE</div>
  <div class="dash">-</div>
  <div class="row"><span class="label">N° Bagage:</span><span>${escapeHtml(bagage.bagage_number)}</span></div>
  ${bagage.with_ticket && bagage.ticket_number ? `<div class="row"><span class="label">Ticket lié:</span><span>${escapeHtml(bagage.ticket_number)}</span></div>` : ''}
  <div class="row"><span class="label">Destination:</span><span>${escapeHtml(bagage.destination)}</span></div>
  <div class="row"><span class="label">Prix:</span><span>${bagage.price} FCFA</span></div>
  <div class="row"><span class="label">Car:</span><span>${escapeHtml(bagage.car_plate || depart.bus_plate || '-')}</span></div>
  ${bagage.description ? `<div class="row"><span class="label">Description:</span><span>${escapeHtml(bagage.description)}</span></div>` : ''}
  ${bagage.owner_name ? `<div class="row"><span class="label">Nom:</span><span>${escapeHtml(bagage.owner_name)}</span></div>` : ''}
  ${bagage.owner_phone ? `<div class="row"><span class="label">Contact:</span><span>${escapeHtml(bagage.owner_phone)}</span></div>` : ''}
  <div class="dash">-</div>
  <div class="row"><span class="label">Date:</span><span>${formatDateTime(bagage.created_at)}</span></div>
  <div class="row"><span class="label">Départ N°:</span><span>${depart.departure_number}</span></div>
  <div class="dash">-</div>
  <div class="qr">${makeQRText(bagage.bagage_number)}</div>
  ${footerHtml}
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function makeQRText(data: string): string {
  const modules = 21;
  let svg = `<svg width="120" height="120" xmlns="http://www.w3.org/2000/svg">`;
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      const seed = (x * 31 + y * 17 + data.charCodeAt(x % data.length) * 7) % 100;
      if (seed < 48) {
        svg += `<rect x="${x * 6}" y="${y * 6}" width="6" height="6" fill="#000"/>`;
      }
    }
  }
  svg += `</svg>`;
  return svg;
}

async function printBrowser(payload: PrintPayload, settings: PrintSettings): Promise<boolean> {
  let html: string;
  if (payload.type === 'ticket' && payload.ticket) {
    html = buildHTMLTicket({ ticket: payload.ticket, depart: payload.depart, stationName: payload.stationName }, settings);
  } else if (payload.type === 'bagage' && payload.bagage) {
    html = buildHTMLBagage({ bagage: payload.bagage, depart: payload.depart, stationName: payload.stationName }, settings);
  } else {
    return false;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  return new Promise((resolve) => {
    const doc = iframe.contentWindow?.document;
    if (!doc) { iframe.remove(); resolve(false); return; }
    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch { /* non-critical */ }
      setTimeout(() => iframe.remove(), 2000);
      resolve(true);
    }, 300);
  });
}

export const PrintService = {
  async printTicket(data: PrintTicketData): Promise<boolean> {
    return this._print({
      type: 'ticket',
      ticket: data.ticket,
      depart: data.depart,
      stationName: data.stationName,
    });
  },

  async printBagage(data: PrintBagageData): Promise<boolean> {
    return this._print({
      type: 'bagage',
      bagage: data.bagage,
      depart: data.depart,
      stationName: data.stationName,
    });
  },

  async print(data: PrintTicketData): Promise<boolean> {
    return this.printTicket(data);
  },

  async _print(payload: PrintPayload): Promise<boolean> {
    const settings = await getPrintSettings();
    let escposData: Uint8Array;
    if (payload.type === 'ticket' && payload.ticket) {
      escposData = buildTicketESCPOS({ ticket: payload.ticket, depart: payload.depart, stationName: payload.stationName }, settings);
    } else if (payload.type === 'bagage' && payload.bagage) {
      escposData = buildBagageESCPOS({ bagage: payload.bagage, depart: payload.depart, stationName: payload.stationName }, settings);
    } else {
      return false;
    }

    // Try backends in order of preference
    if (settings.backend === 'webserial') {
      const ok = await sendWebSerial(escposData);
      if (ok) return true;
      // fall through to browser
    }

    if (settings.backend === 'webusb') {
      const ok = await sendWebUSB(escposData);
      if (ok) return true;
    }

    if (settings.backend === 'qztray') {
      const ok = await sendQzTray(escposData, settings);
      if (ok) return true;
    }

    // Always-available fallback
    return printBrowser(payload, settings);
  },

  buildESCPOS,
};
