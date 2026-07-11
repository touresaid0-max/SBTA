import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { FileText, Download, Loader2, Calendar, Filter, TrendingUp, TrendingDown, Wallet, DollarSign } from 'lucide-react'
import toast from 'react-hot-toast'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import jsPDF from 'jspdf'

interface ParcelExpense {
  id: string
  station_id: string
  agent_id: string
  expense_type: 'depense' | 'ratio'
  nature: string
  amount: number
  expense_date: string
  payment_method: string
  description: string | null
  created_at: string
  agent_name?: string
}

interface AgentOption {
  id: string
  full_name: string
}

type PeriodMode = 'jour' | 'semaine' | 'mois' | 'custom'

const PAYMENT_LABELS: Record<string, string> = {
  especes: 'Especes',
  mobile_money: 'Mobile Money',
  virement: 'Virement',
  cheque: 'Cheque',
  autre: 'Autre',
}

export default function AgentColisExpenseReport() {
  const { user } = useAuthStore()
  const stationId = user?.station_id

  const [expenses, setExpenses] = useState<ParcelExpense[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [parcelRevenue, setParcelRevenue] = useState(0)

  // Filters
  const [periodMode, setPeriodMode] = useState<PeriodMode>('jour')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [selectedAgent, setSelectedAgent] = useState<string>('all')

  const dateRange = useMemo(() => {
    const ref = parseISO(selectedDate)
    switch (periodMode) {
      case 'jour': return { from: selectedDate, to: selectedDate }
      case 'semaine': return { from: format(startOfWeek(ref, { weekStartsOn: 1 }), 'yyyy-MM-dd'), to: format(endOfWeek(ref, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
      case 'mois': return { from: format(startOfMonth(ref), 'yyyy-MM-dd'), to: format(endOfMonth(ref), 'yyyy-MM-dd') }
      case 'custom': return { from: customFrom, to: customTo }
    }
  }, [periodMode, selectedDate, customFrom, customTo])

  const fetchAgents = useCallback(async () => {
    if (!stationId) return
    const { data } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('station_id', stationId)
      .in('role', ['agent_colis', 'superviseur_colis'])
      .order('full_name')
    setAgents(data || [])
  }, [stationId])

  const fetchData = useCallback(async () => {
    if (!stationId) return
    setLoading(true)

    let query = supabase
      .from('parcel_service_expenses')
      .select('*, users:agent_id(full_name)')
      .eq('station_id', stationId)
      .gte('expense_date', dateRange.from)
      .lte('expense_date', dateRange.to)
      .order('expense_date', { ascending: false })

    if (selectedAgent !== 'all') {
      query = query.eq('agent_id', selectedAgent)
    }

    const { data: expData, error } = await query
    if (error) toast.error('Erreur chargement')
    const mapped = (expData || []).map((e: any) => ({ ...e, agent_name: e.users?.full_name || '-' }))
    setExpenses(mapped)

    // Fetch parcel revenue for same period and station
    let revQuery = supabase
      .from('parcels')
      .select('delivery_fee')
      .eq('origin_station_id', stationId)
      .gte('created_at', dateRange.from + 'T00:00:00')
      .lte('created_at', dateRange.to + 'T23:59:59')

    if (selectedAgent !== 'all') {
      revQuery = revQuery.eq('created_by', selectedAgent)
    }

    const { data: parcels } = await revQuery
    const rev = (parcels || []).reduce((sum, p) => sum + (p.delivery_fee || 0), 0)
    setParcelRevenue(rev)

    setLoading(false)
  }, [stationId, dateRange, selectedAgent])

  useEffect(() => { fetchAgents() }, [fetchAgents])
  useEffect(() => { fetchData() }, [fetchData])

  const totalDepenses = useMemo(() => expenses.filter(e => e.expense_type === 'depense').reduce((s, e) => s + e.amount, 0), [expenses])
  const totalRatios = useMemo(() => expenses.filter(e => e.expense_type === 'ratio').reduce((s, e) => s + e.amount, 0), [expenses])
  const totalDeductions = totalDepenses + totalRatios
  const soldeNet = parcelRevenue - totalDeductions
  const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA'

  const periodLabel = useMemo(() => {
    switch (periodMode) {
      case 'jour': return format(parseISO(dateRange.from), 'dd MMMM yyyy', { locale: fr })
      case 'semaine': return `${format(parseISO(dateRange.from), 'dd/MM', { locale: fr })} - ${format(parseISO(dateRange.to), 'dd/MM/yyyy', { locale: fr })}`
      case 'mois': return format(parseISO(dateRange.from), 'MMMM yyyy', { locale: fr })
      case 'custom': return `${format(parseISO(dateRange.from), 'dd/MM/yyyy')} - ${format(parseISO(dateRange.to), 'dd/MM/yyyy')}`
    }
  }, [periodMode, dateRange])

  const exportPDF = () => {
    const fmtPdf = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' F CFA'
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Rapport Depenses & Ratios - Service Courrier', 14, 20)
    doc.setFontSize(10)
    doc.text(`Periode : ${periodLabel}`, 14, 28)
    doc.text(`Date export : ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 34)

    let y = 45
    doc.setFontSize(11)
    doc.text(`Recettes courrier :`, 14, y); doc.text(fmtPdf(parcelRevenue), 120, y); y += 7
    doc.text(`Total Depenses :`, 14, y); doc.text(fmtPdf(totalDepenses), 120, y); y += 7
    doc.text(`Total Ratios :`, 14, y); doc.text(fmtPdf(totalRatios), 120, y); y += 7
    doc.text(`Total Deductions :`, 14, y); doc.text(fmtPdf(totalDeductions), 120, y); y += 7
    doc.setFontSize(12)
    doc.text(`Solde Net :`, 14, y); doc.text(fmtPdf(soldeNet), 120, y); y += 14

    doc.setFontSize(9)
    const headers = ['Date', 'Agent', 'Type', 'Nature', 'Montant', 'Paiement']
    const colX = [14, 36, 80, 100, 130, 160]
    headers.forEach((h, i) => doc.text(h, colX[i], y))
    y += 5
    doc.line(14, y, 196, y); y += 4

    expenses.forEach(exp => {
      if (y > 275) { doc.addPage(); y = 20 }
      doc.text(format(parseISO(exp.expense_date), 'dd/MM/yy'), colX[0], y)
      doc.text((exp.agent_name || '-').substring(0, 22), colX[1], y)
      doc.text(exp.expense_type === 'depense' ? 'Dep.' : 'Ratio', colX[2], y)
      doc.text(exp.nature.substring(0, 15), colX[3], y)
      doc.text(fmtPdf(exp.amount), colX[4], y)
      doc.text(PAYMENT_LABELS[exp.payment_method] || exp.payment_method, colX[5], y)
      y += 5
    })

    doc.save(`rapport_depenses_courrier_${dateRange.from}.pdf`)
    toast.success('PDF exporte')
  }

  const exportExcel = async () => {
    const XLSX = await import('xlsx')
    const rows = expenses.map(exp => ({
      Date: format(parseISO(exp.expense_date), 'dd/MM/yyyy'),
      Agent: exp.agent_name || '-',
      Type: exp.expense_type === 'depense' ? 'Depense' : 'Ratio',
      Nature: exp.nature,
      Montant: exp.amount,
      'Mode Paiement': PAYMENT_LABELS[exp.payment_method] || exp.payment_method,
      Description: exp.description || '',
    }))
    rows.push({ Date: '', Type: '', Nature: '', Montant: 0, 'Mode Paiement': '', Description: '' })
    rows.push({ Date: '', Type: 'RESUME', Nature: 'Recettes courrier', Montant: parcelRevenue, 'Mode Paiement': '', Description: '' })
    rows.push({ Date: '', Type: '', Nature: 'Total Depenses', Montant: totalDepenses, 'Mode Paiement': '', Description: '' })
    rows.push({ Date: '', Type: '', Nature: 'Total Ratios', Montant: totalRatios, 'Mode Paiement': '', Description: '' })
    rows.push({ Date: '', Type: '', Nature: 'Total Deductions', Montant: totalDeductions, 'Mode Paiement': '', Description: '' })
    rows.push({ Date: '', Type: '', Nature: 'Solde Net', Montant: soldeNet, 'Mode Paiement': '', Description: '' })

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rapport')
    XLSX.writeFile(wb, `rapport_depenses_courrier_${dateRange.from}.xlsx`)
    toast.success('Excel exporte')
  }

  if (!stationId) {
    return <div className="p-6 text-center text-gray-500">Aucune gare affectee.</div>
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Rapport Depenses & Ratios</h1>
          <p className="text-sm text-gray-500 mt-1">Bilan financier interne du service courrier</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportPDF} className="inline-flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium">
            <Download className="w-4 h-4" /> PDF
          </button>
          <button onClick={exportExcel} className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium">
            <FileText className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filtres</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Periode</label>
            <select
              value={periodMode}
              onChange={e => setPeriodMode(e.target.value as PeriodMode)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="jour">Jour</option>
              <option value="semaine">Semaine</option>
              <option value="mois">Mois</option>
              <option value="custom">Personnalisee</option>
            </select>
          </div>

          {periodMode !== 'custom' ? (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date de reference</label>
              <input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Du</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Au</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">Agent courrier</label>
            <select
              value={selectedAgent}
              onChange={e => setSelectedAgent(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="all">Tous les agents</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[#0B7439]" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                </div>
                <span className="text-xs text-gray-500">Recettes courrier</span>
              </div>
              <p className="text-lg font-bold text-green-700">{fmt(parcelRevenue)}</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-red-600" />
                </div>
                <span className="text-xs text-gray-500">Depenses</span>
              </div>
              <p className="text-lg font-bold text-red-600">{fmt(totalDepenses)}</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                  <TrendingDown className="w-4 h-4 text-orange-600" />
                </div>
                <span className="text-xs text-gray-500">Ratios</span>
              </div>
              <p className="text-lg font-bold text-orange-600">{fmt(totalRatios)}</p>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                  <DollarSign className="w-4 h-4 text-gray-600" />
                </div>
                <span className="text-xs text-gray-500">Total deductions</span>
              </div>
              <p className="text-lg font-bold text-gray-800">{fmt(totalDeductions)}</p>
            </div>
            <div className={`rounded-xl border p-4 ${soldeNet >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${soldeNet >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                  <DollarSign className={`w-4 h-4 ${soldeNet >= 0 ? 'text-green-700' : 'text-red-700'}`} />
                </div>
                <span className="text-xs text-gray-600 font-medium">Solde Net</span>
              </div>
              <p className={`text-lg font-bold ${soldeNet >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(soldeNet)}</p>
            </div>
          </div>

          {/* Detail Table */}
          <div className="bg-white rounded-xl border overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                Detail des depenses et ratios - {periodLabel}
              </span>
              <span className="text-xs text-gray-500">{expenses.length} enregistrement(s)</span>
            </div>
            <div className="overflow-x-auto">
              {expenses.length === 0 ? (
                <div className="text-center py-10 text-gray-500">Aucune depense pour cette periode</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Agent</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Nature</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Montant</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Paiement</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {expenses.map(exp => (
                      <tr key={exp.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap">{format(parseISO(exp.expense_date), 'dd/MM/yyyy')}</td>
                        <td className="px-4 py-3 text-gray-700 text-xs font-medium whitespace-nowrap">{exp.agent_name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${exp.expense_type === 'depense' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                            {exp.expense_type === 'depense' ? 'Depense' : 'Ratio'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{exp.nature}</td>
                        <td className="px-4 py-3 text-right font-semibold">{exp.amount.toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-3 text-gray-600">{PAYMENT_LABELS[exp.payment_method] || exp.payment_method}</td>
                        <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{exp.description || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-gray-50">
                    <tr>
                      <td className="px-4 py-3 font-semibold" colSpan={4}>TOTAL</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{totalDeductions.toLocaleString('fr-FR')} FCFA</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
