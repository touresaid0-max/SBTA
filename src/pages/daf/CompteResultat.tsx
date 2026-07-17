import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import {
  Building2, Calendar, FileSpreadsheet, FileText, ChevronDown, ChevronRight,
  Save, Loader2, RefreshCw, Database, TrendingUp, TrendingDown, Info
} from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';

interface Company {
  id: string;
  name: string;
  parent_id: string | null;
  children?: Company[];
}

interface DetailItem {
  source: string;
  date: string;
  description: string;
  amount: number;
}

interface LineEntry {
  ref: string;
  label: string;
  sign: string;
  note: string;
  isComputed: boolean;
  isBold: boolean;
  amount_n: number;
  amount_n1: number;
  formula?: string;
  detail_n?: DetailItem[];
  detail_n1?: DetailItem[];
  autoPopulated?: boolean;
}

const STRUCTURE: Omit<LineEntry, 'amount_n' | 'amount_n1'>[] = [
  { ref: 'TA', label: 'Ventes de marchandises', sign: '+', note: '21', isComputed: false, isBold: false },
  { ref: 'RA', label: 'Achats de marchandises', sign: '-', note: '22', isComputed: false, isBold: false },
  { ref: 'RB', label: 'Variation de stocks de marchandises', sign: '-/+', note: '6', isComputed: false, isBold: false },
  { ref: 'XA', label: 'MARGE COMMERCIALE (Somme TA à RB)', sign: '', note: '', isComputed: true, isBold: true, formula: 'TA+RA+RB' },
  { ref: 'TB', label: 'Ventes de produits fabriqués', sign: '+', note: '21', isComputed: false, isBold: false },
  { ref: 'TC', label: 'Travaux, services vendus', sign: '+', note: '21', isComputed: false, isBold: false },
  { ref: 'TD', label: 'Produits accessoires', sign: '+', note: '21', isComputed: false, isBold: false },
  { ref: 'XB', label: 'CHIFFRE D\'AFFAIRES (A + B + C + D)', sign: '', note: '', isComputed: true, isBold: true, formula: 'TA+TB+TC+TD' },
  { ref: 'TE', label: 'Production stockée (ou déstockage)', sign: '-/+', note: '6', isComputed: false, isBold: false },
  { ref: 'TF', label: 'Production immobilisée', sign: '+', note: '21', isComputed: false, isBold: false },
  { ref: 'TG', label: 'Subventions d\'exploitation', sign: '+', note: '21', isComputed: false, isBold: false },
  { ref: 'TH', label: 'Autres produits', sign: '+', note: '21', isComputed: false, isBold: false },
  { ref: 'TI', label: 'Transferts de charges d\'exploitation', sign: '+', note: '12', isComputed: false, isBold: false },
  { ref: 'RC', label: 'Achats de matières premières et fournitures liées', sign: '-', note: '22', isComputed: false, isBold: false },
  { ref: 'RD', label: 'Variation de stocks de matières premières et fournitures liées', sign: '-/+', note: '6', isComputed: false, isBold: false },
  { ref: 'RE', label: 'Autres achats', sign: '-', note: '22', isComputed: false, isBold: false },
  { ref: 'RF', label: 'Variation de stocks d\'autres approvisionnements', sign: '-/+', note: '6', isComputed: false, isBold: false },
  { ref: 'RG', label: 'Transports', sign: '-', note: '23', isComputed: false, isBold: false },
  { ref: 'RH', label: 'Services extérieurs', sign: '-', note: '24', isComputed: false, isBold: false },
  { ref: 'RI', label: 'Impôts et taxes', sign: '-', note: '25', isComputed: false, isBold: false },
  { ref: 'RJ', label: 'Autres charges', sign: '-', note: '26', isComputed: false, isBold: false },
  { ref: 'XC', label: 'VALEUR AJOUTEE', sign: '', note: '', isComputed: true, isBold: true, formula: 'XB+RA+RB+TE+TF+TG+TH+TI+RC+RD+RE+RF+RG+RH+RI+RJ' },
  { ref: 'RK', label: 'Charges de personnel', sign: '-', note: '27', isComputed: false, isBold: false },
  { ref: 'XD', label: 'EXCEDENT BRUT D\'EXPLOITATION', sign: '', note: '', isComputed: true, isBold: true, formula: 'XC+RK' },
  { ref: 'TJ', label: 'Reprises d\'amortissements, provisions et dépréciations', sign: '+', note: '28', isComputed: false, isBold: false },
  { ref: 'RL', label: 'Dotations aux amortissements, aux provisions et dépréciations', sign: '-', note: '3C&28', isComputed: false, isBold: false },
  { ref: 'XE', label: 'RESULTAT D\'EXPLOITATION', sign: '', note: '', isComputed: true, isBold: true, formula: 'XD+TJ+RL' },
  { ref: 'TK', label: 'Revenus financiers et assimilés', sign: '+', note: '29', isComputed: false, isBold: false },
  { ref: 'TL', label: 'Reprises de provisions et dépréciations financières', sign: '+', note: '28', isComputed: false, isBold: false },
  { ref: 'TM', label: 'Transferts de charges financières', sign: '+', note: '12', isComputed: false, isBold: false },
  { ref: 'RM', label: 'Frais financiers et charges assimilées', sign: '-', note: '29', isComputed: false, isBold: false },
  { ref: 'RN', label: 'Dotations aux provisions et aux dépréciations financières', sign: '-', note: '3C&28', isComputed: false, isBold: false },
  { ref: 'XF', label: 'RESULTAT FINANCIER (somme TK à RN)', sign: '', note: '', isComputed: true, isBold: true, formula: 'TK+TL+TM+RM+RN' },
  { ref: 'XG', label: 'RESULTAT DES ACTIVITES ORDINAIRES', sign: '', note: '', isComputed: true, isBold: true, formula: 'XE+XF' },
  { ref: 'TN', label: 'Produits des cessions d\'immobilisations', sign: '+', note: '3D', isComputed: false, isBold: false },
  { ref: 'TO', label: 'Autres Produits HAO', sign: '+', note: '30', isComputed: false, isBold: false },
  { ref: 'RO', label: 'Valeurs comptables des cessions d\'immobilisations', sign: '-', note: '3D', isComputed: false, isBold: false },
  { ref: 'RP', label: 'Autres Charges HAO', sign: '-', note: '30', isComputed: false, isBold: false },
  { ref: 'XH', label: 'RESULTAT HORS ACTIVITES ORDINAIRES', sign: '', note: '', isComputed: true, isBold: true, formula: 'TN+TO+RO+RP' },
  { ref: 'RQ', label: 'Participation des travailleurs', sign: '-', note: '30', isComputed: false, isBold: false },
  { ref: 'RS', label: 'Impôts sur le résultat', sign: '-', note: '', isComputed: false, isBold: false },
  { ref: 'XI', label: 'RESULTAT NET', sign: '', note: '', isComputed: true, isBold: true, formula: 'XG+XH+RQ+RS' },
];

const AUTO_REFS = ['TC', 'RE', 'RF', 'RG', 'RH', 'RJ', 'RK'];

export default function CompteResultat() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [fiscalYear, setFiscalYear] = useState<number>(new Date().getFullYear());
  const [lines, setLines] = useState<LineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedRef, setExpandedRef] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('companies').select('id, name, parent_id').order('name')
      .then(({ data }) => {
        if (data) {
          const parents = data.filter(c => !c.parent_id);
          const grouped = parents.map(p => ({
            ...p,
            children: data.filter(c => c.parent_id === p.id)
          }));
          setCompanies(grouped);
        }
      });
  }, []);

  const initLines = useCallback((): LineEntry[] => {
    return STRUCTURE.map(s => ({ ...s, amount_n: 0, amount_n1: 0 }));
  }, []);

  const computeLines = useCallback((rawLines: LineEntry[]): LineEntry[] => {
    const map: Record<string, { n: number; n1: number }> = {};
    rawLines.forEach(l => { map[l.ref] = { n: l.amount_n, n1: l.amount_n1 }; });

    const getVal = (ref: string, field: 'n' | 'n1') => map[ref]?.[field] || 0;
    const compute = (formula: string, field: 'n' | 'n1'): number => {
      return formula.split('+').reduce((sum, r) => sum + getVal(r.trim(), field), 0);
    };

    return rawLines.map(l => {
      if (l.isComputed && l.formula) {
        const n = compute(l.formula, 'n');
        const n1 = compute(l.formula, 'n1');
        map[l.ref] = { n, n1 };
        return { ...l, amount_n: n, amount_n1: n1 };
      }
      return l;
    });
  }, []);

  const getCompanyIds = useCallback((companyId: string): string[] => {
    const company = companies.find(c => c.id === companyId);
    if (company?.children && company.children.length > 0) {
      return company.children.map(c => c.id);
    }
    return [companyId];
  }, [companies]);

  const loadData = useCallback(async () => {
    if (!selectedCompany || !fiscalYear) return;
    setLoading(true);
    try {
      const base = initLines();
      const companyIds = getCompanyIds(selectedCompany);

      // Load auto-computed data for N and N-1 (aggregate across sub-groups)
      const rpcCallsN = companyIds.map(id =>
        supabase.rpc('compute_income_statement', { p_company_id: id, p_fiscal_year: fiscalYear })
      );
      const rpcCallsN1 = companyIds.map(id =>
        supabase.rpc('compute_income_statement', { p_company_id: id, p_fiscal_year: fiscalYear - 1 })
      );
      const [resultsN, resultsN1, savedData] = await Promise.all([
        Promise.all(rpcCallsN),
        Promise.all(rpcCallsN1),
        supabase.from('income_statement_entries').select('ref_code, amount_n, amount_n1')
          .eq('company_id', selectedCompany).eq('fiscal_year', fiscalYear),
      ]);

      // Merge N results from all sub-companies
      const mergedN: Record<string, { amount: number; detail: DetailItem[] }> = {};
      resultsN.forEach(res => {
        if (res.data && Array.isArray(res.data)) {
          res.data.forEach((entry: { ref: string; amount: number; detail: DetailItem[] }) => {
            if (!mergedN[entry.ref]) mergedN[entry.ref] = { amount: 0, detail: [] };
            mergedN[entry.ref].amount += entry.amount;
            mergedN[entry.ref].detail = mergedN[entry.ref].detail.concat(entry.detail || []);
          });
        }
      });

      // Merge N-1 results
      const mergedN1: Record<string, { amount: number; detail: DetailItem[] }> = {};
      resultsN1.forEach(res => {
        if (res.data && Array.isArray(res.data)) {
          res.data.forEach((entry: { ref: string; amount: number; detail: DetailItem[] }) => {
            if (!mergedN1[entry.ref]) mergedN1[entry.ref] = { amount: 0, detail: [] };
            mergedN1[entry.ref].amount += entry.amount;
            mergedN1[entry.ref].detail = mergedN1[entry.ref].detail.concat(entry.detail || []);
          });
        }
      });

      const resN = { data: Object.entries(mergedN).map(([ref, v]) => ({ ref, ...v })) };
      const resN1 = { data: Object.entries(mergedN1).map(([ref, v]) => ({ ref, ...v })) };

      // Apply auto-computed data for year N
      if (resN.data) {
        resN.data.forEach((entry: { ref: string; amount: number; detail: DetailItem[] }) => {
          const line = base.find(l => l.ref === entry.ref);
          if (line) {
            line.amount_n = entry.amount;
            line.detail_n = entry.detail || [];
            line.autoPopulated = true;
          }
        });
      }

      // Apply auto-computed data for year N-1
      if (resN1.data) {
        resN1.data.forEach((entry: { ref: string; amount: number; detail: DetailItem[] }) => {
          const line = base.find(l => l.ref === entry.ref);
          if (line) {
            line.amount_n1 = entry.amount;
            line.detail_n1 = entry.detail || [];
          }
        });
      }

      // Overlay any manually saved data for NON-auto lines
      if (savedData.data && savedData.data.length > 0) {
        savedData.data.forEach((entry) => {
          const line = base.find(l => l.ref === entry.ref_code);
          if (line && !AUTO_REFS.includes(entry.ref_code) && !line.isComputed) {
            line.amount_n = Number(entry.amount_n) || 0;
            line.amount_n1 = Number(entry.amount_n1) || 0;
          }
        });
      }

      setLines(computeLines(base));
    } catch (err: any) {
      toast.error(err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, fiscalYear, initLines, computeLines, getCompanyIds]);

  useEffect(() => {
    if (selectedCompany && fiscalYear) loadData();
  }, [selectedCompany, fiscalYear, loadData]);

  const handleAmountChange = (ref: string, field: 'amount_n' | 'amount_n1', value: string) => {
    const numVal = parseFloat(value) || 0;
    const updated = lines.map(l => l.ref === ref ? { ...l, [field]: numVal } : l);
    setLines(computeLines(updated));
  };

  const handleSave = async () => {
    if (!selectedCompany || !fiscalYear) {
      toast.error('Sélectionnez une société et un exercice');
      return;
    }
    setSaving(true);
    try {
      const allLines = lines.filter(l => !l.isComputed);
      const rows = allLines.map(l => ({
        company_id: selectedCompany,
        fiscal_year: fiscalYear,
        ref_code: l.ref,
        amount_n: l.amount_n,
        amount_n1: l.amount_n1,
        updated_at: new Date().toISOString()
      }));
      // Also save computed subtotals for historical record
      const computedRows = lines.filter(l => l.isComputed).map(l => ({
        company_id: selectedCompany,
        fiscal_year: fiscalYear,
        ref_code: l.ref,
        amount_n: l.amount_n,
        amount_n1: l.amount_n1,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('income_statement_entries')
        .upsert([...rows, ...computedRows], { onConflict: 'company_id,fiscal_year,ref_code' });

      if (error) throw error;
      toast.success('Compte de résultat enregistré');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const companyName = (() => {
    const c = companies.find(x => x.id === selectedCompany);
    if (c) return c.children && c.children.length > 0 ? `${c.name} (Groupe)` : c.name;
    for (const parent of companies) {
      const child = parent.children?.find(x => x.id === selectedCompany);
      if (child) return child.name;
    }
    return '';
  })();

  const formatNum = (val: number): string => {
    if (val === 0) return '-';
    return Math.round(val).toLocaleString('fr-FR');
  };

  const formatNumPdf = (val: number): string => {
    if (val === 0) return '-';
    const abs = Math.abs(Math.round(val));
    const str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return val < 0 ? '-' + str : str;
  };

  const exportExcel = () => {
    const ws_data = [
      ['COMPTE DE RESULTAT AU 31/12/' + fiscalYear],
      ['Société: ' + companyName],
      ['Système comptable OHADA - Système Normal'],
      [],
      ['REF', 'LIBELLES', '(2)', 'NOTE', `Exercice 31/12/${fiscalYear}`, `Exercice 31/12/${fiscalYear - 1}`],
    ];
    lines.forEach(l => {
      ws_data.push([l.ref, l.label, l.sign, l.note,
        l.amount_n ? Math.round(l.amount_n).toString() : '',
        l.amount_n1 ? Math.round(l.amount_n1).toString() : ''
      ]);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = [{ wch: 6 }, { wch: 55 }, { wch: 6 }, { wch: 8 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Compte de résultat');
    XLSX.writeFile(wb, `Compte_Resultat_${companyName.replace(/\s/g,'_')}_${fiscalYear}.xlsx`);
    toast.success('Export Excel terminé');
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 12;
    let y = 18;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('COMPTE DE RESULTAT AU 31/12/' + fiscalYear, pageW / 2, y, { align: 'center' });
    y += 7;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Société: ' + companyName, pageW / 2, y, { align: 'center' });
    y += 5;
    doc.text('Système comptable OHADA - Système Normal', pageW / 2, y, { align: 'center' });
    y += 8;

    // Header row
    const colX = [margin, margin + 10, margin + 100, margin + 112, margin + 122, margin + 155];
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text('REF', colX[0], y);
    doc.text('LIBELLES', colX[1], y);
    doc.text('(2)', colX[2], y);
    doc.text('NOTE', colX[3], y);
    doc.text(`31/12/${fiscalYear}`, colX[4], y);
    doc.text(`31/12/${fiscalYear - 1}`, colX[5], y);
    y += 2;
    doc.line(margin, y, pageW - margin, y);
    y += 4;

    doc.setFontSize(7);
    lines.forEach(l => {
      if (y > 278) { doc.addPage(); y = 15; }
      doc.setFont('helvetica', l.isBold ? 'bold' : 'normal');
      doc.text(l.ref, colX[0], y);
      const label = l.label.length > 55 ? l.label.substring(0, 55) + '...' : l.label;
      doc.text(label, colX[1], y);
      doc.text(l.sign, colX[2], y);
      doc.text(l.note, colX[3], y);
      doc.text(formatNumPdf(l.amount_n), colX[4], y);
      doc.text(formatNumPdf(l.amount_n1), colX[5], y);
      y += 5;
      if (l.isBold) {
        doc.setDrawColor(180);
        doc.line(margin, y - 2, pageW - margin, y - 2);
      }
    });

    doc.save(`Compte_Resultat_${companyName.replace(/\s/g,'_')}_${fiscalYear}.pdf`);
    toast.success('Export PDF terminé');
  };

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1E293B] mb-1">Compte de résultat</h1>
        <p className="text-sm text-[#64748B]">
          Système comptable OHADA - Alimenté automatiquement depuis les données de la plateforme
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 mb-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          <div className="lg:col-span-2">
            <label className="block text-sm font-semibold text-[#374151] mb-1.5">
              <Building2 className="w-4 h-4 inline mr-1.5 text-[#64748B]" />
              Société
            </label>
            <select
              value={selectedCompany}
              onChange={e => setSelectedCompany(e.target.value)}
              className="w-full px-3 py-2.5 border border-[#D1D5DB] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
            >
              <option value="">-- Sélectionner une société --</option>
              {companies.map(c => (
                <React.Fragment key={c.id}>
                  <option value={c.id}>
                    {c.children && c.children.length > 0 ? `▸ ${c.name} (Groupe)` : c.name}
                  </option>
                  {c.children && c.children.length > 0 && c.children.map(child => (
                    <option key={child.id} value={child.id}>
                      {'    '}{child.name}
                    </option>
                  ))}
                </React.Fragment>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#374151] mb-1.5">
              <Calendar className="w-4 h-4 inline mr-1.5 text-[#64748B]" />
              Exercice
            </label>
            <select
              value={fiscalYear}
              onChange={e => setFiscalYear(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-[#D1D5DB] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !selectedCompany || lines.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#0B7439] text-white rounded-lg text-sm font-medium
                         hover:bg-[#095e2e] disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
            <button
              onClick={loadData}
              disabled={loading || !selectedCompany}
              className="flex items-center gap-2 px-3 py-2.5 border border-[#D1D5DB] rounded-lg text-sm
                         hover:bg-[#F9FAFB] disabled:opacity-50 transition-colors"
              title="Actualiser les données"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={exportExcel}
              disabled={!selectedCompany || lines.length === 0}
              className="flex items-center gap-1.5 px-3 py-2.5 border border-[#D1D5DB] rounded-lg text-sm
                         hover:bg-[#F0FDF4] text-[#0B7439] font-medium disabled:opacity-50 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" /> Excel
            </button>
            <button
              onClick={exportPDF}
              disabled={!selectedCompany || lines.length === 0}
              className="flex items-center gap-1.5 px-3 py-2.5 border border-[#D1D5DB] rounded-lg text-sm
                         hover:bg-[#FEF2F2] text-[#DC2626] font-medium disabled:opacity-50 transition-colors"
            >
              <FileText className="w-4 h-4" /> PDF
            </button>
          </div>
        </div>
      </div>

      {/* Info banner */}
      {selectedCompany && !loading && lines.length > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl mb-5">
          <Database className="w-5 h-5 text-[#2563EB] mt-0.5 flex-shrink-0" />
          <div className="text-sm text-[#1E40AF]">
            <span className="font-medium">Données auto-alimentées :</span> Les lignes TC, RE, RF, RG, RH, RJ, RK
            sont calculées automatiquement depuis les modules de la plateforme (billets, colis, bagages,
            carburant, charges, stock, salaires). Cliquez sur une ligne pour voir le détail.
          </div>
        </div>
      )}

      {/* Table */}
      {!selectedCompany ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-16 text-center">
          <Building2 className="w-16 h-16 mx-auto mb-4 text-[#D1D5DB]" />
          <p className="text-[#64748B]">Sélectionnez une société pour afficher le compte de résultat</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-16 text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 text-[#0B7439] animate-spin" />
          <p className="text-[#64748B]">Chargement et calcul des données...</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#1E293B] uppercase tracking-wide">
                Compte de résultat au 31/12/{fiscalYear}
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                {companyName} - Comparaison avec l'exercice au 31/12/{fiscalYear - 1}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-[#64748B]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]"></span> Auto
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#D1D5DB]"></span> Manuel
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0]">
                  <th className="text-left px-4 py-3 font-semibold text-[#374151] w-[70px]">REF</th>
                  <th className="text-left px-4 py-3 font-semibold text-[#374151]">LIBELLES</th>
                  <th className="text-center px-2 py-3 font-semibold text-[#374151] w-[45px]">(2)</th>
                  <th className="text-center px-2 py-3 font-semibold text-[#374151] w-[55px]">NOTE</th>
                  <th className="text-right px-4 py-3 font-semibold text-[#374151] w-[160px]">
                    31/12/{fiscalYear}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[#374151] w-[160px]">
                    31/12/{fiscalYear - 1}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const isExpanded = expandedRef === line.ref;
                  const isAuto = AUTO_REFS.includes(line.ref);
                  const hasDetail = (line.detail_n && line.detail_n.length > 0) || (line.detail_n1 && line.detail_n1.length > 0);
                  const canExpand = !line.isComputed;

                  return (
                    <React.Fragment key={line.ref}>
                      <tr
                        className={`border-b border-[#F1F5F9] transition-colors
                          ${line.isBold ? 'bg-[#F8FAFC]' : 'hover:bg-[#FAFAFA]'}
                          ${canExpand ? 'cursor-pointer' : ''}
                        `}
                        onClick={() => canExpand && setExpandedRef(isExpanded ? null : line.ref)}
                      >
                        <td className={`px-4 py-2.5 ${line.isBold ? 'font-bold text-[#1E293B]' : 'text-[#475569]'}`}>
                          <div className="flex items-center gap-1">
                            {canExpand && (
                              isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5 text-[#94A3B8]" />
                                : <ChevronRight className="w-3.5 h-3.5 text-[#94A3B8]" />
                            )}
                            <span>{line.ref}</span>
                            {isAuto && (
                              <span className="ml-1 w-2 h-2 rounded-full bg-[#2563EB] inline-block" title="Auto-alimenté"></span>
                            )}
                          </div>
                        </td>
                        <td className={`px-4 py-2.5 ${line.isBold ? 'font-bold text-[#1E293B]' : 'text-[#374151]'}`}>
                          {line.label}
                        </td>
                        <td className="px-2 py-2.5 text-center text-[#64748B] text-xs">{line.sign}</td>
                        <td className="px-2 py-2.5 text-center text-[#64748B] text-xs">{line.note}</td>
                        <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${line.isBold ? 'font-bold' : ''} ${line.amount_n < 0 ? 'text-[#DC2626]' : 'text-[#1E293B]'}`}>
                          {formatNum(line.amount_n)}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${line.isBold ? 'font-bold' : ''} ${line.amount_n1 < 0 ? 'text-[#DC2626]' : 'text-[#64748B]'}`}>
                          {formatNum(line.amount_n1)}
                        </td>
                      </tr>

                      {/* Expanded drill-down / edit */}
                      {isExpanded && canExpand && (
                        <tr className="border-b border-[#E2E8F0]">
                          <td colSpan={6} className="p-0">
                            {isAuto && hasDetail ? (
                              <DrillDown line={line} fiscalYear={fiscalYear} />
                            ) : isAuto && !hasDetail ? (
                              <div className="px-8 py-4 bg-[#F9FAFB] text-sm text-[#64748B] italic">
                                Aucune écriture trouvée pour cet exercice.
                              </div>
                            ) : (
                              <ManualEdit line={line} onChange={handleAmountChange} fiscalYear={fiscalYear} />
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary footer */}
          <div className="px-6 py-5 border-t border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { ref: 'XB', color: '#2563EB' },
                { ref: 'XC', color: '#0B7439' },
                { ref: 'XE', color: '#D97706' },
                { ref: 'XI', color: '#7C3AED' },
              ].map(({ ref, color }) => {
                const l = lines.find(x => x.ref === ref);
                if (!l) return null;
                const isNeg = l.amount_n < 0;
                return (
                  <div key={ref} className="text-center">
                    <p className="text-xs text-[#64748B] mb-1.5 font-medium">{l.label.split('(')[0].trim()}</p>
                    <div className="flex items-center justify-center gap-1.5">
                      {isNeg ? <TrendingDown className="w-4 h-4 text-[#DC2626]" /> : <TrendingUp className="w-4 h-4" style={{ color }} />}
                      <span className={`text-lg font-bold ${isNeg ? 'text-[#DC2626]' : ''}`} style={{ color: isNeg ? undefined : color }}>
                        {formatNum(l.amount_n)}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#94A3B8] mt-0.5">FCFA</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DrillDown({ line, fiscalYear }: { line: LineEntry; fiscalYear: number }) {
  const details = line.detail_n || [];
  const groupedBySource = details.reduce<Record<string, { items: DetailItem[]; total: number }>>((acc, d) => {
    if (!acc[d.source]) acc[d.source] = { items: [], total: 0 };
    acc[d.source].items.push(d);
    acc[d.source].total += d.amount;
    return acc;
  }, {});

  return (
    <div className="bg-[#FAFBFC] border-t border-[#E2E8F0]">
      <div className="px-6 py-3 border-b border-[#E2E8F0] flex items-center gap-2">
        <Info className="w-4 h-4 text-[#2563EB]" />
        <span className="text-xs font-semibold text-[#374151]">
          Détail des écritures - {line.label} (Exercice {fiscalYear})
        </span>
        <span className="ml-auto text-xs text-[#64748B]">
          {details.length} opération{details.length > 1 ? 's' : ''}
        </span>
      </div>

      {Object.entries(groupedBySource).map(([source, { items, total }]) => (
        <div key={source} className="px-6 py-3 border-b border-[#F1F5F9] last:border-b-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#1E293B] bg-[#E2E8F0] px-2 py-0.5 rounded">
              {source}
            </span>
            <span className="text-xs font-mono font-semibold text-[#374151]">
              {Math.round(Math.abs(total)).toLocaleString('fr-FR')} FCFA
              <span className="text-[#94A3B8] ml-1">({items.length})</span>
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#64748B]">
                  <th className="text-left py-1 font-medium w-[90px]">Date</th>
                  <th className="text-left py-1 font-medium">Description</th>
                  <th className="text-right py-1 font-medium w-[100px]">Montant</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 50).map((item, i) => (
                  <tr key={i} className="border-t border-[#F1F5F9]">
                    <td className="py-1 text-[#64748B]">{item.date}</td>
                    <td className="py-1 text-[#374151] truncate max-w-[300px]">{item.description}</td>
                    <td className="py-1 text-right font-mono text-[#1E293B]">
                      {Math.round(Math.abs(item.amount)).toLocaleString('fr-FR')}
                    </td>
                  </tr>
                ))}
                {items.length > 50 && (
                  <tr>
                    <td colSpan={3} className="py-1 text-center text-[#94A3B8] italic">
                      ... et {items.length - 50} autres opérations
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {details.length === 0 && (
        <div className="px-6 py-4 text-sm text-[#64748B] italic">
          Aucune écriture trouvée pour cet exercice.
        </div>
      )}
    </div>
  );
}

function ManualEdit({ line, onChange, fiscalYear }: {
  line: LineEntry;
  onChange: (ref: string, field: 'amount_n' | 'amount_n1', value: string) => void;
  fiscalYear: number;
}) {
  return (
    <div className="bg-[#FFFBEB] px-6 py-4 border-t border-[#FDE68A]">
      <p className="text-xs font-medium text-[#92400E] mb-3">
        Saisie manuelle : {line.label}
      </p>
      <div className="grid grid-cols-2 gap-4 max-w-lg">
        <div>
          <label className="text-xs text-[#64748B] mb-1 block">Exercice {fiscalYear}</label>
          <input
            type="number"
            value={line.amount_n || ''}
            onChange={e => onChange(line.ref, 'amount_n', e.target.value)}
            className="w-full px-3 py-2 border border-[#D1D5DB] rounded-lg text-sm text-right font-mono
                       focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
            placeholder="0"
          />
        </div>
        <div>
          <label className="text-xs text-[#64748B] mb-1 block">Exercice {fiscalYear - 1}</label>
          <input
            type="number"
            value={line.amount_n1 || ''}
            onChange={e => onChange(line.ref, 'amount_n1', e.target.value)}
            className="w-full px-3 py-2 border border-[#D1D5DB] rounded-lg text-sm text-right font-mono
                       focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
            placeholder="0"
          />
        </div>
      </div>
    </div>
  );
}