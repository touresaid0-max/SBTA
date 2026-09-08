import type { TicketRecord, BagageRecord, DepartRecord } from './db';
import type { PrintSettings } from './db';

export interface PrintTicketData {
  ticket: TicketRecord;
  depart: DepartRecord;
  stationName?: string;
  phoneLine?: string;
}

export interface PrintBagageData {
  bagage: BagageRecord;
  depart: DepartRecord;
  stationName?: string;
  phoneLine?: string;
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
  const innerW = w - 2;
  const { ticket, depart, stationName } = data;

  const parts: Uint8Array[] = [init()];
  const vLine = (content: string): string => `|${content.padEnd(innerW).slice(0, innerW)}|`;
  for (const line of settings.header_lines) {
    parts.push(setAlign('center'), text(line), lineFeed());
  }
  parts.push(setAlign('center'), setBold(true), text('SBTA TRANSPORT'), lineFeed());
  parts.push(setBold(false), text('Societe Bonkoungou'), lineFeed());
  parts.push(text('Transport de l\'Agnely'), lineFeed());
  if (data.phoneLine) {
    parts.push(setBold(true), text(`Tel ${data.phoneLine}`), lineFeed(), setBold(false));
  }
  parts.push(text(stationName ?? 'Gare'), lineFeed());
  parts.push(text(`+${'-'.repeat(innerW)}+`), lineFeed());

  // Body — compact: combine fields on the same line to halve ticket length
  parts.push(setAlign('left'));
  const routeNameFull = (depart.route_name ?? '-');
  const routeName = routeNameFull.slice(0, innerW - 8);
  parts.push(setBold(true), text(vLine(`${padRight('Ligne:', 8)}${routeName}`)), lineFeed(), setBold(false));
  if (routeNameFull.length > innerW - 8) {
    parts.push(text(vLine(routeNameFull.slice(innerW - 8))), lineFeed());
  }
  const depLabel = `Dep.${depart.route_number ?? '-'}`;
  const dateShort = formatDateTime(depart.departure_datetime).slice(0, 10);
  parts.push(text(vLine(`${padRight(depLabel, 14)}${dateShort}`)), lineFeed());

  const seatStr = String(ticket.seat_number ?? '-');
  const tarifPart = `${ticket.price} F`;
  const seatLine = `${padRight('Siege:', 8)}${seatStr}`;
  const seatPad = Math.max(innerW - tarifPart.length, seatLine.length + 2);
  if (seatLine.length <= seatPad) {
    parts.push(setDouble(true), text(vLine(padRight(seatLine, innerW - tarifPart.length) + tarifPart)), lineFeed(), setNormal());
  } else {
    parts.push(setDouble(true), text(vLine(padRight(seatLine, innerW))), lineFeed(), text(vLine(padRight(tarifPart, innerW))), lineFeed(), setNormal());
  }

  const carStr = (depart.bus_plate ?? '-').slice(0, 14);
  const ticketStr = ticket.ticket_number;
  const carLine = `${padRight('Car:', 5)}${padRight(carStr, 10)}N:${ticketStr}`;
  if (carLine.length <= innerW) {
    parts.push(setBold(true), text(vLine(carLine)), lineFeed(), setBold(false));
  } else {
    parts.push(setBold(true), text(vLine(`${padRight('Car:', 5)}${carStr}`)), lineFeed(), text(vLine(`N:${ticketStr.slice(0, innerW)}`)), lineFeed(), setBold(false));
    if (ticketStr.length > innerW - 2) {
      parts.push(text(vLine(ticketStr.slice(innerW - 2))), lineFeed());
    }
  }

  if (ticket.is_reduced) {
    parts.push(setBold(true), text(vLine('** REDUCTION APPLIQUEE **')), lineFeed(), setBold(false));
  }
  if (ticket.is_reported) {
    parts.push(setBold(true), text(vLine('** TICKET REPORTE **')), lineFeed(), setBold(false));
  }

  parts.push(text(`+${'-'.repeat(innerW)}+`), lineFeed());

  parts.push(setAlign('center'));
  for (const line of settings.footer_lines) {
    parts.push(text(line), lineFeed());
  }
  parts.push(text('Bon voyage!'), lineFeed());

  parts.push(lineFeed(1));
  parts.push(text('='.repeat(w)), lineFeed());
  parts.push(text('  *  *  *  TEAR HERE  *  *  *  '), lineFeed());
  parts.push(text('='.repeat(w)), lineFeed());

  // Souche header
  parts.push(setAlign('center'), setBold(true), text('SOUCHE'), lineFeed(), setBold(false));

  parts.push(setAlign('left'));
  parts.push(setBold(true), text(vLine(`${padRight('Ligne:', 8)}${routeName}`)), lineFeed(), setBold(false));
  if (routeNameFull.length > innerW - 8) {
    parts.push(text(vLine(routeNameFull.slice(innerW - 8))), lineFeed());
  }
  parts.push(text(vLine(`${padRight(depLabel, 14)}${dateShort}`)), lineFeed());
  if (seatLine.length <= seatPad) {
    parts.push(setDouble(true), text(vLine(padRight(seatLine, innerW - tarifPart.length) + tarifPart)), lineFeed(), setNormal());
  } else {
    parts.push(setDouble(true), text(vLine(padRight(seatLine, innerW))), lineFeed(), text(vLine(padRight(tarifPart, innerW))), lineFeed(), setNormal());
  }
  if (carLine.length <= innerW) {
    parts.push(setBold(true), text(vLine(carLine)), lineFeed(), setBold(false));
  } else {
    parts.push(setBold(true), text(vLine(`${padRight('Car:', 5)}${carStr}`)), lineFeed(), text(vLine(`N:${ticketStr.slice(0, innerW)}`)), lineFeed(), setBold(false));
    if (ticketStr.length > innerW - 2) {
      parts.push(text(vLine(ticketStr.slice(innerW - 2))), lineFeed());
    }
  }

  if (ticket.is_reduced) {
    parts.push(setBold(true), text(vLine('** REDUCTION APPLIQUEE **')), lineFeed(), setBold(false));
  }
  if (ticket.is_reported) {
    parts.push(setBold(true), text(vLine('** TICKET REPORTE **')), lineFeed(), setBold(false));
  }

  parts.push(text(`+${'-'.repeat(innerW)}+`), lineFeed());

  // Footer (souche)
  parts.push(setAlign('center'));
  for (const line of settings.footer_lines) {
    parts.push(text(line), lineFeed());
  }

  parts.push(lineFeed(1));
  if (settings.auto_cut) parts.push(cutPaper());

  return concat(...parts);
}

export function buildBagageESCPOS(data: PrintBagageData, settings: PrintSettings): Uint8Array {
  const w = settings.width_mm === 80 ? 42 : 32;
  const lblW = 11;
  const { bagage, depart, stationName } = data;

  const parts: Uint8Array[] = [init()];

  // Header — compact: SBTA + station on same line when possible
  for (const line of settings.header_lines) {
    parts.push(setAlign('center'), text(line), lineFeed());
  }
  parts.push(setAlign('center'), setBold(true), text('SBTA TRANSPORT'), lineFeed(), setBold(false));
  parts.push(text(stationName ?? 'Gare'), lineFeed());
  if (data.phoneLine) {
    parts.push(setBold(true), text(`Tel ${data.phoneLine}`), lineFeed(), setBold(false));
  }
  parts.push(text(dashLine(w)), lineFeed());

  // Title
  parts.push(setAlign('center'), setBold(true), text('RECU BAGAGE'), lineFeed(), setBold(false));

  // Body — combine fields on same lines to reduce length
  parts.push(setAlign('left'));

  const bagNum = bagage.bagage_number ?? '-';
  const bagLine = `${padRight('N°:', lblW)}${bagNum}`;
  const priceStr = `${bagage.price} F`;
  if (bagLine.length + priceStr.length + 1 <= w) {
    parts.push(text(`${padRight(bagLine, w - priceStr.length)}${priceStr}`), lineFeed());
  } else {
    parts.push(text(bagLine.slice(0, w)), lineFeed());
    parts.push(text(padRight(priceStr, w)), lineFeed());
  }

  if (bagage.with_ticket && bagage.ticket_number) {
    parts.push(text(`${padRight('Ticket:', lblW)}${bagage.ticket_number}`.slice(0, w)), lineFeed());
  }

  // Destination — label on its own short line, city on next line if too long
  const destFull = bagage.destination ?? '-';
  const destLine = `${padRight('Dest:', lblW)}${destFull}`;
  if (destLine.length <= w) {
    parts.push(text(destLine), lineFeed());
  } else {
    parts.push(text(padRight('Destination:', w)), lineFeed());
    parts.push(text(destFull.slice(0, w)), lineFeed());
  }

  const carStr = (bagage.car_plate || depart.bus_plate || '-').slice(0, w - lblW);
  parts.push(text(`${padRight('Car:', lblW)}${carStr}`), lineFeed());

  if (bagage.owner_name) {
    parts.push(text(`${padRight('Nom:', lblW)}${bagage.owner_name}`.slice(0, w)), lineFeed());
  }
  if (bagage.owner_phone) {
    parts.push(text(`${padRight('Tel:', lblW)}${bagage.owner_phone}`.slice(0, w)), lineFeed());
  }
  if (bagage.description) {
    parts.push(text(`${padRight('Desc:', lblW)}${bagage.description}`.slice(0, w)), lineFeed());
  }

  parts.push(text(dashLine(w)), lineFeed());
  parts.push(text(`${padRight('Date:', lblW)}${formatDateTime(bagage.created_at)}`), lineFeed());
  parts.push(text(`${padRight('Dep:', lblW)}${depart.route_number} ${depart.route_name ?? ''}`.slice(0, w)), lineFeed());

  // QR compact
  parts.push(qrCode(bagage.bagage_number), lineFeed());

  // Footer — single feed
  parts.push(setAlign('center'));
  for (const line of settings.footer_lines) {
    parts.push(text(line), lineFeed());
  }

  parts.push(lineFeed(1));
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
