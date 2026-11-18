// Bordereau de dépotage (pompiste) : attendu, mesuré en cuve, dépotage réel et écarts, en plus
// ou en moins, comme sur le document du DG (17/11/2026). Ticket 80 mm, imprimé par le navigateur.

export interface DepotageBordereauData {
  tankName: string;
  supplierName: string;
  productName: string;
  deliveryNote: string | null;
  arrivalAt: string;
  measuredAt: string | null;
  stockBefore: number;
  announced: number;
  measuredLevel: number | null;
  received: number | null;
  withdrawnDuringRest: number;
  varianceTotal: number | null;
  varianceLoading: number;
  varianceUnloading: number | null;
  unitPrice: number;
  observation: string | null;
  pompisteName: string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => Math.round(v).toLocaleString('fr-FR').replace(/ | /g, ' ');
const liters = (v: number) => `${n(v)} L`;
const signed = (v: number, unit: string) => `${v > 0 ? '+ ' : v < 0 ? '- ' : ''}${n(Math.abs(v))} ${unit}`;
const dateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function depotageBordereauHtml(d: DepotageBordereauData): string {
  const row = (label: string, value: string, strong = false) =>
    `<div class="r${strong ? ' b' : ''}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  const measured = d.measuredLevel !== null && d.received !== null && d.varianceTotal !== null;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Bordereau de dépotage</title><style>
    @page { size: 80mm auto; margin: 3mm; }
    body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; margin: 0; width: 74mm; }
    .c { text-align: center; } .t { font-size: 16px; font-weight: bold; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    .r { display: flex; justify-content: space-between; gap: 6px; } .b { font-weight: bold; font-size: 13px; }
    .sig { margin-top: 14px; } .small { font-size: 10px; }
  </style></head><body>
    <div class="c t">SBTA</div><div class="c b">BORDEREAU DE DÉPOTAGE</div><hr>
    ${row('Cuve :', d.tankName)}${row('Fournisseur :', d.supplierName)}${row('Produit :', d.productName)}
    ${d.deliveryNote ? row('Bon de livraison :', d.deliveryNote) : ''}
    ${row('Fin dépotage :', dateTime(d.arrivalAt))}${row('Mesure :', measured ? dateTime(d.measuredAt) : 'en attente')}<hr>
    ${row('Stock de départ', liters(d.stockBefore))}${row('Dépoté théorique', liters(d.announced))}
    ${row('Total attendu', liters(d.stockBefore + d.announced), true)}<hr>
    ${measured ? `
      ${row('Mesuré en cuve', liters(d.measuredLevel as number), true)}
      ${d.withdrawnDuringRest > 0 ? row('Pleins pendant l\'attente', liters(d.withdrawnDuringRest)) : ''}
      ${row('Dépotage réel', liters(d.received as number))}<hr>
      ${row('ÉCART TOTAL', signed(d.varianceTotal as number, 'L'), true)}
      ${row(' dont chargement', signed(d.varianceLoading, 'L'))}
      <div class="small">  (contre-plein citerne)</div>
      ${row(' dont dépotage réel', signed(d.varianceUnloading as number, 'L'))}
      ${row('Valeur de l\'écart', signed((d.varianceTotal as number) * d.unitPrice, 'F'))}<hr>`
    : `${row('Écart citerne (contre-plein)', signed(d.varianceLoading, 'L'))}<div class="c b">MESURE EN ATTENTE</div><hr>`}
    ${d.observation ? `<div>Observation : ${esc(d.observation)}</div><hr>` : ''}
    <div class="sig">Pompiste : ${d.pompisteName ? esc(d.pompisteName) : '______________'}</div>
    <div class="sig">Signature : ______________</div>
    <div class="sig">Chauffeur citerne : ________</div><hr>
    <div class="c small">Imprimé le ${dateTime(new Date().toISOString())}</div>
  </body></html>`;
}

export async function printDepotageBordereau(data: DepotageBordereauData): Promise<void> {
  document.getElementById('depotage-print-frame')?.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'depotage-print-frame';
  Object.assign(iframe.style, { position: 'fixed', top: '-10000px', left: '-10000px', width: '80mm', height: '0', border: 'none' });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(depotageBordereauHtml(data));
  doc.close();
  await new Promise(r => setTimeout(r, 200));
  try {
    iframe.contentWindow?.print();
  } finally {
    setTimeout(() => iframe.remove(), 2000);
  }
}
