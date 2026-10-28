import { db, type PrintSettings, type TicketRecord, type BagageRecord, type DepartRecord } from './db';
import { buildESCPOS, buildTicketESCPOS, buildBagageESCPOS, buildTpeBagageESCPOS, buildRecettesESCPOS, buildBordereauDepartESCPOS, buildBordereauCourrierESCPOS, type PrintTicketData, type PrintBagageData, type PrintRecettesData, type PrintBordereauDepartData, type RasterImage } from './escpos';
import { getPrintCustomization } from '../printCustomization';
import { setPrintingGuard } from '@/store/authStore';
import type { BordereauDepartData } from '@/types/counter.types';
import type { BordereauCourrierData } from '@/utils/printBordereau';

export type { PrintTicketData, PrintBagageData, PrintRecettesData, PrintBordereauDepartData };

const TICKET_LOGO_SRC = '/logosbta001.JPG';
const BAGAGE_LOGO_SRC = '/logosbta001.JPG';

async function loadLogoRaster(src: string, widthDots: number): Promise<RasterImage | null> {
  try {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Logo introuvable'));
    });
    img.src = src;
    if (img.complete && img.naturalWidth > 0) {
      await img.decode().catch(() => undefined);
    } else {
      await loaded;
      await img.decode().catch(() => undefined);
    }
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const width = Math.floor(widthDots / 8) * 8;
    const height = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const widthBytes = width / 8;
    const bits = new Uint8Array(widthBytes * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 140) bits[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    return { widthBytes, height, bits };
  } catch {
    return null;
  }
}

async function loadTicketLogoRaster(widthDots: number): Promise<RasterImage | null> {
  return loadLogoRaster(TICKET_LOGO_SRC, widthDots);
}

async function loadBagageLogoRaster(widthDots: number): Promise<RasterImage | null> {
  return loadLogoRaster(BAGAGE_LOGO_SRC, widthDots);
}

const BORDEREAU_LOGO_SRC = '/logosbta001.JPG';
const COURRIER_LOGO_SRC = '/logosbta00-1.JPG';
const RECETTES_LOGO_SRC = '/logosbta00-1.JPG';

async function loadBordereauLogoRaster(widthDots: number): Promise<RasterImage | null> {
  return loadLogoRaster(BORDEREAU_LOGO_SRC, widthDots);
}

async function loadCourrierLogoRaster(widthDots: number): Promise<RasterImage | null> {
  return loadLogoRaster(COURRIER_LOGO_SRC, widthDots);
}

async function loadRecettesLogoRaster(widthDots: number): Promise<RasterImage | null> {
  return loadLogoRaster(RECETTES_LOGO_SRC, widthDots);
}

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
  tpe?: { notice: string | null; provisional: boolean };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<T>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(fallback), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
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
  const originCity = (routeParts[0] ?? 'ABIDJAN').toUpperCase().trim();
  const destCity   = (ticket.destination || routeParts[routeParts.length - 1] || '').toUpperCase().trim();
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
    <div class="brand">
      <div class="brand-logo"><img src="${TICKET_LOGO_SRC}" alt="SBTA"/></div>
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

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket</title><style>
  @page { size: ${mm}mm auto; margin: 0; }
  * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #fff; }
  body { margin: 0; padding: 0; }
  .ticket-container { width: ${mm}mm; margin: 0 auto; padding: 0; }

  .ticket-block { width: 100%; overflow: visible; }

  .header { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 3px; gap: 4px; }
  .brand { flex: 1 1 auto; text-align: center; line-height: 1.15; min-width: 0; }
  .brand-logo { display: flex; justify-content: center; }
  .brand-logo img { width: 96px; max-width: 60%; height: auto; display: block; }
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

  .notes { padding: 3px 4px; overflow: visible; }
  .note { text-align: center; font-family: Arial, Helvetica, sans-serif; font-size: 8.5px; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; word-break: normal; }

  .badge { text-align: center; font-weight: bold; padding: 3px 4px; font-size: 10px; white-space: normal; overflow-wrap: anywhere; word-break: normal; border-bottom: 1px dashed #000; }

  .footer { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 1px; font-size: 8px; white-space: normal; overflow-wrap: anywhere; word-break: normal; }

  .tear-zone {
    margin: 0;
    height: 14px;
    background: repeating-linear-gradient(135deg, #d0d0d0 0, #d0d0d0 3px, #f5f5f5 3px, #f5f5f5 6px);
    border-top: 1px dashed #000;
    border-bottom: 1px dashed #000;
    text-align: center;
    font-size: 8px;
    color: #888;
    line-height: 14px;
    letter-spacing: 2px;
  }

  @media print {
    body { margin: 0; padding: 0; background: #fff; }
    .ticket-container { width: ${mm}mm !important; margin: 0 auto !important; padding: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
  <div class="ticket-container">
    ${block(false, true)}
    <div class="tear-zone">✂ ✂ ✂</div>
    ${block(true, false)}
  </div>
  <script>window.onload=function(){window.addEventListener('afterprint',function(){setTimeout(function(){window.close();},600);});}</script>
</body></html>`;
}

function buildHTMLBagage(data: PrintBagageData, settings: PrintSettings): string {
  const { bagage, depart, stationName, phoneLine } = data;
  const phone = phoneLine || '01 14 34 60 / 01 14 34 87';
  const nowIso = new Date().toISOString();
  const printed = formatDateTime(nowIso).replace('H', ':');
  const departFmt = formatDateTime(depart.departure_datetime || nowIso);
  const [dDate, dTime] = departFmt.split(' ');
  const price = `${Number(bagage.price || 0).toLocaleString('fr-FR').replace(/\u202f/g, ' ')} F`;
  const stripStationLabel = (s: string) => s.replace(/^(?:GARE\s+SBTA\s+|GARE\s+SBTA[-–]\s*|GARE\s+|SBTA\s+)+/i, '').trim();
  const originCity = stripStationLabel((stationName || depart.station_name || '').toUpperCase().trim());
  const destCity = stripStationLabel((bagage.destination || '').toUpperCase().trim());
  const departNum = String(depart.route_number ?? depart.departure_number ?? '');
  const owner = (bagage.owner_name ?? '').toUpperCase();
  const contact = bagage.owner_phone ?? '';
  const car = (bagage.car_plate || depart.bus_plate || '').toUpperCase();
  const bagNum = bagage.bagage_number ?? '';
  const seatRaw = bagage.with_ticket ? (bagage.linked_seat_number ?? '') : '';
  const seatStr = seatRaw !== '' && seatRaw !== null && seatRaw !== undefined ? String(seatRaw) : '0';
  const v = (s: string | number | null | undefined) => escapeHtml(String(s ?? ''));

  const ticketBlock = (isSouche: boolean) => `
    ${!isSouche ? `
    <div class="hdr">
      <div class="hdr-brand">
        <div class="brand-logo"><img src="/logosbta001.JPG" alt="SBTA"/></div>
        <div class="brand-sub">Société Bonkoungou Transport de L'Agneby</div>
        <div class="brand-sub phone">Tel ${v(phone)}</div>
      </div>
    </div>
    <div class="title">TICKET BAGAGE</div>
    ` : `
    <div class="souche">SOUCHE</div>
    `}
    <div class="sep"></div>
    <div class="row"><span class="lbl">DEPART :</span><span class="val">N° ${v(departNum)}</span></div>
    <div class="route">${v(originCity)} <span class="arrow">=&gt;</span> ${v(destCity)}</div>
    <div class="sep"></div>
    <div class="row"><span class="lbl">SIEGE : <b>${v(seatStr)}</b></span><span class="val"><span class="lbl">PRIX :</span> <b>${v(price)}</b></span></div>
    <div class="sep"></div>
    <div class="row car-row"><span class="lbl">CAR : <b>${v(car)}</b></span><span class="val"><span class="lbl">N°BAG :</span> <b>${v(bagNum)}</b></span></div>
    <div class="sep"></div>
    <div class="row"><span class="lbl">DATE : <b>${v(dDate)}</b></span><span class="val"><span class="lbl">HEURE :</span> <b>${v(dTime || ':')}</b></span></div>
    <div class="sep"></div>
    <div class="row single"><span class="lbl">PROPRIETAIRE : <b>${v(owner)}</b></span></div>
    <div class="row single"><span class="lbl">CONTACT : <b>${v(contact)}</b></span></div>
    <div class="sep"></div>
    <div class="printed">Imprimé le : ${v(printed)}</div>
  `;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: ${settings.width_mm}mm auto; margin: 0; }
  * { font-family: 'Helvetica Neue Condensed', 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; font-stretch: condensed; margin: 0; padding: 0; box-sizing: border-box; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #fff; }
  body { width: ${settings.width_mm}mm; margin: 0; padding: 0; font-size: 10.5px; font-weight: 600; line-height: 1.15; }
  .hdr { padding: 2px 0 3px; }
  .hdr-brand { text-align: center; line-height: 1.05; min-width: 0; }
  .brand-logo { display: flex; justify-content: center; }
  .brand-logo img { width: 150px; max-width: 70%; height: auto; display: block; }
  .brand-sub { font-size: 8.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .brand-sub.phone { font-size: 9.5px; font-weight: 800; margin-top: 1px; }
  .title { text-align: center; font-size: 15px; font-weight: 900; letter-spacing: 1px; padding: 3px 0 2px; }
  .souche { text-align: center; font-size: 14px; font-weight: 900; font-style: italic; letter-spacing: 1px; padding: 3px 0; }
  .sep { border-top: 1px dashed #000; margin: 2px 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; padding: 2px 0; font-size: 10.5px; font-weight: 700; min-width: 0; white-space: nowrap; }
  .row.single { justify-content: flex-start; }
  .row .lbl { flex: 0 0 auto; white-space: nowrap; }
  .row .val { flex: 1 1 auto; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .row.car-row { font-size: 8.8px; letter-spacing: -0.2px; gap: 2px; }
  .row.car-row .lbl, .row.car-row .val { white-space: nowrap; overflow: visible; text-overflow: clip; }
  .row.car-row .val b { overflow-wrap: anywhere; }
  .row b { font-weight: 900; }
  .route { text-align: center; font-size: 12px; font-weight: 900; padding: 2px 0; letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .route .arrow { font-weight: 900; margin: 0 3px; }
  .printed { text-align: center; font-size: 8.5px; font-weight: 700; padding: 2px 0; white-space: nowrap; }
  .tear { display: flex; align-items: center; justify-content: center; gap: 4px; margin: 3px 0; font-size: 8.5px; font-weight: 800; letter-spacing: 2px; }
  .tear::before, .tear::after { content: ''; flex: 1 1 auto; border-top: 1px dashed #000; height: 0; }
  .ticket-frame { border: 1px solid #000; padding: 4px 5px; }
  @media print { body { margin: 0 auto; padding: 0; background: #fff; } }
</style></head><body>
  <div class="ticket-frame">
    ${ticketBlock(false)}
    <div class="tear">DECOUPER ICI</div>
    ${ticketBlock(true)}
  </div>
  <script>window.onload=function(){window.addEventListener('afterprint',function(){setTimeout(function(){window.close();},500);});}</script>
</body></html>`;
}

function buildHTMLTpeBagage(data: PrintBagageData, notice?: string | null, provisional?: boolean): string {
  const { bagage, depart, stationName, phoneLine } = data;
  const value = (input: string | number | null | undefined): string => String(input ?? '').trim();
  const formatMoney = (amount: number): string => `${amount.toLocaleString('fr-FR').replace(/\u202f/g, ' ')} F`;
  const departureDate = formatDateTime(depart.departure_datetime || new Date().toISOString()).split(' ');
  const printed = formatDateTime(new Date().toISOString());
  const stripStationLabel = (input: string): string => input.replace(/^(?:GARE\s+SBTA\s+|GARE\s+SBTA[-–]\s*|GARE\s+|SBTA\s+)+/i, '').trim();
  const origin = stripStationLabel((stationName || depart.station_name || '').toUpperCase()) || '—';
  const destination = stripStationLabel(value(bagage.destination).toUpperCase()) || '—';
  const departureNumber = value(depart.route_number) || value(depart.departure_number) || '—';
  const seat = bagage.with_ticket && value(bagage.linked_seat_number) ? value(bagage.linked_seat_number) : '—';
  const car = value(bagage.car_plate || depart.bus_plate).toUpperCase() || '—';
  const owner = value(bagage.owner_name).toUpperCase() || '—';
  const contact = value(bagage.owner_phone) || '—';
  const description = value(bagage.description);
  const bagageNumber = value(bagage.bagage_number) || '—';
  const row = (left: string, right: string): string => `<div class="row"><span>${escapeHtml(left)}</span><strong>${escapeHtml(right)}</strong></div>`;
  const block = (souche: boolean): string => `
    <section class="copy${souche ? ' souche-copy' : ''}">
      ${souche ? '<div class="souche-title">SOUCHE</div>' : `<img class="logo" src="${BAGAGE_LOGO_SRC}" alt="SBTA"><div class="company">Société Bonkoungou Transport de L'Agneby</div><div class="phone">Tel ${escapeHtml(phoneLine || '01 14 34 60 / 01 14 34 87')}</div><div class="title">TICKET BAGAGE</div>`}
      <div class="separator"></div>
      ${row('DEPART :', `N° ${departureNumber}`)}
      <div class="route">${escapeHtml(origin)} <span>=&gt;</span> ${escapeHtml(destination)}</div>
      <div class="separator"></div>
      ${row(`SIEGE : ${seat}`, `PRIX : ${formatMoney(Number(bagage.price || 0))}`)}
      <div class="separator"></div>
      ${row('CAR :', car)}
      ${row('N°BAG :', bagageNumber)}
      <div class="separator"></div>
      ${row(`DATE : ${departureDate[0] || '—'}`, `HEURE : ${departureDate[1] || '—'}`)}
      ${description && description !== '__deleted__' ? `<div class="single"><span>DESCRIPTION :</span> <strong>${escapeHtml(description)}</strong></div>` : ''}
      ${Number(bagage.declared_value || 0) > 0 ? `${row('VALEUR DECLAREE :', formatMoney(Number(bagage.declared_value)))}<div class="separator"></div>` : ''}
      <div class="separator"></div>
      <div class="single">PROPRIETAIRE : <strong>${escapeHtml(owner)}</strong></div>
      <div class="single">CONTACT : <strong>${escapeHtml(contact)}</strong></div>
      <div class="separator"></div>
      <div class="printed">Imprimé le : ${escapeHtml(printed)}</div>
      ${notice && notice.trim() ? `<div class="separator"></div><div class="notice">${escapeHtml(notice.trim())}</div>` : ''}
      ${provisional ? `<div class="provisional-banner">EN ATTENTE DE PAIEMENT</div>` : ''}
    </section>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket bagage TPE</title><style>
    @page { size: 58mm auto; margin: 0; }
    * { box-sizing: border-box; color: #000; font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    html, body { width: 58mm; background: #fff; }
    body { width: 54mm; margin: 0 auto; padding: 1mm 0; font-size: 9.5px; line-height: 1.15; font-weight: 700; }
    .copy { width: 54mm; break-inside: avoid; page-break-inside: avoid; }
    .logo { display: block; width: 28mm; max-height: 19mm; object-fit: contain; margin: 0 auto 1mm; }
    .company, .phone, .title, .souche-title, .route, .printed { text-align: center; }
    .company { font-size: 7.5px; white-space: nowrap; }
    .phone { font-size: 8.5px; margin-top: 1px; }
    .title { font-size: 13px; letter-spacing: .7px; margin: 2mm 0 1mm; }
    .souche-title { font-size: 13px; font-style: italic; letter-spacing: 1px; padding: 2mm 0 1mm; }
    .separator { border-top: 1px dashed #000; margin: 1.5mm 0; }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; min-width: 0; padding: 1mm 0; font-size: 9.5px; }
    .row span { min-width: 0; }
    .row strong { text-align: right; min-width: 0; overflow-wrap: anywhere; }
    .route { font-size: 10.5px; font-weight: 900; overflow-wrap: anywhere; padding: 1mm 0; }
    .route span { padding: 0 1mm; }
    .single { padding: 1mm 0; overflow-wrap: anywhere; }
    .printed { font-size: 7.5px; padding: 1mm 0 0; }
    .notice { font-size: 6.5px; line-height: 1.3; text-align: justify; padding: 1mm 0; overflow-wrap: anywhere; word-break: normal; }
    .provisional-banner { text-align: center; font-size: 11px; font-weight: 900; letter-spacing: 1px; padding: 2mm 0; border-top: 2px solid #000; border-bottom: 2px solid #000; margin-top: 1mm; }
    .tear { display: flex; align-items: center; gap: 1mm; justify-content: center; height: 7mm; font-size: 7px; letter-spacing: 1px; break-inside: avoid; page-break-inside: avoid; }
    .tear::before, .tear::after { content: ''; flex: 1; border-top: 1px dashed #000; }
    @media print { html, body { width: 58mm !important; } body { margin: 0 auto !important; padding: 1mm 0 !important; } }
  </style></head><body>${block(false)}<div class="tear">DECOUPER ICI</div>${block(true)}<script>window.onload=function(){window.print();window.addEventListener('afterprint',function(){setTimeout(function(){window.close();},400);});}</script></body></html>`;
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

async function printHTMLDocument(html: string): Promise<boolean> {
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
    if (cw) cw.addEventListener('afterprint', () => finish(true), { once: true });
    setTimeout(async () => {
      try {
        const images = Array.from(doc.images);
        await Promise.all(images.map(image => {
          if (image.complete && image.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>(resolve => {
            const done = () => resolve();
            image.addEventListener('load', done, { once: true });
            image.addEventListener('error', done, { once: true });
            setTimeout(done, 3000);
          });
        }));
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

async function printBrowser(payload: PrintPayload, settings: PrintSettings): Promise<boolean> {
  let html: string;
  if (payload.type === 'ticket' && payload.ticket) {
    html = await buildHTMLTicket({ ticket: payload.ticket, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine }, settings);
  } else if (payload.type === 'bagage' && payload.bagage) {
    const bagageData = { bagage: payload.bagage, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine };
    html = payload.tpe
      ? buildHTMLTpeBagage(bagageData, payload.tpe.notice, payload.tpe.provisional)
      : buildHTMLBagage(bagageData, settings);
  } else {
    return false;
  }

  return printHTMLDocument(html);
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

  async printTpeBagage(data: PrintBagageData, provisional?: boolean): Promise<boolean> {
    const customization = await getPrintCustomization();
    setPrintingGuard(true);
    try {
      return await this._print({
        type: 'bagage',
        bagage: data.bagage,
        depart: data.depart,
        stationName: data.stationName,
        phoneLine: data.phoneLine,
        tpe: { notice: customization.tpe_baggage_notice, provisional: provisional ?? false },
      });
    } finally {
      setPrintingGuard(false);
    }
  },

  async print(data: PrintTicketData): Promise<boolean> {
    return this.printTicket(data);
  },

  async _print(payload: PrintPayload): Promise<boolean> {
    const settings = await getPrintSettings();
    let escposData: Uint8Array;
    if (payload.type === 'ticket' && payload.ticket) {
      const logo = await loadTicketLogoRaster(settings.width_mm === 80 ? 288 : 224);
      escposData = buildTicketESCPOS({ ticket: payload.ticket, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine }, settings, logo);
    } else if (payload.type === 'bagage' && payload.bagage) {
      const logo = await loadBagageLogoRaster(settings.width_mm === 80 ? 208 : 160);
      const bagageData = { bagage: payload.bagage, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine };
      escposData = payload.tpe
        ? buildTpeBagageESCPOS(bagageData, settings, logo, payload.tpe.notice, payload.tpe.provisional)
        : buildBagageESCPOS(bagageData, settings, logo);
    } else {
      return false;
    }

    // For bagage, always try ESC/POS thermal printers first (regardless of backend setting)
    if (payload.type === 'bagage') {
      const ok = await withTimeout(sendWebSerial(escposData), 1500, false);
      if (ok) return true;
      const okUsb = await withTimeout(sendWebUSB(escposData), 1500, false);
      if (okUsb) return true;
      const okQz = await withTimeout(sendQzTray(escposData, settings), 3000, false);
      if (okQz) return true;
      return printBrowser(payload, settings);
    }

    // Try backends in order of preference
    if (settings.backend === 'webserial') {
      const ok = await withTimeout(sendWebSerial(escposData), 1500, false);
      if (ok) return true;
      // fall through to browser
    }

    if (settings.backend === 'webusb') {
      const ok = await withTimeout(sendWebUSB(escposData), 1500, false);
      if (ok) return true;
    }

    if (settings.backend === 'qztray') {
      const ok = await withTimeout(sendQzTray(escposData, settings), 3000, false);
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
      <div class="row"><span class="lbl">Ville d'arrivée</span><span class="val val-strong">${escapeHtml(convoy.route_name ?? '—')}</span></div>
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

function buildHTMLRecettesBordereau(data: PrintRecettesData, settings: PrintSettings): string {
  const { data: bordereau, phoneLine } = data;
  const mm = settings.width_mm;
  const bodyWidthMm = mm - 4;
  const fmtNum = (n: number): string =>
    Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fmt = (n: number): string => fmtNum(n) + ' F';

  const rowsHtml = bordereau.rows.map(row => {
    const immat = escapeHtml((row.registration_number || '').toUpperCase().slice(0, 9));
    const num = escapeHtml(String(row.departure_number || '').slice(0, 3));
    const siege = escapeHtml(fmtNum(row.seats_sold).slice(0, 4));
    const ticket = escapeHtml(fmtNum(row.total_ticket));
    const depense = escapeHtml(fmtNum(row.total_charges));
    const solde = escapeHtml(fmtNum(row.solde_ticket));
    const bagage = escapeHtml(fmtNum(row.total_baggage));
    return `<tr>
      <td class="l">${immat}</td>
      <td class="l">${num}</td>
      <td class="l">${siege}</td>
      <td class="r">${ticket}</td>
      <td class="r">${depense}</td>
      <td class="r">${solde}</td>
      <td class="r">${bagage}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: ${mm}mm auto; margin: 0; }
  * { font-family: 'Courier New', monospace; font-size: 10px; color: #000; margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #fff; }
  body { width: ${bodyWidthMm}mm; margin: 0 auto; padding: 2px 0; font-weight: 700; }
  .hdr { text-align: center; }
  .brand { font-size: 18px; font-weight: 900; }
  .brand-logo { display: flex; justify-content: center; }
  .brand-logo img { width: 80px; max-width: 45%; height: auto; display: block; margin: 0 auto 2px; }
  .sub { font-size: 10px; }
  .phone { font-size: 11px; font-weight: 800; }
  .title { text-align: center; font-size: 13px; font-weight: 900; margin: 2px 0; }
  .dsep { border-top: 2px solid #000; margin: 2px 0; }
  .sep { border-top: 1px solid #000; margin: 1px 0; }
  .info { display: flex; justify-content: space-between; font-size: 11px; font-weight: 800; padding: 1px 0; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th { font-size: 9px; font-weight: 900; padding: 1px 1px; border-bottom: 1px solid #000; }
  th.l { text-align: left; }
  th.r { text-align: right; }
  td { font-size: 9px; font-weight: 800; padding: 1px 1px; }
  td.l { text-align: left; white-space: nowrap; overflow: hidden; text-overflow: clip; }
  td.r { text-align: right; white-space: nowrap; }
  .tot { font-weight: 900; border-top: 1px solid #000; }
  .recap { font-size: 11px; font-weight: 800; padding: 1px 0; }
  .recap-row { display: flex; justify-content: space-between; padding: 1px 0; }
  .recap-bold { font-weight: 900; }
  .printed { text-align: center; font-size: 10px; font-weight: 800; padding: 2px 0; }
  @media print { body { margin: 0 auto; } }
</style></head><body>
  <div class="hdr">
    <div class="brand-logo"><img src="${RECETTES_LOGO_SRC}" alt="SBTA"/></div>
    <div class="sub">Soc. Bonkoungou Transport de L'Agneby</div>
    <div class="phone">Tel ${escapeHtml(phoneLine || '07 69 94 88 03 / 07 99 68 60 03')}</div>
  </div>
  <div class="dsep"></div>
  <div class="title">BORDEREAU DETAILLE DES RECETTES</div>
  <div class="dsep"></div>
  <div class="info"><span>GUICHET:</span><span>${escapeHtml(bordereau.station_name)}</span></div>
  <div class="info"><span>DU:</span><span>${escapeHtml(bordereau.date_from)}</span></div>
  <div class="info"><span>AU:</span><span>${escapeHtml(bordereau.date_to)}</span></div>
  <div class="sep"></div>
  <table>
    <thead>
      <tr>
        <th class="l">IMMAT</th>
        <th class="l">N°</th>
        <th class="l">SIEG</th>
        <th class="r">MT TIC</th>
        <th class="r">DEP R/P</th>
        <th class="r">SOLDE</th>
        <th class="r">BAG</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="tot">
        <td class="l">TOTAUX</td>
        <td class="l">${bordereau.totals.departures}</td>
        <td class="l">${fmtNum(bordereau.totals.seats_sold)}</td>
        <td class="r">${fmtNum(bordereau.totals.total_ticket)}</td>
        <td class="r">${fmtNum(bordereau.totals.total_charges)}</td>
        <td class="r">${fmtNum(bordereau.totals.solde_ticket)}</td>
        <td class="r">${fmtNum(bordereau.totals.total_baggage)}</td>
      </tr>
    </tbody>
  </table>
  <div class="dsep"></div>
  <div class="recap">
    <div class="recap-row recap-bold"><span>TOTAL TICKETS:</span><span>${fmt(bordereau.totals.total_ticket)}</span></div>
    ${bordereau.totals.total_rations > 0 ? `<div class="recap-row"><span>  RATIONS:</span><span>${fmt(bordereau.totals.total_rations)}</span></div>` : ''}
    ${bordereau.totals.total_carburant > 0 ? `<div class="recap-row"><span>  CARBURANT:</span><span>${fmt(bordereau.totals.total_carburant)}</span></div>` : ''}
    ${bordereau.totals.total_peages > 0 ? `<div class="recap-row"><span>  PEAGES:</span><span>${fmt(bordereau.totals.total_peages)}</span></div>` : ''}
    ${bordereau.totals.total_autres > 0 ? `<div class="recap-row"><span>  AUTRES:</span><span>${fmt(bordereau.totals.total_autres)}</span></div>` : ''}
    <div class="sep"></div>
    <div class="recap-row recap-bold"><span>TOTAL DEPENSES:</span><span>${fmt(bordereau.totals.total_charges)}</span></div>
    <div class="recap-row recap-bold"><span>SOLDE TICKET:</span><span>${fmt(bordereau.totals.solde_ticket)}</span></div>
    <div class="recap-row"><span>TOTAL BAGAGE:</span><span>${fmt(bordereau.totals.total_baggage)}</span></div>
    <div class="recap-row"><span>NB VEHICULES:</span><span>${bordereau.totals.departures}</span></div>
    <div class="recap-row"><span>NB SIEGES:</span><span>${fmtNum(bordereau.totals.seats_sold)}</span></div>
  </div>
  <div class="dsep"></div>
  <div class="printed">Imprime le ${escapeHtml(bordereau.print_date)} a ${escapeHtml(bordereau.print_time)}</div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}</script>
</body></html>`;
}

export async function printRecettesBordereau(data: PrintRecettesData): Promise<boolean> {
  const settings = await getPrintSettings();
  const logo = await loadRecettesLogoRaster(settings.width_mm === 80 ? 208 : 160);
  const escposData = buildRecettesESCPOS(data, settings, logo);

  const okSerial = await sendWebSerial(escposData);
  if (okSerial) return true;
  const okUsb = await sendWebUSB(escposData);
  if (okUsb) return true;
  const okQz = await sendQzTray(escposData, settings);
  if (okQz) return true;

  const html = buildHTMLRecettesBordereau(data, settings);
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

// ═══════════════════════════════════════════════════════════════════
//  BORDEREAU DE DÉPART — impression thermique 58 mm (ESC/POS + HTML fallback)
// ═══════════════════════════════════════════════════════════════════
function buildHTMLBordereauDepart(data: PrintBordereauDepartData, settings: PrintSettings): string {
  const { data: bord, phoneLine } = data;
  const mm = settings.width_mm;
  const fmtNum = (n: number): string =>
    Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fmt = (n: number): string => fmtNum(n) + ' F';

  const groups = bord.destination_groups && bord.destination_groups.length > 0
    ? bord.destination_groups
    : [{ destination: bord.destination, seats_sold: bord.seats_sold, unit_price: bord.unit_price, amount: bord.total_ticket_amount, seat_numbers: bord.sold_seat_numbers }];

  const rowsHtml = groups.map(g => {
    const dest = escapeHtml(g.destination.slice(0, 22));
    const sieg = escapeHtml(fmtNum(g.seats_sold));
    const tarif = escapeHtml(fmtNum(g.unit_price));
    const montant = escapeHtml(fmtNum(g.amount));
    return `<tr>
      <td class="l">${dest}</td>
      <td class="l">${sieg}</td>
      <td class="r">${tarif}</td>
      <td class="r">${montant}</td>
    </tr>`;
  }).join('');

  const convoySection = bord.is_convoy
    ? `<div class="convoy-badge">** DEPART EN CONVOI **</div>`
    : '';

  const salesTable = bord.is_convoy ? '' : `
  <div class="sep"></div>
  <table>
    <thead>
      <tr>
        <th class="l">DEST</th>
        <th class="l">SIEG</th>
        <th class="r">TARIF</th>
        <th class="r">MONTANT</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>`;

  const recapHtml = bord.is_convoy
    ? `
    <div class="recap-row recap-bold"><span>MONTANT CONVOI:</span><span>${fmt(bord.convoy_amount)}</span></div>
    ${bord.total_rations > 0 ? `<div class="recap-row"><span>  RATIONS:</span><span>${fmt(bord.total_rations)}</span></div>` : ''}
    ${bord.total_carburant > 0 ? `<div class="recap-row"><span>  CARBURANT:</span><span>${fmt(bord.total_carburant)}</span></div>` : ''}
    ${bord.total_peages > 0 ? `<div class="recap-row"><span>  PEAGES:</span><span>${fmt(bord.total_peages)}</span></div>` : ''}
    ${bord.total_autres > 0 ? `<div class="recap-row"><span>  AUTRES:</span><span>${fmt(bord.total_autres)}</span></div>` : ''}
    <div class="sep"></div>
    <div class="recap-row"><span>MT TOTAL DEPENSES:</span><span>${fmt(bord.total_charges)}</span></div>
    <div class="recap-row recap-bold"><span>SOLDE CONVOI:</span><span>${fmt(bord.convoy_amount - bord.total_charges)}</span></div>
    <div class="recap-row"><span>MT TOTAL BAGAGE:</span><span>${fmt(bord.total_baggage)}</span></div>
  `
    : `
    <div class="recap-row recap-bold"><span>MT TOTAL TICKET:</span><span>${fmt(bord.total_ticket_amount)}</span></div>
    ${bord.total_rations > 0 ? `<div class="recap-row"><span>  RATIONS:</span><span>${fmt(bord.total_rations)}</span></div>` : ''}
    ${bord.total_carburant > 0 ? `<div class="recap-row"><span>  CARBURANT:</span><span>${fmt(bord.total_carburant)}</span></div>` : ''}
    ${bord.total_peages > 0 ? `<div class="recap-row"><span>  PEAGES:</span><span>${fmt(bord.total_peages)}</span></div>` : ''}
    ${bord.total_autres > 0 ? `<div class="recap-row"><span>  AUTRES:</span><span>${fmt(bord.total_autres)}</span></div>` : ''}
    <div class="sep"></div>
    <div class="recap-row"><span>MT TOTAL DEPENSES:</span><span>${fmt(bord.total_charges)}</span></div>
    <div class="recap-row recap-bold"><span>SOLDE TICKETS:</span><span>${fmt(bord.solde_ticket)}</span></div>
    <div class="recap-row"><span>MT TOTAL BAGAGE:</span><span>${fmt(bord.total_baggage)}</span></div>
  `;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: ${mm}mm auto; margin: 0; }
  * { font-family: 'Courier New', monospace; font-size: 10px; color: #000; margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #fff; }
  body { width: ${mm}mm; margin: 0 auto; padding: 0; font-weight: 600; }
  .border-box { border: 0; padding: 0 1mm; width: ${mm}mm; }
  .hdr { text-align: center; }
  .brand { font-size: 19px; font-weight: 900; }
  .brand-logo { display: flex; justify-content: center; }
  .brand-logo img { width: 110px; max-width: 60%; height: auto; display: block; }
  .sub { font-size: 9px; white-space: nowrap; letter-spacing: -0.2px; }
  .phone { font-size: 10px; font-weight: 700; white-space: nowrap; letter-spacing: -0.2px; }
  .title { text-align: center; font-size: 13px; font-weight: 900; margin: 3px 0; }
  .dsep { border-top: 2px solid #000; margin: 3px 0; }
  .sep { border-top: 1px solid #000; margin: 2px 0; }
  .info { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; padding: 2px 0; }
  .convoy-badge { text-align: center; font-size: 12px; font-weight: 900; padding: 3px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 9px; font-weight: 900; padding: 2px 0; border-bottom: 1px solid #000; }
  th.l { text-align: left; }
  th.r { text-align: right; }
  td { font-size: 10px; padding: 2px 0; }
  td.l { text-align: left; white-space: nowrap; overflow: hidden; text-overflow: clip; }
  td.r { text-align: right; white-space: nowrap; }
  .seats { font-size: 9px; font-style: italic; padding: 0 0 2px 2px; color: #333; }
  .recap { font-size: 11px; font-weight: 700; padding: 2px 2px; }
  .recap-row { display: flex; justify-content: space-between; padding: 2px 0; }
  .recap-bold { font-weight: 900; }
  .printed { text-align: center; font-size: 10px; font-weight: 700; padding: 3px 0; }
  @media print { body { margin: 0 auto; width: ${mm}mm !important; padding: 0 !important; } .border-box { border: 0 !important; width: ${mm}mm !important; } }
</style></head><body>
  <div class="border-box">
  <div class="hdr">
    <div class="brand-logo"><img src="${BORDEREAU_LOGO_SRC}" alt="SBTA"/></div>
    <div class="sub">Soc. Bonkoungou Transport de L'Agneby</div>
    <div class="phone">Tel ${escapeHtml(phoneLine || '07 69 94 88 03 / 07 99 68 60 03')}</div>
  </div>
  <div class="dsep"></div>
  <div class="title">BORDEREAU DE DEPART</div>
  <div class="dsep"></div>
  <div class="info"><span>GUICHET:</span><span>${escapeHtml(bord.station_name)}</span></div>
  <div class="info"><span>DEP N°:</span><span>${escapeHtml(String(bord.departure_number))}</span></div>
  <div class="info"><span>LIGNE:</span><span>${escapeHtml(bord.route_name)}</span></div>
  <div class="info"><span>DATE:</span><span>${escapeHtml(bord.departure_date)}</span></div>
  <div class="info"><span>HEURE:</span><span>${escapeHtml(bord.departure_time)}</span></div>
  <div class="sep"></div>
  <div class="info"><span>CAR:</span><span>${escapeHtml(bord.registration_number)}</span></div>
  <div class="info"><span>CHAUFFEUR:</span><span>${escapeHtml(bord.driver_name)}</span></div>
  <div class="sep"></div>
  ${convoySection}
  <div class="info"><span>NBRE PLACE:</span><span>${fmtNum(bord.total_seats)}</span></div>
  <div class="info"><span>VENDU(S):</span><span>${fmtNum(bord.seats_sold)}</span></div>
  <div class="info"><span>RESTANT(S):</span><span>${fmtNum(bord.seats_remaining)}</span></div>
  ${salesTable}
  <div class="sep"></div>
  <div class="recap">
    ${recapHtml}
  </div>
  <div class="dsep"></div>
  <div class="printed">Imprime le ${escapeHtml(bord.print_date)} a ${escapeHtml(bord.print_time)}</div>
  </div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}</script>
</body></html>`;
}

export async function printBordereauCourrierThermal(data: BordereauCourrierData): Promise<boolean> {
  const settings = await getPrintSettings();
  const logo = await loadCourrierLogoRaster(settings.width_mm === 80 ? 208 : 160);
  const escposData = buildBordereauCourrierESCPOS(data, settings, logo);

  const okSerial = await sendWebSerial(escposData);
  if (okSerial) return true;
  const okUsb = await sendWebUSB(escposData);
  if (okUsb) return true;
  const okQz = await sendQzTray(escposData, settings);
  if (okQz) return true;

  const bodyWidthMm = settings.width_mm - 4;
  const headerRow = `<tr><th>CODE</th><th>NATURE</th><th>DESIGNATION</th></tr>`;
  const dataRows = data.parcels.map(p => {
    const nat = ({autre:'AUTRE',electronique:'ELEC.',vetement:'VET.',document:'DOC.',alimentaire:'ALIM.',medicament:'MEDIC.',electromenager:'ELECTR',fragile:'FRAGILE'} as Record<string,string>)[p.nature] ?? 'AUTRE';
    return `<tr><td>${(p.parcel_code||'').toUpperCase()}</td><td>${nat}</td><td>${(p.content_description||'').toUpperCase()}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bordereau Courrier</title><style>
  @page { size: ${settings.width_mm}mm auto; margin: 0; }
  * { font-family: 'Courier New', monospace; font-size: 11px; font-weight: 600; color: #000; margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${bodyWidthMm}mm; margin: 0 auto; }
  h1 { font-size: 14px; text-align: center; font-weight: bold; }
  h2 { font-size: 12px; text-align: center; font-weight: bold; }
  .logo { display: block; width: 80px; max-width: 42%; height: auto; margin: 0 auto 2px; }
  .info { font-size: 11px; }
  .info b { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th, td { border: 1px solid #000; padding: 1px 3px; font-size: 10px; text-align: left; word-break: break-word; }
  th { font-weight: bold; }
  .sep { border-top: 1px solid #000; margin: 2px 0; }
  .total { font-weight: bold; font-size: 12px; }
  .footer { text-align: center; font-size: 10px; }
</style></head><body>
  <img class="logo" src="${COURRIER_LOGO_SRC}" alt="SBTA" />
  <h2>${data.station_name.toUpperCase()}</h2>
  ${data.station_phone ? `<div class="footer">Tel ${data.station_phone}</div>` : ''}
  <div class="sep"></div>
  <h1>BORDEREAU COURRIER</h1>
  <div class="sep"></div>
  <div class="info"><b>DESTINATION:</b> ${data.destination.toUpperCase()}</div>
  <div class="info"><b>DATE:</b> ${data.date}</div>
  <div class="info"><b>MATRICULE:</b> ${(data.bus_registration || '—').toUpperCase()}</div>
  <div class="sep"></div>
  <h2>CHAUFFEUR</h2>
  <h2>${(data.driver_name || '—').toUpperCase()}</h2>
  <div class="sep"></div>
  <h2>LISTE COLIS</h2>
  <table><thead>${headerRow}</thead><tbody>${dataRows}</tbody></table>
  <div class="sep"></div>
  <div class="total">TOTAL COLIS : ${data.parcels.length}</div>
  <div class="sep"></div>
  <div class="footer">Imprime le ${data.print_date} a ${data.print_time}</div>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},600);}</script>
</body></html>`;

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

export async function printBordereauDepartThermal(data: PrintBordereauDepartData): Promise<boolean> {
  const settings = await getPrintSettings();
  const logo = await loadBordereauLogoRaster(settings.width_mm === 80 ? 208 : 160);
  const escposData = buildBordereauDepartESCPOS(data, settings, logo);

  const okSerial = await sendWebSerial(escposData);
  if (okSerial) return true;
  const okUsb = await sendWebUSB(escposData);
  if (okUsb) return true;
  const okQz = await sendQzTray(escposData, settings);
  if (okQz) return true;

  const html = buildHTMLBordereauDepart(data, settings);
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
