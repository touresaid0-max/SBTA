import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, CreditCard as Edit2, X, Loader2, Receipt, Wallet, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'

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
  receipt_url: string | null
  created_at: string
}

const PAYMENT_METHODS = [
  { value: 'especes', label: 'Especes' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'autre', label: 'Autre' },
]

export default function AgentColisExpenses() {
  const { user } = useAuthStore()
  const isSuperviseur = user?.role === 'superviseur_colis' || user?.role === 'admin' || user?.role === 'daf'
  const [expenses, setExpenses] = useState<ParcelExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [stations, setStations] = useState<{ id: string; name: string }[]>([])
  const [selectedStation, setSelectedStation] = useState<string>(user?.station_id || '')

  // Form state
  const [formType, setFormType] = useState<'depense' | 'ratio'>('depense')
  const [formNature, setFormNature] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDate, setFormDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [formPayment, setFormPayment] = useState('especes')
  const [formDescription, setFormDescription] = useState('')
  const [formReceipt, setFormReceipt] = useState<File | null>(null)

  const stationId = isSuperviseur ? selectedStation : user?.station_id

  useEffect(() => {
    if (!isSuperviseur) return
    supabase.from('stations').select('id, name').eq('is_active', true).order('name').then(({ data }) => {
      setStations(data || [])
    })
  }, [isSuperviseur])

  const fetchExpenses = useCallback(async () => {
    if (!stationId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('parcel_service_expenses')
      .select('*')
      .eq('station_id', stationId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) {
      toast.error('Erreur chargement des depenses')
    } else {
      setExpenses(data || [])
    }
    setLoading(false)
  }, [stationId])

  useEffect(() => { fetchExpenses() }, [fetchExpenses])

  const resetForm = () => {
    setFormType('depense')
    setFormNature('')
    setFormAmount('')
    setFormDate(format(new Date(), 'yyyy-MM-dd'))
    setFormPayment('especes')
    setFormDescription('')
    setFormReceipt(null)
    setEditingId(null)
    setShowForm(false)
  }

  const handleEdit = (exp: ParcelExpense) => {
    setEditingId(exp.id)
    setFormType(exp.expense_type)
    setFormNature(exp.nature)
    setFormAmount(String(exp.amount))
    setFormDate(exp.expense_date)
    setFormPayment(exp.payment_method)
    setFormDescription(exp.description || '')
    setFormReceipt(null)
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stationId || !user) return
    if (!formNature.trim()) { toast.error('La nature est obligatoire'); return }
    if (!formAmount || Number(formAmount) <= 0) { toast.error('Montant invalide'); return }

    setSubmitting(true)
    let receiptUrl: string | null = null

    if (formReceipt) {
      const ext = formReceipt.name.split('.').pop()
      const path = `parcel-expenses/${stationId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('parcel-photos')
        .upload(path, formReceipt)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('parcel-photos').getPublicUrl(path)
        receiptUrl = urlData.publicUrl
      }
    }

    const payload = {
      station_id: stationId,
      agent_id: user.id,
      expense_type: formType,
      nature: formNature.trim(),
      amount: Number(formAmount),
      expense_date: formDate,
      payment_method: formPayment,
      description: formDescription.trim() || null,
      receipt_url: receiptUrl,
    }

    if (editingId) {
      const updatePayload: Record<string, unknown> = { ...payload }
      if (!receiptUrl) delete updatePayload.receipt_url
      const { error } = await supabase
        .from('parcel_service_expenses')
        .update(updatePayload)
        .eq('id', editingId)
      if (error) toast.error('Erreur modification')
      else { toast.success('Depense modifiee'); resetForm(); fetchExpenses() }
    } else {
      const { error } = await supabase
        .from('parcel_service_expenses')
        .insert(payload)
      if (error) toast.error('Erreur enregistrement')
      else { toast.success('Depense enregistree'); resetForm(); fetchExpenses() }
    }
    setSubmitting(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette depense ?')) return
    const { error } = await supabase.from('parcel_service_expenses').delete().eq('id', id)
    if (error) toast.error('Erreur suppression')
    else { toast.success('Supprimee'); fetchExpenses() }
  }

  const totalDepenses = expenses.filter(e => e.expense_type === 'depense').reduce((s, e) => s + e.amount, 0)
  const totalRatios = expenses.filter(e => e.expense_type === 'ratio').reduce((s, e) => s + e.amount, 0)
  const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA'

  if (!stationId) {
    return (
      <div className="p-6 text-center text-gray-500">
        {isSuperviseur
          ? 'Veuillez selectionner une gare.'
          : 'Vous n\'etes affecte a aucune gare. Contactez l\'administrateur.'}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Depenses & Ratios - Service Courrier</h1>
          <p className="text-sm text-gray-500 mt-1">Suivi interne des depenses et ratios du service courrier</p>
        </div>
        <div className="flex items-center gap-3">
          {isSuperviseur && (
            <select
              value={selectedStation}
              onChange={e => setSelectedStation(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
            >
              <option value="" disabled>Choisir une gare</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            disabled={isSuperviseur && !selectedStation}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B7439] text-white rounded-lg hover:bg-[#095e2e] transition font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Nouvelle depense
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Total Depenses</p>
            <p className="text-lg font-bold text-red-600">{fmt(totalDepenses)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Total Ratios</p>
            <p className="text-lg font-bold text-orange-600">{fmt(totalRatios)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-gray-700" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Total Deductions</p>
            <p className="text-lg font-bold text-gray-900">{fmt(totalDepenses + totalRatios)}</p>
          </div>
        </div>
      </div>

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-semibold">
                {editingId ? 'Modifier la depense' : 'Nouvelle depense / ratio'}
              </h2>
              <button onClick={resetForm} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <div className="flex gap-3">
                  <label className={`flex-1 text-center py-2 rounded-lg border cursor-pointer transition ${formType === 'depense' ? 'bg-red-50 border-red-300 text-red-700 font-medium' : 'hover:bg-gray-50'}`}>
                    <input type="radio" className="sr-only" checked={formType === 'depense'} onChange={() => setFormType('depense')} />
                    Depense
                  </label>
                  <label className={`flex-1 text-center py-2 rounded-lg border cursor-pointer transition ${formType === 'ratio' ? 'bg-orange-50 border-orange-300 text-orange-700 font-medium' : 'hover:bg-gray-50'}`}>
                    <input type="radio" className="sr-only" checked={formType === 'ratio'} onChange={() => setFormType('ratio')} />
                    Ratio
                  </label>
                </div>
              </div>

              {/* Nature */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nature *</label>
                <input
                  type="text"
                  value={formNature}
                  onChange={e => setFormNature(e.target.value)}
                  placeholder="Ex: Carburant moto, Fournitures..."
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
                  required
                />
              </div>

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Montant (FCFA) *</label>
                  <input
                    type="number"
                    min="1"
                    value={formAmount}
                    onChange={e => setFormAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
                    required
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mode de paiement *</label>
                <select
                  value={formPayment}
                  onChange={e => setFormPayment(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439]"
                >
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (facultatif)</label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] resize-none"
                  placeholder="Details supplementaires..."
                />
              </div>

              {/* Receipt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Justificatif (facultatif)</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={e => setFormReceipt(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-[#0B7439]/10 file:text-[#0B7439] hover:file:bg-[#0B7439]/20"
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-[#0B7439] text-white rounded-lg hover:bg-[#095e2e] disabled:opacity-50 font-medium flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? 'Enregistrer les modifications' : 'Enregistrer'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[#0B7439]" />
            </div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              Aucune depense enregistree
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Nature</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Montant</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Paiement</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {expenses.map(exp => (
                  <tr key={exp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {format(new Date(exp.expense_date), 'dd/MM/yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${exp.expense_type === 'depense' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                        {exp.expense_type === 'depense' ? 'Depense' : 'Ratio'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{exp.nature}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {exp.amount.toLocaleString('fr-FR')}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {PAYMENT_METHODS.find(m => m.value === exp.payment_method)?.label || exp.payment_method}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                      {exp.description || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleEdit(exp)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Modifier">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {(isSuperviseur || user?.role === 'admin') && (
                          <button onClick={() => handleDelete(exp.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Supprimer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
