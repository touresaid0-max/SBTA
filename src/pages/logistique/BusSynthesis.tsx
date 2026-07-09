import { useEffect, useMemo, useState } from 'react'
import { Bus, Building2, TrendingUp, Search, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import toast from 'react-hot-toast'
import { supabase } from '@/services/supabase'
import ExportButton from '@/components/shared/ExportButton'

interface CompanyBusData {
  id: string
  name: string
  parent_id: string | null
  is_group: boolean
  bus_count: number
}

const COLORS = [
  '#0B7439', '#1D4ED8', '#B45309', '#7C3AED', '#DC2626',
  '#0891B2', '#4F46E5', '#EA580C', '#16A34A', '#9333EA',
  '#2563EB', '#D97706', '#059669', '#6366F1', '#E11D48',
]

export default function BusSynthesis() {
  const [data, setData] = useState<CompanyBusData[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, parent_id, is_group')

    if (error) { toast.error('Erreur chargement societes'); setLoading(false); return }

    const { data: buses, error: busErr } = await supabase
      .from('buses')
      .select('id, company_id')

    if (busErr) { toast.error('Erreur chargement bus'); setLoading(false); return }

    const countMap = new Map<string, number>()
    buses?.forEach(b => {
      const cid = b.company_id
      if (cid) countMap.set(cid, (countMap.get(cid) ?? 0) + 1)
    })

    const result: CompanyBusData[] = (companies ?? [])
      .map(c => ({ ...c, bus_count: countMap.get(c.id) ?? 0 }))
      .filter(c => c.bus_count > 0)
      .sort((a, b) => b.bus_count - a.bus_count)

    setData(result)
    setLoading(false)
  }

  const totalBuses = useMemo(() => data.reduce((s, c) => s + c.bus_count, 0), [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return data
    return data.filter(c => c.name.toLowerCase().includes(q))
  }, [data, search])

  const chartData = useMemo(() =>
    filtered.map(c => ({ name: c.name, value: c.bus_count })),
  [filtered])

  async function exportExcel() {
    const { utils, writeFile } = await import('xlsx')
    const aoa: unknown[][] = [
      ['Synthese Bus - Nombre de cars par sous-groupe'],
      [],
      ['Sous-groupe', 'Nombre de cars'],
      ...data.map(c => [c.name, c.bus_count]),
      [],
      ['TOTAL', totalBuses],
    ]
    const ws = utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 35 }, { wch: 16 }]
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Synthese')
    writeFile(wb, 'synthese_bus_par_sous_groupe.xlsx')
  }

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    pdf.setFontSize(16)
    pdf.setTextColor(11, 116, 57)
    pdf.text('Synthese Bus - Nombre de cars par sous-groupe', 14, 20)
    pdf.setFontSize(10)
    pdf.setTextColor(100)
    pdf.text(`Total : ${totalBuses} vehicules`, 14, 28)

    let y = 38
    pdf.setFontSize(9)
    pdf.setTextColor(255, 255, 255)
    pdf.setFillColor(11, 116, 57)
    pdf.rect(14, y - 4, 182, 7, 'F')
    pdf.text('Sous-groupe', 16, y)
    pdf.text('Nombre de cars', 160, y)
    y += 10

    pdf.setTextColor(30, 30, 30)
    data.forEach((c, i) => {
      if (y > 270) { pdf.addPage(); y = 20 }
      if (i % 2 === 0) { pdf.setFillColor(247, 250, 248); pdf.rect(14, y - 4, 182, 7, 'F') }
      pdf.text(c.name, 16, y)
      pdf.text(String(c.bus_count), 170, y)
      y += 7
    })

    y += 5
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'bold')
    pdf.text(`Total : ${totalBuses} vehicules`, 16, y)
    pdf.save('synthese_bus_par_sous_groupe.pdf')
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Synthese bus</h1>
          <p className="text-sm text-[#6B7280] mt-1">Nombre de cars par societe et sous-groupe</p>
        </div>
        <ExportButton onExportPDF={exportPdf} onExportExcel={exportExcel} />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#E7F6EC] flex items-center justify-center">
              <Bus className="w-5 h-5 text-[#0B7439]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#1A2E22]">{totalBuses}</p>
              <p className="text-xs text-[#6B7280]">Total vehicules</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#DBEAFE] flex items-center justify-center">
              <Building2 className="w-5 h-5 text-[#1D4ED8]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#1A2E22]">{data.length}</p>
              <p className="text-xs text-[#6B7280]">Sous-groupes</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#FEF3C7] flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-[#B45309]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-[#1A2E22]">{data.length > 0 ? Math.round(totalBuses / data.length) : 0}</p>
              <p className="text-xs text-[#6B7280]">Moyenne par sous-groupe</p>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
        <h2 className="font-semibold text-[#1A2E22] mb-4">Nombre de cars par sous-groupe</h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2EAE5" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: '#4A6B55' }}
                angle={-35}
                textAnchor="end"
                interval={0}
                height={70}
              />
              <YAxis tick={{ fontSize: 11, fill: '#4A6B55' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #E2EAE5', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}
                formatter={(value: number) => [`${value} cars`, 'Nombre']}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={50}>
                {chartData.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2EAE5] flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-[#1A2E22]">Detail par sous-groupe</h2>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un sous-groupe..."
              className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-[#E2EAE5] bg-[#F8FAF8] text-[#1A2E22] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1A2E22]">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0B7439] text-left text-xs font-semibold text-white uppercase tracking-wide">
                <th className="px-5 py-3 w-12">#</th>
                <th className="px-5 py-3">Sous-groupe</th>
                <th className="px-5 py-3 text-right">Nombre de cars</th>
                <th className="px-5 py-3 text-right">% du total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F4F1]">
              {filtered.map((c, idx) => (
                <tr key={c.id} className="even:bg-[#F7FAF8] hover:bg-[#EEF6F1] transition-colors">
                  <td className="px-5 py-3 text-[#6B7280] font-medium">{idx + 1}</td>
                  <td className="px-5 py-3 font-medium text-[#1A2E22]">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                      {c.name}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-bold text-[#1A2E22] tabular-nums">{c.bus_count}</td>
                  <td className="px-5 py-3 text-right text-[#6B7280] tabular-nums">
                    {totalBuses > 0 ? ((c.bus_count / totalBuses) * 100).toFixed(1) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#1A2E22]">
                <td className="px-5 py-3 text-white font-bold" colSpan={2}>TOTAL</td>
                <td className="px-5 py-3 text-right text-white font-bold tabular-nums">{filtered.reduce((s, c) => s + c.bus_count, 0)}</td>
                <td className="px-5 py-3 text-right text-white font-bold tabular-nums">
                  {totalBuses > 0 ? ((filtered.reduce((s, c) => s + c.bus_count, 0) / totalBuses) * 100).toFixed(1) : 0}%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
