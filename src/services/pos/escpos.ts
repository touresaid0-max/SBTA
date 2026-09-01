import type { TicketRecord, BagageRecord, DepartRecord } from './db';
import type { PrintSettings } from './db';

export interface PrintTicketData {
  ticket: TicketRecord;
  depart: DepartRecord;
  stationName?: string;
  chefGarePhone?: string | null;
  chefGareName?: string | null;
  guichetPhone?: string | null;
}

export interface PrintBagageData {
  bagage: BagageRecord;
  depart: DepartRecord;
  stationName?: string;
}

type PrintableType = 'ticket' | 'bagage';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function cmd(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function text(str: string): Uint8Array {
  const enc = new TextEncoder();
  return enc.encode(str);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function init(): Uint8Array {
  return cmd(ESC, 0x40);
}

function setAlign(align: 'left' | 'center' | 'right'): Uint8Array {
  const n = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  return cmd(ESC, 0x61, n);
}

function setBold(on: boolean): Uint8Array {
  return cmd(ESC, 0x45, on ? 1 : 0);
}

function setDouble(on: boolean): Uint8Array {
  return cmd(ESC, 0x21, on ? 0x30 : 0x00);
}

function setNormal(): Uint8Array {
  return cmd(ESC, 0x21, 0x00);
}

function lineFeed(n = 1): Uint8Array {
  return cmd(LF, ...Array(n - 1).fill(0x0a));
}

function cutPaper(): Uint8Array {
  return cmd(GS, 0x56, 0x00);
}

function dashLine(width: number): string {
  return '-'.repeat(width);
}

function qrCode(data: string): Uint8Array {
  const enc = new TextEncoder();
  const dataBytes = enc.encode(data);
  const len = dataBytes.length;
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;
  return concat(
    cmd(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...dataBytes),
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x33),
    cmd(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30),
  );
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function padLeft(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return ' '.repeat(width - str.length) + str;
}
void padLeft;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

export function buildTicketESCPOS(data: PrintTicketData, settings: PrintSettings): Uint8Array {
  const w = settings.width_mm === 80 ? 42 : 32;
  const { ticket, depart, stationName } = data;

  const parts: Uint8Array[] = [init()];

  // Header (custom)
  for (const line of settings.header_lines) {
    parts.push(setAlign('center'), text(line), lineFeed());
  }
  parts.push(setAlign('center'), setBold(true), text('SBTA TRANSPORT'), lineFeed());
  parts.push(setBold(false), text(stationName ?? 'Gare'), lineFeed());

  // Contact phones from Chef de Gare and Guichet profiles
  if (data.chefGarePhone) {
    const chefLine = data.chefGareName
      ? `${data.chefGarePhone} Chef: ${data.chefGareName}`
      : `${data.chefGarePhone} Chef de Gare`;
    parts.push(text(chefLine), lineFeed());
  }
  if (data.guichetPhone) {
    parts.push(text(`${data.guichetPhone} Guichet`), lineFeed());
  }

  parts.push(text(dashLine(w)), lineFeed());

  parts.push(text(`${padRight('Gare:', 12)}${stationName ?? '-'}`), lineFeed());
  parts.push(text(`${padRight('Ligne:', 12)}${depart.route_name ?? '-'}`), lineFeed());
  parts.push(text(`${padRight('Destination:', 12)}${ticket.destination}`), lineFeed());
  parts.push(text(`${padRight('N° Siège:', 12)}${ticket.seat_number}`), lineFeed());
  parts.push(text(`${padRight('Climatisé:', 12)}${ticket.is_ac ? 'OUI' : 'NON'}`), lineFeed());

  if (ticket.is_reduced) {
    parts.push(setBold(true), text('  ** REDUCTION **'), lineFeed(), setBold(false));
  }
  if (ticket.is_reported) {
    parts.push(setBold(true), text('  ** TICKET REPORTE **'), lineFeed(), setBold(false));
  }

  parts.push(text(dashLine(w)), lineFeed());

  // Price
  parts.push(setDouble(true), text(`${padRight('Tarif:', 12)}`), text(`${ticket.price} FCFA`), lineFeed());
  parts.push(setNormal(), lineFeed());

  // Ticket number
  parts.push(setBold(true), text(`${padRight('N° Ticket:', 12)}`), text(ticket.ticket_number), lineFeed(), setBold(false));

  // Date/time
  parts.push(text(`${padRight('Date:', 12)}${formatDateTime(depart.departure_datetime)}`), lineFeed());
  parts.push(text(`${padRight('Départ N°:', 12)}${depart.route_number} (${depart.route_name ?? ''})`), lineFeed());

  parts.push(text(dashLine(w)), lineFeed());

  // QR code with ticket number
  parts.push(qrCode(ticket.ticket_number), lineFeed());

  // Footer (custom)
  parts.push(setAlign('center'));
  for (const line of settings.footer_lines) {
    parts.push(text(line), lineFeed());
  }
  parts.push(text('Bon voyage!'), lineFeed());

  parts.push(lineFeed(2));
  if (settings.auto_cut) parts.push(cutPaper());

  return concat(...parts);
}

export function buildBagageESCPOS(data: PrintBagageData, settings: PrintSettings): Uint8Array {
  const w = settings.width_mm === 80 ? 42 : 32;
  const { bagage, depart, stationName } = data;

  const parts: Uint8Array[] = [init()];

  // Header
  for (const line of settings.header_lines) {
    parts.push(setAlign('center'), text(line), lineFeed());
  }
  parts.push(setAlign('center'), setBold(true), text('SBTA TRANSPORT'), lineFeed());
  parts.push(setBold(false), text(stationName ?? 'Gare'), lineFeed());
  parts.push(text(dashLine(w)), lineFeed());

  // Body
  parts.push(setAlign('left'), setBold(true), text('RECU BAGAGE'), lineFeed(), setBold(false));

  parts.push(text(`${padRight('N° Bagage:', 14)}${bagage.bagage_number}`), lineFeed());

  if (bagage.with_ticket && bagage.ticket_number) {
    parts.push(text(`${padRight('Ticket lié:', 14)}${bagage.ticket_number}`), lineFeed());
  }

  parts.push(text(`${padRight('Destination:', 14)}${bagage.destination}`), lineFeed());
  parts.push(text(`${padRight('Prix:', 14)}${bagage.price} FCFA`), lineFeed());
  parts.push(text(`${padRight('Car:', 14)}${bagage.car_plate || depart.bus_plate || '-'}`), lineFeed());

  if (bagage.description) {
    parts.push(text(`${padRight('Description:', 14)}${bagage.description}`), lineFeed());
  }
  if (bagage.owner_name) {
    parts.push(text(`${padRight('Nom:', 14)}${bagage.owner_name}`), lineFeed());
  }
  if (bagage.owner_phone) {
    parts.push(text(`${padRight('Contact:', 14)}${bagage.owner_phone}`), lineFeed());
  }

  parts.push(text(dashLine(w)), lineFeed());
  parts.push(text(`${padRight('Date:', 14)}${formatDateTime(bagage.created_at)}`), lineFeed());
  parts.push(text(`${padRight('Départ N°:', 14)}${depart.route_number} (${depart.route_name ?? ''})`), lineFeed());

  parts.push(text(dashLine(w)), lineFeed());

  // QR with bagage number
  parts.push(qrCode(bagage.bagage_number), lineFeed());

  // Footer
  parts.push(setAlign('center'));
  for (const line of settings.footer_lines) {
    parts.push(text(line), lineFeed());
  }

  parts.push(lineFeed(2));
  if (settings.auto_cut) parts.push(cutPaper());

  return concat(...parts);
}

export function buildESCPOS(
  type: PrintableType,
  data: PrintTicketData | PrintBagageData,
  settings: PrintSettings,
): Uint8Array {
  if (type === 'ticket') return buildTicketESCPOS(data as PrintTicketData, settings);
  return buildBagageESCPOS(data as PrintBagageData, settings);
}
