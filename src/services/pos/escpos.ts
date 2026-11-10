import type { TicketRecord, BagageRecord, DepartRecord } from './db';
import type { PrintSettings } from './db';
import type { BordereauRecettesData, BordereauDepartData } from '@/types/counter.types';
import type { BordereauCourrierData } from '@/utils/printBordereau';
import { trustedNowIso } from '@/services/offline/deviceClock';
import { formatPhoneCI } from '@/utils/phoneCI';

export interface PrintTicketData {
  ticket: TicketRecord;
  depart: DepartRecord;
  stationName?: string;
  phoneLine?: string;
  /** Reprint authorized by the admin — printed with a DUPLICATA mention */
  duplicate?: boolean;
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

export function concat(...arrays: Uint8Array[]): Uint8Array {
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

function setFontB(): Uint8Array {
  return cmd(ESC, 0x21, 0x01);
}

function setDoubleFontB(): Uint8Array {
  return cmd(ESC, 0x21, 0x31);
}

function setDouble(on: boolean): Uint8Array {
  return cmd(ESC, 0x21, on ? 0x30 : 0x00);
}

function setNormal(): Uint8Array {
  return cmd(ESC, 0x21, 0x00);
}

/** Characters `factor` times wider and taller (GS !, 1 to 8); 1 goes back to the normal size. */
function setCharSize(factor: number): Uint8Array {
  const n = Math.min(8, Math.max(1, Math.round(factor))) - 1;
  return cmd(GS, 0x21, (n << 4) | n);
}

function setLineSpacing(spacing: number): Uint8Array {
  return cmd(ESC, 0x33, spacing);
}

function lineFeed(n = 1): Uint8Array {
  return cmd(LF, ...Array(n - 1).fill(0x0a));
}

function cutPaper(): Uint8Array {
  return cmd(GS, 0x56, 0x00);
}

export interface RasterImage {
  widthBytes: number;
  height: number;
  bits: Uint8Array;
}

function rasterImage(img: RasterImage): Uint8Array {
  const { widthBytes, height, bits } = img;
  return concat(
    cmd(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff),
    bits,
  );
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

export function buildTicketESCPOS(data: PrintTicketData, settings: PrintSettings, logo?: RasterImage | null): Uint8Array {
  const w = settings.width_mm === 80 ? 42 : 32;
  const innerW = w - 2;
  const { ticket, depart, stationName } = data;

  const parts: Uint8Array[] = [init()];
  const vLine = (content: string): string => `|${content.padEnd(innerW).slice(0, innerW)}|`;
  for (const line of settings.header_lines) {
    parts.push(setAlign('center'), text(line), lineFeed());
  }
  if (logo) {
    parts.push(setAlign('center'), rasterImage(logo), lineFeed());
  } else {
    parts.push(setAlign('center'), setBold(true), text('SBTA TRANSPORT'), lineFeed());
  }
  parts.push(setBold(false), text('Societe Bonkoungou'), lineFeed());
  parts.push(text('Transport de l\'Agnely'), lineFeed());
  if (data.phoneLine) {
    parts.push(setBold(true), text(`Tel ${data.phoneLine}`), lineFeed(), setBold(false));
  }
  parts.push(text(stationName ?? 'Gare'), lineFeed());
  parts.push(text(`+${'-'.repeat(innerW)}+`), lineFeed());

  // Body — compact: combine fields on the same line to halve ticket length
  parts.push(setAlign('left'));
  const routePartsTicket = (depart.route_name ?? '').split(/\s*[-–—]\s*/);
  const originCityTicket = (routePartsTicket[0] ?? '').toUpperCase().trim() || '-';
  const destCityTicket = (ticket.destination || routePartsTicket[routePartsTicket.length - 1] || '').toUpperCase().trim() || '-';
  const routeNameFull = `${originCityTicket} => ${destCityTicket}`;
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
  // The passenger's copy: the seat on its own line, three times larger (customers could not read
  // it), then the fare
  parts.push(setAlign('center'), setBold(true), setCharSize(3), text(`SIEGE ${seatStr}`), lineFeed(), setCharSize(1), setBold(false), setAlign('left'));
  parts.push(setDouble(true), text(vLine(padRight(`${padRight('Tarif:', 8)}${tarifPart}`, innerW))), lineFeed(), setNormal());

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
  if (data.duplicate) {
    parts.push(setBold(true), text(vLine('*** DUPLICATA ***')), lineFeed(), setBold(false));
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
  if (data.duplicate) {
    parts.push(setBold(true), text(vLine('*** DUPLICATA ***')), lineFeed(), setBold(false));
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

export function buildBagageESCPOS(data: PrintBagageData, settings: PrintSettings, logo?: RasterImage | null): Uint8Array {
  const w = settings.width_mm === 80 ? 52 : 44;
  const { bagage, depart, stationName } = data;
  const parts: Uint8Array[] = [init(), setLineSpacing(24), setFontB()];
  const value = (input: string | number | null | undefined) => String(input ?? '').trim();
  const price = `${Number(bagage.price || 0).toLocaleString('fr-FR').replace(/\u202f/g, ' ')} F`;
  const nowIso = trustedNowIso();
  const printed = formatDateTime(nowIso);
  const departDate = formatDateTime(depart.departure_datetime || nowIso);
  const [dDate, dTime] = departDate.split(' ');
  const stripStationLabel = (s: string) => s.replace(/^(?:GARE\s+SBTA\s+|GARE\s+SBTA[-–]\s*|GARE\s+|SBTA\s+)+/i, '').trim();
  const originCity = stripStationLabel((stationName || depart.station_name || '').toUpperCase().trim());
  const destCity = stripStationLabel((bagage.destination || '').toUpperCase().trim());
  const departNum = value(depart.route_number) || value(depart.departure_number);
  const owner = value(bagage.owner_name).toUpperCase();
  const contact = formatPhoneCI(bagage.owner_phone) || value(bagage.owner_phone);
  const car = value(bagage.car_plate || depart.bus_plate).toUpperCase();
  const bagNum = value(bagage.bagage_number);
  const seatRaw = bagage.with_ticket ? value(bagage.linked_seat_number) : '';
  const seat = seatRaw !== '' ? seatRaw : '0';

  const line = (s = '') => [text(s.slice(0, w)), lineFeed()];
  const center = (s: string) => {
    const t = s.slice(0, w);
    const pad = Math.max(0, Math.floor((w - t.length) / 2));
    return line(' '.repeat(pad) + t);
  };
  const separator = () => line('-'.repeat(w));
  const pair = (left: string, right: string) => {
    const rightStr = right.slice(0, Math.max(0, w - left.length - 1));
    const gap = Math.max(1, w - left.length - rightStr.length);
    return line(`${left}${' '.repeat(gap)}${rightStr}`);
  };
  const pairOrStack = (left: string, right: string) => {
    if (left.length + 1 + right.length <= w) {
      return pair(left, right);
    }
    return [...line(left), ...line(right)];
  };

  const renderBlock = (isSouche: boolean): void => {
    parts.push(setAlign('left'));
    if (logo) {
      parts.push(setAlign('center'), rasterImage(logo), lineFeed());
    } else {
      parts.push(setAlign('center'), setDoubleFontB(), setBold(true), ...line('SBTA'), setNormal(), setFontB(), setBold(false));
    }
    parts.push(setBold(true), ...center("Societe Bonkoungou Transport de L'Agneby"), setBold(false));
    parts.push(setBold(true), ...center(`Tel ${data.phoneLine || '01 14 34 60 / 01 14 34 87'}`), setBold(false));
    parts.push(...separator());
    if (isSouche) {
      parts.push(setAlign('center'), setDoubleFontB(), setBold(true), ...line('SOUCHE'), setNormal(), setFontB(), setBold(false));
    } else {
      parts.push(setAlign('center'), setDoubleFontB(), setBold(true), ...line('TICKET BAGAGE'), setNormal(), setFontB(), setBold(false));
    }
    parts.push(setAlign('left'), ...separator());
    parts.push(setBold(true), ...pair('DEPART :', `N° ${departNum}`), setBold(false));
    parts.push(setBold(true), ...center(`${originCity} => ${destCity}`), setBold(false));
    parts.push(...separator());
    parts.push(setBold(true), ...pair(`SIEGE : ${seat}`, `PRIX : ${price}`), setBold(false));
    parts.push(...separator());
    parts.push(setBold(true), ...pairOrStack(`CAR : ${car}`, `N°BAG : ${bagNum}`), setBold(false));
    parts.push(...separator());
    parts.push(setBold(true), ...pair(`DATE : ${dDate}`, `HEURE : ${dTime || ':'}`), setBold(false));
    parts.push(...separator());
    parts.push(setBold(true), ...line(`PROPRIETAIRE : ${owner}`), setBold(false));
    parts.push(setBold(true), ...line(`CONTACT : ${contact}`), setBold(false));
    parts.push(...separator());
    parts.push(setAlign('center'), ...line(`Imprime le : ${printed}`), setAlign('left'));
  };

  renderBlock(false);
  parts.push(setAlign('center'));
  parts.push(...line('- - - - - - - - - - - - - - - - - - - - - - - - '.slice(0, w)));
  parts.push(setBold(true), ...line('DECOUPER ICI'), setBold(false));
  parts.push(...line('- - - - - - - - - - - - - - - - - - - - - - - - '.slice(0, w)));
  renderBlock(true);
  parts.push(lineFeed(2));
  if (settings.auto_cut) parts.push(cutPaper());
  return concat(...parts);
}

export function buildTpeBagageESCPOS(data: PrintBagageData, settings: PrintSettings, logo?: RasterImage | null, notice?: string | null, provisional?: boolean): Uint8Array {
  const w = 32;
  const { bagage, depart, stationName } = data;
  const value = (input: string | number | null | undefined): string => String(input ?? '').trim();
  const price = `${Number(bagage.price || 0).toLocaleString('fr-FR').replace(/\u202f/g, ' ')} F`;
  const nowIso = trustedNowIso();
  const printed = formatDateTime(nowIso);
  const departDate = formatDateTime(depart.departure_datetime || nowIso);
  const [dDate, dTime] = departDate.split(' ');
  const stripStationLabel = (s: string): string => s.replace(/^(?:GARE\s+SBTA\s+|GARE\s+SBTA[-–]\s*|GARE\s+|SBTA\s+)+/i, '').trim();
  const origin = stripStationLabel((stationName || depart.station_name || '').toUpperCase()) || '—';
  const destination = stripStationLabel(value(bagage.destination).toUpperCase()) || '—';
  const departureNumber = value(depart.route_number) || value(depart.departure_number) || '—';
  const seat = bagage.with_ticket && value(bagage.linked_seat_number) ? value(bagage.linked_seat_number) : '—';
  const car = value(bagage.car_plate || depart.bus_plate).toUpperCase() || '—';
  const bagageNumber = value(bagage.bagage_number) || '—';
  const owner = value(bagage.owner_name).toUpperCase() || '—';
  const contact = formatPhoneCI(bagage.owner_phone) || value(bagage.owner_phone) || '—';
  const description = value(bagage.description).replace(/\s+/g, ' ');
  const parts: Uint8Array[] = [init(), setLineSpacing(20), setFontB()];
  const line = (input = ''): Uint8Array[] => [text(input.slice(0, w)), lineFeed()];
  const centered = (input: string): Uint8Array[] => {
    const clipped = input.slice(0, w);
    return line(' '.repeat(Math.max(0, Math.floor((w - clipped.length) / 2))) + clipped);
  };
  const separator = (): Uint8Array[] => line('-'.repeat(w));
  const pair = (left: string, right: string): Uint8Array[] => {
    const leftText = left.slice(0, w);
    const rightText = right.slice(0, w - leftText.length - 1);
    const gap = Math.max(1, w - leftText.length - rightText.length);
    return line(`${leftText}${' '.repeat(gap)}${rightText}`);
  };
  const render = (souche: boolean): void => {
    if (souche) {
      parts.push(setAlign('center'), setBold(true), ...line('SOUCHE'), setBold(false));
    } else if (logo) {
      parts.push(setAlign('center'), rasterImage(logo), lineFeed());
      parts.push(setBold(true), ...centered("Societe Bonkoungou Transport de L'Agneby"), setBold(false));
      parts.push(setBold(true), ...centered(`Tel ${data.phoneLine || '01 14 34 60 / 01 14 34 87'}`), setBold(false));
      parts.push(setBold(true), ...centered('TICKET BAGAGE'), setBold(false));
    } else {
      parts.push(setAlign('center'), setBold(true), ...centered('SBTA'), ...centered('TICKET BAGAGE'), setBold(false));
    }
    parts.push(setAlign('left'), ...separator());
    parts.push(setBold(true), ...pair('DEPART :', `N° ${departureNumber}`), setBold(false));
    parts.push(setBold(true), ...centered(`${origin} => ${destination}`), setBold(false), ...separator());
    parts.push(setBold(true), ...pair(`SIEGE : ${seat}`, `PRIX : ${price}`), setBold(false), ...separator());
    parts.push(setBold(true), ...line(`CAR : ${car}`), ...line(`N°BAG : ${bagageNumber}`), setBold(false), ...separator());
    parts.push(setBold(true), ...pair(`DATE : ${dDate}`, `HEURE : ${dTime || '—'}`), setBold(false));
    if (description && description !== '__deleted__') parts.push(...line(`DESCRIPTION : ${description}`));
    const declared = Number(bagage.declared_value || 0);
    if (declared > 0) parts.push(setBold(true), ...pair('VALEUR DECLAREE:', `${declared.toLocaleString('fr-FR').replace(/\u202f/g, ' ')} F`), setBold(false), ...separator());
    parts.push(...separator(), setBold(true), ...line(`PROPRIETAIRE : ${owner}`), ...line(`CONTACT : ${contact}`), setBold(false), ...separator());
    parts.push(setAlign('center'), ...line(`Imprime le : ${printed}`), setAlign('left'));
    if (notice && notice.trim()) {
      const words = notice.trim().split(/\s+/);
      let current = '';
      for (const word of words) {
        if (current.length + 1 + word.length <= w) {
          current = current ? current + ' ' + word : word;
        } else {
          parts.push(...line(current));
          current = word;
        }
      }
      if (current) parts.push(...line(current));
    }
  };

  const renderWithBanner = (souche: boolean): void => {
    render(souche);
    if (provisional) {
      parts.push(setAlign('center'), setBold(true), ...line('** EN ATTENTE **'), ...line('** DE PAIEMENT **'), setBold(false), setAlign('left'));
    }
  };
  renderWithBanner(false);
  parts.push(setAlign('center'), ...line('-'.repeat(w)), setBold(true), ...line('DECOUPER ICI'), setBold(false), ...line('-'.repeat(w)));
  renderWithBanner(true);
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

// ═══════════════════════════════════════════════════════════════════
//  BORDEREAU DETAILLE DES RECETTES  (ESC/POS 58 mm)
// ═══════════════════════════════════════════════════════════════════
export interface PrintRecettesData {
  data: BordereauRecettesData;
  phoneLine?: string;
}

export function buildRecettesESCPOS(data: PrintRecettesData, settings: PrintSettings, logo?: RasterImage | null): Uint8Array {
  const w = settings.width_mm === 80 ? 52 : 44;
  const { data: bordereau, phoneLine } = data;
  const parts: Uint8Array[] = [init(), setLineSpacing(20), setFontB()];

  const fmtNum = (n: number): string =>
    Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fmt = (n: number): string => fmtNum(n) + ' F';

  const line = (s = '') => [text(s.slice(0, w)), lineFeed()];
  const center = (s: string) => {
    const t = s.slice(0, w);
    const pad = Math.max(0, Math.floor((w - t.length) / 2));
    return line(' '.repeat(pad) + t);
  };
  const separator = () => line('-'.repeat(w));
  const doubleSep = () => line('='.repeat(w));

  // ── EN-TÊTE ──────────────────────────────────────────────────────
  if (logo) {
    parts.push(setAlign('center'), rasterImage(logo), lineFeed());
  } else {
    parts.push(setAlign('center'), setDoubleFontB(), setBold(true), ...line('SBTA'), setNormal(), setFontB(), setBold(false));
  }
  parts.push(setBold(true), ...center("Soc. Bonkoungou Transport de L'Agneby"), setBold(false));
  parts.push(setBold(true), ...center(`Tel ${phoneLine || '07 69 94 88 03 / 07 99 68 60 03'}`), setBold(false));
  parts.push(...doubleSep());
  parts.push(setAlign('center'), setBold(true), ...line('BORDEREAU DETAILLE'), setBold(false));
  parts.push(setAlign('center'), setBold(true), ...line('DES RECETTES'), setBold(false));
  parts.push(...doubleSep());

  // ── INFOS GUICHET / DU / AU ───────────────────────────────────────
  parts.push(setAlign('left'));
  const padR = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
  const dateRange = bordereau.date_from === bordereau.date_to
    ? bordereau.date_from
    : `${bordereau.date_from} au ${bordereau.date_to}`;
  parts.push(setBold(true), ...line(`${padR('GUICHET:', 10)}${(bordereau.station_name || '').slice(0, w - 10)}`), setBold(false));
  parts.push(setBold(true), ...line(`${padR('DU:', 10)}${(bordereau.date_from || '').slice(0, w - 10)}`), setBold(false));
  parts.push(setBold(true), ...line(`${padR('AU:', 10)}${(bordereau.date_to || '').slice(0, w - 10)}`), setBold(false));
  parts.push(...separator());

  // ── TABLEAU ───────────────────────────────────────────────────────
  // Seven fixed columns did not fit in the width: amounts were cut (a balance of 1 760 000
  // printed « 1 760 0 ») or glued together. Each departure now takes two lines: the bus, then
  // its three amounts in columns wide enough for any amount (about 14 characters each).
  const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) : s;
  // Never cuts an amount: a wider value only pushes the line
  const rightAlign = (s: string, max: number) => s.length >= max ? s : ' '.repeat(max - s.length) + s;

  const third = Math.floor(w / 3);
  const colWidths = [w - 2 * third, third, third];
  const amounts = (ticket: string, charges: string, solde: string) =>
    rightAlign(ticket, colWidths[0]) + rightAlign(charges, colWidths[1]) + rightAlign(solde, colWidths[2]);
  const places = (n: number) => `${fmtNum(n)} place${n > 1 ? 's' : ''}`;
  const bag = (n: number) => (n > 0 ? ` Bag ${fmtNum(n)}` : '');

  parts.push(setBold(true), ...line(amounts('TICKETS', 'DEPENSES', 'SOLDE')), setBold(false));
  parts.push(...separator());

  for (const row of bordereau.rows) {
    const bus = (row.registration_number || '-').toUpperCase();
    const head = `${bus} N°${row.departure_number ?? ''} ${places(row.seats_sold)}${bag(row.total_baggage)}`;
    parts.push(setBold(true), ...line(truncate(head, w)), setBold(false));
    parts.push(...line(amounts(fmtNum(row.total_ticket), fmtNum(row.total_charges), fmtNum(row.solde_ticket))));
  }

  parts.push(...separator());

  // TOTAUX: same two lines, in bold
  const n = bordereau.totals.departures;
  const totHead = `TOTAUX ${n} depart${n > 1 ? 's' : ''} ${places(bordereau.totals.seats_sold)}${bag(bordereau.totals.total_baggage)}`;
  parts.push(setBold(true), ...line(truncate(totHead, w)));
  parts.push(...line(amounts(
    fmtNum(bordereau.totals.total_ticket),
    fmtNum(bordereau.totals.total_charges),
    fmtNum(bordereau.totals.solde_ticket),
  )), setBold(false));

  parts.push(...doubleSep());

  // ── RÉCAPITULATIF ─────────────────────────────────────────────────
  parts.push(setAlign('left'));
  const recap = (label: string, val: string, bold = false) => {
    const v = truncate(val, w - label.length - 1);
    const gap = Math.max(1, w - label.length - v.length);
    if (bold) parts.push(setBold(true));
    parts.push(...line(`${label}${' '.repeat(gap)}${v}`));
    if (bold) parts.push(setBold(false));
  };

  recap('TOTAL TICKETS:', fmt(bordereau.totals.total_ticket), true);
  if (bordereau.totals.total_rations > 0)
    recap('  RATIONS:', fmt(bordereau.totals.total_rations));
  if (bordereau.totals.total_carburant > 0)
    recap('  CARBURANT:', fmt(bordereau.totals.total_carburant));
  if (bordereau.totals.total_peages > 0)
    recap('  PEAGES:', fmt(bordereau.totals.total_peages));
  if (bordereau.totals.total_autres > 0)
    recap('  AUTRES:', fmt(bordereau.totals.total_autres));
  parts.push(...separator());
  recap('TOTAL DEPENSES:', fmt(bordereau.totals.total_charges), true);
  recap('SOLDE TICKET:', fmt(bordereau.totals.solde_ticket), true);
  recap('TOTAL BAGAGE:', fmt(bordereau.totals.total_baggage));
  recap('NB VEHICULES:', String(bordereau.totals.departures));
  recap('NB SIEGES:', fmtNum(bordereau.totals.seats_sold));

  parts.push(...doubleSep());

  // ── PIED ──────────────────────────────────────────────────────────
  parts.push(setAlign('center'));
  parts.push(...line(`Imprime le ${bordereau.print_date} a ${bordereau.print_time}`));

  parts.push(lineFeed(2));
  if (settings.auto_cut) parts.push(cutPaper());
  return concat(...parts);
}

// ═══════════════════════════════════════════════════════════════════
//  BORDEREAU DE DÉPART  (ESC/POS 58 mm)
// ═══════════════════════════════════════════════════════════════════
export interface PrintBordereauDepartData {
  data: BordereauDepartData;
  phoneLine?: string;
}

export function buildBordereauDepartESCPOS(data: PrintBordereauDepartData, settings: PrintSettings, logo?: RasterImage | null): Uint8Array {
  const w = settings.width_mm === 80 ? 68 : 64;
  const { data: bord, phoneLine } = data;
  const parts: Uint8Array[] = [init(), setLineSpacing(24), setFontB()];

  const fmtNum = (n: number): string =>
    Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fmt = (n: number): string => fmtNum(n) + ' F';

  const rawLine = (s = '') => [text(s.slice(0, w)), lineFeed()];
  const line = (s = '') => {
    const inner = s.slice(0, w - 2).padEnd(w - 2);
    return [text(`|${inner}|`), lineFeed()];
  };
  const center = (s: string) => {
    const t = s.slice(0, w - 2);
    const pad = Math.max(0, Math.floor((w - 2 - t.length) / 2));
    return line(' '.repeat(pad) + t);
  };
  const separator = () => line('-'.repeat(w - 2));
  const doubleSep = () => line('='.repeat(w - 2));
  const topBorder = () => rawLine('+' + '-'.repeat(w - 2) + '+');
  const bottomBorder = () => rawLine('+' + '-'.repeat(w - 2) + '+');

  const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) : s;
  const rightAlign = (s: string, max: number) => s.length >= max ? s.slice(0, max) : ' '.repeat(max - s.length) + s;
  const leftAlign = (s: string, max: number) => s.length >= max ? s.slice(0, max) : s + ' '.repeat(max - s.length);

  // ── CONTOUR SUPÉRIEUR ─────────────────────────────────────────────
  parts.push(setAlign('center'), ...topBorder());

  // ── EN-TÊTE ──────────────────────────────────────────────────────
  if (logo) {
    parts.push(setAlign('center'), rasterImage(logo), lineFeed());
  } else {
    parts.push(setAlign('center'), setDoubleFontB(), setBold(true), ...line('SBTA'), setNormal(), setFontB(), setBold(false));
  }
  parts.push(setBold(true), ...center("Soc. Bonkoungou Transport de L'Agneby"), setBold(false));
  parts.push(setBold(true), ...center(`Tel ${phoneLine || '07 69 94 88 03 / 07 99 68 60 03'}`), setBold(false));
  parts.push(...doubleSep());
  parts.push(setAlign('center'), setBold(true), ...line('BORDEREAU DE DEPART'), setBold(false));
  parts.push(...doubleSep());

  // ── INFOS GUICHET / TRAJET ───────────────────────────────────────
  parts.push(setAlign('left'));
  const padR = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
  const pair = (label: string, value: string, bold = false) => {
    const v = truncate(value, w - label.length);
    if (bold) parts.push(setBold(true));
    parts.push(...line(`${padR(label, w - v.length > 0 ? w - v.length : label.length)}${v}`));
    if (bold) parts.push(setBold(false));
  };
  // Departure number, bus and driver read from afar (like the seat number of the ticket): the
  // label on its line, the value centred below, enlarged (x3 for the number, x2 for the others)
  const big = (label: string, value: string, factor: number) => {
    parts.push(...line(label));
    parts.push(setAlign('center'), setBold(true), setCharSize(factor), text(value || '-'), lineFeed(), setCharSize(1), setBold(false), setAlign('left'));
  };
  pair('GUICHET:', bord.station_name);
  big('DEP N°:', String(bord.departure_number), 3);
  pair('LIGNE:', bord.route_name);
  pair('DATE:', bord.departure_date);
  pair('HEURE:', bord.departure_time);
  parts.push(...separator());

  // ── BUS & CHAUFFEUR ──────────────────────────────────────────────
  big('CAR:', bord.registration_number, 2);
  big('CHAUFFEUR:', bord.driver_name, 2);
  parts.push(...separator());

  // ── CONVOI ──────────────────────────────────────────────────────
  if (bord.is_convoy) {
    parts.push(setAlign('center'), setBold(true), ...line('** DEPART EN CONVOI **'), setBold(false));
    parts.push(setAlign('left'));
    parts.push(...separator());
  }

  // ── CAPACITÉ ────────────────────────────────────────────────────
  pair('NBRE PLACE', fmtNum(bord.total_seats));
  pair('VENDU(S)', fmtNum(bord.seats_sold));
  pair('RESTANT(S)', fmtNum(bord.seats_remaining));
  parts.push(...separator());

  if (bord.is_convoy) {
    // Convoy: simplified financial section
    pair('MONTANT CONVOI:', fmt(bord.convoy_amount), true);
    if (bord.total_rations > 0)     pair('RATIONS:', fmt(bord.total_rations));
    if (bord.total_carburant > 0)   pair('CARBURANT COMPL.:', fmt(bord.total_carburant));
    if (bord.total_peages > 0)      pair('PEAGES:', fmt(bord.total_peages));
    if (bord.total_autres > 0)      pair('AUTRES:', fmt(bord.total_autres));
    pair('MT TOTAL DEPENSES:', fmt(bord.total_charges));
    pair('SOLDE CONVOI:', fmt(bord.convoy_amount - bord.total_charges), true);
    pair('MT TOTAL BAGAGE:', fmt(bord.total_baggage));
  } else {
    // Normal: sales table by destination
    // Column layout for 62 inner chars:
    // DEST(26) | SIEG(4) | TARIF(16) | MONTANT(16) = 62
    const C_DEST = 26;
    const C_SIEG = 4;
    const C_TARIF = 16;
    const C_MONTANT = 16;

    const headerRow =
      leftAlign('DESTINATION', C_DEST) +
      leftAlign('SIEG', C_SIEG) +
      rightAlign('TARIF', C_TARIF) +
      rightAlign('MONTANT', C_MONTANT);
    parts.push(setBold(true), ...line(headerRow.slice(0, w)), setBold(false));
    parts.push(...separator());

    const groups = bord.destination_groups && bord.destination_groups.length > 0
      ? bord.destination_groups
      : [{ destination: bord.destination, seats_sold: bord.seats_sold, unit_price: bord.unit_price, amount: bord.total_ticket_amount, seat_numbers: bord.sold_seat_numbers }];

    for (const group of groups) {
      const destLabel = truncate(group.destination, C_DEST);
      const sieg = leftAlign(fmtNum(group.seats_sold), C_SIEG);
      const tarif = rightAlign(fmtNum(group.unit_price), C_TARIF);
      const montant = rightAlign(fmtNum(group.amount), C_MONTANT);
      parts.push(...line(`${leftAlign(destLabel, C_DEST)}${sieg}${tarif}${montant}`));

    }
    parts.push(...separator());

    // ── RÉCAPITULATIF FINANCIER ─────────────────────────────────────
    const recap = (label: string, val: string, bold = false) => {
      const v = truncate(val, w - label.length - 1);
      const gap = Math.max(1, w - label.length - v.length);
      if (bold) parts.push(setBold(true));
      parts.push(...line(`${label}${' '.repeat(gap)}${v}`));
      if (bold) parts.push(setBold(false));
    };
    recap('MT TOTAL TICKET:', fmt(bord.total_ticket_amount), true);
    if (bord.total_rations > 0)     recap('  RATIONS:', fmt(bord.total_rations));
    if (bord.total_carburant > 0)   recap('  CARBURANT:', fmt(bord.total_carburant));
    if (bord.total_peages > 0)      recap('  PEAGES:', fmt(bord.total_peages));
    if (bord.total_autres > 0)      recap('  AUTRES:', fmt(bord.total_autres));
    recap('MT TOTAL DEPENSES:', fmt(bord.total_charges));
    recap('SOLDE TICKETS:', fmt(bord.solde_ticket), true);
    recap('MT TOTAL BAGAGE:', fmt(bord.total_baggage));
  }

  parts.push(...doubleSep());

  // ── PIED ──────────────────────────────────────────────────────────
  parts.push(setAlign('center'));
  parts.push(...line(`Imprime le ${bord.print_date} a ${bord.print_time}`));

  // ── CONTOUR INFÉRIEUR ─────────────────────────────────────────────
  parts.push(...bottomBorder());

  parts.push(lineFeed(2));
  if (settings.auto_cut) parts.push(cutPaper());
  return concat(...parts);
}

// ═══════════════════════════════════════════════════════════════════
//  BORDEREAU COURRIER  (ESC/POS 58 mm)
// ═══════════════════════════════════════════════════════════════════
const COURRIER_NATURE_LABELS: Record<string, string> = {
  autre:          'AUTRE',
  electronique:   'ELEC.',
  vetement:       'VET.',
  document:       'DOC.',
  alimentaire:    'ALIM.',
  medicament:     'MEDIC.',
  electromenager: 'ELECTR',
  fragile:        'FRAGILE',
};

export function buildBordereauCourrierESCPOS(data: BordereauCourrierData, settings: PrintSettings, logo?: RasterImage | null): Uint8Array {
  const w = settings.width_mm === 80 ? 68 : 64;
  const parts: Uint8Array[] = [init(), setLineSpacing(24), setFontB()];

  const rawLine = (s = '') => [text(s.slice(0, w)), lineFeed()];
  const line = (s = '') => {
    const inner = s.slice(0, w - 2).padEnd(w - 2);
    return [text(`|${inner}|`), lineFeed()];
  };
  const center = (s: string) => {
    const t = s.slice(0, w - 2);
    const pad = Math.max(0, Math.floor((w - 2 - t.length) / 2));
    return line(' '.repeat(pad) + t);
  };
  const separator = () => line('-'.repeat(w - 2));
  const doubleSep = () => line('='.repeat(w - 2));
  const topBorder = () => rawLine('+' + '-'.repeat(w - 2) + '+');
  const bottomBorder = () => rawLine('+' + '-'.repeat(w - 2) + '+');

  const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) : s;
  const padR = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);

  parts.push(setAlign('center'), ...topBorder());

  if (logo) {
    parts.push(setAlign('center'), rasterImage(logo), lineFeed());
  }
  parts.push(setBold(true), ...center(data.station_name.toUpperCase()), setBold(false));
  if (data.station_phone) {
    parts.push(setBold(true), ...center(`Tel ${data.station_phone}`), setBold(false));
  }
  parts.push(...doubleSep());
  parts.push(setAlign('center'), setBold(true), ...line('BORDEREAU COURRIER'), setBold(false));
  parts.push(...doubleSep());

  parts.push(setAlign('left'));
  const pair = (label: string, value: string, bold = false) => {
    const v = truncate(value, w - label.length);
    if (bold) parts.push(setBold(true));
    parts.push(...line(`${padR(label, w - v.length > 0 ? w - v.length : label.length)}${v}`));
    if (bold) parts.push(setBold(false));
  };
  pair('DESTINATION:', data.destination.toUpperCase());
  pair('DATE:', data.date);
  pair('MATRICULE:', (data.bus_registration || '—').toUpperCase());
  parts.push(...separator());

  parts.push(setAlign('center'), setBold(true), ...line('CHAUFFEUR'), setBold(false));
  parts.push(setAlign('center'), setBold(true), ...line((data.driver_name || '—').toUpperCase()), setBold(false));
  parts.push(setAlign('left'));
  parts.push(...doubleSep());

  parts.push(setAlign('center'), setBold(true), ...line('LISTE COLIS'), setBold(false));
  parts.push(setAlign('left'));

  const C_CODE = 16;
  const C_NAT = 10;
  const C_DES = w - 2 - C_CODE - C_NAT;

  const headerRow =
    padR('CODE', C_CODE) +
    padR('NATURE', C_NAT) +
    padR('DESIGNATION', C_DES);
  parts.push(setBold(true), ...line(headerRow.slice(0, w)), setBold(false));
  parts.push(...separator());

  for (const p of data.parcels) {
    const code = truncate(p.parcel_code || '', C_CODE);
    const nat = truncate((COURRIER_NATURE_LABELS[p.nature] ?? 'AUTRE').toUpperCase(), C_NAT);
    const des = truncate((p.content_description || '').toUpperCase(), C_DES);
    parts.push(...line(`${padR(code, C_CODE)}${padR(nat, C_NAT)}${padR(des, C_DES)}`));
  }

  parts.push(...separator());

  parts.push(setBold(true), ...line(`TOTAL COLIS : ${data.parcels.length}`), setBold(false));
  parts.push(...doubleSep());

  parts.push(setAlign('center'));
  parts.push(...line(`Imprime le ${data.print_date} a ${data.print_time}`));

  parts.push(...bottomBorder());

  parts.push(lineFeed(2));
  if (settings.auto_cut) parts.push(cutPaper());
  return concat(...parts);
}

// ═══════════════════════════════════════════════════════════════════
//  RAPPORT DES VENTES DE RAMASSAGE  (ESC/POS, guichet)
// ═══════════════════════════════════════════════════════════════════

/** One ramassage of the report, every value already written as it is printed. */
export interface PrintRamassageReportRow {
  date: string;
  heure: string;
  type: string;
  departure_number: string;
  bus: string;
  driver: string;
  gare: string;
  guichet: string;
  destination: string;
  seats: string;
  amount: string;
  validated_by: string;
}

export interface PrintRamassageReportData {
  station_name: string;
  period_from: string;
  period_to: string;
  count: number;
  total_seats: string;
  total_amount: string;
  rows: PrintRamassageReportRow[];
}

// The printer's character table has no accents: letters are printed without them (Touré → Toure)
// and the typographic signs are replaced, rather than printed as unreadable signs.
function plainText(s: string): string {
  return s
    .replace(/[  ]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/°/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Same layout as the model (rapport_ventes_ramassage_thermique.pdf): one block per ramassage. */
export function buildRamassageReportESCPOS(data: PrintRamassageReportData, settings: PrintSettings): Uint8Array {
  const w = settings.width_mm === 80 ? 48 : 32;
  // ESC G 1: double strike
  const parts: Uint8Array[] = [init(), setLineSpacing(30), setNormal(), setBold(true), cmd(ESC, 0x47, 1)];

  // A long value goes on to the next lines, never cut
  const wrap = (s: string): string[] => {
    const out: string[] = [];
    let rest = plainText(s);
    while (rest.length > w) {
      const cut = rest.lastIndexOf(' ', w);
      const at = cut > w / 3 ? cut : w;
      out.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    out.push(rest);
    return out;
  };
  // Every line in bold and double strike: darker on the roll, as asked by the guichet
  const lines = (s: string) => {
    for (const l of wrap(s)) parts.push(text(l), lineFeed());
  };
  const field = (label: string, value: string) => lines(`${label} : ${value}`);
  const dashes = () => { parts.push(setAlign('left'), text('-'.repeat(w)), lineFeed()); };
  const heading = (s: string) => { parts.push(setAlign('center')); lines(s); parts.push(setAlign('left')); };

  // ── EN-TÊTE ──────────────────────────────────────────────────────
  parts.push(setAlign('center'), setCharSize(2), text('SBTA'), lineFeed(), setCharSize(1));
  lines("SOCIETE BONKOUNGOU TRANSPORT DE L'AGNEBY");
  lines('RAPPORT DES VENTES DE RAMASSAGE');
  parts.push(setAlign('left'), lineFeed());

  // ── RÉSUMÉ ───────────────────────────────────────────────────────
  dashes();
  field('GARE', data.station_name);
  field('PERIODE', `${data.period_from} au ${data.period_to}`);
  field('NOMBRE DE RAMASSAGES', String(data.count));
  field('TOTAL SIEGES', data.total_seats);
  field('MONTANT TOTAL', data.total_amount);

  // ── UN BLOC PAR RAMASSAGE ────────────────────────────────────────
  data.rows.forEach((r, i) => {
    dashes();
    heading(`RAMASSAGE No ${i + 1}`);
    field('DATE', r.date);
    field('HEURE', r.heure);
    field('TYPE', r.type);
    field('No DEPART', r.departure_number);
    field('IMMATRICULATION', r.bus);
    field('CHAUFFEUR', r.driver);
    field('GARE', r.gare);
    field('GUICHET', r.guichet);
    field('VILLE / DESTINATION', r.destination);
    field('SIEGES', r.seats);
    field('MONTANT', r.amount);
    field('VALIDE PAR', r.validated_by);
  });

  // ── RÉCAPITULATIF ────────────────────────────────────────────────
  dashes();
  heading('RECAPITULATIF');
  field('RAMASSAGES', String(data.count));
  field('TOTAL SIEGES', data.total_seats);
  field('TOTAL ENCAISSE', data.total_amount);

  dashes();
  heading('Fin du rapport');
  parts.push(setAlign('center'));
  lines('Document genere par SBTA');
  parts.push(setAlign('left'), lineFeed(4));
  if (settings.auto_cut) parts.push(cutPaper());
  return concat(...parts);
}
