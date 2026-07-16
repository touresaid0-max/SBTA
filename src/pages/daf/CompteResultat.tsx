import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import {
  Building2, Calendar, Download, FileSpreadsheet, FileText,
  ChevronDown, ChevronRight, Save, Loader2, RefreshCw
} from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';

interface Company {
  id: string;
  name: string;
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

export default function CompteResultat() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [fiscalYear, setFiscalYear] = useState<number>(new Date().getFullYear());
  const [lines, setLines] = useState<LineEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    supabase.from('companies').select('id, name').order('name')
      .then(({ data }) => { if (data) setCompanies(data); });
  }, []);

  const initLines = useCallback((): LineEntry[] => {
    return STRUCTURE.map(s => ({ ...s, amount_n: 0, amount_n1: 0 }));
  }, []);

  const computeLines = useCallback((rawLines: LineEntry[]): LineEntry[] => {
    const map: Record<string, { n: number; n1: number }> = {};
    rawLines.forEach(l => { map[l.ref] = { n: l.amount_n, n1: l.amount_n1 }; });

    const getVal = (ref: string, field: 'n' | 'n1') => map[ref]?.[field] || 0;

    const compute = (formula: string, field: 'n' | 'n1'): number => {
      const refs = formula.split('+');
      return refs.reduce((sum, r) => sum + getVal(r.trim(), field), 0);
    };

    const result = rawLines.map(l => {
      if (l.isComputed && l.formula) {
        const n = compute(l.formula, 'n');
        const n1 = compute(l.formula, 'n1');
        map[l.ref] = { n, n1 };
        return { ...l, amount_n: n, amount_n1: n1 };
      }
      return l;
    });
    return result;
  }, []);

  const loadData = useCallback(async () => {
    if (!selectedCompany || !fiscalYear) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('income_statement_entries')
        .select('ref_code, amount_n, amount_n1')
        .eq('company_id', selectedCompany)
        .eq('fiscal_year', fiscalYear);

      if (error) throw error;

      const base = initLines();
      if (data && data.length > 0) {
        setHasData(true);
        data.forEach(entry => {
          const line = base.find(l => l.ref === entry.ref_code);
          if (line && !line.isComputed) {
            line.amount_n = Number(entry.amount_n) || 0;
            line.amount_n1 = Number(entry.amount_n1) || 0;
          }
        });
      } else {
        setHasData(false);
      }
      setLines(computeLines(base));
    } catch (err: any) {
      toast.error(err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, fiscalYear, initLines, computeLines]);

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
      const inputLines = lines.filter(l => !l.isComputed);
      const computedLines = lines.filter(l => l.isComputed);
      const allLinesToSave = [...inputLines, ...computedLines];

      const rows = allLinesToSave.map(l => ({
        company_id: selectedCompany,
        fiscal_year: fiscalYear,
        ref_code: l.ref,
        amount_n: l.amount_n,
        amount_n1: l.amount_n1,
        created_by: null,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('income_statement_entries')
        .upsert(rows, { onConflict: 'company_id,fiscal_year,ref_code' });

      if (error) throw error;
      setHasData(true);
      toast.success('Compte de résultat enregistré');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  const companyName = companies.find(c => c.id === selectedCompany)?.name || '';

  const exportExcel = () => {
    const ws_data = [
      ['COMPTE DE RESULTAT AU 31/12/' + fiscalYear],
      ['Société: ' + companyName],
      [],
      ['REF', 'LIBELLES', 'SIGNE', 'NOTE', `Exercice au 31/12/${fiscalYear}`, `Exercice au 31/12/${fiscalYear - 1}`],
    ];
    lines.forEach(l => {
      ws_data.push([l.ref, l.label, l.sign, l.note, l.amount_n.toString(), l.amount_n1.toString()]);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = [{ wch: 6 }, { wch: 55 }, { wch: 6 }, { wch: 8 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Compte de résultat');
    XLSX.writeFile(wb, `Compte_Resultat_${companyName}_${fiscalYear}.xlsx`);
    toast.success('Export Excel terminé');
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 20;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('COMPTE DE RESULTAT AU 31/12/' + fiscalYear, pageW / 2, y, { align: 'center' });
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Société: ' + companyName, pageW / 2, y, { align: 'center' });
    y += 10;

    const colX = [margin, margin + 10, margin + 95, margin + 107, margin + 117, margin + 148];
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('REF', colX[0], y);
    doc.text('LIBELLES', colX[1], y);
    doc.text('(2)', colX[2], y);
    doc.text('NOTE', colX[3], y);
    doc.text(`31/12/${fiscalYear}`, colX[4], y);
    doc.text(`31/12/${fiscalYear - 1}`, colX[5], y);
    y += 2;
    doc.setDrawColor(0);
    doc.line(margin, y, pageW - margin, y);
    y += 4;

    doc.setFontSize(7);
    lines.forEach(l => {
      if (y > 275) {
        doc.addPage();
        y = 20;
      }
      if (l.isBold) {
        doc.setFont('helvetica', 'bold');
      } else {
        doc.setFont('helvetica', 'normal');
      }
      doc.text(l.ref, colX[0], y);
      doc.text(l.label.substring(0, 50), colX[1], y);
      doc.text(l.sign, colX[2], y);
      doc.text(l.note, colX[3], y);
      doc.text(formatNum(l.amount_n), colX[4], y);
      doc.text(formatNum(l.amount_n1), colX[5], y);
      y += 5;
      if (l.isBold) {
        doc.setDrawColor(200);
        doc.line(margin, y - 2, pageW - margin, y - 2);
      }
    });

    doc.save(`Compte_Resultat_${companyName}_${fiscalYear}.pdf`);
    toast.success('Export PDF terminé');
  };

  const formatNum = (val: number): string => {
    if (val === 0) return '-';
    return val.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1E293B] mb-1">Compte de résultat</h1>
        <p className="text-sm text-[#64748B]">Système comptable OHADA - Système Normal</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 mb-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
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
              <option value="">-- Sélectionner --</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#374151] mb-1.5">
              <Calendar className="w-4 h-4 inline mr-1.5 text-[#64748B]" />
              Exercice comptable
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
                         hover:bg-[#095e2e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
            <button
              onClick={loadData}
              disabled={loading || !selectedCompany}
              className="flex items-center gap-2 px-3 py-2.5 border border-[#D1D5DB] rounded-lg text-sm
                         hover:bg-[#F9FAFB] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={exportExcel}
              disabled={!selectedCompany || lines.length === 0}
              className="flex items-center gap-2 px-3 py-2.5 border border-[#D1D5DB] rounded-lg text-sm
                         hover:bg-[#F0FDF4] text-[#0B7439] font-medium transition-colors disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Excel
            </button>
            <button
              onClick={exportPDF}
              disabled={!selectedCompany || lines.length === 0}
              className="flex items-center gap-2 px-3 py-2.5 border border-[#D1D5DB] rounded-lg text-sm
                         hover:bg-[#FEF2F2] text-[#DC2626] font-medium transition-colors disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              PDF
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      {!selectedCompany ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-16 text-center">
          <Building2 className="w-16 h-16 mx-auto mb-4 text-[#D1D5DB]" />
          <p className="text-[#64748B]">Sélectionnez une société pour afficher le compte de résultat</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-16 text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 text-[#0B7439] animate-spin" />
          <p className="text-[#64748B]">Chargement...</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
          {/* Title bar */}
          <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <h2 className="text-sm font-bold text-[#1E293B] uppercase tracking-wide">
              Compte de résultat au 31/12/{fiscalYear}
            </h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              {companyName} - Comparaison avec l'exercice au 31/12/{fiscalYear - 1}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F1F5F9] border-b border-[#E2E8F0]">
                  <th className="text-left px-4 py-3 font-semibold text-[#374151] w-[60px]">REF</th>
                  <th className="text-left px-4 py-3 font-semibold text-[#374151]">LIBELLES</th>
                  <th className="text-center px-3 py-3 font-semibold text-[#374151] w-[50px]">(2)</th>
                  <th className="text-center px-3 py-3 font-semibold text-[#374151] w-[60px]">NOTE</th>
                  <th className="text-right px-4 py-3 font-semibold text-[#374151] w-[170px]">
                    Exercice au 31/12/{fiscalYear}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-[#374151] w-[170px]">
                    Exercice au 31/12/{fiscalYear - 1}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const isExpanded = expandedRef === line.ref;
                  return (
                    <React.Fragment key={line.ref}>
                      <tr
                        className={`border-b border-[#F1F5F9] transition-colors
                          ${line.isBold ? 'bg-[#F8FAFC]' : 'hover:bg-[#FAFAFA]'}
                          ${line.isComputed ? 'cursor-default' : 'cursor-pointer'}
                        `}
                        onClick={() => !line.isComputed && setExpandedRef(isExpanded ? null : line.ref)}
                      >
                        <td className={`px-4 py-2.5 ${line.isBold ? 'font-bold text-[#1E293B]' : 'text-[#475569]'}`}>
                          <div className="flex items-center gap-1">
                            {!line.isComputed && (
                              isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5 text-[#94A3B8]" />
                                : <ChevronRight className="w-3.5 h-3.5 text-[#94A3B8]" />
                            )}
                            {line.ref}
                          </div>
                        </td>
                        <td className={`px-4 py-2.5 ${line.isBold ? 'font-bold text-[#1E293B]' : 'text-[#374151]'}`}>
                          {line.label}
                        </td>
                        <td className="px-3 py-2.5 text-center text-[#64748B]">{line.sign}</td>
                        <td className="px-3 py-2.5 text-center text-[#64748B]">{line.note}</td>
                        <td className={`px-4 py-2.5 text-right font-mono ${line.isBold ? 'font-bold text-[#1E293B]' : 'text-[#374151]'}`}>
                          {line.isComputed ? (
                            <span className={line.amount_n < 0 ? 'text-[#DC2626]' : ''}>
                              {formatNum(line.amount_n)}
                            </span>
                          ) : (
                            <span>{formatNum(line.amount_n)}</span>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono ${line.isBold ? 'font-bold text-[#1E293B]' : 'text-[#374151]'}`}>
                          {line.isComputed ? (
                            <span className={line.amount_n1 < 0 ? 'text-[#DC2626]' : ''}>
                              {formatNum(line.amount_n1)}
                            </span>
                          ) : (
                            <span>{formatNum(line.amount_n1)}</span>
                          )}
                        </td>
                      </tr>
                      {/* Expanded row for editing */}
                      {isExpanded && !line.isComputed && (
                        <tr className="bg-[#FEFCE8] border-b border-[#FDE68A]">
                          <td colSpan={4} className="px-4 py-3">
                            <span className="text-xs font-medium text-[#92400E]">
                              Saisie des montants pour : {line.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={line.amount_n || ''}
                              onChange={e => handleAmountChange(line.ref, 'amount_n', e.target.value)}
                              className="w-full px-3 py-1.5 border border-[#D1D5DB] rounded text-sm text-right font-mono
                                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={line.amount_n1 || ''}
                              onChange={e => handleAmountChange(line.ref, 'amount_n1', e.target.value)}
                              className="w-full px-3 py-1.5 border border-[#D1D5DB] rounded text-sm text-right font-mono
                                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
                              placeholder="0"
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer summary */}
          <div className="px-6 py-4 border-t border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {['XA', 'XB', 'XE', 'XI'].map(ref => {
                const l = lines.find(x => x.ref === ref);
                if (!l) return null;
                return (
                  <div key={ref} className="text-center">
                    <p className="text-xs text-[#64748B] mb-1">{l.label.split('(')[0].trim()}</p>
                    <p className={`text-base font-bold ${l.amount_n < 0 ? 'text-[#DC2626]' : 'text-[#0B7439]'}`}>
                      {formatNum(l.amount_n)} FCFA
                    </p>
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
