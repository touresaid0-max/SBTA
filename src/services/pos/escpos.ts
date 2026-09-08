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
  if (isNaN(d.getTime())) return `--/--/---- 00H00`;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}H${mi}`;
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
  const w = 42;
  const innerW = w - 2;
  const { bagage, depart, stationName } = data;
  const parts: Uint8Array[] = [init()];
  const value = (input: string | number | null | undefined) => String(input ?? '-').trim() || '-';
  const price = `${Number(bagage.price || 0).toLocaleString('fr-FR').replace(/\u202f/g, ' ')} F`;
  const date = formatDateTime(bagage.created_at);
  const [datePart, timePart] = date.split(' ');
  const departure = `${value(depart.route_number)} ${value(depart.route_name).toUpperCase()}`;
  const destination = value(bagage.destination).toUpperCase();
  const owner = value(bagage.owner_name).toUpperCase();
  const description = value(bagage.description).toUpperCase();
  const car = value(bagage.car_plate || depart.bus_plate);
  const mode = bagage.with_ticket ? 'AVEC TICKET' : 'SANS SIEGE';
  const station = value(stationName || 'Gare');
  const line = (input = '') => [text(input.slice(0, w)), lineFeed()];
  const boxedRaw = (content: string) => `|${content.padEnd(innerW, ' ').slice(0, innerW)}|`;
  const boxed = (input = '') => line(boxedRaw(input.slice(0, innerW)));
  const boxedCenter = (input: string) => {
    const s = input.slice(0, innerW);
    const left = Math.floor((innerW - s.length) / 2);
    return line(boxedRaw(' '.repeat(Math.max(0, left)) + s));
  };
  const border = () => line(`+${'-'.repeat(innerW)}+`);
  const separator = () => line(boxedRaw('-'.repeat(innerW)));
  const row = (label: string, input: string | number) => {
    const right = value(input).slice(0, Math.max(1, innerW - label.length - 1));
    return boxed(`${label}${' '.repeat(Math.max(1, innerW - label.length - right.length))}${right}`);
  };
  const dateRow = () => {
    const left = `DATE    ${datePart}`;
    const right = `HEURE       ${timePart || '00H00'}`;
    return boxed(`${left}${' '.repeat(Math.max(1, innerW - left.length - right.length))}${right}`);
  };

  const renderTicket = (isSouche: boolean): void => {
    parts.push(setAlign('left'));
    parts.push(...border());
    parts.push(setAlign('center'), setDouble(true), setBold(true), ...boxedCenter('SBTA'), setNormal());
    parts.push(setBold(false), ...boxedCenter("Societe Bonkoungou Transport de L'Agneby"));
    parts.push(...boxedCenter(`Tel ${data.phoneLine || '01 14 34 60 / 01 14 34 87'}`));
    parts.push(...separator());
    parts.push(setAlign('center'), setBold(true), ...boxed(isSouche ? 'SOUCHE BAGAGE' : 'TICKET BAGAGE'), ...boxed(mode), setBold(false));
    parts.push(setAlign('left'), ...separator());
    parts.push(...row('N BAGAGE', bagage.bagage_number));
    if (bagage.with_ticket && bagage.ticket_number) parts.push(...separator(), ...row('TICKET', bagage.ticket_number));
    parts.push(...separator());
    parts.push(...row('DEPART', departure));
    parts.push(...separator());
    parts.push(...row('PRIX', price));
    parts.push(...separator());
    parts.push(...row('CAR', car));
    parts.push(...separator());
    parts.push(...dateRow());
    parts.push(...separator());
    parts.push(...row('PROPRIETAIRE', owner));
    parts.push(...row('CONTACT', value(bagage.owner_phone)));
    parts.push(...separator());
    parts.push(...boxed('DESCRIPTION'));
    parts.push(...boxed(description));
    parts.push(...separator());
    parts.push(setAlign('center'), setBold(true), ...boxed('OK'), setBold(false));
    parts.push(...boxed(station));
    if (!isSouche) {
      parts.push(...boxed('AUCUN REMBOURSEMENT N EST POSSIBLE APRES ENCAISSEMENT'));
      parts.push(...boxed('NB: PASSE UN DELAI DE 14 JOURS, SBTA N EST PAS RESPONSABLE EN CAS DE'));
      parts.push(...boxed('PERTE DE COLIS.'));
    }
    parts.push(setAlign('left'), ...border());
  };

  renderTicket(false);
  parts.push(setAlign('center'), ...line('DECOUPER ICI'));
  renderTicket(true);
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
