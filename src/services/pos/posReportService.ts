import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import type { DepartRecord } from './departService';
import { seatsLibres, computeSolde } from './departService';

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
  seats_sold: number;
  seats_libres: number;
  mt_ticket: number;
  mt_bagage: number;
  tot_depense: number;
  solde: number;
  caisse: number;
  status: string;
  station_name?: string;
}

export function departToSummary(d: DepartRecord): DepartSummary {
  return {
    departure_number: d.departure_number,
    route_number: d.route_number,
    route_name: d.route_name ?? '',
    bus_plate: d.bus_plate ?? '',
    bus_name: d.bus_name ?? '',
    driver_name: d.driver_name ?? '',
    departure_date: d.departure_date,
    departure_time: d.departure_time,
    seats_total: d.seats_total,
    seats_sold: d.seats_sold,
    seats_libres: seatsLibres(d),
    mt_ticket: d.mt_ticket,
    mt_bagage: d.mt_bagage,
    tot_depense: d.tot_depense,
    solde: computeSolde(d),
    caisse: d.caisse,
    status: d.cloture ? 'Clôturé' : d.cancelled ? 'Annulé' : d.confirmed ? 'Confirmé' : 'En attente',
    station_name: d.station_name,
  };
}

const COLUMNS: { key: keyof DepartSummary; label: string; width: number }[] = [
  { key: 'route_number', label: 'N° Départ/Ligne', width: 20 },
  { key: 'route_name', label: 'Ligne', width: 55 },
  { key: 'departure_date', label: 'Date', width: 28 },
  { key: 'departure_time', label: 'Heure', width: 18 },
  { key: 'seats_total', label: 'Sièges', width: 16 },
  { key: 'seats_sold', label: 'Vendus', width: 16 },
  { key: 'seats_libres', label: 'Libres', width: 16 },
  { key: 'mt_ticket', label: 'MT Ticket', width: 28 },
  { key: 'mt_bagage', label: 'MT Bagage', width: 28 },
  { key: 'tot_depense', label: 'Tot Dépense', width: 28 },
  { key: 'solde', label: 'Solde', width: 28 },
  { key: 'caisse', label: 'Caisse', width: 28 },
  { key: 'status', label: 'Statut', width: 22 },
];

function fmt(n: number): string {
  return n.toLocaleString('fr-FR');
}

export function exportToExcel(summaries: DepartSummary[], fileName: string): void {
  const rows = summaries.map(s => ({
    'N° Départ/Ligne': s.route_number,
    'Ligne': s.route_name,
    'Date': s.departure_date,
    'Heure': s.departure_time,
    'Matricule': s.bus_plate,
    'Nom Car': s.bus_name,
    'Chauffeur': s.driver_name,
    'Sièges': s.seats_total,
    'Sièges vendus': s.seats_sold,
    'Sièges libres': s.seats_libres,
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
    'Sièges': summaries.reduce((a, s) => a + s.seats_total, 0),
    'Sièges vendus': summaries.reduce((a, s) => a + s.seats_sold, 0),
    'Sièges libres': summaries.reduce((a, s) => a + s.seats_libres, 0),
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
  y += 3;
  if (summaries[0]?.station_name) {
    doc.text(`Gare: ${summaries[0].station_name}`, margin, y);
    y += 3;
  }
  y += 3;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');

  let x = margin;
  for (const col of COLUMNS) {
    doc.text(col.label, x, y);
    x += col.width;
  }
  y += 2;
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  for (const s of summaries) {
    if (y > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 15;
      doc.setFont('helvetica', 'bold');
      x = margin;
      for (const col of COLUMNS) {
        doc.text(col.label, x, y);
        x += col.width;
      }
      y += 4;
      doc.setFont('helvetica', 'normal');
    }

    x = margin;
    for (const col of COLUMNS) {
      const val = s[col.key];
      let str: string;
      if (typeof val === 'number') {
        str = ['mt_ticket', 'mt_bagage', 'tot_depense', 'solde', 'caisse'].includes(col.key)
          ? fmt(val)
          : String(val);
      } else {
        str = String(val ?? '');
      }
      if (str.length > col.width / 1.8) {
        str = str.slice(0, Math.floor(col.width / 1.8)) + '…';
      }
      doc.text(str, x, y);
      x += col.width;
    }
    y += 4;
  }

  y += 2;
  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL', margin, y);

  const totals = {
    seats_total: summaries.reduce((a, s) => a + s.seats_total, 0),
    seats_sold: summaries.reduce((a, s) => a + s.seats_sold, 0),
    seats_libres: summaries.reduce((a, s) => a + s.seats_libres, 0),
    mt_ticket: summaries.reduce((a, s) => a + s.mt_ticket, 0),
    mt_bagage: summaries.reduce((a, s) => a + s.mt_bagage, 0),
    tot_depense: summaries.reduce((a, s) => a + s.tot_depense, 0),
    solde: summaries.reduce((a, s) => a + s.solde, 0),
    caisse: summaries.reduce((a, s) => a + s.caisse, 0),
  };

  const colStart = margin + COLUMNS.slice(0, 4).reduce((a, c) => a + c.width, 0);
  doc.text(String(totals.seats_total), colStart, y);
  doc.text(String(totals.seats_sold), colStart + COLUMNS[4].width, y);
  doc.text(String(totals.seats_libres), colStart + COLUMNS[4].width + COLUMNS[5].width, y);
  doc.text(fmt(totals.mt_ticket), colStart + COLUMNS[4].width + COLUMNS[5].width + COLUMNS[6].width, y);
  doc.text(fmt(totals.mt_bagage), colStart + COLUMNS[4].width + COLUMNS[5].width + COLUMNS[6].width + COLUMNS[7].width, y);
  doc.text(fmt(totals.tot_depense), colStart + COLUMNS[4].width + COLUMNS[5].width + COLUMNS[6].width + COLUMNS[7].width + COLUMNS[8].width, y);
  doc.text(fmt(totals.solde), colStart + COLUMNS[4].width + COLUMNS[5].width + COLUMNS[6].width + COLUMNS[7].width + COLUMNS[8].width + COLUMNS[9].width, y);
  doc.text(fmt(totals.caisse), colStart + COLUMNS[4].width + COLUMNS[5].width + COLUMNS[6].width + COLUMNS[7].width + COLUMNS[8].width + COLUMNS[9].width + COLUMNS[10].width, y);

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
    <td style="text-align:center">${s.route_number}</td>
    <td>${escapeHtml(s.route_name)}</td>
    <td style="text-align:center">${s.departure_date} ${s.departure_time}</td>
    <td style="text-align:center">${s.bus_plate}</td>
    <td>${escapeHtml(s.driver_name)}</td>
    <td style="text-align:center">${s.seats_total}</td>
    <td style="text-align:center">${s.seats_sold}</td>
    <td style="text-align:center">${s.seats_libres}</td>
    <td style="text-align:right">${fmt(s.mt_ticket)}</td>
    <td style="text-align:right">${fmt(s.mt_bagage)}</td>
    <td style="text-align:right">${fmt(s.tot_depense)}</td>
    <td style="text-align:right;font-weight:bold">${fmt(s.solde)}</td>
    <td style="text-align:center">${s.status}</td>
  </tr>`).join('');

  const totals = {
    seats_total: summaries.reduce((a, s) => a + s.seats_total, 0),
    seats_sold: summaries.reduce((a, s) => a + s.seats_sold, 0),
    seats_libres: summaries.reduce((a, s) => a + s.seats_libres, 0),
    mt_ticket: summaries.reduce((a, s) => a + s.mt_ticket, 0),
    mt_bagage: summaries.reduce((a, s) => a + s.mt_bagage, 0),
    tot_depense: summaries.reduce((a, s) => a + s.tot_depense, 0),
    solde: summaries.reduce((a, s) => a + s.solde, 0),
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
        <th>Sièges</th><th>Vendus</th><th>Libres</th><th>MT Ticket</th><th>MT Bagage</th>
        <th>Tot Dépense</th><th>Solde</th><th>Statut</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="text-align:right">TOTAL</td>
        <td style="text-align:center">${totals.seats_total}</td>
        <td style="text-align:center">${totals.seats_sold}</td>
        <td style="text-align:center">${totals.seats_libres}</td>
        <td style="text-align:right">${fmt(totals.mt_ticket)}</td>
        <td style="text-align:right">${fmt(totals.mt_bagage)}</td>
        <td style="text-align:right">${fmt(totals.tot_depense)}</td>
        <td style="text-align:right">${fmt(totals.solde)}</td>
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
