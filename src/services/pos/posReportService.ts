import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import type { DepartRecord } from './departService';
import {
  seatsLibres, computeSolde,
  seatsAllocatedForStation, seatsVendusForStation, seatsLibresForStation,
  getSeatRangeForStation,
} from './departService';
import type { TicketRecord } from './db';

export interface DepartSummary {
  departure_number: number;
  route_number: number;
  route_name: string;
  bus_plate: string;
  bus_name: string;
  driver_name: string;
  departure_date: string;
  departure_time: string;
  seats_total: number;
  seats_allocated: number;
  seat_range: string;
  seats_sold: number;
  seats_libres: number;
  fill_rate: number;
  mt_ticket: number;
  mt_bagage: number;
  tot_depense: number;
  solde: number;
  caisse: number;
  status: string;
  station_name?: string;
}

export function departToSummary(
  d: DepartRecord,
  tickets?: TicketRecord[],
  stationId?: string,
): DepartSummary {
  const hasAlloc = !!(stationId && d.seat_allocations && d.seat_allocations.length > 0 && tickets);
  const allocated = hasAlloc ? seatsAllocatedForStation(d, stationId!) : d.seats_total;
  const sold = hasAlloc ? seatsVendusForStation(tickets!, d, stationId!) : d.seats_sold;
  const libres = hasAlloc ? seatsLibresForStation(tickets!, d, stationId!) : seatsLibres(d);
  const range = hasAlloc ? getSeatRangeForStation(d, stationId!) : null;
  const seatRangeStr = range ? `${range.from}–${range.to}` : `${d.seats_from}–${d.seats_total}`;
  const fillRate = allocated > 0 ? Math.round((sold / allocated) * 100) : 0;
  return {
    departure_number: d.departure_number,
    route_number: d.route_number,
    route_name: d.route_name ?? '',
    bus_plate: d.bus_plate ?? '',
    bus_name: d.bus_name ?? '',
    driver_name: d.driver_name ?? '',
    departure_date: d.departure_date,
    departure_time: d.departure_time,
    seats_total: allocated,
    seats_allocated: allocated,
    seat_range: seatRangeStr,
    seats_sold: sold,
    seats_libres: libres,
    fill_rate: fillRate,
    mt_ticket: d.mt_ticket,
    mt_bagage: d.mt_bagage,
    tot_depense: d.tot_depense,
    solde: computeSolde(d),
    caisse: d.caisse,
    status: d.cloture ? 'Clôturé' : d.cancelled ? 'Annulé' : d.confirmed ? 'Confirmé' : 'En attente',
    station_name: d.station_name,
  };
}

type ColumnAlign = 'left' | 'right';

// PDF columns: widths in mm, they add up to the usable width of a landscape A4 (277 mm).
// Labels are wrapped on two lines when they do not fit their column.
const COLUMNS: { key: keyof DepartSummary; label: string; width: number; align: ColumnAlign; total?: boolean; amount?: boolean }[] = [
  { key: 'route_number', label: 'N° Départ / Ligne', width: 13, align: 'left' },
  { key: 'route_name', label: 'Ligne', width: 36, align: 'left' },
  { key: 'departure_date', label: 'Date', width: 18, align: 'left' },
  { key: 'departure_time', label: 'Heure', width: 11, align: 'left' },
  { key: 'seats_allocated', label: 'Sièges attribués', width: 15, align: 'right', total: true },
  { key: 'seat_range', label: 'Plage sièges', width: 15, align: 'right' },
  { key: 'seats_sold', label: 'Vendus', width: 13, align: 'right', total: true },
  { key: 'seats_libres', label: 'Libres', width: 12, align: 'right', total: true },
  { key: 'fill_rate', label: 'Taux (%)', width: 13, align: 'right' },
  { key: 'mt_ticket', label: 'MT Ticket', width: 24, align: 'right', total: true, amount: true },
  { key: 'mt_bagage', label: 'MT Bagage', width: 22, align: 'right', total: true, amount: true },
  { key: 'tot_depense', label: 'Tot Dépense', width: 22, align: 'right', total: true, amount: true },
  { key: 'solde', label: 'Solde', width: 24, align: 'right', total: true, amount: true },
  { key: 'caisse', label: 'Caisse', width: 24, align: 'right', total: true, amount: true },
  { key: 'status', label: 'Statut', width: 15, align: 'left' },
];

function fmt(n: number): string {
  return n.toLocaleString('fr-FR');
}

// The PDF fonts have no narrow no-break space (the fr-FR thousands separator): it printed
// "305 /500". Use a plain space instead.
function pdfAmount(n: number): string {
  return Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const AMOUNT_COLUMNS = ['MT Ticket', 'MT Bagage', 'Tot Dépense', 'Solde', 'Caisse'];

export function exportToExcel(summaries: DepartSummary[], fileName: string): void {
  const rows = summaries.map(s => ({
    'N° Départ/Ligne': s.route_number,
    'Ligne': s.route_name,
    'Date': s.departure_date,
    'Heure': s.departure_time,
    'Matricule': s.bus_plate,
    'Nom Car': s.bus_name,
    'Chauffeur': s.driver_name,
    'Sièges attribués': s.seats_allocated,
    'Plage sièges': s.seat_range,
    'Sièges vendus': s.seats_sold,
    'Sièges libres': s.seats_libres,
    'Taux remplissage %': s.fill_rate,
    'MT Ticket': s.mt_ticket,
    'MT Bagage': s.mt_bagage,
    'Tot Dépense': s.tot_depense,
    'Solde': s.solde,
    'Caisse': s.caisse,
    'Statut': s.status,
    'Gare': s.station_name ?? '',
  }));

  const totals = {
    'N° Départ/Ligne': '',
    'Ligne': 'TOTAL',
    'Date': '',
    'Heure': '',
    'Matricule': '',
    'Nom Car': '',
    'Chauffeur': '',
    'Sièges attribués': summaries.reduce((a, s) => a + s.seats_allocated, 0),
    'Plage sièges': '',
    'Sièges vendus': summaries.reduce((a, s) => a + s.seats_sold, 0),
    'Sièges libres': summaries.reduce((a, s) => a + s.seats_libres, 0),
    'Taux remplissage %': '',
    'MT Ticket': summaries.reduce((a, s) => a + s.mt_ticket, 0),
    'MT Bagage': summaries.reduce((a, s) => a + s.mt_bagage, 0),
    'Tot Dépense': summaries.reduce((a, s) => a + s.tot_depense, 0),
    'Solde': summaries.reduce((a, s) => a + s.solde, 0),
    'Caisse': summaries.reduce((a, s) => a + s.caisse, 0),
    'Statut': '',
    'Gare': '',
  };
  rows.push(totals as unknown as typeof rows[0]);

  const ws = XLSX.utils.json_to_sheet(rows);

  // Readable columns, and amounts shown with thousands separators (still numbers in Excel)
  const headers = Object.keys(rows[0] ?? totals);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, AMOUNT_COLUMNS.includes(h) ? 14 : h === 'Ligne' ? 28 : 10) }));
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  headers.forEach((h, c) => {
    if (!AMOUNT_COLUMNS.includes(h)) return;
    for (let r = 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0';
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Récapitulatif');
  XLSX.writeFile(wb, fileName);
}

export function exportToPDF(summaries: DepartSummary[], fileName: string, title: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  let y = 15;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, margin, y);
  y += 5;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const dateStr = new Date().toLocaleString('fr-FR');
  doc.text(`Généré le ${dateStr}`, margin, y);
  y += 4.5;
  if (summaries[0]?.station_name) {
    doc.text(`Gare: ${summaries[0].station_name}`, margin, y);
    y += 4.5;
  }
  y += 3;

  // Left edge of each column, scaled down if the table were wider than the page
  const usable = pageWidth - margin * 2;
  const scale = Math.min(1, usable / COLUMNS.reduce((a, c) => a + c.width, 0));
  const lefts: number[] = [];
  COLUMNS.reduce((x, c) => { lefts.push(x); return x + c.width * scale; }, margin);
  const pad = 1;

  const cellText = (col: typeof COLUMNS[number], text: string, i: number, rowY: number) => {
    const w = col.width * scale - pad * 2;
    let str = text;
    while (str.length > 1 && doc.getTextWidth(str) > w) str = str.slice(0, -1);
    if (str !== text) str = str.slice(0, -1) + '…';
    if (col.align === 'right') doc.text(str, lefts[i] + col.width * scale - pad, rowY, { align: 'right' });
    else doc.text(str, lefts[i] + pad, rowY);
  };

  const drawHeader = () => {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    let lines = 1;
    COLUMNS.forEach((col, i) => {
      const parts = doc.splitTextToSize(col.label, col.width * scale - pad * 2) as string[];
      lines = Math.max(lines, parts.length);
      parts.forEach((p, k) => {
        if (col.align === 'right') doc.text(p, lefts[i] + col.width * scale - pad, y + k * 3.2, { align: 'right' });
        else doc.text(p, lefts[i] + pad, y + k * 3.2);
      });
    });
    y += (lines - 1) * 3.2 + 2;
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
  };

  drawHeader();
  for (const s of summaries) {
    if (y > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 15;
      drawHeader();
    }
    COLUMNS.forEach((col, i) => {
      const val = s[col.key];
      const text = typeof val === 'number' ? (col.amount ? pdfAmount(val) : String(val)) : String(val ?? '');
      cellText(col, text, i, y);
    });
    y += 4;
  }

  y += 2;
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL', margin + pad, y);
  COLUMNS.forEach((col, i) => {
    if (!col.total) return;
    const sum = summaries.reduce((a, s) => a + (Number(s[col.key]) || 0), 0);
    cellText(col, col.amount ? pdfAmount(sum) : String(sum), i, y);
  });

  doc.save(fileName);
}

export function printDeparturesList(summaries: DepartSummary[], stationName?: string): void {
  const html = buildPrintHTML(summaries, stationName);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* non-critical */ }
    setTimeout(() => iframe.remove(), 2000);
  }, 300);
}

function buildPrintHTML(summaries: DepartSummary[], stationName?: string): string {
  const dateStr = new Date().toLocaleString('fr-FR');
  const rows = summaries.map(s => `<tr>
    <td style="text-align:center">${escapeHtml(String(s.route_number ?? ''))}</td>
    <td>${escapeHtml(s.route_name ?? '')}</td>
    <td style="text-align:center">${escapeHtml(`${s.departure_date} ${s.departure_time}`)}</td>
    <td style="text-align:center">${escapeHtml(String(s.bus_plate ?? ''))}</td>
    <td>${escapeHtml(s.driver_name ?? '')}</td>
    <td style="text-align:center">${s.seats_allocated}</td>
    <td style="text-align:center">${escapeHtml(String(s.seat_range ?? ''))}</td>
    <td style="text-align:center">${s.seats_sold}</td>
    <td style="text-align:center">${s.seats_libres}</td>
    <td style="text-align:center">${s.fill_rate}%</td>
    <td style="text-align:right">${fmt(s.mt_ticket)}</td>
    <td style="text-align:right">${fmt(s.mt_bagage)}</td>
    <td style="text-align:right">${fmt(s.tot_depense)}</td>
    <td style="text-align:right;font-weight:bold">${fmt(s.solde)}</td>
    <td style="text-align:right">${fmt(s.caisse)}</td>
    <td style="text-align:center">${escapeHtml(String(s.status ?? ''))}</td>
  </tr>`).join('');

  const totals = {
    seats_allocated: summaries.reduce((a, s) => a + s.seats_allocated, 0),
    seats_sold: summaries.reduce((a, s) => a + s.seats_sold, 0),
    seats_libres: summaries.reduce((a, s) => a + s.seats_libres, 0),
    mt_ticket: summaries.reduce((a, s) => a + s.mt_ticket, 0),
    mt_bagage: summaries.reduce((a, s) => a + s.mt_bagage, 0),
    tot_depense: summaries.reduce((a, s) => a + s.tot_depense, 0),
    solde: summaries.reduce((a, s) => a + s.solde, 0),
    caisse: summaries.reduce((a, s) => a + s.caisse, 0),
  };

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: landscape; margin: 10mm; }
  * { font-family: 'Courier New', monospace; font-size: 10px; }
  h1 { font-size: 16px; text-align: center; }
  h2 { font-size: 12px; text-align: center; font-weight: normal; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #f0f0f0; padding: 4px 6px; border: 1px solid #ccc; font-weight: bold; font-size: 9px; }
  td { padding: 3px 6px; border: 1px solid #ddd; }
  tfoot td { font-weight: bold; border-top: 2px solid #333; background: #f8f8f8; }
  .meta { text-align: center; margin-bottom: 8px; font-size: 9px; color: #666; }
</style></head><body>
  <h1>SBTA TRANSPORT — Liste des départs</h1>
  ${stationName ? `<h2>Gare: ${escapeHtml(stationName)}</h2>` : ''}
  <div class="meta">Généré le ${dateStr}</div>
  <table>
    <thead>
      <tr>
        <th>N° Ligne</th><th>Ligne</th><th>Date/Heure</th><th>Matricule</th><th>Chauffeur</th>
        <th>Sièges attribués</th><th>Plage</th><th>Vendus</th><th>Libres</th><th>Taux</th>
        <th>MT Ticket</th><th>MT Bagage</th><th>Tot Dépense</th><th>Solde</th><th>Caisse</th><th>Statut</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="text-align:right">TOTAL</td>
        <td style="text-align:center">${totals.seats_allocated}</td>
        <td></td>
        <td style="text-align:center">${totals.seats_sold}</td>
        <td style="text-align:center">${totals.seats_libres}</td>
        <td></td>
        <td style="text-align:right">${fmt(totals.mt_ticket)}</td>
        <td style="text-align:right">${fmt(totals.mt_bagage)}</td>
        <td style="text-align:right">${fmt(totals.tot_depense)}</td>
        <td style="text-align:right">${fmt(totals.solde)}</td>
        <td style="text-align:right">${fmt(totals.caisse)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
