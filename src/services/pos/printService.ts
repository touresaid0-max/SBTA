import { db, type PrintSettings, type TicketRecord, type BagageRecord, type DepartRecord } from './db';
import { buildESCPOS, buildTicketESCPOS, buildBagageESCPOS, buildTpeBagageESCPOS, buildRecettesESCPOS, buildBordereauDepartESCPOS, buildBordereauCourrierESCPOS, buildRamassageReportESCPOS, concat, type PrintRamassageReportData, type PrintTicketData, type PrintBagageData, type PrintRecettesData, type PrintBordereauDepartData, type RasterImage } from './escpos';
import { getPrintCustomization, type PrintCustomization } from '../printCustomization';
import { setPrintingGuard } from '@/store/authStore';
import { formatPhoneCI } from '@/utils/phoneCI';
import type { BordereauDepartData } from '@/types/counter.types';
import type { BordereauCourrierData } from '@/utils/printBordereau';
import { printLogoSrc, withPrintLogos } from './printLogos';
import { trustedNow, trustedNowIso } from '@/services/offline/deviceClock';

export type { PrintTicketData, PrintBagageData, PrintRecettesData, PrintBordereauDepartData, PrintRamassageReportData };

const TICKET_LOGO_SRC = '/logosbta001.JPG';
const BAGAGE_LOGO_SRC = '/logosbta001.JPG';

const LOGO_WAIT_MS = 3_000;

async function loadLogoRaster(src: string, widthDots: number): Promise<RasterImage | null> {
  try {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Logo introuvable'));
    });
    // The copy kept on the device when known: the logo is printed without network too
    img.src = printLogoSrc(src);
    if (img.complete && img.naturalWidth > 0) {
      await img.decode().catch(() => undefined);
    } else {
      // A logo not kept on the device, on a line cut without the network knowing it, never
      // finished loading: the ticket waited for it. Printed without the logo after this delay.
      await withTimeout(loaded, LOGO_WAIT_MS, undefined);
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
  /** Several tickets sent as one print job (multi-seat sale) */
  tickets?: TicketRecord[];
  bagage?: BagageRecord;
  depart: DepartRecord;
  stationName?: string;
  phoneLine?: string;
  tpe?: { notice: string | null; provisional: boolean };
  duplicate?: boolean;
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

function buildHTMLTicketContainer(data: PrintTicketData, customization: PrintCustomization): string {
  const { ticket, depart, phoneLine: overridePhone, duplicate } = data;
  const phoneLine = overridePhone || customization.bus_ticket_phones[0] || 'Tel 01 14 34 60 / 01 14 34 87';
  const customNotes = customization.bus_ticket_notes;

  const routeParts = (depart.route_name ?? '').split(/\s*[-–—]\s*/);
  const originCity = (routeParts[0] ?? 'ABIDJAN').toUpperCase().trim();
  const destCity   = (ticket.destination || routeParts[routeParts.length - 1] || '').toUpperCase().trim();
  const seatStr    = ticket.seat_number ? String(ticket.seat_number) : '—';
  const tarifStr   = ticket.price.toLocaleString('fr-FR') + ' f';
  const carPlate   = escapeHtml((depart.bus_plate ?? '—').toUpperCase());
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

  const nowD = trustedNow();
  const printedAt = `${String(nowD.getDate()).padStart(2,'0')}/${String(nowD.getMonth()+1).padStart(2,'0')}/${nowD.getFullYear()} ${String(nowD.getHours()).padStart(2,'0')}:${String(nowD.getMinutes()).padStart(2,'0')}:${String(nowD.getSeconds()).padStart(2,'0')}`;

  const reducedBadge = ticket.is_reduced ? `<div class="badge">** REDUCTION APPLIQUEE **</div>` : '';
  const reportedBadge = ticket.is_reported ? `<div class="badge">** TICKET REPORTE **</div>` : '';
  const duplicateBadge = duplicate ? `<div class="badge">*** DUPLICATA ***</div>` : '';

  const block = (isSouche: boolean, isFirst: boolean) => `
<div class="ticket-block${isFirst ? ' first' : ' last'}">
  ${!isSouche ? `
  <div class="header">
    <div class="brand">
      <div class="brand-logo"><img src="${TICKET_LOGO_SRC}" alt="SBTA"/></div>
      <div class="brand-sub">Société Bonkoungou Transport de L&apos;Agneby</div>
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
      <span class="lbl">SIEGE&nbsp;&nbsp;<b class="seat-num">${escapeHtml(seatStr)}</b></span>
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
  ${reducedBadge}${reportedBadge}${duplicateBadge}
  ${!isSouche ? `
  ${customNotes.map(note => `<div class="section notes"><div class="note">${escapeHtml(note)}</div></div>`).join('')}
  ` : ''}
  <div class="footer">
    <span>V10&nbsp;&nbsp;Imprimer le :</span>
    <span>${escapeHtml(printedAt)}</span>
  </div>
</div>`;

  return `<div class="ticket-container">
    ${block(false, true)}
    <div class="tear-zone">✂ ✂ ✂</div>
    ${block(true, false)}
  </div>`;
}

/** One HTML document for one or more tickets — a single print dialog, one page per ticket. */
async function buildHTMLTickets(list: PrintTicketData[], settings: PrintSettings): Promise<string> {
  const mm = settings.width_mm;
  const customization = await getPrintCustomization();
  const containers = list.map(data => buildHTMLTicketContainer(data, customization)).join('\n  <div class="ticket-break"></div>\n  ');

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
  /* The seat number, read by the passenger: the largest figure of the ticket (it was 11 px) */
  .seat-num { font-weight: 900; font-size: 28px; line-height: 1; }

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
    .ticket-break { break-after: page; page-break-after: always; height: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
  ${containers}
  <script>window.onload=function(){window.addEventListener('afterprint',function(){setTimeout(function(){window.close();},600);});}</script>
</body></html>`;
}

function buildHTMLBagage(data: PrintBagageData, settings: PrintSettings): string {
  const { bagage, depart, stationName, phoneLine } = data;
  const phone = phoneLine || '01 14 34 60 / 01 14 34 87';
  const nowIso = trustedNowIso();
  const printed = formatDateTime(nowIso).replace('H', ':');
  const departFmt = formatDateTime(depart.departure_datetime || nowIso);
  const [dDate, dTime] = departFmt.split(' ');
  const price = `${Number(bagage.price || 0).toLocaleString('fr-FR').replace(/\u202f/g, ' ')} F`;
  const stripStationLabel = (s: string) => s.replace(/^(?:GARE\s+SBTA\s+|GARE\s+SBTA[-–]\s*|GARE\s+|SBTA\s+)+/i, '').trim();
  const originCity = stripStationLabel((stationName || depart.station_name || '').toUpperCase().trim());
  const destCity = stripStationLabel((bagage.destination || '').toUpperCase().trim());
  const departNum = String(depart.route_number ?? depart.departure_number ?? '');
  const owner = (bagage.owner_name ?? '').toUpperCase();
  const contact = formatPhoneCI(bagage.owner_phone) || (bagage.owner_phone ?? '');
  const car = (bagage.car_plate || depart.bus_plate || '').toUpperCase();
  const bagNum = bagage.bagage_number ?? '';
  const seatRaw = bagage.with_ticket ? (bagage.linked_seat_number ?? '') : '';
  const seatStr = seatRaw !== '' && seatRaw !== null && seatRaw !== undefined ? String(seatRaw) : '0';
  const v = (s: string | number | null | undefined) => escapeHtml(String(s ?? ''));
  const bagagePrintWidth = settings.width_mm + 4;

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
  @page { size: ${bagagePrintWidth}mm auto; margin: 0; }
  * { font-family: 'Helvetica Neue Condensed', 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; font-stretch: condensed; margin: 0; padding: 0; box-sizing: border-box; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: #fff; }
  body { width: ${bagagePrintWidth}mm; margin: 0; padding: 0; font-size: 10.5px; font-weight: 600; line-height: 1.15; }
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
  .row.car-row .lbl { white-space: nowrap; }
  .row.car-row .val { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
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
  const departureDate = formatDateTime(depart.departure_datetime || trustedNowIso()).split(' ');
  const printed = formatDateTime(trustedNowIso());
  const stripStationLabel = (input: string): string => input.replace(/^(?:GARE\s+SBTA\s+|GARE\s+SBTA[-–]\s*|GARE\s+|SBTA\s+)+/i, '').trim();
  const origin = stripStationLabel((stationName || depart.station_name || '').toUpperCase()) || '—';
  const destination = stripStationLabel(value(bagage.destination).toUpperCase()) || '—';
  const departureNumber = value(depart.route_number) || value(depart.departure_number) || '—';
  const seat = bagage.with_ticket && value(bagage.linked_seat_number) ? value(bagage.linked_seat_number) : '—';
  const car = value(bagage.car_plate || depart.bus_plate).toUpperCase() || '—';
  const owner = value(bagage.owner_name).toUpperCase() || '—';
  const contact = formatPhoneCI(bagage.owner_phone) || value(bagage.owner_phone) || '—';
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

// ── Print pages reused ──
// Each ticket was printed in a new hidden page (iframe), removed afterwards. After thousands of
// tickets the browser was weighed down by all the pages created (measured: 19 ms per ticket on a
// fresh page, 217 ms after 1 920 tickets, with the same data; only a reload brought it back).
// A few print pages are now reused. A page is taken again only after PRINT_PAGE_REST_MS since its
// last ticket (the printer may still be taking that job, as when the page was removed after 1,5 s).
const PRINT_PAGE_REST_MS = 1500;
const MAX_IDLE_PRINT_PAGES = 120;
const idlePrintPages: { iframe: HTMLIFrameElement; freeAt: number }[] = [];

function takePrintPage(): HTMLIFrameElement {
  const now = Date.now();
  const i = idlePrintPages.findIndex(p => p.freeAt <= now && p.iframe.isConnected && p.iframe.contentWindow);
  if (i >= 0) return idlePrintPages.splice(i, 1)[0].iframe;
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  return iframe;
}

function releasePrintPage(iframe: HTMLIFrameElement): void {
  if (idlePrintPages.length >= MAX_IDLE_PRINT_PAGES) {
    setTimeout(() => iframe.remove(), PRINT_PAGE_REST_MS);
    return;
  }
  idlePrintPages.push({ iframe, freeAt: Date.now() + PRINT_PAGE_REST_MS });
}

async function printHTMLDocument(html: string): Promise<boolean> {
  const iframe = takePrintPage();

  return new Promise((resolve) => {
    const cw = iframe.contentWindow;
    const doc = cw?.document;
    if (!doc) { iframe.remove(); resolve(false); return; }
    // A reused page: open() replaces its previous ticket (and the listeners of that ticket)
    doc.open();
    doc.write(withPrintLogos(html));
    doc.close();

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      releasePrintPage(iframe);
      resolve(ok);
    };
    if (cw) cw.addEventListener('afterprint', () => finish(true), { once: true });

    // Printed as soon as the page is ready: loaded, and every image (the logo) loaded and decoded.
    // A fixed 300 ms wait came before each ticket: a series of 1 000 tickets waited 5 minutes for
    // nothing (measured 317 ms per ticket with an instant printer, 300 of them waiting). 3 s at most.
    const pageLoaded = new Promise<void>(resolve => {
      if (doc.readyState === 'complete') { resolve(); return; }
      cw?.addEventListener('load', () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    });
    const imageReady = (image: HTMLImageElement) => new Promise<void>(resolve => {
      const decoded = () => {
        if (typeof image.decode !== 'function') { resolve(); return; }
        image.decode().then(() => resolve(), () => resolve());
      };
      if (image.complete) { decoded(); return; }
      image.addEventListener('load', decoded, { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
    const withinLimit = <T,>(p: Promise<T>) => Promise.race([p, new Promise<void>(resolve => setTimeout(resolve, 3000))]);

    (async () => {
      try {
        await withinLimit(pageLoaded);
        await withinLimit(Promise.all(Array.from(doc.images).map(imageReady)));
        cw?.focus();
        cw?.print();
      } catch {
        finish(false);
        return;
      }
      setTimeout(() => finish(true), 2000);
    })();
  });
}

function payloadTickets(payload: PrintPayload): TicketRecord[] {
  return payload.tickets ?? (payload.ticket ? [payload.ticket] : []);
}

async function printBrowser(payload: PrintPayload, settings: PrintSettings): Promise<boolean> {
  let html: string;
  const ticketList = payloadTickets(payload);
  if (payload.type === 'ticket' && ticketList.length > 0) {
    html = await buildHTMLTickets(ticketList.map(ticket => ({ ticket, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine, duplicate: payload.duplicate })), settings);
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
      duplicate: data.duplicate,
    });
  },

  /** Print several tickets of the same départ as a single job (one dialog in browser mode). */
  async printTickets(data: Omit<PrintTicketData, 'ticket'> & { tickets: TicketRecord[] }): Promise<boolean> {
    if (data.tickets.length === 0) return true;
    return this._print({
      type: 'ticket',
      tickets: data.tickets,
      depart: data.depart,
      stationName: data.stationName,
      phoneLine: data.phoneLine,
      duplicate: data.duplicate,
    });
  },

  /**
   * Multi-seat sale: one ticket per seat, printed one after another in seat order,
   * each followed by a paper cut. Returns the tickets actually printed, so a failure
   * part-way leaves only the remaining tickets to resume (no ticket printed twice).
   */
  async printTicketsSequence(data: Omit<PrintTicketData, 'ticket'> & {
    tickets: TicketRecord[];
    /** Called as soon as each ticket is printed, before the next one: a series cut part-way
     *  (page reloaded, screen left) keeps the tickets already printed marked as printed. */
    onPrinted?: (ticket: TicketRecord) => Promise<void> | void;
  }): Promise<TicketRecord[]> {
    const markPrinted = async (ticket: TicketRecord) => {
      try { await data.onPrinted?.(ticket); } catch { /* marked again at the end of the series */ }
    };
    const ordered = [...data.tickets].sort((a, b) => a.seat_number - b.seat_number);
    if (ordered.length === 0) return [];
    const settings = await getPrintSettings();

    // The first ticket finds out quickly whether the thermal printer is there (1,5 s, 3 s for QZ
    // Tray). The next ones may wait: the printer is still printing the previous tickets and takes
    // the new ones as its buffer empties. With 1,5 s a long series stopped part-way, the rest unprinted.
    const NEXT_TICKET_WAIT_MS = 15_000;
    let send: ((bytes: Uint8Array, waitMs?: number) => Promise<boolean>) | null = null;
    if (settings.backend === 'webserial') send = (bytes, waitMs = 1500) => withTimeout(sendWebSerial(bytes), waitMs, false);
    if (settings.backend === 'webusb') send = (bytes, waitMs = 1500) => withTimeout(sendWebUSB(bytes), waitMs, false);
    if (settings.backend === 'qztray') send = (bytes, waitMs = 3000) => withTimeout(sendQzTray(bytes, settings), waitMs, false);

    if (send) {
      const logo = await loadTicketLogoRaster(settings.width_mm === 80 ? 288 : 224);
      const cutSettings = { ...settings, auto_cut: true };
      const printed: TicketRecord[] = [];
      for (const ticket of ordered) {
        const bytes = buildTicketESCPOS({ ticket, depart: data.depart, stationName: data.stationName, phoneLine: data.phoneLine }, cutSettings, logo);
        if (!(await send(bytes, printed.length > 0 ? NEXT_TICKET_WAIT_MS : undefined))) break;
        printed.push(ticket);
        await markPrinted(ticket);
      }
      // The thermal printer took some tickets: the rest is resumed, never sent to the browser too
      if (printed.length > 0) return printed;
    }

    // Browser (or no thermal printer reachable): one print job per ticket. The thermal
    // driver cuts at the end of each job, like a single-ticket sale; page breaks inside
    // one job are not cut, which left the tickets stuck together.
    const printed: TicketRecord[] = [];
    for (const ticket of ordered) {
      const ok = await printBrowser({
        type: 'ticket',
        ticket,
        depart: data.depart,
        stationName: data.stationName,
        phoneLine: data.phoneLine,
      }, settings);
      if (!ok) break;
      printed.push(ticket);
      await markPrinted(ticket);
    }
    return printed;
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
    const ticketList = payloadTickets(payload);
    if (payload.type === 'ticket' && ticketList.length > 0) {
      const logo = await loadTicketLogoRaster(settings.width_mm === 80 ? 288 : 224);
      escposData = concat(...ticketList.map(ticket =>
        buildTicketESCPOS({ ticket, depart: payload.depart, stationName: payload.stationName, phoneLine: payload.phoneLine, duplicate: payload.duplicate }, settings, logo)));
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

    // Try backends in order of preference.
    // A grouped job is larger: scale the timeouts so a slow send does not fall back to
    // the browser and print the tickets twice.
    const jobSize = Math.max(1, ticketList.length);
    if (settings.backend === 'webserial') {
      const ok = await withTimeout(sendWebSerial(escposData), 1500 * jobSize, false);
      if (ok) return true;
      // fall through to browser
    }

    if (settings.backend === 'webusb') {
      const ok = await withTimeout(sendWebUSB(escposData), 1500 * jobSize, false);
      if (ok) return true;
    }

    if (settings.backend === 'qztray') {
      const ok = await withTimeout(sendQzTray(escposData, settings), 3000 * jobSize, false);
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

  const nowD = trustedNow();
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

  const nowD = trustedNow();
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
    doc.write(withPrintLogos(html));
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
    doc.write(withPrintLogos(html));
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
  // The whole paper width (1 mm margin each side, instead of 2 mm): the 7 columns need it
  const bodyWidthMm = mm - 2;
  // Non-breaking spaces: an amount never splits over two lines
  const fmtNum = (n: number): string =>
    Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const fmt = (n: number): string => fmtNum(n) + '\u00a0F';
  // In the table: narrow non-breaking spaces, so that the space inside an amount is clearly
  // smaller than the gap between two columns (« 1 872 500 | 112 500 »)
  const fmtCell = (n: number): string => fmtNum(n).replace(/\u00a0/g, '\u202f');

  // One line per departure, 7 columns. The amounts overlapped in Courier (a wide font) on 54 mm:
  // the table now uses a narrow font and the whole width, and the registration is not cut.
  const rowsHtml = bordereau.rows.map(row => `<tr>
      <td class="immat">${escapeHtml((row.registration_number || '').toUpperCase())}</td>
      <td class="c">${escapeHtml(String(row.departure_number ?? ''))}</td>
      <td class="c">${escapeHtml(fmtNum(row.seats_sold))}</td>
      <td class="r">${escapeHtml(fmtCell(row.total_ticket))}</td>
      <td class="r">${escapeHtml(fmtCell(row.total_charges))}</td>
      <td class="r">${escapeHtml(fmtCell(row.solde_ticket))}</td>
      <td class="r">${escapeHtml(fmtCell(row.total_baggage))}</td>
    </tr>`).join('');

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
  table, table * { font-family: 'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', Arial, sans-serif; font-stretch: condensed; }
  th, td { white-space: nowrap; padding: 1px 0 1px 3px; }
  th:first-child, td:first-child { padding-left: 0; }
  th { font-size: 8px; font-weight: 800; border-bottom: 1px solid #000; text-align: right; }
  th.l { text-align: left; }
  th.c, td.c { text-align: center; }
  /* 9 px and 700: the heavier 900 widened the narrow font and the 7 columns no longer fitted */
  td { font-size: 9px; font-weight: 700; }
  td.immat { text-align: left; font-size: 8px; }
  td.r { text-align: right; }
  /* A dotted line between the amount columns: they can no longer be read as one number */
  td.r, th.r { border-left: 1px dotted #000; padding-left: 2px; padding-right: 1px; }
  tr.tot td { font-weight: 800; border-top: 1px solid #000; padding-top: 2px; }
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
        <th class="c">N°</th>
        <th class="c">SIEG</th>
        <th class="r">MT TIC</th>
        <th class="r">DEP R/P</th>
        <th class="r">SOLDE</th>
        <th class="r">BAG</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="tot">
        <td class="immat">TOTAUX</td>
        <td class="c">${bordereau.totals.departures}</td>
        <td class="c">${fmtNum(bordereau.totals.seats_sold)}</td>
        <td class="r">${fmtCell(bordereau.totals.total_ticket)}</td>
        <td class="r">${fmtCell(bordereau.totals.total_charges)}</td>
        <td class="r">${fmtCell(bordereau.totals.solde_ticket)}</td>
        <td class="r">${fmtCell(bordereau.totals.total_baggage)}</td>
      </tr>
    </tbody>
  </table>
  <script>
    // Without Arial Narrow on the device the table is wider than the paper: shrink it to the
    // width rather than let the columns overlap or be cut
    (function () {
      var t = document.querySelector('table');
      var k = t ? document.body.clientWidth / t.scrollWidth : 1;
      if (k < 1) t.style.zoom = String(k);
    })();
  </script>
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
    doc.write(withPrintLogos(html));
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
  /* Departure number, bus and driver read from afar (like the seat number of the ticket): a long
     value goes to the next line instead of being cut */
  .info-big { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; font-size: 11px; font-weight: 700; padding: 2px 0; }
  .info-big .v { margin-left: auto; text-align: right; font-size: 18px; font-weight: 900; line-height: 1.1; overflow-wrap: anywhere; }
  .info-big .v.xl { font-size: 28px; line-height: 1; }
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
  <div class="info-big"><span>DEP N°:</span><span class="v xl">${escapeHtml(String(bord.departure_number))}</span></div>
  <div class="info"><span>LIGNE:</span><span>${escapeHtml(bord.route_name)}</span></div>
  <div class="info"><span>DATE:</span><span>${escapeHtml(bord.departure_date)}</span></div>
  <div class="info"><span>HEURE:</span><span>${escapeHtml(bord.departure_time)}</span></div>
  <div class="sep"></div>
  <div class="info-big"><span>CAR:</span><span class="v">${escapeHtml(bord.registration_number)}</span></div>
  <div class="info-big"><span>CHAUFFEUR:</span><span class="v">${escapeHtml(bord.driver_name)}</span></div>
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
  // Texts typed by guichetiers (description…) are escaped: the page is written into a frame of the app
  const up = (s: string | null | undefined): string => escapeHtml(String(s ?? '').toUpperCase());
  const headerRow = `<tr><th>CODE</th><th>NATURE</th><th>DESIGNATION</th></tr>`;
  const dataRows = data.parcels.map(p => {
    const nat = ({autre:'AUTRE',electronique:'ELEC.',vetement:'VET.',document:'DOC.',alimentaire:'ALIM.',medicament:'MEDIC.',electromenager:'ELECTR',fragile:'FRAGILE'} as Record<string,string>)[p.nature] ?? 'AUTRE';
    return `<tr><td>${up(p.parcel_code)}</td><td>${nat}</td><td>${up(p.content_description)}</td></tr>`;
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
  <h2>${up(data.station_name)}</h2>
  ${data.station_phone ? `<div class="footer">Tel ${escapeHtml(data.station_phone)}</div>` : ''}
  <div class="sep"></div>
  <h1>BORDEREAU COURRIER</h1>
  <div class="sep"></div>
  <div class="info"><b>DESTINATION:</b> ${up(data.destination)}</div>
  <div class="info"><b>DATE:</b> ${escapeHtml(data.date)}</div>
  <div class="info"><b>MATRICULE:</b> ${up(data.bus_registration || '—')}</div>
  <div class="sep"></div>
  <h2>CHAUFFEUR</h2>
  <h2>${up(data.driver_name || '—')}</h2>
  <div class="sep"></div>
  <h2>LISTE COLIS</h2>
  <table><thead>${headerRow}</thead><tbody>${dataRows}</tbody></table>
  <div class="sep"></div>
  <div class="total">TOTAL COLIS : ${data.parcels.length}</div>
  <div class="sep"></div>
  <div class="footer">Imprime le ${escapeHtml(data.print_date)} a ${escapeHtml(data.print_time)}</div>
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
    doc.write(withPrintLogos(html));
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
    doc.write(withPrintLogos(html));
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
//  RAPPORT DES VENTES DE RAMASSAGE — impression thermique du guichet
//  Same layout as the model rapport_ventes_ramassage_thermique.pdf (80 mm roll, one block per
//  ramassage). The A4 table, the PDF and the Excel export of the report are not changed.
// ═══════════════════════════════════════════════════════════════════
function buildHTMLRamassageReport(data: PrintRamassageReportData, settings: PrintSettings): string {
  const e = escapeHtml;
  const row = (label: string, value: string, bold = false) =>
    `<div class="f${bold ? ' b' : ''}">${e(label)} : ${e(value)}</div>`;
  const blocks = data.rows.map((r, i) => `
  <div class="sep"></div>
  <div class="h">RAMASSAGE N° ${i + 1}</div>
  ${row('DATE', r.date)}
  ${row('HEURE', r.heure)}
  ${row('TYPE', r.type)}
  ${row('N° DÉPART', r.departure_number)}
  ${row('IMMATRICULATION', r.bus, true)}
  ${row('CHAUFFEUR', r.driver)}
  ${row('GARE', r.gare)}
  ${row('GUICHET', r.guichet)}
  ${row('VILLE / DESTINATION', r.destination, true)}
  ${row('SIÈGES', r.seats)}
  ${row('MONTANT', r.amount, true)}
  ${row('VALIDÉ PAR', r.validated_by)}`).join('');

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Rapport des ventes de ramassage</title>
<style>
  @page { size: ${settings.width_mm}mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${settings.width_mm}mm; background: #fff; color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 7.2pt; line-height: 1.5; padding: 0.5mm 4mm 6mm; }
  .logo { text-align: center; font-size: 15.5pt; font-weight: bold; line-height: 1.15; }
  .co { text-align: center; font-size: 6pt; font-weight: bold; margin-top: 1.2mm; }
  .title { text-align: center; font-size: 8.7pt; font-weight: bold; line-height: 1.2; margin-bottom: 3.2mm; }
  .sep { border-top: 1px dashed #000; margin: 1.4mm 0 0.4mm; }
  .h { text-align: center; font-size: 7.8pt; font-weight: bold; }
  .f { overflow-wrap: anywhere; }
  .b { font-weight: bold; }
  .end { text-align: center; font-weight: bold; }
  .gen { text-align: center; font-size: 6.2pt; }
</style></head>
<body>
  <div class="logo">SBTA</div>
  <div class="co">SOCIÉTÉ BONKOUNGOU TRANSPORT DE L'AGNEBY</div>
  <div class="title">RAPPORT DES VENTES DE RAMASSAGE</div>
  <div class="sep"></div>
  ${row('GARE', data.station_name, true)}
  ${row('PÉRIODE', `${data.period_from} au ${data.period_to}`)}
  ${row('NOMBRE DE RAMASSAGES', String(data.count))}
  ${row('TOTAL SIÈGES', data.total_seats)}
  ${row('MONTANT TOTAL', data.total_amount, true)}
  ${blocks}
  <div class="sep"></div>
  <div class="h">RÉCAPITULATIF</div>
  ${row('RAMASSAGES', String(data.count))}
  ${row('TOTAL SIÈGES', data.total_seats)}
  ${row('TOTAL ENCAISSÉ', data.total_amount, true)}
  <div class="sep"></div>
  <div class="end">Fin du rapport</div>
  <div class="gen">Document généré par SBTA</div>
</body></html>`;
}

/** Thermal print of the ramassage report: the printer directly if one is set up, else the browser at the roll width. */
export async function printRamassageReportThermal(data: PrintRamassageReportData): Promise<boolean> {
  const settings = await getPrintSettings();
  const escposData = buildRamassageReportESCPOS(data, settings);
  if (await withTimeout(sendWebSerial(escposData), 1500, false)) return true;
  if (await withTimeout(sendWebUSB(escposData), 1500, false)) return true;
  if (await withTimeout(sendQzTray(escposData, settings), 3000, false)) return true;
  return printHTMLDocument(buildHTMLRamassageReport(data, settings));
}
