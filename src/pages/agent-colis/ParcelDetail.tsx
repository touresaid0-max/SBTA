import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Package, User, MapPin, Clock, MessageCircle, AlertTriangle, Bus, Navigation, Camera, ZoomIn, X, Pencil, Check, Loader2 as Loader2Icon } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import { fetchTrackingEvents, updateParcelStatus, updateParcelNames } from '@/services/parcel.service'
import { fetchSmsLogs, resendSms } from '@/services/emisSms.service'
import type { SmsLog } from '@/services/emisSms.service'
import ParcelStatusStepper from '@/components/parcel/ParcelStatusStepper'
import { getParcelActionPermission } from '@/utils/parcelPermissions'
import ChangeRequestButton from '@/components/shared/ChangeRequestButton'
import type { Parcel, ParcelTrackingEvent, ParcelStatus } from '@/types/parcel.types'

const STATUS_CONFIG: Record<ParcelStatus, { label: string; color: string; bg: string }> = {
  enregistre:    { label: 'Enregistré',    color: '#0B7439', bg: '#d4edda' },
  mis_en_paquet: { label: 'Mis en paquet', color: '#1D6FA4', bg: '#DBEAFE' },
  expedie:       { label: 'Expédié',       color: '#D97706', bg: '#FEF3C7' },
  arrive:        { label: 'Arrivé',        color: '#0B7439', bg: '#d4edda' },
  livre:         { label: 'Retiré',        color: '#0B7439', bg: '#d4edda' },
  retourne:      { label: 'Retourné',      color: '#92400E', bg: '#FEF3C7' },
  perdu:         { label: 'Perdu',         color: '#AF3029', bg: '#f8d7d5' },
}

export default function ParcelDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const [parcel, setParcel] = useState<Parcel | null>(null)
  const [scheduleInfo, setScheduleInfo] = useState<{
    route_name: string | null
    departure_datetime: string | null
    arrival_datetime: string | null
    estimated_duration_minutes: number | null
    bus_registration: string | null
    driver_name: string | null
    driver_phone: string | null
    status: string | null
  } | null>(null)
  const [directBusInfo, setDirectBusInfo] = useState<{
    bus_registration: string | null
    bus_brand: string | null
    driver_name: string | null
  } | null>(null)
  const [events, setEvents] = useState<ParcelTrackingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([])
  const [resending, setResending] = useState<string | null>(null)

  const [editingSender, setEditingSender] = useState(false)
  const [editingRecipient, setEditingRecipient] = useState(false)
  const [editSenderName, setEditSenderName] = useState('')
  const [editRecipientName, setEditRecipientName] = useState('')
  const [savingName, setSavingName] = useState(false)

  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  const [deliveryName, setDeliveryName] = useState('')
  const [deliveryPhone, setDeliveryPhone] = useState('')
  const [deliveryCni, setDeliveryCni] = useState('')

  const canEditNames = parcel != null && !['expedie', 'arrive', 'livre', 'retourne', 'perdu'].includes(parcel.status)

  async function handleSaveName(field: 'sender_name' | 'recipient_name') {
    if (!parcel) return
    const value = field === 'sender_name' ? editSenderName : editRecipientName
    if (!value.trim()) { toast.error('Le nom ne peut pas être vide'); return }
    setSavingName(true)
    try {
      await updateParcelNames(parcel.id, { [field]: value.trim() })
      setParcel(prev => prev ? { ...prev, [field]: value.trim() } : prev)
      toast.success('Nom mis à jour')
      if (field === 'sender_name') setEditingSender(false)
      else setEditingRecipient(false)
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la mise à jour')
    } finally {
      setSavingName(false)
    }
  }

  const stationId    = user?.station_id    ?? null

  useEffect(() => {
    if (!id) return
    async function load() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('parcels')
          .select(`
            *,
            origin_station:stations!origin_station_id(id, name, phone),
            dest_station:stations!destination_station_id(id, name),
            schedule:schedules!schedule_id(
              route_name,
              departure_datetime,
              arrival_datetime,
              estimated_duration_minutes,
              status,
              buses!bus_id(registration_number, brand, model, total_seats, companies(name)),
              users!driver_id(full_name, phone)
            ),
            direct_bus:buses!parcels_bus_id_fkey(registration_number, brand),
            direct_driver:users!parcels_driver_id_fkey(full_name)
          `)
          .eq('id', id)
          .maybeSingle()

        if (error) throw error
        if (data) {
          setParcel({
            ...data,
            origin_station_name: (data as any).origin_station?.name ?? '',
            destination_station_name: (data as any).dest_station?.name ?? '',
          })
          const sched = (data as any).schedule
          if (sched) {
            setScheduleInfo({
              route_name: sched.route_name ?? null,
              departure_datetime: sched.departure_datetime ?? null,
              arrival_datetime: sched.arrival_datetime ?? null,
              estimated_duration_minutes: sched.estimated_duration_minutes ?? null,
              bus_registration: sched.buses?.registration_number ?? null,
              driver_name: sched.users?.full_name ?? null,
              driver_phone: sched.users?.phone ?? null,
              status: sched.status ?? null,
            })
          } else {
            setScheduleInfo(null)
          }

          const dBus = (data as any).direct_bus
          const dDriver = (data as any).direct_driver
          if (dBus || dDriver) {
            setDirectBusInfo({
              bus_registration: dBus?.registration_number ?? null,
              bus_brand: dBus?.brand ?? null,
              driver_name: dDriver?.full_name ?? null,
            })
          } else {
            setDirectBusInfo(null)
          }
        }

        const evts = await fetchTrackingEvents(id)
        setEvents(evts)

        const logs = await fetchSmsLogs(id)
        setSmsLogs(logs)
      } catch {
        toast.error('Erreur chargement courrier')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  async function handleAdvance(newStatus: ParcelStatus) {
    if (!parcel) return
    if (newStatus === 'livre') {
      setShowDeliveryModal(true)
      return
    }
    await doAdvance(newStatus)
  }

  async function doAdvance(newStatus: ParcelStatus, additionalData?: Record<string, unknown>) {
    if (!parcel) return
    setActionLoading(true)
    try {
      await updateParcelStatus(parcel.id, newStatus, additionalData)
      toast.success(`Statut mis a jour : ${STATUS_CONFIG[newStatus].label}`)
      setParcel(prev => prev ? { ...prev, status: newStatus, ...additionalData } : prev)
      const evts = await fetchTrackingEvents(parcel.id)
      setEvents(evts)

      if (newStatus === 'arrive') {
        const logs = await fetchSmsLogs(parcel.id)
        setSmsLogs(logs)
        const arrivedLog = logs.find(l => l.sms_type === 'ARRIVED')
        if (arrivedLog?.status === 'FAILED' || !arrivedLog) {
          toast('Statut mis a jour, mais SMS non envoye.', { icon: '\u26A0\uFE0F' })
        }
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setActionLoading(false)
    }
  }

  async function confirmDelivery() {
    if (!parcel) return
    const name = deliveryName.trim()
    const phone = deliveryPhone.trim()
    const cni = deliveryCni.trim()
    if (!name && !phone && !cni) {
      toast.error('Veuillez renseigner au moins une information d\u2019identification du client')
      return
    }
    const additionalData: Record<string, unknown> = {}
    if (name) {
      additionalData.delivery_recipient_name = name
      additionalData.delivery_id_type = 'name'
    }
    if (phone) {
      additionalData.delivery_recipient_phone = phone
      if (!additionalData.delivery_id_type) additionalData.delivery_id_type = 'phone'
    }
    if (cni) {
      additionalData.delivery_id_number = cni
      if (!additionalData.delivery_id_type) additionalData.delivery_id_type = 'cni'
    }
    setShowDeliveryModal(false)
    await doAdvance('livre', additionalData)
    setDeliveryName('')
    setDeliveryPhone('')
    setDeliveryCni('')
  }

  async function handleResendSms(logId: string) {
    setResending(logId)
    try {
      const result = await resendSms(logId)
      if (result.success) {
        toast.success('SMS renvoye avec succes')
      } else {
        toast.error('Echec du renvoi SMS')
      }
      if (parcel) {
        const logs = await fetchSmsLogs(parcel.id)
        setSmsLogs(logs)
      }
    } catch {
      toast.error('Erreur lors du renvoi')
    } finally {
      setResending(null)
    }
  }

  const actionPerm = parcel && stationId
    ? getParcelActionPermission(
        parcel.status,
        parcel.origin_station_id,
        parcel.destination_station_id,
        stationId,
      )
    : { allowed: false as const, reason: '' }

  const isOriginStation      = parcel ? parcel.origin_station_id === stationId : false
  const isDestinationStation = parcel ? parcel.destination_station_id === stationId : false

  if (!stationId) {
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#0B7439', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  if (!parcel) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
        Courrier introuvable
      </div>
    )
  }

  const sc = STATUS_CONFIG[parcel.status]

  return (
    <div className="agent-colis-theme p-3 sm:p-4 lg:p-6 max-w-3xl mx-auto space-y-4 sm:space-y-5 lg:space-y-6 overflow-x-hidden">

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => navigate('/agent-colis/dashboard')}
            className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-gray-100 flex-shrink-0"
            title="Retour à l'accueil"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-xl font-bold font-mono" style={{ color: '#0B7439' }}>
                {parcel.parcel_code}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0" style={{ backgroundColor: sc.bg, color: sc.color }}>
                {sc.label}
              </span>
            </div>
          </div>
        </div>

        <ChangeRequestButton
          operationType="courrier_sortant"
          operationId={parcel.id}
          operationTable="parcels"
          operationReference={`Courrier ${parcel.parcel_code}`}
          operationSnapshot={parcel as unknown as Record<string, unknown>}
          stationId={stationId}
          stationName={user?.station_name}
        />

      </div>

      {/* Workflow */}
      <div className="rounded-xl p-3 sm:p-4 lg:p-5 space-y-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Suivi du courrier</h2>
          {/* Station role badge */}
          {isOriginStation && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
              Gare de départ
            </span>
          )}
          {isDestinationStation && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
              Gare de destination
            </span>
          )}
        </div>

        <ParcelStatusStepper
          parcel={parcel}
          onAdvance={handleAdvance}
          canAdvance={actionPerm.allowed}
          loading={actionLoading}
        />

        {/* Blocked action message */}
        {!actionPerm.allowed && actionPerm.reason && (
          <div
            className="flex items-start gap-2 px-3 py-2.5 rounded-lg"
            style={{ backgroundColor: '#FEF3C7', border: '1px solid #D97706' }}
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#D97706' }} />
            <p className="text-xs font-medium leading-relaxed" style={{ color: '#92400E' }}>
              {actionPerm.reason}
            </p>
          </div>
        )}
      </div>

      {/* Info cards — 1 col mobile, 2 cols tablette+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Expéditeur */}
        <div className="rounded-xl p-3 sm:p-4 space-y-1.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <span className="font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>EXPÉDITEUR</span>
            {canEditNames && !editingSender && (
              <button
                onClick={() => { setEditSenderName(parcel.sender_name); setEditingSender(true) }}
                className="ml-auto p-1 rounded hover:bg-gray-100 transition-colors"
                title="Modifier le nom de l'expéditeur"
              >
                <Pencil className="w-3.5 h-3.5" style={{ color: '#0B7439' }} />
              </button>
            )}
          </div>
          {editingSender ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                className="flex-1 text-sm font-semibold px-2 py-1.5 rounded-lg border outline-none focus:ring-2 focus:ring-green-500"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' }}
                value={editSenderName}
                onChange={e => setEditSenderName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveName('sender_name'); if (e.key === 'Escape') setEditingSender(false) }}
                disabled={savingName}
              />
              <button
                onClick={() => handleSaveName('sender_name')}
                disabled={savingName || !editSenderName.trim()}
                className="p-1.5 rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#0B7439', color: '#fff' }}
              >
                {savingName ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setEditingSender(false)}
                disabled={savingName}
                className="p-1.5 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p className="font-semibold text-sm sm:text-base" style={{ color: 'var(--text-primary)' }}>{parcel.sender_name}</p>
          )}
          <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>{parcel.sender_phone}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{parcel.origin_station_name}</p>
        </div>

        {/* Destinataire */}
        <div className="rounded-xl p-3 sm:p-4 space-y-1.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#1D6FA4' }} />
            <span className="font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>DESTINATAIRE</span>
            {canEditNames && !editingRecipient && (
              <button
                onClick={() => { setEditRecipientName(parcel.recipient_name); setEditingRecipient(true) }}
                className="ml-auto p-1 rounded hover:bg-gray-100 transition-colors"
                title="Modifier le nom du destinataire"
              >
                <Pencil className="w-3.5 h-3.5" style={{ color: '#1D6FA4' }} />
              </button>
            )}
          </div>
          {editingRecipient ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                className="flex-1 text-sm font-semibold px-2 py-1.5 rounded-lg border outline-none focus:ring-2 focus:ring-blue-500"
                style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' }}
                value={editRecipientName}
                onChange={e => setEditRecipientName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveName('recipient_name'); if (e.key === 'Escape') setEditingRecipient(false) }}
                disabled={savingName}
              />
              <button
                onClick={() => handleSaveName('recipient_name')}
                disabled={savingName || !editRecipientName.trim()}
                className="p-1.5 rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#1D6FA4', color: '#fff' }}
              >
                {savingName ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setEditingRecipient(false)}
                disabled={savingName}
                className="p-1.5 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p className="font-semibold text-sm sm:text-base" style={{ color: 'var(--text-primary)' }}>{parcel.recipient_name}</p>
          )}
          <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>{parcel.recipient_phone}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{parcel.recipient_city} — {parcel.destination_station_name}</p>
        </div>

        {/* Colis */}
        <div className="rounded-xl p-3 sm:p-4 space-y-1.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4 flex-shrink-0" style={{ color: '#D97706' }} />
            <span className="font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>COURRIER</span>
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{parcel.content_description}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Nature : {parcel.nature} · Priorité : {parcel.priority}
          </p>
          {parcel.notes && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Note : {parcel.notes}</p>}
        </div>

        {/* Finances */}
        <div className="rounded-xl p-3 sm:p-4 space-y-1.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <MessageCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#6B7280' }} />
            <span className="font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>FINANCES</span>
          </div>
          <div className="text-xs sm:text-sm space-y-1.5">
            <div className="flex justify-between gap-2">
              <span style={{ color: 'var(--text-secondary)' }}>Valeur déclarée</span>
              <span className="font-medium text-right" style={{ color: 'var(--text-primary)' }}>{Number(parcel.declared_value).toLocaleString('fr-CI')} FCFA</span>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: 'var(--text-secondary)' }}>Frais livraison</span>
              <span className="font-medium text-right" style={{ color: 'var(--text-primary)' }}>{Number(parcel.delivery_fee).toLocaleString('fr-CI')} FCFA</span>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: 'var(--text-secondary)' }}>Frais SMS</span>
              <span className="font-medium text-right" style={{ color: 'var(--text-primary)' }}>{Number(parcel.sms_tracking_fee).toLocaleString('fr-CI')} FCFA</span>
            </div>
            <div className="flex justify-between gap-2 font-bold pt-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
              <span style={{ color: '#0B7439' }}>TOTAL</span>
              <span style={{ color: '#0B7439' }}>{Number(parcel.total_amount).toLocaleString('fr-CI')} FCFA</span>
            </div>
          </div>
        </div>
      </div>

      {/* Photos du colis */}
      {parcel.parcel_photos && parcel.parcel_photos.length > 0 && (
        <div className="rounded-xl p-3 sm:p-4 lg:p-5 space-y-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              Photo{parcel.parcel_photos.length > 1 ? 's' : ''} du courrier
            </h2>
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
              {parcel.parcel_photos.length} photo{parcel.parcel_photos.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            {parcel.parcel_photos.map((url, idx) => (
              <button
                key={url}
                type="button"
                onClick={() => setLightbox(url)}
                className="relative rounded-xl overflow-hidden flex-shrink-0 group"
                style={{
                  width: 96,
                  height: 96,
                  border: '2px solid var(--border)',
                }}
                title="Agrandir"
              >
                <img
                  src={url}
                  alt={`Photo courrier ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
                >
                  <ZoomIn className="w-5 h-5 text-white" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
            onClick={() => setLightbox(null)}
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={lightbox}
            alt="Photo courrier"
            className="rounded-xl object-contain"
            style={{ maxWidth: '90vw', maxHeight: '85vh', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Bus d'acheminement — only shown from "expedie" status onwards */}
      {['expedie', 'arrive', 'livre', 'retourne'].includes(parcel.status) && (
        <>
      {scheduleInfo ? (
        <div className="rounded-xl overflow-hidden" style={{ border: '2px solid #0B7439' }}>
          {/* En-tete */}
          <div className="px-3 sm:px-5 py-2.5 sm:py-3 flex items-center justify-between gap-2" style={{ backgroundColor: '#0B7439' }}>
            <div className="flex items-center gap-2">
              <Bus className="w-4 h-4 text-white flex-shrink-0" />
              <span className="font-semibold text-sm text-white">Bus d'acheminement</span>
            </div>
            {scheduleInfo.status && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{
                backgroundColor: scheduleInfo.status === 'planifie' ? '#d4edda' : scheduleInfo.status === 'en_cours' ? '#FEF3C7' : '#F3F4F6',
                color: scheduleInfo.status === 'planifie' ? '#0B7439' : scheduleInfo.status === 'en_cours' ? '#D97706' : '#374151',
              }}>
                {scheduleInfo.status === 'planifie' ? 'Planifie' : scheduleInfo.status === 'en_cours' ? 'En cours' : scheduleInfo.status}
              </span>
            )}
          </div>

          <div className="p-3 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#d4edda' }}>
                <Bus className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: '#0B7439' }} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Numero du bus</p>
                <p className="font-bold font-mono text-sm sm:text-base" style={{ color: '#0B7439' }}>
                  {scheduleInfo.bus_registration ?? '—'}
                </p>
                {scheduleInfo.route_name && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{scheduleInfo.route_name}</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEF3C7' }}>
                <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: '#D97706' }} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Chauffeur</p>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {scheduleInfo.driver_name ?? 'Non assigne'}
                </p>
                {scheduleInfo.driver_phone && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{scheduleInfo.driver_phone}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-wide mb-1 leading-tight" style={{ color: 'var(--text-muted)' }}>Depart</p>
                {scheduleInfo.departure_datetime ? (
                  <>
                    <p className="text-xs sm:text-sm font-bold" style={{ color: '#0B7439' }}>
                      {format(new Date(scheduleInfo.departure_datetime), 'HH:mm', { locale: fr })}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {format(new Date(scheduleInfo.departure_datetime), 'dd/MM/yy', { locale: fr })}
                    </p>
                  </>
                ) : <p className="text-sm" style={{ color: 'var(--text-muted)' }}>—</p>}
              </div>
              <div className="text-center border-x" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1 leading-tight" style={{ color: 'var(--text-muted)' }}>Duree</p>
                <p className="text-xs sm:text-sm font-bold" style={{ color: '#1D6FA4' }}>
                  {scheduleInfo.estimated_duration_minutes
                    ? (() => {
                        const h = Math.floor(scheduleInfo.estimated_duration_minutes / 60)
                        const m = scheduleInfo.estimated_duration_minutes % 60
                        return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m}min`
                      })()
                    : '—'}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>trajet</p>
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-wide mb-1 leading-tight" style={{ color: 'var(--text-muted)' }}>Arrivee</p>
                {(scheduleInfo.arrival_datetime || (scheduleInfo.departure_datetime && scheduleInfo.estimated_duration_minutes)) ? (
                  (() => {
                    const arr = scheduleInfo.arrival_datetime
                      ? new Date(scheduleInfo.arrival_datetime)
                      : new Date(new Date(scheduleInfo.departure_datetime!).getTime() + scheduleInfo.estimated_duration_minutes! * 60000)
                    return (
                      <>
                        <p className="text-xs sm:text-sm font-bold" style={{ color: '#D97706' }}>
                          {format(arr, 'HH:mm', { locale: fr })}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {format(arr, 'dd/MM/yy', { locale: fr })}
                        </p>
                      </>
                    )
                  })()
                ) : <p className="text-sm" style={{ color: 'var(--text-muted)' }}>—</p>}
              </div>
            </div>
          </div>
        </div>
      ) : directBusInfo && (directBusInfo.bus_registration || directBusInfo.driver_name) ? (
        <div className="rounded-xl overflow-hidden" style={{ border: '2px solid #0B7439' }}>
          <div className="px-3 sm:px-5 py-2.5 sm:py-3 flex items-center gap-2" style={{ backgroundColor: '#0B7439' }}>
            <Bus className="w-4 h-4 text-white flex-shrink-0" />
            <span className="font-semibold text-sm text-white">Bus d'acheminement</span>
          </div>
          <div className="p-3 sm:p-5 space-y-3 sm:space-y-4" style={{ backgroundColor: 'var(--surface)' }}>
            {directBusInfo.bus_registration && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#d4edda' }}>
                  <Bus className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: '#0B7439' }} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Plaque d'immatriculation</p>
                  <p className="font-bold font-mono text-sm sm:text-base" style={{ color: '#0B7439' }}>
                    {directBusInfo.bus_registration}
                  </p>
                  {directBusInfo.bus_brand && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{directBusInfo.bus_brand}</p>
                  )}
                </div>
              </div>
            )}
            {directBusInfo.driver_name && (
              <div className="flex items-start gap-3 rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEF3C7' }}>
                  <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: '#D97706' }} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Chauffeur</p>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {directBusInfo.driver_name}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : parcel.schedule_id ? (
        <div className="rounded-xl p-3 sm:p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Bus className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Chargement des informations du bus...</p>
        </div>
      ) : (
        <div className="rounded-xl p-3 sm:p-4 flex items-center gap-3" style={{ backgroundColor: 'var(--bg-subtle)', border: '1px dashed var(--border)' }}>
          <Navigation className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucun bus assigne pour l'acheminement de ce courrier.</p>
        </div>
      )}
        </>
      )}

      {/* SMS Status */}
      <div className="rounded-xl p-3 sm:p-4 lg:p-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#1D6FA4' }} />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Notifications SMS</h2>
        </div>
        {(() => {
          const createdLog = smsLogs.find(l => l.sms_type === 'CREATED')
          const arrivedLog = smsLogs.find(l => l.sms_type === 'ARRIVED')
          return (
            <div className="space-y-2">
              <SmsStatusRow
                label="SMS creation"
                log={createdLog}
                resending={resending}
                onResend={handleResendSms}
              />
              <SmsStatusRow
                label="SMS arrivee"
                log={arrivedLog}
                resending={resending}
                onResend={handleResendSms}
              />
            </div>
          )
        })()}
      </div>

      {/* Timeline */}
      <div className="rounded-xl p-3 sm:p-4 lg:p-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-3 sm:mb-4">
          <Clock className="w-4 h-4 flex-shrink-0" style={{ color: '#6B7280' }} />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Historique des evenements</h2>
        </div>
        {events.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aucun événement enregistré</p>
        ) : (
          <div className="space-y-3">
            {events.map((evt, idx) => {
              const sc2 = STATUS_CONFIG[evt.event_type as ParcelStatus] ?? { color: '#6B7280', bg: '#F3F4F6' }
              return (
                <div key={evt.id} className="flex gap-2 sm:gap-3">
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full mt-0.5" style={{ backgroundColor: sc2.color }} />
                    {idx < events.length - 1 && <div className="w-0.5 flex-1 mt-1" style={{ backgroundColor: 'var(--border)' }} />}
                  </div>
                  <div className="pb-3 flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs sm:text-sm font-semibold" style={{ color: sc2.color }}>{evt.description}</span>
                      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(evt.event_at), 'dd/MM HH:mm', { locale: fr })}
                      </span>
                    </div>
                    {evt.performer_name && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>par {evt.performer_name}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Delivery confirmation modal */}
      {showDeliveryModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowDeliveryModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl shadow-2xl"
            style={{ backgroundColor: 'var(--surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                Retrait du courrier {parcel?.parcel_code}
              </h3>
              <button onClick={() => setShowDeliveryModal(false)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: '#FEF3C7', border: '1px solid #D97706' }}>
                <p className="text-xs font-medium leading-relaxed" style={{ color: '#92400E' }}>
                  Veuillez renseigner au moins une information permettant d'identifier le client qui retire le colis.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                    Numéro CNI du client
                  </label>
                  <input
                    type="text"
                    value={deliveryCni}
                    onChange={e => setDeliveryCni(e.target.value)}
                    placeholder="Ex : C123456789"
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                    Nom du client
                  </label>
                  <input
                    type="text"
                    value={deliveryName}
                    onChange={e => setDeliveryName(e.target.value)}
                    placeholder="Nom et prénom"
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                    Numéro de téléphone
                  </label>
                  <input
                    type="tel"
                    value={deliveryPhone}
                    onChange={e => setDeliveryPhone(e.target.value)}
                    placeholder="Ex : 07 00 00 00 00"
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-emerald-500"
                    style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => setShowDeliveryModal(false)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Annuler
              </button>
              <button
                onClick={confirmDelivery}
                disabled={actionLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: '#0B7439', color: '#fff' }}
              >
                {actionLoading ? 'Enregistrement...' : 'Confirmer le retrait'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SmsStatusRow({ label, log, resending, onResend }: {
  label: string
  log: SmsLog | undefined
  resending: string | null
  onResend: (logId: string) => void
}) {
  const isSent   = log?.status === 'SENT'
  const isFailed = log?.status === 'FAILED'
  const noLog    = !log

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: isSent ? '#0B7439' : isFailed ? '#DC2626' : '#9CA3AF' }}
        />
        <span className="text-xs sm:text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {label}
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
          style={{
            backgroundColor: isSent ? '#d4edda' : isFailed ? '#fee2e2' : '#F3F4F6',
            color: isSent ? '#0B7439' : isFailed ? '#DC2626' : '#6B7280',
          }}
        >
          {isSent ? 'Envoye' : isFailed ? 'Echec' : 'Non envoye'}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {log?.sent_at && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {format(new Date(log.sent_at), 'dd/MM HH:mm', { locale: fr })}
          </span>
        )}
        {(isFailed || (noLog && false)) && log && (
          <button
            onClick={() => onResend(log.id)}
            disabled={resending === log.id}
            className="text-xs px-2 py-1 rounded font-medium disabled:opacity-50"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
          >
            {resending === log.id ? '...' : 'Renvoyer'}
          </button>
        )}
      </div>
    </div>
  )
}
