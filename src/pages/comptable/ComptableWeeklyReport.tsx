import { useState, useEffect, useCallback } from 'react'
import { Printer, Download, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'
import { useComptableCompanies } from '@/hooks/useComptableCompanies'
import type { VehicleExpense } from '@/types/chargeAchat.types'

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n) + ' XOF'

interface VehicleGroup { reg: string; expenses: VehicleExpense[]; total: number }

export default function ComptableWeeklyReport() {
  const { user }  = useAuthStore()
  const { allowedCompanyIds } = useComptableCompanies()
  const companyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : [])
  const companyId = companyIds[0] ?? null

  const [weekOffset, setWeekOffset] = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [companyName, setCompanyName] = useState('')
  const [companyCode, setCompanyCode] = useState('')
  const [vehicles,   setVehicles]   = useState<VehicleGroup[]>([])
  const [total,      setTotal]      = useState(0)

  const base      = subWeeks(new Date(), weekOffset < 0 ? -weekOffset : weekOffset)
  const weekStart = startOfWeek(base, { weekStartsOn: 1 })
  const weekEnd   = endOfWeek(base,   { weekStartsOn: 1 })
  const startStr  = format(weekStart, 'yyyy-MM-dd')
  const endStr    = format(weekEnd,   'yyyy-MM-dd')
  const weekLabel = `Semaine du ${format(weekStart, 'dd/MM', { locale: fr })} au ${format(weekEnd, 'dd/MM/yyyy', { locale: fr })}`

  const load = useCallback(async () => {
    if (companyIds.length === 0) return
    setLoading(true)
    try {
      const [companyRes, expensesRes] = await Promise.all([
        supabase.from('companies').select('name, code').in('id', companyIds),
        supabase.from('vehicle_expenses')
          .select('*, category:expense_categories(name,icon,color)')
          .in('company_id', companyIds)
          .eq('source', 'comptable')
          .gte('expense_date', startStr)
          .lte('expense_date', endStr)
          .order('registration_number')
          .order('expense_date'),
      ])

      if (companyRes.data && companyRes.data.length > 0) {
        setCompanyName((companyRes.data as { name: string; code: string }[]).map(c => c.name).join(', '))
        setCompanyCode((companyRes.data as { name: string; code: string }[]).map(c => c.code).join(', '))
      }

      const exps = (expensesRes.data ?? []) as VehicleExpense[]
      const byVehicle: Record<string, VehicleGroup> = {}
      for (const e of exps) {
        if (!byVehicle[e.registration_number]) byVehicle[e.registration_number] = { reg: e.registration_number, expenses: [], total: 0 }
        byVehicle[e.registration_number].expenses.push(e)
        byVehicle[e.registration_number].total += Number(e.amount)
      }

      const sorted = Object.values(byVehicle).sort((a, b) => a.reg.localeCompare(b.reg))
      setVehicles(sorted)
      setTotal(sorted.reduce((a, b) => a + b.total, 0))
    } finally {
      setLoading(false)
    }
  }, [companyIds, startStr, endStr])

  useEffect(() => { load() }, [load])

  const handlePrint = () => window.print()

  const exportPdf = async () => {
    const { default: jsPDF } = await import('jspdf')
    const { default: html2canvas } = await import('html2canvas')
    const el = document.getElementById('report-content')
    if (!el) return
    const canvas = await html2canvas(el, { scale: 1.5, useCORS: true })
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const imgW = 210
    const imgH = (canvas.height * imgW) / canvas.width
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgW, imgH)
    pdf.save(`rapport_hebdo_${startStr}.pdf`)
  }

  const exportExcel = async () => {
    const { utils, writeFile } = await import('xlsx')
    const wb = utils.book_new()

    const rows: unknown[][] = [
      [`DÉPENSES ${companyCode} — ${weekLabel}`, '', '', ''],
      [],
      ['IMMATRICULATION', 'DESCRIPTION', 'MONTANT', 'FOURNISSEUR / DATE'],
    ]
    for (const v of vehicles) {
      for (const [i, e] of v.expenses.entries()) {
        rows.push([i === 0 ? v.reg : '', e.description, Number(e.amount), `${e.supplier ?? ''} — ${format(new Date(e.expense_date), 'dd/MM/yyyy', { locale: fr })}`])
      }
      rows.push(['', 'TOTAL VÉHICULE', v.total, ''])
      rows.push([])
    }
    rows.push([], ['', 'TOTAL GÉNÉRAL', total, ''])

    const ws = utils.aoa_to_sheet(rows)
    utils.book_append_sheet(wb, ws, companyCode || 'Rapport')
    writeFile(wb, `rapport_hebdo_${startStr}.xlsx`)
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">

      <div className="flex items-center justify-between flex-wrap gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Rapport hebdomadaire</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Récapitulatif des dépenses par véhicule</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <Printer className="w-3.5 h-3.5" /> Imprimer
          </button>
          <button onClick={exportPdf} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ backgroundColor: '#DC2626', color: '#fff' }}>
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
          <button onClick={exportExcel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold" style={{ backgroundColor: '#1D6FA4', color: '#fff' }}>
            <Download className="w-3.5 h-3.5" /> Excel
          </button>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-center gap-4 no-print">
        <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-lg hover:bg-gray-100">
          <ChevronLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Calendar className="w-4 h-4" style={{ color: '#0B7439' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{weekLabel}</span>
        </div>
        <button onClick={() => setWeekOffset(w => Math.max(0, w - 1))} disabled={weekOffset === 0} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30">
          <ChevronRight className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      <div id="report-content" className="space-y-4">

        {/* Summary banner */}
        <div className="rounded-xl p-5" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
          <p className="text-sm opacity-80">{companyCode} — {companyName} — RAPPORT HEBDOMADAIRE</p>
          <p className="text-lg font-bold mt-1">{weekLabel}</p>
          <div className="mt-3 pt-3 border-t border-green-600 flex justify-between items-center">
            <span className="text-sm opacity-80">{vehicles.length} véhicule{vehicles.length > 1 ? 's' : ''} avec dépenses</span>
            <span className="text-2xl font-bold">{fmt(total)}</span>
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-7 h-7 border-4 rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
          </div>
        ) : vehicles.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Aucune dépense cette semaine</div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Immatriculation</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Description de la dépense</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Montant</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>Fournisseur / Date</th>
                </tr>
              </thead>
              <tbody style={{ backgroundColor: 'var(--surface)' }}>
                {vehicles.map(v => (
                  <>
                    {v.expenses.map((e, ei) => (
                      <tr key={e.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="px-3 py-2 font-mono font-bold text-xs" style={{ color: '#0B7439' }}>{ei === 0 ? v.reg : ''}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>
                          <span className="mr-1">{(e as any).category?.icon ?? ''}</span>{e.description}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {new Intl.NumberFormat('fr-FR').format(Number(e.amount))}
                        </td>
                        <td className="px-3 py-2 text-xs hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>
                          {[e.supplier, format(new Date(e.expense_date), 'dd/MM/yy', { locale: fr })].filter(Boolean).join(' — ')}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                      <td className="px-3 py-1.5 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{v.reg}</td>
                      <td className="px-3 py-1.5 text-xs font-semibold text-right" style={{ color: 'var(--text-secondary)' }}>Sous-total :</td>
                      <td className="px-3 py-1.5 text-right text-xs font-bold" style={{ color: '#0B7439' }}>{new Intl.NumberFormat('fr-FR').format(v.total)}</td>
                      <td className="hidden sm:table-cell" />
                    </tr>
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: '#0B7439' }}>
                  <td colSpan={2} className="px-3 py-2 text-xs font-bold text-right text-white">TOTAL {companyCode}</td>
                  <td className="px-3 py-2 text-right text-sm font-bold text-white">{new Intl.NumberFormat('fr-FR').format(total)}</td>
                  <td className="hidden sm:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
