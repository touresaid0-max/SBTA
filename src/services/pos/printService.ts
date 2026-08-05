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

  const writePort = async (port: any): Promise<boolean> => {
    if (!port.writable || port.writable.locked) return false;
    await port.open({ baudRate: 9600 });
    const writer = port.writable?.getWriter();
    if (!writer) { await port.close(); return false; }
    await writer.write(data);
    writer.releaseLock();
    await port.close();
    return true;
  };

  try {
    // 1. Reuse already-authorized ports first (no dialog)
    const granted = await nav.serial.getPorts();
    for (const port of granted) {
      try {
        const ok = await writePort(port);
        if (ok) return true;
      } catch {
        // try next port
      }
    }

    // 2. No authorized port — show picker dialog
    const port = await nav.serial.requestPort({ filters: [] });
    return writePort(port);
  } catch {
    return false;
  }
}

async function sendWebUSB(data: Uint8Array): Promise<boolean> {
  const nav = navigator as any;
  if (!nav.usb) return false;

  const writeDevice = async (device: any): Promise<boolean> => {
    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    await device.transferOut(1, data);
    await device.close();
    return true;
  };

  try {
    // 1. Reuse already-authorized devices first (no dialog)
    const granted = await nav.usb.getDevices();
    for (const device of granted) {
      try {
        const ok = await writeDevice(device);
        if (ok) return true;
      } catch {
        // try next device
      }
    }

    // 2. No authorized device — show picker dialog
    const device = await nav.usb.requestDevice({ filters: [{ classCode: 7 }] });
    return writeDevice(device);
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
  const mm = settings.width_mm;

  const routeParts = (depart.route_name ?? '').split(/\s*[-–—]\s*/);
  const originCity = (routeParts[0] ?? stationName ?? 'ABIDJAN').toUpperCase();
  const destCity   = (routeParts[routeParts.length - 1] ?? ticket.destination).toUpperCase();
  const gareDepart  = escapeHtml(stationName ?? 'GARE SBTA').toUpperCase();
  const gareArrivee = escapeHtml(ticket.destination).toUpperCase();
  const seatStr    = ticket.seat_number ? String(ticket.seat_number) : '—';
  const tarifStr   = ticket.price.toLocaleString('fr-FR') + ' f';
  const carPlate   = escapeHtml(depart.bus_plate ?? '—').toUpperCase();
  const ticketNum  = escapeHtml(ticket.ticket_number);
  const depNum     = String(depart.route_number ?? '1');

  let dateStr = '—', timeStr = '—';
  try {
    const rawDate = depart.departure_datetime ?? `${depart.departure_date}T${depart.departure_time ?? '00:00'}`;
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) {
      dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
      timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
  } catch { /* leave defaults */ }

  const nowD = new Date();
  const printedAt = `${String(nowD.getDate()).padStart(2,'0')}/${String(nowD.getMonth()+1).padStart(2,'0')}/${nowD.getFullYear()} ${String(nowD.getHours()).padStart(2,'0')}:${String(nowD.getMinutes()).padStart(2,'0')}:${String(nowD.getSeconds()).padStart(2,'0')}`;

  const reducedBadge = ticket.is_reduced ? `<div class="badge">** REDUCTION APPLIQUEE **</div>` : '';
  const reportedBadge = ticket.is_reported ? `<div class="badge">** TICKET REPORTE **</div>` : '';

  const isWide = mm >= 80;
  const fsInfo = isWide ? 11 : 9;
  const fsVal  = isWide ? 13 : 11;
  const fsBig  = isWide ? 20 : 16;
  const fsXl   = isWide ? 26 : 20;
  const fsRoute = isWide ? 15 : 12;
  const fsNote = isWide ? 9 : 8;
  const logoMax = isWide ? 72 : 50;

  const block = (isSouche: boolean) => `
<div class="box">
  <div class="inner">

    ${!isSouche ? `
    <div class="header">
      <div class="logo"><img src="/LOGO_SBTA_-1.png" style="width:100%;max-width:${logoMax}px;" alt="SBTA"/></div>
      <div class="brand">
        <span class="brand-name">SBTA</span><br/>
        <span class="brand-sub">Societe Bonkoungou Transport de L&apos;Agneby</span><br/>
        <span class="brand-sub">Tel 01 14 34 60 / 01 14 34 87</span>
      </div>
    </div>
    ` : `
    <div class="souche-title">SOUCHE</div>
    `}

    <div class="dash"></div>
    <div class="row big">
      <span class="big-label">DEPART</span>
      <span class="sep">|</span>
      <span class="big-num">${escapeHtml(depNum)}</span>
    </div>
    <div class="dash"></div>

    <div class="route">
      ${escapeHtml(originCity)} &nbsp;<span class="arrow">=&gt;</span>&nbsp; ${escapeHtml(destCity)}
    </div>
    <div class="dash"></div>

    <div class="row info"><span>GARE DEPART</span><span class="val">${gareDepart}</span></div>
    <div class="row info"><span>GARE ARRIVEE</span><span class="val">${gareArrivee}</span></div>
    <div class="dash"></div>

    <div class="row info"><span>SIEGE &nbsp;<b class="val-lg">${escapeHtml(seatStr)}</b></span><span>TARIF &nbsp;<b class="val-lg">${escapeHtml(tarifStr)}</b></span></div>
    <div class="dash"></div>

    <div class="row info"><span>CAR &nbsp;<b class="val">${carPlate}</b></span><span>N°TICKET &nbsp;<b class="val ticket-num">${ticketNum}</b></span></div>
    <div class="dash"></div>

    <div class="row info"><span>DATE : &nbsp;<b class="val">${escapeHtml(dateStr)}</b></span><span>HEURE: &nbsp;<b class="val">${escapeHtml(timeStr)}</b></span></div>

    ${reducedBadge}${reportedBadge}

    ${!isSouche ? `
    <div class="dash"></div>
    <div class="note">NB. Tout ticket encaisse n est plus remboursable</div>
    <div class="note">SBTA pas responsable ces bagages sans ticket</div>
    <div class="note">VEUILLEZ CONSERVER LES TICKETS JUSQU&apos;A DESTINATION</div>
    ` : ''}

    <div class="dash"></div>
    <div class="row footnote"><span>V10&nbsp; Imprimer le :</span><span>${escapeHtml(printedAt)}</span></div>

  </div>
</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket</title><style>
  @page { size: ${mm}mm auto; margin: 0.4mm; }
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; margin:0; padding:0; }
  html, body { width: ${mm}mm; margin: 0; padding: 0; }
  body { font-size: ${fsInfo}px; }
  .box { border: 1px solid #000; width: 100%; }
  .inner { padding: 1.5mm 1mm; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2mm; width: 100%; }
  .logo { width: 26%; }
  .brand { text-align: right; line-height: 1.3; width: 74%; }
  .brand-name { font-size: ${fsXl}px; font-weight: 900; letter-spacing: 1px; }
  .brand-sub { font-size: ${fsNote}px; }
  .souche-title { text-align: center; font-size: ${fsBig}px; font-weight: 900; font-style: italic; margin: 1mm 0; }
  .dash { border: none; border-top: 1px dashed #000; margin: 1mm 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; width: 100%; }
  .row.big { font-size: ${fsBig}px; font-weight: 900; }
  .big-label { flex: 0 0 auto; }
  .sep { flex: 1 1 auto; text-align: center; font-size: ${fsVal}px; color: #555; }
  .big-num { flex: 0 0 auto; }
  .route { font-size: ${fsRoute}px; font-weight: 900; padding: 1mm 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row.info { font-size: ${fsInfo}px; padding: 0.3mm 0; }
  .row.info .val { font-weight: bold; }
  .val-lg { font-size: ${fsVal}px; font-weight: bold; }
  .ticket-num { color: #0066cc; }
  .badge { text-align: center; font-size: ${fsVal}px; font-weight: bold; padding: 1mm 0 0; }
  .note { text-align: center; font-size: ${fsNote}px; padding: 0.3mm 0; }
  .row.footnote { font-size: ${fsNote}px; padding-top: 0.5mm; }
  .sep-cut { margin: 2mm 0; border-top: 2px dashed #000; text-align: center; font-size: ${fsNote}px; padding-top: 1mm; }
</style></head><body>
  ${block(false)}

  <div class="sep-cut">&mdash; &mdash; &mdash; &mdash; &mdash; &mdash; &mdash; &mdash; &mdash; &mdash;</div>

  ${block(true)}

  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},600);}</script>
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
  <div class="row"><span class="label">Départ N°:</span><span>${depart.route_number} (${escapeHtml(depart.route_name ?? '')})</span></div>
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
    const cw = iframe.contentWindow;
    const doc = cw?.document;
    if (!doc) { iframe.remove(); resolve(false); return; }
    doc.open();
    doc.write(html);
    doc.close();

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      setTimeout(() => iframe.remove(), 1500);
      resolve(ok);
    };

    // Resolve when print dialog closes (afterprint) or on timeout fallback
    if (cw) {
      cw.addEventListener('afterprint', () => finish(true), { once: true });
    }
    setTimeout(() => {
      try {
        cw?.focus();
        cw?.print();
      } catch {
        finish(false);
        return;
      }
      // Fallback timeout: if afterprint never fires (some browsers), resolve after 2s
      setTimeout(() => finish(true), 2000);
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
