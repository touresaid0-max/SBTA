import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Search, X, Filter, Download, Fuel, Calendar } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../store/authStore';
import { useComptableCompanies } from '../../hooks/useComptableCompanies';
import { CompanyFilterBar } from '../../components/shared/CompanyFilterBar';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';

/* ─── types ─────────────────────────────────────────────────── */

interface Withdrawal {
  id: string;
  registration_number: string;
  driver_name: string | null;
  station_name: string;
  station_code: string;
  city: string | null;
  fuel_type: string;
  liters: number;
  unit_price: number | null;
  total_amount: number;
  withdrawal_date: string;
  observations: string | null;
}

const FUEL_LABELS: Record<string, string> = { essence: 'Essence', gasoil: 'Gasoil' };
const FUEL_COLORS: Record<string, string> = { essence: '#F59E0B', gasoil: '#3B82F6' };

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA';
}
function fmtL(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n) + ' L';
}

/* ─── component ─────────────────────────────────────────────── */

export default function ComptableCarburantReport() {
  const { user } = useAuthStore();
  const { allowedCompanyIds, companyInfos } = useComptableCompanies();
  const allCompanyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : []);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const companyIds = selectedCompanies.length > 0 ? selectedCompanies : allCompanyIds;
  const companyId = companyIds[0] ?? null;

  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // filters
  const today = format(new Date(), 'yyyy-MM-dd');
  const firstDayMonth = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(firstDayMonth);
  const [dateTo, setDateTo] = useState(today);
  const [search, setSearch] = useState('');
  const [filterFuelType, setFilterFuelType] = useState('');
  const [filterStation, setFilterStation] = useState('');
  const [filterCity, setFilterCity] = useState('');

  const load = useCallback(async () => {
    if (companyIds.length === 0) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('comptable_fuel_withdrawals')
      .select('id,registration_number,driver_name,station_name,station_code,city,fuel_type,liters,unit_price,total_amount,withdrawal_date,observations')
      .in('company_id', companyIds)
      .gte('withdrawal_date', dateFrom)
      .lte('withdrawal_date', dateTo)
      .order('withdrawal_date', { ascending: false });
    if (error) toast.error('Erreur de chargement');
    else setWithdrawals((data as Withdrawal[]) || []);
    setLoading(false);
  }, [companyIds, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  /* ─── derived ─── */

  const allStations = [...new Set(withdrawals.map(w => w.station_name))].sort();
  const allCities = [...new Set(withdrawals.map(w => w.city).filter(Boolean))].sort() as string[];

  const filtered = withdrawals.filter(w => {
    const q = search.toLowerCase();
    const matchSearch = !q || w.registration_number.toLowerCase().includes(q)
      || (w.driver_name || '').toLowerCase().includes(q)
      || w.station_name.toLowerCase().includes(q);
    const matchFuel = !filterFuelType || w.fuel_type === filterFuelType;
    const matchStation = !filterStation || w.station_name === filterStation;
    const matchCity = !filterCity || w.city === filterCity;
    return matchSearch && matchFuel && matchStation && matchCity;
  });

  const hasFilters = search || filterFuelType || filterStation || filterCity;
  const clearFilters = () => { setSearch(''); setFilterFuelType(''); setFilterStation(''); setFilterCity(''); };

  const totalLiters = filtered.reduce((s, w) => s + Number(w.liters), 0);
  const totalAmount = filtered.reduce((s, w) => s + Number(w.total_amount), 0);

  /* ─── Export Excel ─── */

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { utils, writeFile } = await import('xlsx');
      const headers = ['Date', 'Immatriculation', 'Chauffeur', 'Station', 'Code', 'Ville', 'Type', 'Litres', 'Prix unit.', 'Montant total'];
      const rows = filtered.map(w => [
        format(new Date(w.withdrawal_date), 'dd/MM/yyyy'),
        w.registration_number,
        w.driver_name || '—',
        w.station_name,
        w.station_code,
        w.city || '—',
        FUEL_LABELS[w.fuel_type] || w.fuel_type,
        Number(w.liters),
        w.unit_price ?? '—',
        Math.round(Number(w.total_amount)),
      ]);
      rows.push(['', '', '', '', '', '', 'TOTAL', totalLiters, '', Math.round(totalAmount)]);

      const ws = utils.aoa_to_sheet([headers, ...rows]);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Carburant');
      writeFile(wb, `carburant_${dateFrom}_${dateTo}.xlsx`);
      toast.success('Export Excel téléchargé');
    } catch (e) {
      toast.error('Erreur export Excel');
    } finally {
      setExporting(false);
    }
  };

  /* ─── Export PDF ─── */

  const exportPDF = async () => {
    setExporting(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      const pageW = doc.internal.pageSize.getWidth();
      let y = 15;

      // title
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Rapport Carburant', 14, y);
      y += 8;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Période : ${format(new Date(dateFrom), 'dd/MM/yyyy')} – ${format(new Date(dateTo), 'dd/MM/yyyy')}`, 14, y);
      doc.text(`Total : ${fmtL(totalLiters)}  |  ${fmt(totalAmount)}`, pageW - 14, y, { align: 'right' });
      y += 10;

      // table header
      const cols = [
        { label: 'Date', w: 22 },
        { label: 'Immat.', w: 26 },
        { label: 'Chauffeur', w: 38 },
        { label: 'Station', w: 38 },
        { label: 'Ville', w: 28 },
        { label: 'Type', w: 20 },
        { label: 'Litres', w: 22 },
        { label: 'Montant', w: 30 },
      ];

      doc.setFillColor(243, 244, 246);
      doc.rect(14, y - 5, pageW - 28, 8, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      let x = 14;
      cols.forEach(c => { doc.text(c.label, x + 1, y); x += c.w; });
      y += 5;

      doc.setFont('helvetica', 'normal');
      filtered.forEach((w, i) => {
        if (y > 185) { doc.addPage(); y = 15; }
        if (i % 2 === 0) { doc.setFillColor(249, 250, 251); doc.rect(14, y - 4, pageW - 28, 7, 'F'); }
        doc.setFontSize(7.5);
        x = 14;
        const cells = [
          format(new Date(w.withdrawal_date), 'dd/MM/yyyy'),
          w.registration_number,
          (w.driver_name || '—').substring(0, 18),
          w.station_name.substring(0, 20),
          (w.city || '—').substring(0, 15),
          FUEL_LABELS[w.fuel_type] || w.fuel_type,
          fmtL(w.liters),
          fmt(w.total_amount),
        ];
        cells.forEach((cell, idx) => { doc.text(String(cell), x + 1, y); x += cols[idx].w; });
        y += 7;
      });

      // total footer
      y += 3;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`Total : ${fmtL(totalLiters)}`, 14, y);
      doc.text(fmt(totalAmount), pageW - 14, y, { align: 'right' });

      doc.save(`carburant_${dateFrom}_${dateTo}.pdf`);
      toast.success('Export PDF téléchargé');
    } catch (e) {
      toast.error('Erreur export PDF');
    } finally {
      setExporting(false);
    }
  };

  /* ─── render ─────────────────────────────────────────────── */

  return (
    <div className="p-8">
      {/* header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Rapports Carburant</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {filtered.length} prélèvement{filtered.length !== 1 ? 's' : ''} — {fmtL(totalLiters)} — {fmt(totalAmount)}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} disabled={exporting || filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border font-semibold text-sm disabled:opacity-40 transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
            <Download className="w-4 h-4" /> Excel
          </button>
          <button onClick={exportPDF} disabled={exporting || filtered.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-40 transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--primary)' }}>
            <FileText className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      <CompanyFilterBar filter={{ allCompanyIds, selectedCompanyIds: companyIds, companyInfos, hasMultiple: allCompanyIds.length > 1 }} onChange={setSelectedCompanies} />

      {/* date range + filters */}
      <div className="rounded-xl border p-5 mb-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Filtres</span>
          {hasFilters && (
            <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <X className="w-3 h-3" /> Effacer
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {/* date range */}
          <div className="col-span-2 md:col-span-2 grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Du</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="w-full pl-8 pr-2 py-2 border rounded-lg text-xs outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Au</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="w-full pl-8 pr-2 py-2 border rounded-lg text-xs outline-none"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>

          {/* search */}
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Bus, chauffeur, station…"
              className="w-full pl-9 pr-3 py-2.5 border rounded-lg text-sm outline-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }} />
          </div>

          <select value={filterFuelType} onChange={e => setFilterFuelType(e.target.value)}
            className="px-3 py-2.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Tous types</option>
            <option value="essence">Essence</option>
            <option value="gasoil">Gasoil</option>
          </select>

          <select value={filterStation} onChange={e => setFilterStation(e.target.value)}
            className="px-3 py-2.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Toutes stations</option>
            {allStations.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
            className="px-3 py-2.5 border rounded-lg text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
            <option value="">Toutes villes</option>
            {allCities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* summary strip */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Prélèvements', value: filtered.length, color: 'var(--primary)' },
            { label: 'Total litres', value: fmtL(totalLiters), color: '#3B82F6' },
            { label: 'Montant total', value: fmt(totalAmount), color: '#16A34A' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border p-4 flex items-center gap-3"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-2xl" style={{ borderColor: 'var(--border)' }}>
          <Fuel className="w-12 h-12 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Aucun prélèvement trouvé</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Ajustez la période ou les filtres</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" id="report-table">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle, #F9FAFB)' }}>
                  {['Date', 'Immatriculation', 'Chauffeur', 'Station', 'Ville', 'Type', 'Litres', 'Prix unit.', 'Montant total'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(w => (
                  <tr key={w.id} className="border-t hover:bg-gray-50 transition-colors"
                    style={{ borderColor: 'var(--border)' }}>
                    <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {format(new Date(w.withdrawal_date), 'dd MMM yyyy', { locale: fr })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>
                        {w.registration_number}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                      {w.driver_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{w.station_name}</div>
                      <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{w.station_code}</div>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {w.city || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ backgroundColor: `${FUEL_COLORS[w.fuel_type]}18`, color: FUEL_COLORS[w.fuel_type] }}>
                        {FUEL_LABELS[w.fuel_type] || w.fuel_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-sm" style={{ color: '#3B82F6' }}>
                      {fmtL(w.liters)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {w.unit_price != null ? `${w.unit_price.toLocaleString('fr-FR')} F/L` : '—'}
                    </td>
                    <td className="px-4 py-3 font-bold text-sm" style={{ color: '#16A34A' }}>
                      {fmt(w.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <td colSpan={6} className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-right"
                    style={{ color: 'var(--text-secondary)' }}>
                    TOTAUX
                  </td>
                  <td className="px-4 py-3 font-black text-sm" style={{ color: '#3B82F6' }}>{fmtL(totalLiters)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 font-black text-sm" style={{ color: '#16A34A' }}>{fmt(totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
