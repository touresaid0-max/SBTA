import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, User, MapPin, Package, DollarSign, FileText, CheckCircle2, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import { createParcel, fetchParcelAgentInfo, markTicketPrinted } from '@/services/parcel.service'
import { isOnline as courrierIsOnline, getPendingCount } from '@/services/courrier/syncEngine'
import { localInsertParcel } from '@/services/courrier/offlineStore'
import { useConnection } from '@/services/courrier/ConnectionContext'
import { CourrierOfflineBanner } from '@/components/parcel/CourrierOfflineBanner'
import { sendCourierCreatedSms } from '@/services/emisSms.service'
import { buildReceiptData, printParcelTicket } from '@/utils/printParcelTicket'
import type { ParcelNature, ParcelPriority, Parcel } from '@/types/parcel.types'

interface Station { id: string; name: string; city_name?: string }

const NATURE_OPTIONS: { value: ParcelNature; label: string }[] = [
  { value: 'autre', label: 'Autre' },
  { value: 'electronique', label: 'Électronique' },
  { value: 'vetement', label: 'Vêtement' },
  { value: 'document', label: 'Document' },
  { value: 'alimentaire', label: 'Alimentaire' },
  { value: 'medicament', label: 'Médicament' },
  { value: 'electromenager', label: 'Électroménager' },
  { value: 'fragile', label: 'Fragile' },
]

const PRIORITY_OPTIONS: { value: ParcelPriority; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'fragile', label: 'Fragile' },
]

export default function NewParcelForm() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const myStation: Station | null = user?.station_id
    ? { id: user.station_id, name: user.station_name ?? '' }
    : null
  const stationPhone = user?.station_phone ?? ''

  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    sender_name: '',
    sender_phone: '',
    recipient_name: '',
    recipient_phone: '',
    recipient_city: '',
    destination_station_id: '',
    declared_value: 0,
    delivery_fee: 1000,
    sms_tracking_fee: 100,
    priority: 'standard' as ParcelPriority,
    planned_date: '',
    nature: 'autre' as ParcelNature,
    content_description: '',
    notes: '',
  })

  useEffect(() => {
    async function loadStations() {
      const { data: stData } = await supabase
        .from('stations')
        .select('id, name, cities(name)')
        .eq('is_active', true)
        .order('name')
      setStations((stData ?? []).map((s: any) => ({ id: s.id, name: s.name, city_name: s.cities?.name ?? '' })))
    }
    loadStations()
  }, [])

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const total = Number(form.delivery_fee) + Number(form.sms_tracking_fee)

  const conn = useConnection()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myStation) { toast.error('Aucune gare associée à votre compte'); return }
    if (!form.recipient_name || !form.recipient_phone || !form.destination_station_id || !form.content_description) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      return
    }

    setLoading(true)
    try {
      // Offline path: save locally, queue for sync, skip server-only features
      if (!courrierIsOnline()) {
        const now = new Date().toISOString()
        const localId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const tempCode = `LOCAL-${Date.now().toString().slice(-6)}`
        const totalAmount = Number(form.delivery_fee) + Number(form.sms_tracking_fee)

        const localParcel = await localInsertParcel({
          parcel_code: tempCode,
          reference: '',
          daily_sequence: 0,
          sender_name: form.sender_name,
          sender_phone: form.sender_phone,
          sender_address: null,
          recipient_name: form.recipient_name,
          recipient_phone: form.recipient_phone,
          recipient_city: form.recipient_city,
          recipient_address: null,
          origin_station_id: myStation.id,
          origin_station_name: myStation.name,
          destination_station_id: form.destination_station_id,
          destination_station_name: stations.find(s => s.id === form.destination_station_id)?.name ?? '',
          schedule_id: null,
          driver_id: null,
          bus_id: null,
          declared_value: Number(form.declared_value),
          delivery_fee: Number(form.delivery_fee),
          sms_tracking_fee: Number(form.sms_tracking_fee),
          total_amount: totalAmount,
          priority: form.priority,
          planned_date: form.planned_date || null,
          nature: form.nature,
          content_description: form.content_description,
          notes: form.notes || null,
          status: 'enregistre',
          registered_at: now,
          registered_by: user?.id ?? null,
          packaged_at: null,
          shipped_at: null,
          arrived_at: null,
          delivered_at: null,
          tracking_url: '',
          sms_sent_at: null,
          company_id: null,
          ticket_printed: false,
          delivery_recipient_name: null,
          delivery_recipient_phone: null,
          delivery_id_number: null,
          delivery_id_type: null,
        })

        toast.success('Courrier enregistré localement (hors ligne) — sera synchronisé au retour de la connexion')

        // Print ticket with local data
        try {
          const agentInfo = await fetchParcelAgentInfo(myStation.id, form.destination_station_id).catch(() => null)
          await printParcelTicket(buildReceiptData(
            { ...localParcel, origin_station_name: myStation.name, parcel_code: localParcel.parcel_code } as Parcel,
            myStation.name,
            stationPhone,
            null,
            null,
            agentInfo,
          ))
          await localInsertParcel({ ...localParcel, ticket_printed: true } as any)
        } catch { /* printing failure must not block */ }

        conn.setPendingCount(await getPendingCount())
        navigate('/agent-colis/dashboard')
        return
      }

      // Online path: original flow
      // Vérifier qu'un code agence est configuré pour cette destination
      const { data: destCode } = await supabase
        .from('station_destination_agency_codes')
        .select('agency_code')
        .eq('origin_station_id', myStation.id)
        .eq('destination_station_id', form.destination_station_id)
        .maybeSingle()

      if (!destCode?.agency_code) {
        toast('Aucun code agence configuré pour cette destination — le code agence général de la gare sera utilisé.', { icon: '⚠️' })
      }

      const parcel = await createParcel({
        sender_name:            form.sender_name,
        sender_phone:           form.sender_phone,
        sender_address:         null,
        recipient_name:         form.recipient_name,
        recipient_phone:        form.recipient_phone,
        recipient_city:         form.recipient_city,
        recipient_address:      null,
        origin_station_id:      myStation.id,
        destination_station_id: form.destination_station_id,
        declared_value:         Number(form.declared_value),
        delivery_fee:           Number(form.delivery_fee),
        sms_tracking_fee:       Number(form.sms_tracking_fee),
        priority:               form.priority,
        planned_date:           form.planned_date || null,
        schedule_id:            null,
        bus_id:                 null,
        driver_id:              null,
        nature:                 form.nature,
        content_description:    form.content_description,
        parcel_photos:          [],
        notes:                  form.notes || null,
        company_id:             null,
      } as any)

      await supabase.from('parcel_tracking_events').insert({
        parcel_id:      parcel.id,
        event_type:     'enregistre',
        description:    'Courrier enregistré',
        station_id:     myStation.id,
        performer_name: user?.full_name ?? '',
      })

      toast.success('Courrier enregistré avec succès !')

      const agentInfo = await fetchParcelAgentInfo(myStation.id, form.destination_station_id).catch(() => null)
      await printParcelTicket(buildReceiptData(
        { ...parcel, origin_station_name: myStation.name } as Parcel,
        myStation.name,
        stationPhone,
        null,
        null,
        agentInfo,
      ))
      await markTicketPrinted(parcel.id)

      try {
        const smsResult = await sendCourierCreatedSms({
          id: parcel.id,
          parcel_code: parcel.parcel_code,
          recipient_name: parcel.recipient_name,
          recipient_phone: parcel.recipient_phone,
          recipient_city: parcel.recipient_city ?? form.recipient_city,
          tracking_url: parcel.tracking_url ?? '',
        })
        if (!smsResult.success && !smsResult.duplicate) {
          toast('Courrier enregistre, mais SMS non envoye.', { icon: '⚠️' })
        }
      } catch { /* SMS failure must not block */ }

      navigate('/agent-colis/dashboard')
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur lors de l\'enregistrement')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-green-500'
  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }
  const labelCls = 'block text-xs font-semibold mb-1'
  const labelStyle = { color: 'var(--text-secondary)' }

  if (!myStation) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="w-full max-w-sm rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--surface)', border: '2px solid #D97706' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#FEF3C7' }}>
            <AlertTriangle className="w-7 h-7" style={{ color: '#D97706' }} />
          </div>
          <h2 className="text-base font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Aucune gare rattachée</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Aucune gare n'est rattachée à votre compte. Veuillez contacter l'administrateur.
          </p>
        </div>
      </div>
    )
  }

  const colisDir = user?.colis_direction ?? null
  const canSortant = !colisDir || colisDir.length === 0 || colisDir.includes('sortant')
  if (!canSortant) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="w-full max-w-sm rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--surface)', border: '2px solid #D97706' }}>
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: '#FEF3C7' }}>
            <AlertTriangle className="w-7 h-7" style={{ color: '#D97706' }} />
          </div>
          <h2 className="text-base font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Accès non autorisé</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Votre compte est configuré pour la gestion des courriers entrants uniquement. Vous ne pouvez pas enregistrer de nouveaux courriers sortants.
          </p>
          <button onClick={() => navigate('/agent-colis/dashboard')} className="mt-4 px-4 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
            Retour au tableau de bord
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="agent-colis-theme p-3 sm:p-4 lg:p-6 max-w-3xl mx-auto overflow-x-hidden">

      <CourrierOfflineBanner
        status={conn.status}
        syncing={conn.syncing}
        pendingCount={conn.pendingCount}
        lastSyncError={conn.lastSyncError}
        onShowQueue={() => {}}
        onSyncNow={() => {}}
      />
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 flex-shrink-0">
          <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Nouveau Courrier</h1>
          <p className="text-xs sm:text-sm truncate" style={{ color: 'var(--text-muted)' }}>
            Gare de départ : {myStation?.name ?? '—'}
          </p>
        </div>
      </div>

      <form id="new-parcel-form" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 lg:space-y-6">

        {/* SECTION 1 — EXPÉDITEUR */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Expéditeur</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Nom complet *</label>
              <input className={inputCls} style={inputStyle} value={form.sender_name} onChange={e => set('sender_name', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Téléphone *</label>
              <input className={inputCls} style={inputStyle} value={form.sender_phone} onChange={e => set('sender_phone', e.target.value)} required />
            </div>
          </div>
        </section>

        {/* SECTION 2 — DESTINATAIRE */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#1D6FA4' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Destinataire</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Nom complet *</label>
              <input className={inputCls} style={inputStyle} value={form.recipient_name} onChange={e => set('recipient_name', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Téléphone (SMS/WhatsApp) *</label>
              <input className={inputCls} style={inputStyle} value={form.recipient_phone} onChange={e => set('recipient_phone', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Gare d'arrivée *</label>
              <select className={inputCls} style={inputStyle} value={form.destination_station_id} onChange={e => {
                const stationId = e.target.value
                const station = stations.find(s => s.id === stationId)
                setForm(prev => ({ ...prev, destination_station_id: stationId, recipient_city: station?.city_name ?? '' }))
              }} required>
                <option value="">Sélectionner une gare</option>
                {stations.filter(s => s.id !== myStation?.id).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Ville de destination *</label>
              <input className={inputCls} style={{ ...inputStyle, backgroundColor: 'var(--bg-subtle)' }} value={form.recipient_city} readOnly tabIndex={-1} />
            </div>
          </div>
        </section>

        {/* SECTION 3 — DÉTAILS FINANCIERS & LOGISTIQUE */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 flex-shrink-0" style={{ color: '#D97706' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Détails financiers & logistique</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Valeur déclarée (FCFA)</label>
              <input type="number" min={0} className={inputCls} style={inputStyle} value={form.declared_value} onChange={e => set('declared_value', e.target.value)} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Frais de livraison (FCFA) *</label>
              <input type="number" min={0} className={inputCls} style={inputStyle} value={form.delivery_fee} onChange={e => set('delivery_fee', e.target.value)} required />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>Priorité</label>
              <select className={inputCls} style={inputStyle} value={form.priority} onChange={e => set('priority', e.target.value)}>
                {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* SECTION 5 — DESCRIPTION DU COLIS */}
        <section className="rounded-xl p-4 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 flex-shrink-0" style={{ color: '#6B7280' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Description du courrier</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls} style={labelStyle}>Nature du courrier</label>
              <select className={inputCls} style={inputStyle} value={form.nature} onChange={e => set('nature', e.target.value)}>
                {NATURE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls} style={labelStyle}>Désignation / Contenu *</label>
            <textarea
              className={inputCls} style={inputStyle}
              rows={3}
              placeholder="ex: 01 SHT BLC (HABIT)"
              value={form.content_description}
              onChange={e => set('content_description', e.target.value)}
              required
            />
          </div>
        </section>

        {/* SECTION 5 — RÉCAPITULATIF */}
        <section className="rounded-xl p-4 sm:p-5" style={{ backgroundColor: '#f0faf4', border: '2px solid #0B7439' }}>
          <div className="flex items-center gap-2 mb-3 sm:mb-4">
            <FileText className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <h2 className="font-semibold text-sm" style={{ color: '#0B7439' }}>Récapitulatif</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span style={{ color: '#374151' }}>Frais de livraison</span>
              <span className="font-medium">{Number(form.delivery_fee).toLocaleString('fr-CI')} FCFA</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: '#374151' }}>Frais SMS tracking</span>
              <span className="font-medium">{Number(form.sms_tracking_fee).toLocaleString('fr-CI')} FCFA</span>
            </div>
            <div className="border-t pt-2 mt-2 flex justify-between font-bold text-base" style={{ borderColor: '#0B7439' }}>
              <span style={{ color: '#0B7439' }}>TOTAL</span>
              <span style={{ color: '#0B7439' }}>{total.toLocaleString('fr-CI')} FCFA</span>
            </div>
          </div>
        </section>

        {/* Spacer so content isn't hidden behind the sticky bar on mobile */}
        <div className="h-32 lg:hidden" />
      </form>

      {/* Actions — sticky on mobile/tablet, inline on desktop */}
      <div
        className="sticky-form-actions flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end"
        style={{ backgroundColor: 'var(--bg-subtle)' }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-full sm:w-auto px-5 py-2.5 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' }}
        >
          Annuler
        </button>
        <button
          type="submit"
          form="new-parcel-form"
          disabled={loading}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: '#0B7439', color: '#fff' }}
        >
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {loading ? 'Enregistrement...' : 'Enregistrer + Imprimer'}
        </button>
      </div>
    </div>
  )
}
