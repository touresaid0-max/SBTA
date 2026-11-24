/**
 * Bagagiste prints (24/11/2026), in the style of the baggage ticket (80 mm paper):
 * - « Feuille bagages » : one sheet per departure, its baggage by destination, for the bus;
 * - « Bordereau de fin de caisse (bagages) » : number of baggage and amount of the day.
 * Printed through the browser; the logo is the one of the tickets, kept by the app for offline use.
 */

const LOGO_SRC = '/logosbta001.JPG';
const COMPANY = 'Société Bonkoungou Transport de L\'Agneby';
const PHONES = 'Tel 01 14 34 60 / 01 14 34 87';

export interface SheetBaggage {
  baggage_number: string;
  destination: string;
  seat_number: string | null;
  owner_name: string;
  price: number;
}

export interface DepartureSheet {
  number: number | null;
  route_name: string;
  destination: string;
  bus_registration: string;
  counter_number: string;
  provisional: boolean;
  baggages: SheetBaggage[];
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
const frDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const nowLabel = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const STYLE = `
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000}
  .t{width:72mm;margin:0 auto;padding:2mm 0 4mm}
  .page{page-break-after:always}.page:last-child{page-break-after:auto}
  .c{text-align:center}.logo{width:44mm}.co,.ph{font-size:10px;font-weight:700}
  .title{font-size:17px;font-weight:900;text-align:center;margin:5px 0 2px}
  .dash{border-top:1px dashed #000;margin:4px 0}
  .r{display:flex;justify-content:space-between;gap:6px;font-size:11.5px;font-weight:700;margin:2px 0}
  .big{font-size:14px;font-weight:900;text-align:center;margin:3px 0}
  .g{font-size:12.5px;font-weight:900;margin-top:6px;border-bottom:1.5px solid #000}
  table{width:100%;border-collapse:collapse;font-size:10.5px;font-weight:700}td{padding:1px 0;vertical-align:top}
  td.m{text-align:right;white-space:nowrap}td.s{width:30px}
  .tot{font-size:12.5px;font-weight:900}.small{font-size:9px;font-weight:700;text-align:center;margin-top:5px}
  .box{width:100%;border-collapse:collapse;margin-top:6px}.box th,.box td{border:1.5px solid #000;text-align:center;padding:5px 3px}
  .box th{font-size:11px}.box td{font-size:20px;font-weight:900}
  .bt{background:#000;color:#fff;font-weight:900;text-align:center;padding:5px;border-radius:6px;font-size:14px;line-height:1.2;margin:5px 0}
  @page{size:80mm auto;margin:3mm}
`;

const header = () => `<div class="c"><img class="logo" src="${LOGO_SRC}" alt="SBTA"></div>
  <div class="c co">${esc(COMPANY)}</div><div class="c ph">${esc(PHONES)}</div>`;

function openPrint(title: string, body: string): boolean {
  const w = window.open('', '_blank', 'width=420,height=800');
  if (!w) return false;
  w.document.open();
  w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`);
  w.document.close();
  w.focus();
  // Printed once the logo is there (or after 1.5 s without it: printed without the logo)
  const go = () => { try { w.print(); } catch { /* closed */ } };
  const img = w.document.querySelector('img');
  if (img && !img.complete) {
    let done = false;
    const once = () => { if (!done) { done = true; go(); } };
    img.addEventListener('load', once);
    img.addEventListener('error', once);
    setTimeout(once, 1500);
  } else {
    setTimeout(go, 300);
  }
  return true;
}

/** One sheet per departure, on one print job */
export function printDepartureSheets(p: {
  sheets: DepartureSheet[]; stationName: string; date: string; bagagiste: string;
}): boolean {
  const printedAt = nowLabel();
  const pages = p.sheets.map(s => {
    const byDest = new Map<string, SheetBaggage[]>();
    for (const b of s.baggages) {
      const k = (b.destination || '—').toUpperCase();
      byDest.set(k, [...(byDest.get(k) ?? []), b]);
    }
    const groups = [...byDest.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dest, list]) => `
      <div class="g">${esc(dest)} (${list.length})</div>
      <table>${list.map(b => `<tr><td>${esc(b.baggage_number)}</td><td class="s">${b.seat_number ? 'S.' + esc(b.seat_number) : '—'}</td><td>${esc(b.owner_name)}</td><td class="m">${money(b.price)}</td></tr>`).join('')}</table>`).join('');
    const total = s.baggages.reduce((sum, b) => sum + (b.price || 0), 0);
    return `<div class="t page">${header()}
      <div class="title">FEUILLE BAGAGES</div><div class="dash"></div>
      <div class="r"><span>DEPART :</span><span>N° ${s.number ?? '—'}${s.provisional ? ' (provisoire)' : ''}</span></div>
      <div class="big">${esc(p.stationName)} =&gt; ${esc(s.destination || '—')}</div><div class="dash"></div>
      <div class="r"><span>CAR : ${esc(s.bus_registration || '—')}</span><span>GUICHET : ${esc(s.counter_number || '—')}</span></div><div class="dash"></div>
      <div class="r"><span>DATE : ${esc(frDate(p.date))}</span><span>LIGNE : ${esc(s.route_name || '—')}</span></div><div class="dash"></div>
      ${groups || '<div class="small">Aucun bagage</div>'}
      <div class="dash"></div>
      <div class="r tot"><span>NOMBRE DE BAGAGES :</span><span>${s.baggages.length}</span></div>
      <div class="r tot"><span>MONTANT TOTAL :</span><span>${money(total)} F</span></div>
      <div class="dash"></div>
      <div class="r"><span>BAGAGISTE :</span><span>${esc(p.bagagiste.toUpperCase())}</span></div>
      <div class="small">Imprimé le : ${esc(printedAt)}</div></div>`;
  }).join('');
  return openPrint('Feuilles bagages', pages);
}

/** End of day: number of baggage and amount */
export function printEndOfDayBaggage(p: {
  date: string; bagagiste: string; stationName: string; count: number; amount: number;
}): boolean {
  const body = `<div class="t">${header()}<div class="dash"></div>
    <div class="bt">BORDEREAU DE FIN DE CAISSE<br><span style="letter-spacing:3px;font-size:12px">(BAGAGES)</span></div><div class="dash"></div>
    <div class="r" style="justify-content:flex-start"><span>Date :</span><span>${esc(frDate(p.date))}</span></div>
    <div class="r" style="justify-content:flex-start"><span>Nom de l'Identifiant :</span><span>${esc(p.bagagiste.toUpperCase())}</span></div>
    <div class="r" style="justify-content:flex-start"><span>Fonction :</span><span>Caissier / Bagagiste</span></div>
    <div class="r" style="justify-content:flex-start"><span>Gare :</span><span>${esc(p.stationName)}</span></div>
    <div class="dash"></div>
    <table class="box"><tr><th>Nombre de Bagages enregistrés</th><th>Montant Global (F CFA)</th></tr>
    <tr><td>${p.count}</td><td>${money(p.amount)}</td></tr></table>
    <div class="small">Imprimé le : ${esc(nowLabel())}</div></div>`;
  return openPrint('Bordereau de fin de caisse (bagages)', body);
}
