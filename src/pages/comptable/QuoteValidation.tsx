import React, { useState, useEffect, useCallback } from 'react'
import {
  ClipboardList, CheckCircle, XCircle, AlertTriangle, Building2,
  Bus, Eye, X, Clock,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '../../services/supabase'
import { fetchQuotesByCompany, validateQuote, rejectQuote } from '../../services/garage.service'
import { useAuthStore } from '../../store/authStore'
import { useComptableCompanies } from '../../hooks/useComptableCompanies'
import { formatCurrency } from '../../utils/formatCurrency'
import type { MaintenanceQuote } from '../../types/garage.types'

const URGENCY_CFG = {
  faible:   { label: 'Faible',    bg: '#F3F4F6', color: '#6B7280' },
  normale:  { label: 'Normale',   bg: '#DBEAFE', color: '#2563EB' },
  elevee:   { label: 'Élevée',    bg: '#FEF3C7', color: '#D97706' },
  critique: { label: 'Critique',  bg: '#FEE2E2', color: '#DC2626' },
}

const STATUS_CFG = {
  brouillon:        { label: 'Brouillon',   bg: '#F3F4F6', color: '#6B7280' },
  soumis_comptable: { label: 'En attente',  bg: '#FEF3C7', color: '#D97706' },
  valide:           { label: 'Validé',      bg: '#DCFCE7', color: '#16A34A' },
  rejete:           { label: 'Rejeté',      bg: '#FEE2E2', color: '#DC2626' },
  converti_en_ot:   { label: 'OT créé',     bg: '#DBEAFE', color: '#2563EB' },
  annule:           { label: 'Annulé',      bg: '#F9FAFB', color: '#9CA3AF' },
}

interface DetailModalProps {
  quote: MaintenanceQuote
  onClose: () => void
  onValidate: (id: string) => void
  onReject: (id: string, reason: string) => void
}

function DetailModal({ quote, onClose, onValidate, onReject }: DetailModalProps) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)

  const isPending = quote.status === 'soumis_comptable'
  const urg = URGENCY_CFG[quote.urgency_level] ?? URGENCY_CFG.normale

  const handleValidate = async () => {
    setLoading(true)
    try {
      await onValidate(quote.id)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!reason.trim()) { toast.error('Motif de rejet obligatoire'); return }
    setLoading(true)
    try {
      await onReject(quote.id, reason)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-start justify-between" style={{ borderColor: '#E2EAE5' }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm font-bold" style={{ color: '#0B7439' }}>{quote.quote_number}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: urg.bg, color: urg.color }}>
                {urg.label}
              </span>
            </div>
            <h2 className="text-lg font-bold" style={{ color: '#1A2E22' }}>{quote.title}</h2>
            <p className="text-xs mt-0.5" style={{ color: '#4A6B55' }}>
              Créé par {quote.created_by_name} · {format(new Date(quote.created_at), 'dd MMM yyyy', { locale: fr })}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" style={{ color: '#4A6B55' }} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Bus + Garage */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl" style={{ backgroundColor: '#F0FBF4' }}>
              <p className="text-xs font-bold uppercase mb-2" style={{ color: '#4A6B55' }}>Bus concerné</p>
              <div className="flex items-center gap-2">
                <Bus className="w-4 h-4" style={{ color: '#0B7439' }} />
                <span className="font-bold text-sm" style={{ color: '#1A2E22' }}>{quote.bus_registration}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Building2 className="w-3.5 h-3.5" style={{ color: '#4A6B55' }} />
                <span className="text-xs" style={{ color: '#4A6B55' }}>Propriétaire : <strong>{quote.bus_company_name}</strong></span>
              </div>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: '#F4F7F5' }}>
              <p className="text-xs font-bold uppercase mb-2" style={{ color: '#4A6B55' }}>Garage demandeur</p>
              <p className="font-bold text-sm" style={{ color: '#1A2E22' }}>{quote.garage_name}</p>
              {quote.planned_start_date && (
                <p className="text-xs mt-1" style={{ color: '#4A6B55' }}>
                  Début prévu : {format(new Date(quote.planned_start_date), 'dd/MM/yyyy')}
                </p>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="text-sm font-bold mb-1" style={{ color: '#1A2E22' }}>Problème</p>
            <p className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#F4F7F5', color: '#4A6B55' }}>
              {quote.problem_description}
            </p>
          </div>
          {quote.proposed_solution && (
            <div>
              <p className="text-sm font-bold mb-1" style={{ color: '#1A2E22' }}>Solution proposée</p>
              <p className="text-sm p-3 rounded-xl" style={{ backgroundColor: '#F4F7F5', color: '#4A6B55' }}>
                {quote.proposed_solution}
              </p>
            </div>
          )}

          {/* Costs */}
          <div className="rounded-xl p-4" style={{ backgroundColor: '#F0FBF4', border: '1px solid #BBF7D0' }}>
            <p className="text-xs font-bold uppercase mb-3" style={{ color: '#4A6B55' }}>Récapitulatif des coûts</p>
            <div className="space-y-1.5">
              <CostLine label={`Main d'oeuvre (${quote.labor_hours}h × ${formatCurrency(quote.labor_hourly_rate)}/h)`} value={quote.labor_cost} />
              <CostLine label="Pièces détachées" value={quote.parts_cost} />
              <div className="border-t pt-2" style={{ borderColor: '#BBF7D0' }}>
                <CostLine label="TOTAL ESTIMÉ" value={quote.total_estimated_cost} bold />
              </div>
            </div>
          </div>

          {/* Parts list */}
          {quote.parts_items.length > 0 && (
            <div>
              <p className="text-sm font-bold mb-2" style={{ color: '#1A2E22' }}>Pièces détachées ({quote.parts_items.length})</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ backgroundColor: '#F4F7F5' }}>
                      <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: '#4A6B55' }}>Désignation</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold" style={{ color: '#4A6B55' }}>Qté</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: '#4A6B55' }}>P.U.</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: '#4A6B55' }}>Total</th>
                      <th className="text-center px-3 py-2 text-xs font-semibold" style={{ color: '#4A6B55' }}>Dispo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.parts_items.map((p, i) => (
                      <tr key={i} className="border-t" style={{ borderColor: '#E2EAE5' }}>
                        <td className="px-3 py-2" style={{ color: '#1A2E22' }}>{p.part_name}</td>
                        <td className="px-3 py-2 text-center">{p.qty}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(p.unit_price)}</td>
                        <td className="px-3 py-2 text-right font-semibold" style={{ color: '#1A2E22' }}>{formatCurrency(p.total)}</td>
                        <td className="px-3 py-2 text-center">
                          {p.available
                            ? <CheckCircle className="w-4 h-4 mx-auto" style={{ color: '#16A34A' }} />
                            : <AlertTriangle className="w-4 h-4 mx-auto" style={{ color: '#DC2626' }} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Rejection reason if rejected */}
          {quote.status === 'rejete' && quote.rejection_reason && (
            <div className="p-3 rounded-xl" style={{ backgroundColor: '#FEE2E2' }}>
              <p className="text-xs font-bold mb-1" style={{ color: '#DC2626' }}>Motif de rejet</p>
              <p className="text-sm" style={{ color: '#991B1B' }}>{quote.rejection_reason}</p>
            </div>
          )}

          {/* Reject form */}
          {rejecting && (
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: '#1A2E22' }}>Motif du rejet *</label>
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                placeholder="Expliquer pourquoi le devis est rejeté..."
                className="w-full px-4 py-2.5 border-2 rounded-xl text-sm focus:outline-none resize-none"
                style={{ borderColor: '#AF3029' }} />
            </div>
          )}
        </div>

        {/* Footer */}
        {isPending && (
          <div className="px-6 py-4 border-t flex justify-between items-center" style={{ borderColor: '#E2EAE5' }}>
            <div className="flex gap-3">
              {!rejecting ? (
                <button
                  onClick={() => setRejecting(true)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 text-white"
                  style={{ backgroundColor: '#AF3029' }}
                >
                  <XCircle className="w-4 h-4" /> Rejeter
                </button>
              ) : (
                <>
                  <button onClick={() => setRejecting(false)}
                    className="px-4 py-2.5 border-2 rounded-xl text-sm font-semibold"
                    style={{ borderColor: '#E2EAE5', color: '#4A6B55' }}>
                    Annuler
                  </button>
                  <button onClick={handleReject} disabled={loading}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
                    style={{ backgroundColor: loading ? '#9AB4A0' : '#AF3029' }}>
                    Confirmer le rejet
                  </button>
                </>
              )}
            </div>
            {!rejecting && (
              <button
                onClick={handleValidate}
                disabled={loading}
                className="px-6 py-2.5 rounded-xl text-sm font-bold text-white flex items-center gap-2"
                style={{ backgroundColor: loading ? '#9AB4A0' : '#0B7439' }}
              >
                <CheckCircle className="w-4 h-4" />
                {loading ? 'Validation...' : 'Valider — Créer OT automatiquement'}
              </button>
            )}
          </div>
        )}
        {!isPending && (
          <div className="px-6 py-4 border-t" style={{ borderColor: '#E2EAE5' }}>
            <button onClick={onClose}
              className="w-full py-2.5 border-2 rounded-xl text-sm font-semibold"
              style={{ borderColor: '#E2EAE5', color: '#4A6B55' }}>
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function QuoteValidation() {
  const { user } = useAuthStore()
  const { allowedCompanyIds } = useComptableCompanies()
  const companyIds = allowedCompanyIds ?? (user?.company_id ? [user.company_id] : [])
  const [quotes, setQuotes]       = useState<MaintenanceQuote[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<MaintenanceQuote | null>(null)
  const [statusFilter, setStatusFilter] = useState('soumis_comptable')

  const load = useCallback(async () => {
    if (companyIds.length === 0) return
    try {
      const results = await Promise.all(companyIds.map(cid => fetchQuotesByCompany(cid)))
      setQuotes(results.flat())
    } catch (e: any) {
      toast.error(e.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [companyIds])

  useEffect(() => { load() }, [load])

  // Realtime subscription
  useEffect(() => {
    if (companyIds.length === 0) return
    const channel = supabase
      .channel(`quotes-comptable-multi`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'maintenance_quotes',
      }, (payload) => {
        if (companyIds.includes((payload.new as any).bus_company_id)) {
          toast('Nouveau devis reçu pour validation', { duration: 8000 })
          load()
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'maintenance_quotes',
      }, (payload) => {
        if (companyIds.includes((payload.new as any).bus_company_id) &&
            (payload.new as any).status === 'soumis_comptable') {
          toast(`Devis ${(payload.new as any).quote_number} soumis pour validation`, { duration: 8000 })
          load()
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [companyIds, load])

  const handleValidate = async (id: string) => {
    if (!user) return
    await validateQuote(id, user.id)
    toast.success('Devis validé — OT créé automatiquement')
    load()
  }

  const handleReject = async (id: string, reason: string) => {
    if (!user) return
    await rejectQuote(id, reason, user.id)
    toast.success('Devis rejeté')
    load()
  }

  const filtered = quotes.filter(q => !statusFilter || q.status === statusFilter)
  const pending = quotes.filter(q => q.status === 'soumis_comptable')

  if (loading) return <div className="p-8">Chargement...</div>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#1A2E22' }}>
          Devis de maintenance
        </h1>
        <p className="text-sm" style={{ color: '#4A6B55' }}>
          Ces devis concernent les bus appartenant à votre société. Ils ont été créés par les garages SBTA.
        </p>
      </div>

      {/* Alert banner */}
      {pending.length > 0 && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl border"
          style={{ backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }}>
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#D97706' }} />
          <div>
            <p className="text-sm font-bold" style={{ color: '#92400E' }}>
              {pending.length} devis en attente de votre validation
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#B45309' }}>
              La validation crée automatiquement un Ordre de Travail et met le bus en maintenance.
            </p>
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {[
          ['',                'Tous', quotes.length],
          ['soumis_comptable','En attente', pending.length],
          ['valide',          'Validés', quotes.filter(q => q.status === 'valide').length],
          ['rejete',          'Rejetés', quotes.filter(q => q.status === 'rejete').length],
          ['converti_en_ot',  'OT créés', quotes.filter(q => q.status === 'converti_en_ot').length],
        ].map(([v, label, count]) => (
          <button
            key={v as string}
            onClick={() => setStatusFilter(v as string)}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            style={{
              backgroundColor: statusFilter === v ? '#0B7439' : '#F4F7F5',
              color:           statusFilter === v ? '#fff'    : '#4A6B55',
            }}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border" style={{ borderColor: '#E2EAE5' }}>
          <ClipboardList className="w-12 h-12 mx-auto mb-3" style={{ color: '#D1DFD6' }} />
          <p style={{ color: '#9AB4A0' }}>Aucun devis trouvé</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: '#E2EAE5' }}>
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: '#F4F7F5' }}>
                <th className="text-left px-4 py-3 text-sm font-semibold" style={{ color: '#4A6B55' }}>N° Devis</th>
                <th className="text-left px-4 py-3 text-sm font-semibold" style={{ color: '#4A6B55' }}>Bus</th>
                <th className="text-left px-4 py-3 text-sm font-semibold" style={{ color: '#4A6B55' }}>Garage</th>
                <th className="text-left px-4 py-3 text-sm font-semibold" style={{ color: '#4A6B55' }}>Urgence</th>
                <th className="text-right px-4 py-3 text-sm font-semibold" style={{ color: '#4A6B55' }}>Montant</th>
                <th className="text-left px-4 py-3 text-sm font-semibold" style={{ color: '#4A6B55' }}>Statut</th>
                <th className="text-left px-4 py-3 text-sm font-semibold" style={{ color: '#4A6B55' }}>Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(q => {
                const urg = URGENCY_CFG[q.urgency_level] ?? URGENCY_CFG.normale
                const sts = STATUS_CFG[q.status] ?? STATUS_CFG.brouillon
                return (
                  <tr key={q.id} className="border-t hover:bg-gray-50" style={{ borderColor: '#E2EAE5' }}>
                    <td className="px-4 py-3 font-mono text-xs font-bold" style={{ color: '#0B7439' }}>
                      {q.quote_number}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-sm" style={{ color: '#1A2E22' }}>{q.bus_registration}</div>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#4A6B55' }}>{q.garage_name}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded-full font-medium"
                        style={{ backgroundColor: urg.bg, color: urg.color }}>
                        {urg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold" style={{ color: '#1A2E22' }}>
                      {formatCurrency(q.total_estimated_cost)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 rounded-full font-medium"
                        style={{ backgroundColor: sts.bg, color: sts.color }}>
                        {sts.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#4A6B55' }}>
                      {format(new Date(q.created_at), 'dd/MM/yyyy', { locale: fr })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setSelected(q)}
                          className="p-2 hover:bg-gray-100 rounded-lg flex items-center gap-1.5 text-xs font-semibold"
                          style={{ color: '#4A6B55' }}>
                          <Eye className="w-4 h-4" /> Voir
                        </button>
                        {q.status === 'soumis_comptable' && (
                          <button onClick={() => setSelected(q)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                            style={{ backgroundColor: '#0B7439' }}>
                            Valider
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DetailModal
          quote={selected}
          onClose={() => setSelected(null)}
          onValidate={handleValidate}
          onReject={handleReject}
        />
      )}
    </div>
  )
}

function CostLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span style={{ color: '#4A6B55', fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: '#1A2E22', fontWeight: bold ? 700 : 600 }}>{formatCurrency(value)}</span>
    </div>
  )
}
