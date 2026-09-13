import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Printer, Package, User, MapPin, Clock,
  MessageCircle, Bus, Navigation, Camera, ZoomIn, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { supabase } from '@/services/supabase'
import { fetchTrackingEvents, fetchParcelAgentInfo } from '@/services/parcel.service'
import { buildReceiptData, printParcelTicket } from '@/utils/printParcelTicket'
import ParcelStatusStepper from '@/components/parcel/ParcelStatusStepper'
import type { Parcel, ParcelTrackingEvent, ParcelStatus } from '@/types/parcel.types'

const STATUS_CONFIG: Record<ParcelStatus, { label: string; color: string; bg: string }> = {
  enregistre:    { label: 'Enregistré',    color: '#0B7439', bg: '#d4edda' },
  mis_en_paquet: { label: 'Mis en paquet', color: '#1D6FA4', bg: '#DBEAFE' },
  expedie:       { label: 'Expédié',       color: '#D97706', bg: '#FEF3C7' },
  arrive:        { label: 'Arrivé',        color: '#1D6FA4', bg: '#DBEAFE' },
  livre:         { label: 'Retiré',        color: '#0B7439', bg: '#d4edda' },
  retourne:      { label: 'Retourné',      color: '#92400E', bg: '#FEF3C7' },
  perdu:         { label: 'Perdu',         color: '#AF3029', bg: '#f8d7d5' },
}

interface ScheduleInfo {
  bus_registration:           string | null
  driver_name:                string | null
  driver_phone:               string | null
  departure_datetime:         string | null
  arrival_datetime:           string | null
  estimated_duration_minutes: number | null
  route_name:                 string | null
  status:                     string | null
}

export default function SuperviseurParcelDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [parcel, setParcel]           = useState<Parcel | null>(null)
  const [events, setEvents]           = useState<ParcelTrackingEvent[]>([])
  const [scheduleInfo, setScheduleInfo] = useState<ScheduleInfo | null>(null)
  const [directBusInfo, setDirectBusInfo] = useState<{
    bus_registration: string | null
    bus_brand: string | null
    driver_name: string | null
  } | null>(null)
  const [loading, setLoading]         = useState(true)
  const [lightbox, setLightbox]       = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    async function load() {
      setLoading(true)
      try {
        const { data: p, error } = await supabase
          .from('parcels')
          .select(`
            *,
            origin_station:stations!origin_station_id(id, name),
            dest_station:stations!destination_station_id(id, name),
            companies(name),
            direct_bus:buses!parcels_bus_id_fkey(registration_number, brand),
            direct_driver:users!parcels_driver_id_fkey(full_name)
          `)
          .eq('id', id)
          .maybeSingle()

        if (error) throw error
        setParcel(p)

        const evts = await fetchTrackingEvents(id)
        setEvents(evts)

        if (p) {
          const dBus = (p as any).direct_bus
          const dDriver = (p as any).direct_driver
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

        if (p?.schedule_id) {
          const { data: sched } = await supabase
            .from('schedules')
            .select(`
              id, status, departure_datetime, arrival_datetime, estimated_duration_minutes,
              buses(registration_number),
              routes(name),
              users!schedules_driver_id_fkey(full_name, phone)
            `)
            .eq('id', p.schedule_id)
            .maybeSingle()

          if (sched) {
            setScheduleInfo({
              bus_registration:           (sched.buses as any)?.registration_number ?? null,
              driver_name:                (sched.users as any)?.full_name ?? null,
              driver_phone:               (sched.users as any)?.phone ?? null,
              departure_datetime:         sched.departure_datetime,
              arrival_datetime:           sched.arrival_datetime,
              estimated_duration_minutes: sched.estimated_duration_minutes,
              route_name:                 (sched.routes as any)?.name ?? null,
              status:                     sched.status,
            })
          }
        }
      } catch (e: any) {
        toast.error(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  async function handlePrint() {
    if (!parcel) return
    const agentInfo = await fetchParcelAgentInfo(parcel.origin_station_id, parcel.destination_station_id).catch(() => null)
    const { data: stationData } = await supabase
      .from('stations')
      .select('courier_qr_enabled')
      .eq('id', parcel.origin_station_id)
      .maybeSingle()
    await printParcelTicket(buildReceiptData(parcel, parcel.origin_station_name, '', null, null, agentInfo, stationData?.courier_qr_enabled ?? true))
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
    <div className="p-3 sm:p-4 lg:p-6 max-w-3xl mx-auto space-y-4 sm:space-y-5 lg:space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-xl font-bold font-mono" style={{ color: '#0B7439' }}>
                {parcel.parcel_code}
              </h1>
              <span
                className="px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0"
                style={{ backgroundColor: sc.bg, color: sc.color }}
              >
                {sc.label}
              </span>
              {/* Read-only badge */}
              <span className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0" style={{ backgroundColor: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB' }}>
                Lecture seule
              </span>
            </div>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
              Ref. {parcel.reference}
            </p>
          </div>
        </div>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border text-xs sm:text-sm flex-shrink-0"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <Printer className="w-4 h-4" />
          <span className="hidden xs:inline">Ticket</span>
        </button>
      </div>

      {/* Workflow — read-only (canAdvance=false, no loading) */}
      <div className="rounded-xl p-3 sm:p-4 lg:p-5 space-y-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Suivi du courrier</h2>
          <div className="flex items-center gap-1.5">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
              {parcel.origin_station_name}
            </span>
            <Navigation className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D6FA4' }}>
              {parcel.destination_station_name}
            </span>
          </div>
        </div>
        <ParcelStatusStepper
          parcel={parcel}
          onAdvance={async () => {}}
          canAdvance={false}
          loading={false}
        />
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Expéditeur */}
        <div className="rounded-xl p-3 sm:p-4 space-y-1.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 flex-shrink-0" style={{ color: '#0B7439' }} />
            <span className="font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>EXPÉDITEUR</span>
          </div>
          <p className="font-semibold text-sm sm:text-base" style={{ color: 'var(--text-primary)' }}>{parcel.sender_name}</p>
          <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>{parcel.sender_phone}</p>
          {parcel.sender_address && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{parcel.sender_address}</p>}
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{parcel.origin_station_name}</p>
        </div>

        {/* Destinataire */}
        <div className="rounded-xl p-3 sm:p-4 space-y-1.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#1D6FA4' }} />
            <span className="font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>DESTINATAIRE</span>
          </div>
          <p className="font-semibold text-sm sm:text-base" style={{ color: 'var(--text-primary)' }}>{parcel.recipient_name}</p>
          <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>{parcel.recipient_phone}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{parcel.recipient_city} — {parcel.destination_station_name}</p>
          {parcel.recipient_address && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{parcel.recipient_address}</p>}
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
          {parcel.notes && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Note : {parcel.notes}</p>
          )}
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
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{Number(parcel.declared_value).toLocaleString('fr-CI')} F</span>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: 'var(--text-secondary)' }}>Frais livraison</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{Number(parcel.delivery_fee).toLocaleString('fr-CI')} F</span>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: 'var(--text-secondary)' }}>Frais SMS</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{Number(parcel.sms_tracking_fee).toLocaleString('fr-CI')} F</span>
            </div>
            <div className="flex justify-between gap-2 font-bold pt-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
              <span style={{ color: '#0B7439' }}>TOTAL</span>
              <span style={{ color: '#0B7439' }}>{Number(parcel.total_amount).toLocaleString('fr-CI')} F</span>
            </div>
          </div>
        </div>
      </div>

      {/* Photos */}
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
                style={{ width: 96, height: 96, border: '2px solid var(--border)' }}
              >
                <img src={url} alt={`Photo courrier ${idx + 1}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
                  <ZoomIn className="w-5 h-5 text-white" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }} onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} onClick={() => setLightbox(null)}>
            <X className="w-6 h-6 text-white" />
          </button>
          <img src={lightbox} alt="Photo courrier" className="rounded-xl object-contain" style={{ maxWidth: '90vw', maxHeight: '85vh' }} onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* Bus d'acheminement */}
      {scheduleInfo ? (
        <div className="rounded-xl overflow-hidden" style={{ border: '2px solid #0B7439' }}>
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
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#d4edda' }}>
                <Bus className="w-4 h-4" style={{ color: '#0B7439' }} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Numero du bus</p>
                <p className="font-bold font-mono text-sm" style={{ color: '#0B7439' }}>{scheduleInfo.bus_registration ?? '—'}</p>
                {scheduleInfo.route_name && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{scheduleInfo.route_name}</p>}
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEF3C7' }}>
                <User className="w-4 h-4" style={{ color: '#D97706' }} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Chauffeur</p>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{scheduleInfo.driver_name ?? 'Non assigne'}</p>
                {scheduleInfo.driver_phone && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{scheduleInfo.driver_phone}</p>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Depart</p>
                {scheduleInfo.departure_datetime ? (
                  <>
                    <p className="text-sm font-bold" style={{ color: '#0B7439' }}>{format(new Date(scheduleInfo.departure_datetime), 'HH:mm', { locale: fr })}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{format(new Date(scheduleInfo.departure_datetime), 'dd/MM/yy', { locale: fr })}</p>
                  </>
                ) : <p className="text-sm" style={{ color: 'var(--text-muted)' }}>—</p>}
              </div>
              <div className="text-center border-x" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Duree</p>
                <p className="text-sm font-bold" style={{ color: '#1D6FA4' }}>
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
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Arrivee</p>
                {scheduleInfo.arrival_datetime ? (
                  <>
                    <p className="text-sm font-bold" style={{ color: '#1D6FA4' }}>{format(new Date(scheduleInfo.arrival_datetime), 'HH:mm', { locale: fr })}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{format(new Date(scheduleInfo.arrival_datetime), 'dd/MM/yy', { locale: fr })}</p>
                  </>
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
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#d4edda' }}>
                  <Bus className="w-4 h-4" style={{ color: '#0B7439' }} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Plaque d'immatriculation</p>
                  <p className="font-bold font-mono text-sm" style={{ color: '#0B7439' }}>{directBusInfo.bus_registration}</p>
                  {directBusInfo.bus_brand && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{directBusInfo.bus_brand}</p>}
                </div>
              </div>
            )}
            {directBusInfo.driver_name && (
              <div className="flex items-start gap-3 rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEF3C7' }}>
                  <User className="w-4 h-4" style={{ color: '#D97706' }} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-muted)' }}>Chauffeur</p>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{directBusInfo.driver_name}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Historique de suivi */}
      {events.length > 0 && (
        <div className="rounded-xl p-3 sm:p-4 lg:p-5 space-y-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 flex-shrink-0" style={{ color: '#6B7280' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Historique de suivi</h2>
          </div>
          <div className="space-y-0">
            {events.map((evt, idx) => {
              const sc2 = STATUS_CONFIG[evt.event_type as ParcelStatus] ?? { color: '#6B7280', bg: '#F3F4F6', label: evt.event_type }
              return (
                <div key={evt.id} className="flex gap-3 relative">
                  {idx < events.length - 1 && (
                    <div className="absolute left-3.5 top-6 bottom-0 w-px" style={{ backgroundColor: 'var(--border)' }} />
                  )}
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 z-10" style={{ backgroundColor: sc2.bg, border: `2px solid ${sc2.color}` }}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sc2.color }} />
                  </div>
                  <div className="pb-4 flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{sc2.label}</p>
                      <p className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {format(new Date(evt.event_at), 'dd/MM/yyyy HH:mm', { locale: fr })}
                      </p>
                    </div>
                    {evt.description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{evt.description}</p>}
                    {evt.performer_name && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Par : {evt.performer_name}</p>}
                    {evt.location && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Lieu : {evt.location}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Dates clés */}
      <div className="rounded-xl p-3 sm:p-4 space-y-2.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-4 h-4 flex-shrink-0" style={{ color: '#6B7280' }} />
          <span className="font-semibold text-xs" style={{ color: 'var(--text-secondary)' }}>DATES CLÉS</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {[
            { label: 'Enregistré le', value: parcel.registered_at },
            { label: 'Mis en paquet', value: parcel.packaged_at },
            { label: 'Expédié le',    value: parcel.shipped_at },
            { label: 'Arrivé le',     value: parcel.arrived_at },
            { label: 'Retiré le',     value: parcel.delivered_at },
          ].map(({ label, value }) => (
            <div key={label}>
              <span style={{ color: 'var(--text-muted)' }}>{label} : </span>
              <span className="font-medium" style={{ color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {value ? format(new Date(value), 'dd/MM/yyyy HH:mm', { locale: fr }) : '—'}
              </span>
            </div>
          ))}
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Enregistré par : </span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{parcel.registered_by_name ?? '—'}</span>
          </div>
        </div>
      </div>

    </div>
  )
}
