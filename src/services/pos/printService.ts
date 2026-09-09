import { db, type PrintSettings, type TicketRecord, type BagageRecord, type DepartRecord } from './db';
import { buildESCPOS, buildTicketESCPOS, buildBagageESCPOS, type PrintTicketData, type PrintBagageData } from './escpos';
import { getPrintCustomization } from '../printCustomization';

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
  phoneLine?: string;
}

async function sendWebSerial(data: Uint8Array): Promise<boolean> {
  const nav = navigator as any;
  if (!nav.serial) return false;

  const writePort = async (port: any): Promise<boolean> => {
    if (!port.writable || port.writable.locked) return false;
    const wasOpen = Boolean(port.opened);
    if (!wasOpen) await port.open({ baudRate: 9600 });
    const writer = port.writable?.getWriter();
    if (!writer) {
      if (!wasOpen) await port.close();
      return false;
    }
    try {
      await writer.write(data);
      return true;
    } finally {
      writer.releaseLock();
      if (!wasOpen) await port.close();
    }
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

    // Do not open a connection picker during an automatic sale print.
    return false;
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

    // Do not open a connection picker during an automatic sale print.
    return false;
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

async function buildHTMLTicket(data: PrintTicketData, settings: PrintSettings): Promise<string> {
  const { ticket, depart, stationName, phoneLine: overridePhone } = data;
  const mm = settings.width_mm;
  const customization = await getPrintCustomization();
  const phoneLine = overridePhone || customization.bus_ticket_phones[0] || 'Tel 01 14 34 60 / 01 14 34 87';
  const customNotes = customization.bus_ticket_notes;

  const routeParts = (depart.route_name ?? '').split(/\s*[-–—]\s*/);
  const originCity = (routeParts[0] ?? stationName ?? 'ABIDJAN').toUpperCase();
  const destCity   = (routeParts[routeParts.length - 1] ?? ticket.destination).toUpperCase();
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

  const block = (isSouche: boolean, isFirst: boolean) => `
<div class="ticket-block${isFirst ? ' first' : ' last'}">
  ${!isSouche ? `
  <div class="header">
    <div class="logo"><img src="/LOGO_SBTA_-1.png" alt="SBTA"/></div>
    <div class="brand">
      <div class="brand-name">SBTA</div>
      <div class="brand-sub">Société Bonkoungou Transport de l&apos;Angély</div>
      <div class="brand-sub phone">${escapeHtml(phoneLine)}</div>
    </div>
  </div>
  ` : `
  <div class="souche-title">SOUCHE</div>
  `}
  <div class="section depart-row">
    <span class="depart-label">DEPART</span>
    <span class="depart-sep"></span>
    <span class="depart-num">${escapeHtml(depNum)}</span>
  </div>
  <div class="section route-row">
    <span class="route-from">${escapeHtml(originCity)}</span>
    <span class="route-to"><span class="arrow">=&gt;</span> ${escapeHtml(destCity)}</span>
  </div>
  <div class="section">
    <div class="line">
      <span class="lbl">SIEGE&nbsp;&nbsp;<b class="val-strong">${escapeHtml(seatStr)}</b></span>
      <span class="val">TARIF&nbsp;&nbsp;<b class="val-strong">${escapeHtml(tarifStr)}</b></span>
    </div>
  </div>
  <div class="section">
    <div class="line">
      <span class="lbl">CAR&nbsp;&nbsp;<b>${carPlate}</b></span>
      <span class="val">N°TICKET&nbsp;&nbsp;<b>${ticketNum}</b></span>
    </div>
  </div>
  <div class="section">
    <div class="line">
      <span class="lbl">DATE :&nbsp;&nbsp;<b>${escapeHtml(dateStr)}</b></span>
      <span class="val">HEURE:&nbsp;&nbsp;<b>${escapeHtml(timeStr)}</b></span>
    </div>
  </div>
  ${reducedBadge}${reportedBadge}
  ${!isSouche ? `
  ${customNotes.map(note => `<div class="section notes"><div class="note">${escapeHtml(note)}</div></div>`).join('')}
  ` : ''}
  <div class="footer">
    <span>V10&nbsp;&nbsp;Imprimer le :</span>
    <span>${escapeHtml(printedAt)}</span>
  </div>
</div>`;

  const innerW = mm === 80 ? 328 : 232;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket</title><style>
  @page { size: ${mm}mm auto; margin: 0; }
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #fff; }
  body { margin: 0; padding: 0; }
  .ticket-container { width: ${innerW}px; margin: 0 auto; padding: 0; }

  .ticket-block { width: 100%; border-left: 1px solid #000; border-right: 1px solid #000; overflow: hidden; }
  .ticket-block.first { border-top: 1px solid #000; }
  .ticket-block.last { border-bottom: 1px solid #000; }

  .header { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 3px; gap: 4px; }
  .logo { flex: 0 0 auto; width: 44px; }
  .logo img { width: 100%; height: auto; display: block; }
  .brand { flex: 1 1 auto; text-align: center; line-height: 1.15; min-width: 0; }
  .brand-name { font-size: 21px; font-weight: 900; letter-spacing: 1px; line-height: 1; }
  .brand-sub { font-size: 8px; white-space: normal; word-break: break-word; }
  .brand-sub.phone { font-size: 11px; font-weight: 700; }

  .souche-title { font-style: italic; font-weight: bold; font-size: 17px; text-align: center; margin: 0; padding: 4px 4px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; }

  .section { border-bottom: 1px dashed #000; padding: 2px 4px; }
  .section:first-of-type { border-top: 1px dashed #000; }

  .depart-row { display: flex; align-items: center; justify-content: space-between; padding: 3px 4px; font-size: 17px; font-weight: 900; }
  .depart-label { flex: 0 0 auto; }
  .depart-sep { flex: 1 1 auto; text-align: center; border-left: 1px solid #000; height: 17px; align-self: center; margin: 0 auto; width: 0; }
  .depart-num { flex: 0 0 auto; }

  .route-row { display: flex; align-items: baseline; justify-content: space-between; gap: 4px; font-size: 12px; font-weight: 900; padding: 3px 4px; }
  .route-from { flex: 0 1 auto; white-space: normal; word-break: break-word; }
  .route-to { flex: 1 1 auto; text-align: right; white-space: normal; word-break: break-word; }
  .route-to .arrow { font-weight: 900; }

  .line { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; font-size: 10px; padding: 1px 4px; flex-wrap: wrap; }
  .line .lbl { flex: 0 0 auto; white-space: normal; word-break: break-word; }
  .line .val { flex: 1 1 auto; text-align: right; font-weight: bold; white-space: normal; word-break: break-word; }
  .val-strong { font-weight: 900; font-size: 11px; }

  .notes { padding: 2px 4px; }
  .note { text-align: center; font-size: 9px; white-space: normal; word-break: break-word; }

  .badge { text-align: center; font-weight: bold; padding: 2px 4px; font-size: 10px; white-space: normal; word-break: break-word; border-bottom: 1px dashed #000; }

  .footer { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 1px; font-size: 8px; white-space: normal; word-break: break-word; }

  .tear-zone {
    margin: 0;
    height: 14px;
    background: repeating-linear-gradient(135deg, #d0d0d0 0, #d0d0d0 3px, #f5f5f5 3px, #f5f5f5 6px);
    border-top: 1px dashed #000;
    border-bottom: 1px dashed #000;
    border-left: 1px solid #000;
    border-right: 1px solid #000;
    text-align: center;
    font-size: 8px;
    color: #888;
    line-height: 14px;
    letter-spacing: 2px;
  }

  @media print {
    body { margin: 0; padding: 0; background: #fff; }
    .ticket-container { width: ${innerW}px !important; margin: 0 auto !important; padding: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
  <div class="ticket-container">
    ${block(false, true)}
    <div class="tear-zone">✂ ✂ ✂</div>
    ${block(true, false)}
  </div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},600);}</script>
</body></html>`;
}

function buildHTMLBagage(data: PrintBagageData, settings: PrintSettings): string {
  const { bagage, depart, stationName, phoneLine } = data;
  const widthPx = settings.width_mm === 80 ? 320 : 224;
  const phone = phoneLine || '01 14 34 60 / 01 14 34 87';
  const dt = formatDateTime(new Date().toISOString());
  const [datePart, timePart] = dt.split(' ');
  const price = `${Number(bagage.price || 0).toLocaleString('fr-FR').replace(/\u202f/g, ' ')} F`;
  const departure = `${depart.route_number ?? '-'} ${(depart.route_name ?? '-').toUpperCase()}`;
  const destination = (bagage.destination ?? '-').toUpperCase();
  const owner = (bagage.owner_name ?? '-').toUpperCase();
  const description = (bagage.description ?? '-').toUpperCase();
  const car = bagage.car_plate || depart.bus_plate || '-';
  const mode = bagage.with_ticket ? 'AVEC TICKET' : 'SANS SIEGE';
  const station = (stationName ?? 'Gare').toUpperCase();
  const v = (s: string | number | null | undefined) => escapeHtml(String(s ?? '-').trim() || '-');

  const ticketBlock = (isSouche: boolean) => {
    const rows: string[] = [];
    const row = (label: string, val: string) =>
      `<div class="row"><span class="lbl">${label}</span><span class="val">${v(val)}</span></div>`;
    rows.push(`<div class="ticket-header"><img src="/logo-sbta.JPG" alt="SBTA"/><div class="brand bold">SBTA</div><div class="company">Societe Bonkoungou Transport de L'Agneby</div><div class="phone">Tel ${v(phone)}</div></div>`);
    rows.push(`<div class="sep"></div>`);
    rows.push(`<div class="title">${isSouche ? 'SOUCHE BAGAGE' : 'TICKET BAGAGE'}</div>`);
    rows.push(`<div class="title">${mode}</div>`);
    rows.push(`<div class="sep"></div>`);
    rows.push(row('N BAGAGE', bagage.bagage_number));
    if (bagage.with_ticket && bagage.ticket_number) { rows.push(`<div class="sep"></div>`); rows.push(row('TICKET', bagage.ticket_number)); }
    rows.push(`<div class="sep"></div>`);
    rows.push(row('DEPART', departure));
    rows.push(`<div class="sep"></div>`);
    rows.push(row('PRIX', price));
    rows.push(`<div class="sep"></div>`);
    rows.push(row('CAR', car));
    rows.push(`<div class="sep"></div>`);
    rows.push(`<div class="row"><span class="lbl">DATE</span><span class="val">${v(datePart)}</span><span class="lbl ml">HEURE</span><span class="val">${v(timePart || '00H00')}</span></div>`);
    rows.push(`<div class="sep"></div>`);
    rows.push(row('PROPRIETAIRE', owner));
    rows.push(row('CONTACT', bagage.owner_phone));
    rows.push(`<div class="sep"></div>`);
    rows.push(`<div class="lbl">DESCRIPTION</div>`);
    rows.push(`<div>${v(description)}</div>`);
    rows.push(`<div class="sep"></div>`);
    rows.push(`<div class="center bold">OK</div>`);
    rows.push(`<div class="center">${v(station)}</div>`);
    if (!isSouche) {
      rows.push(`<div class="small">AUCUN REMBOURSEMENT N EST POSSIBLE APRES ENCAISSEMENT</div>`);
      rows.push(`<div class="small">NB: PASSE UN DELAI DE 14 JOURS, SBTA N EST PAS RESPONSABLE EN CAS DE</div>`);
      rows.push(`<div class="small">PERTE DE COLIS.</div>`);
    }
    rows.push(`<div class="border"></div>`);
    return rows.join('');
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: ${settings.width_mm}mm auto; margin: 0; }
  * { font-family: 'Courier New', monospace; font-size: 12px; font-weight: 600; margin: 0; padding: 0; line-height: 1.3; }
  body { width: ${widthPx}px; margin: 0 auto; padding: 1px 2px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: bold; }
  .ticket-header { text-align: center; padding: 3px 0 4px; border-bottom: 1px solid #000; }
  .ticket-header img { display: block; width: 72px; height: auto; margin: 0 auto 2px; }
  .brand { font-size: 16px; }
  .company { font-size: 10px; font-weight: 700; }
  .phone { font-size: 11px; font-weight: 700; }
  .title { text-align: center; font-weight: bold; font-size: 13px; }
  .border { height: 0; margin: 0; }
  .sep { border-top: 1px dashed #000; margin: 1px 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; min-width: 0; }
  .lbl { font-weight: 800; flex: 0 0 auto; }
  .ml { margin-left: 8px; }
  .val { min-width: 0; text-align: right; font-weight: 700; overflow-wrap: anywhere; }
  .small { font-size: 10px; text-align: center; line-height: 1.3; }
  .cut { text-align: center; font-size: 9px; margin: 2px 0; }
  .ticket-frame { border: 1px solid #000; padding: 0 4px; }
</style></head><body>
  <div class="ticket-frame">
  ${ticketBlock(false)}
  <div class="cut">DECOUPER ICI</div>
  ${ticketBlock(true)}
  </div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return `--/--/---- 00H00`;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}H${mi}`;
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
    html = await buildHTMLTicket({ ticket: payload.ticket, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine }, settings);
  } else if (payload.type === 'bagage' && payload.bagage) {
    html = buildHTMLBagage({ bagage: payload.bagage, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine }, settings);
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
      phoneLine: data.phoneLine,
    });
  },

  async printBagage(data: PrintBagageData): Promise<boolean> {
    return this._print({
      type: 'bagage',
      bagage: data.bagage,
      depart: data.depart,
      stationName: data.stationName,
      phoneLine: data.phoneLine,
    });
  },

  async print(data: PrintTicketData): Promise<boolean> {
    return this.printTicket(data);
  },

  async _print(payload: PrintPayload): Promise<boolean> {
    const settings = await getPrintSettings();
    let escposData: Uint8Array;
    if (payload.type === 'ticket' && payload.ticket) {
      escposData = buildTicketESCPOS({ ticket: payload.ticket, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine }, settings);
    } else if (payload.type === 'bagage' && payload.bagage) {
      escposData = buildBagageESCPOS({ bagage: payload.bagage, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine }, settings);
    } else {
      return false;
    }

    // For bagage, always try ESC/POS thermal printers first (regardless of backend setting)
    if (payload.type === 'bagage') {
      const ok = await sendWebSerial(escposData);
      if (ok) return true;
      const okUsb = await sendWebUSB(escposData);
      if (okUsb) return true;
      const okQz = await sendQzTray(escposData, settings);
      if (okQz) return true;
      return printBrowser(payload, settings);
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

export interface PrintRamassageData {
  notif: {
    route_name?: string | null;
    departure_number?: number | null;
    bus_registration?: string | null;
    driver_name?: string | null;
    origin_station_name?: string | null;
    destination_station_name?: string | null;
    departure_datetime?: string | null;
    collected_places?: number | null;
    collected_amount?: number | null;
  };
  stationName?: string;
}

function buildHTMLRamassageBordereau(data: PrintRamassageData, settings: PrintSettings): string {
  const { notif, stationName } = data;
  const mm = settings.width_mm;
  const headerHtml = settings.header_lines.map(l => `<div class="hdr">${escapeHtml(l)}</div>`).join('');
  const footerHtml = settings.footer_lines.map(l => `<div class="ftr">${escapeHtml(l)}</div>`).join('');

  let dateStr = '—', timeStr = '—';
  if (notif.departure_datetime) {
    try {
      const d = new Date(notif.departure_datetime);
      if (!isNaN(d.getTime())) {
        dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
        timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }
    } catch { /* defaults */ }
  }

  const nowD = new Date();
  const printedAt = `${String(nowD.getDate()).padStart(2,'0')}/${String(nowD.getMonth()+1).padStart(2,'0')}/${nowD.getFullYear()} ${String(nowD.getHours()).padStart(2,'0')}:${String(nowD.getMinutes()).padStart(2,'0')}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bordereau Ramassage</title><style>
  @page { size: ${mm}mm auto; margin: 0; }
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: #fff; margin: 0; padding: 0; }
  .container { width: 100%; max-width: 480px; margin: 0 auto; padding: 10px; }
  .hdr { text-align: center; font-size: 12px; }
  .brand { text-align: center; font-size: 22px; font-weight: 900; margin: 4px 0; }
  .title { text-align: center; font-size: 18px; font-weight: 900; padding: 8px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; margin: 6px 0; }
  .section { padding: 6px 2px; border-bottom: 1.5px dashed #000; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 13px; padding: 3px 0; }
  .lbl { flex: 0 0 auto; }
  .val { flex: 1 1 auto; text-align: right; font-weight: bold; word-break: break-word; }
  .val-strong { font-weight: 900; font-size: 15px; }
  .ftr { text-align: center; font-size: 11px; margin-top: 4px; }
  .printed { text-align: center; font-size: 10px; margin-top: 6px; }
  @media print { body { margin: 0; padding: 0; } .container { width: 100% !important; max-width: 480px !important; } }
</style></head><body>
  <div class="container">
    ${headerHtml}
    <div class="brand">SBTA</div>
    <div class="title">BORDEREAU RAMASSAGE</div>
    <div class="section">
      <div class="row"><span class="lbl">N° Départ</span><span class="val val-strong">${escapeHtml(String(notif.departure_number ?? '—'))}</span></div>
      <div class="row"><span class="lbl">Ligne</span><span class="val">${escapeHtml(notif.route_name ?? '—')}</span></div>
    </div>
    <div class="section">
      <div class="row"><span class="lbl">Immatriculation</span><span class="val">${escapeHtml(notif.bus_registration ?? '—')}</span></div>
      <div class="row"><span class="lbl">Chauffeur</span><span class="val">${escapeHtml(notif.driver_name ?? '—')}</span></div>
    </div>
    <div class="section">
      <div class="row"><span class="lbl">Gare de départ</span><span class="val">${escapeHtml(notif.origin_station_name ?? '—')}</span></div>
      <div class="row"><span class="lbl">Gare de destination</span><span class="val">${escapeHtml(notif.destination_station_name ?? '—')}</span></div>
    </div>
    <div class="section">
      <div class="row"><span class="lbl">Places vendues</span><span class="val val-strong">${escapeHtml(String(notif.collected_places ?? 0))}</span></div>
      <div class="row"><span class="lbl">Montant collecté</span><span class="val val-strong">${(notif.collected_amount ?? 0).toLocaleString('fr-FR')} FCFA</span></div>
    </div>
    <div class="section">
      <div class="row"><span class="lbl">Date</span><span class="val">${escapeHtml(dateStr)}</span></div>
      <div class="row"><span class="lbl">Heure</span><span class="val">${escapeHtml(timeStr)}</span></div>
      <div class="row"><span class="lbl">Guichet</span><span class="val">${escapeHtml(stationName ?? '—')}</span></div>
    </div>
    ${footerHtml}
    <div class="printed">Imprimé le ${escapeHtml(printedAt)}</div>
  </div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},600);}</script>
</body></html>`;
}

export interface PrintConvoyData {
  convoy: {
    trip_type?: 'aller_simple' | 'aller_retour';
    route_name?: string | null;
    departure_datetime?: string | null;
    bus_registration?: string | null;
    driver_name?: string | null;
    company_name?: string | null;
    passengers_count?: number;
    amount?: number;
    ratio_amount?: number;
    carburant_amount?: number;
    peage_amount?: number;
    autres_amount?: number;
    observation?: string | null;
  };
  stationName?: string;
}

function buildHTMLConvoyBordereau(data: PrintConvoyData, settings: PrintSettings): string {
  const { convoy, stationName } = data;
  const mm = settings.width_mm;
  const headerHtml = settings.header_lines.map(l => `<div class="hdr">${escapeHtml(l)}</div>`).join('');
  const footerHtml = settings.footer_lines.map(l => `<div class="ftr">${escapeHtml(l)}</div>`).join('');

  let dateStr = '—', timeStr = '—';
  if (convoy.departure_datetime) {
    try {
      const d = new Date(convoy.departure_datetime);
      if (!isNaN(d.getTime())) {
        dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
        timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      }
    } catch { /* defaults */ }
  }

  const nowD = new Date();
  const printedAt = `${String(nowD.getDate()).padStart(2,'0')}/${String(nowD.getMonth()+1).padStart(2,'0')}/${nowD.getFullYear()} ${String(nowD.getHours()).padStart(2,'0')}:${String(nowD.getMinutes()).padStart(2,'0')}`;

  const totalCharges = (convoy.ratio_amount ?? 0) + (convoy.carburant_amount ?? 0) + (convoy.peage_amount ?? 0) + (convoy.autres_amount ?? 0);
  const solde = (convoy.amount ?? 0) - totalCharges;
  const tripLabel = convoy.trip_type === 'aller_retour' ? 'ALLER-RETOUR' : 'ALLER SIMPLE';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bordereau Convoi</title><style>
  @page { size: ${mm}mm auto; margin: 0; }
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: #fff; margin: 0; padding: 0; }
  .container { width: 100%; max-width: 480px; margin: 0 auto; padding: 10px; }
  .hdr { text-align: center; font-size: 12px; }
  .brand { text-align: center; font-size: 22px; font-weight: 900; margin: 4px 0; }
  .title { text-align: center; font-size: 18px; font-weight: 900; padding: 8px 0; border-top: 2px solid #000; border-bottom: 2px solid #000; margin: 6px 0; }
  .trip-type { text-align: center; font-size: 14px; font-weight: 900; padding: 4px 0; }
  .section { padding: 6px 2px; border-bottom: 1.5px dashed #000; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 13px; padding: 3px 0; }
  .lbl { flex: 0 0 auto; }
  .val { flex: 1 1 auto; text-align: right; font-weight: bold; word-break: break-word; }
  .val-strong { font-weight: 900; font-size: 15px; }
  .charges-box { margin: 6px 2px; border: 1.5px solid #000; border-radius: 4px; padding: 6px 8px; }
  .charges-title { font-size: 12px; font-weight: 900; text-align: center; margin-bottom: 4px; }
  .charge-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
  .charge-total { display: flex; justify-content: space-between; font-size: 13px; font-weight: 900; border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; }
  .solde-row { display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; margin-top: 6px; }
  .obs { font-size: 11px; padding: 4px 2px; }
  .ftr { text-align: center; font-size: 11px; margin-top: 4px; }
  .printed { text-align: center; font-size: 10px; margin-top: 6px; }
  @media print { body { margin: 0; padding: 0; } .container { width: 100% !important; max-width: 480px !important; } }
</style></head><body>
  <div class="container">
    ${headerHtml}
    <div class="brand">SBTA</div>
    <div class="title">BORDEREAU CONVOI</div>
    <div class="trip-type">${tripLabel}</div>
    <div class="section">
      <div class="row"><span class="lbl">Ligne</span><span class="val val-strong">${escapeHtml(convoy.route_name ?? '—')}</span></div>
      <div class="row"><span class="lbl">Date</span><span class="val">${escapeHtml(dateStr)}</span></div>
      <div class="row"><span class="lbl">Heure</span><span class="val">${escapeHtml(timeStr)}</span></div>
    </div>
    <div class="section">
      <div class="row"><span class="lbl">Immatriculation</span><span class="val">${escapeHtml(convoy.bus_registration ?? '—')}</span></div>
      <div class="row"><span class="lbl">Chauffeur</span><span class="val">${escapeHtml(convoy.driver_name ?? '—')}</span></div>
      <div class="row"><span class="lbl">Société</span><span class="val">${escapeHtml(convoy.company_name ?? '—')}</span></div>
      <div class="row"><span class="lbl">Guichet</span><span class="val">${escapeHtml(stationName ?? '—')}</span></div>
    </div>
    <div class="section">
      <div class="row"><span class="lbl">Passagers</span><span class="val val-strong">${escapeHtml(String(convoy.passengers_count ?? 0))}</span></div>
      <div class="row"><span class="lbl">Montant</span><span class="val val-strong">${(convoy.amount ?? 0).toLocaleString('fr-FR')} FCFA</span></div>
    </div>
    <div class="charges-box">
      <div class="charges-title">CHARGES DU CONVOI</div>
      <div class="charge-row"><span>Ratio</span><span>${(convoy.ratio_amount ?? 0).toLocaleString('fr-FR')} F</span></div>
      <div class="charge-row"><span>Carburant</span><span>${(convoy.carburant_amount ?? 0).toLocaleString('fr-FR')} F</span></div>
      <div class="charge-row"><span>Péage</span><span>${(convoy.peage_amount ?? 0).toLocaleString('fr-FR')} F</span></div>
      <div class="charge-row"><span>Autres</span><span>${(convoy.autres_amount ?? 0).toLocaleString('fr-FR')} F</span></div>
      <div class="charge-total"><span>TOTAL CHARGES</span><span>${totalCharges.toLocaleString('fr-FR')} F</span></div>
      <div class="solde-row"><span>SOLDE</span><span style="color: ${solde >= 0 ? '#16A34A' : '#DC2626'}">${solde.toLocaleString('fr-FR')} F</span></div>
    </div>
    ${convoy.observation ? `<div class="obs"><b>Observations:</b> ${escapeHtml(convoy.observation)}</div>` : ''}
    ${footerHtml}
    <div class="printed">Imprimé le ${escapeHtml(printedAt)}</div>
  </div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},600);}</script>
</body></html>`;
}

export async function printConvoyBordereau(data: PrintConvoyData): Promise<boolean> {
  const settings = await getPrintSettings();
  const html = buildHTMLConvoyBordereau(data, settings);

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
      setTimeout(() => finish(true), 2000);
    }, 300);
  });
}

export async function printRamassageBordereau(data: PrintRamassageData): Promise<boolean> {
  const settings = await getPrintSettings();
  const html = buildHTMLRamassageBordereau(data, settings);

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
      setTimeout(() => finish(true), 2000);
    }, 300);
  });
}
