import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, User, MapPin, Package, DollarSign, FileText, CheckCircle2, AlertTriangle, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCourrierUser, isNetworkError } from '@/services/courrier/useCourrierUser'
import { supabase } from '@/services/supabase'
import { createParcel, fetchParcelAgentInfo, fetchPosOriginPhones, markTicketPrinted } from '@/services/parcel.service'
import { isOnline as courrierIsOnline, getPendingCount, enqueueSms, keepAndQueuePhotos, plannedPhotoPaths, flushSyncQueue } from '@/services/courrier/syncEngine'
import { localInsertParcel, localInsertTrackingEvent, localUpdateParcel } from '@/services/courrier/offlineStore'
import { getReferentiel } from '@/services/courrier/referentiels'
import { generateOfflineParcelCodes } from '@/services/courrier/parcelCodeGenerator'
import { useConnection } from '@/services/courrier/ConnectionContext'
import { CourrierOfflineBanner } from '@/components/parcel/CourrierOfflineBanner'
import { CourrierSyncQueueModal } from '@/components/parcel/CourrierSyncQueueModal'
import { sendCourierCreatedSms } from '@/services/emisSms.service'
import { buildReceiptData, printParcelTicket } from '@/utils/printParcelTicket'
import type { ParcelNature, ParcelPriority, Parcel, ParcelReceiptData } from '@/types/parcel.types'
import { trustedNowIso } from '@/services/offline/deviceClock'
import PhoneInputCI from '@/components/shared/PhoneInputCI'
import { phoneCIError, toStoredPhoneCI } from '@/utils/phoneCI'
import { cleanText, TEXT_LIMITS } from '@/utils/textInput'
import { uuidV4 } from '@/utils/uuid'
import ParcelPhotoCapture, { type CapturedPhoto } from '@/components/parcel/ParcelPhotoCapture'
import { checkAmounts, AMOUNT_RULES } from '@/utils/amountLimits'

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
  // Account and station of the counter's session: also known after an offline login
  const user = useCourrierUser()
  const navigate = useNavigate()
  const location = useLocation()
  const basePath = location.pathname.startsWith('/guichet/courrier') ? '/guichet/courrier' : '/agent-colis'

  const myStation: Station | null = user.station_id
    ? { id: user.station_id, name: user.station_name }
    : null
  const stationPhone = user.station_phone
  const isPosCourrier = basePath === '/guichet/courrier'

  async function loadAgentInfo(originStationId: string, destinationStationId: string) {
    // Server data only: without network the receipt prints without the agents' phones
    if (!courrierIsOnline()) return null
    const agentInfo = await fetchParcelAgentInfo(originStationId, destinationStationId).catch(() => null)
    if (!isPosCourrier || !agentInfo || !user.id) return agentInfo
    const posPhones = await fetchPosOriginPhones(user.id, originStationId, user.phone ?? null).catch(() => null)
    return posPhones ? { ...agentInfo, origin_agent_phone: posPhones } : agentInfo
  }

  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(false)
  // Phone errors shown at once after a submit attempt, otherwise when the field is left
  const [showPhoneErrors, setShowPhoneErrors] = useState(false)
  // Photos of the parcel (audit m3): reduced on the device, sent by the queue after the parcel
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])

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
      // Online: fetch from Supabase and cache locally via referentiels refresh
      if (courrierIsOnline()) {
        try {
          const { data: stData } = await supabase
            .from('stations')
            .select('id, name, cities(name)')
            .eq('is_active', true)
            .order('name')
          const mapped = (stData ?? []).map((s: any) => ({ id: s.id, name: s.name, city_name: s.cities?.name ?? '' }))
          setStations(mapped)
          return
        } catch {
          // Network failed mid-fetch — fall through to local cache
        }
      }

      // Offline (or online fetch failed): load from local IndexedDB cache
      const cached = await getReferentiel<{ id: string; name: string; cities?: { name?: string } }>('stations_all')
      if (cached) {
        setStations(cached.map(s => ({ id: s.id, name: s.name, city_name: s.cities?.name ?? '' })))
      }
    }
    loadStations()
  }, [])

  function set(field: string, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const total = Number(form.delivery_fee) + Number(form.sms_tracking_fee)

  const conn = useConnection()

  const [showSyncQueue, setShowSyncQueue] = useState(false)

  const [printModal, setPrintModal] = useState<{
    data: ParcelReceiptData
    parcelId: string
    isOffline: boolean
    localParcel?: any
    smsData?: { id: string; parcel_code: string; recipient_name: string; recipient_phone: string; recipient_city: string; tracking_url: string }
  } | null>(null)
  const [printCopy, setPrintCopy] = useState<'client' | 'agency'>('client')
  const [printLoading, setPrintLoading] = useState(false)

  async function handlePrintCopy() {
    if (!printModal) return
    setPrintLoading(true)
    try {
      await printParcelTicket(printModal.data, printCopy)
      if (printCopy === 'client') {
        try {
          if (printModal.isOffline && printModal.localParcel) {
            // An update, sent after the parcel: a second full insert of the parcel was queued
            // behind the recipient's SMS and held it back until it was sent
            await localUpdateParcel(printModal.parcelId, { ticket_printed: true })
          } else {
            await markTicketPrinted(printModal.parcelId)
          }
        } catch { /* must not block */ }
        setPrintCopy('agency')
      } else {
        await finalizeParcel()
      }
    } catch {
      if (printCopy === 'client') setPrintCopy('agency')
    } finally {
      setPrintLoading(false)
    }
  }

  async function finalizeParcel() {
    if (!printModal) return
    const m = printModal
    setPrintModal(null)
    setPrintCopy('client')

    if (!m.isOffline && m.smsData) {
      try {
        const smsResult = await sendCourierCreatedSms(m.smsData)
        if (!smsResult.success && !smsResult.duplicate) {
          toast('Courrier enregistre, mais SMS non envoye.', { icon: '⚠️' })
        }
      } catch {
        // Service unreachable: kept and sent again with the other pending operations
        await enqueueSms({ kind: 'created', parcel_id: m.smsData.id, parcel_code: m.smsData.parcel_code, recipient_name: m.smsData.recipient_name, recipient_phone: m.smsData.recipient_phone, recipient_city: m.smsData.recipient_city, tracking_url: m.smsData.tracking_url }).catch(() => {})
        conn.setPendingCount(await getPendingCount())
      }
    }

    if (m.isOffline) {
      conn.setPendingCount(await getPendingCount())
    }

    navigate(`${basePath}/dashboard`)
  }

  /**
   * Parcel saved on the device (no network, or the server stopped answering): code generated
   * here, ticket printed at once; the parcel, its "registered" event and the recipient's SMS are
   * sent when the network is back.
   */
  // Texts as saved: cleaned (spaces, invisible characters) and limited (audit m2)
  function cleanedTexts() {
    return {
      sender_name: cleanText(form.sender_name, TEXT_LIMITS.name),
      recipient_name: cleanText(form.recipient_name, TEXT_LIMITS.name),
      recipient_city: cleanText(form.recipient_city, TEXT_LIMITS.city),
      content_description: cleanText(form.content_description, TEXT_LIMITS.description),
    }
  }

  async function saveOffline(fullRecipientPhone: string, parcelId: string, photoPaths: string[]) {
    if (!myStation) return
    const now = trustedNowIso()
    const totalAmount = Number(form.delivery_fee) + Number(form.sms_tracking_fee)

    // Same prefix as online (audit M11): the agency code of the destination for this station,
    // otherwise the station's general agency code, both kept on the device
    let agencyCode: string | null = null
    const destCodes = await getReferentiel<{ destination_station_id: string; agency_code?: string | null }>(`destination_agency_codes_${myStation.id}`)
    const destCode = destCodes?.find(c => c.destination_station_id === form.destination_station_id)?.agency_code
    if (destCode) {
      agencyCode = destCode
    } else {
      const cachedStations = await getReferentiel<{ id: string; agency_code?: string | null }>('stations_all')
      const myStationData = cachedStations?.find(s => s.id === myStation.id)
      agencyCode = myStationData?.agency_code ?? null
    }

    // Generate proper parcel codes matching the online DB trigger format
    const { parcel_code, reference, daily_sequence, tracking_url } =
      await generateOfflineParcelCodes(myStation.id, agencyCode)

    const localParcel = await localInsertParcel({
      id: parcelId,
      parcel_photos: photoPaths,
      parcel_code,
      reference,
      daily_sequence,
      tracking_url,
      sender_name: cleanedTexts().sender_name,
      sender_phone: toStoredPhoneCI(form.sender_phone),
      sender_address: null,
      recipient_name: cleanedTexts().recipient_name,
      recipient_phone: fullRecipientPhone,
      recipient_city: cleanedTexts().recipient_city,
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
      content_description: cleanedTexts().content_description,
      notes: form.notes || null,
      status: 'enregistre',
      registered_at: now,
      registered_by: user.id,
      packaged_at: null,
      shipped_at: null,
      arrived_at: null,
      delivered_at: null,
      sms_sent_at: null,
      company_id: null,
      ticket_printed: false,
      delivery_recipient_name: null,
      delivery_recipient_phone: null,
      delivery_id_number: null,
      delivery_id_type: null,
    })

    // Same "registered" event and SMS as online, sent with the parcel when the network is back
    try {
      await localInsertTrackingEvent({
        parcel_id: localParcel.id,
        event_type: 'enregistre',
        description: 'Courrier enregistré',
        location: myStation.name,
        station_id: myStation.id,
        performed_by: user.id,
        performer_name: user.full_name,
        event_at: now,
        metadata: {},
      })
      await enqueueSms({
        kind: 'created',
        parcel_id: localParcel.id,
        parcel_code: localParcel.parcel_code,
        recipient_name: localParcel.recipient_name,
        recipient_phone: localParcel.recipient_phone,
        recipient_city: localParcel.recipient_city,
        tracking_url: localParcel.tracking_url,
      })
    } catch { /* the parcel itself is saved */ }

    // Photos kept with the parcel, sent after it when the network is back (audit m3)
    try {
      await keepAndQueuePhotos(localParcel.id, photos)
    } catch { toast('Photos non gardées sur ce poste : le courrier est enregistré sans elles.', { icon: '⚠️' }) }

    toast.success('Courrier enregistré localement (hors ligne) — sera synchronisé au retour de la connexion')

    try {
      const agentInfo = await loadAgentInfo(myStation.id, form.destination_station_id)
      let courierQrEnabled = true
      const cachedStationsForQr = await getReferentiel<{ id: string; courier_qr_enabled?: boolean }>('station_extras')
      if (cachedStationsForQr) {
        const myStationData = cachedStationsForQr.find(s => s.id === myStation.id)
        if (myStationData?.courier_qr_enabled !== undefined) courierQrEnabled = myStationData.courier_qr_enabled
      }
      const receiptData = buildReceiptData(
        { ...localParcel, origin_station_name: myStation.name, parcel_code: localParcel.parcel_code } as Parcel,
        myStation.name,
        stationPhone,
        null,
        null,
        agentInfo,
        courierQrEnabled,
      )
      setPrintModal({ data: receiptData, parcelId: localParcel.id, isOffline: true, localParcel })
      setPrintCopy('client')
    } catch {
      conn.setPendingCount(await getPendingCount())
      navigate(`${basePath}/dashboard`)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myStation) { toast.error('Aucune gare associée à votre compte'); return }
    const texts = cleanedTexts()
    if (!texts.sender_name || !texts.recipient_name || !form.recipient_phone || !form.destination_station_id || !texts.content_description) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      return
    }

    // Both numbers follow the Côte d'Ivoire rule (10 digits, 01/05/07/21/25/27) and are stored as 225 + 10 digits
    const senderPhoneError = phoneCIError(form.sender_phone, true)
    if (senderPhoneError) { setShowPhoneErrors(true); toast.error(`Téléphone de l'expéditeur : ${senderPhoneError}`); return }
    const recipientPhoneError = phoneCIError(form.recipient_phone, true)
    if (recipientPhoneError) { setShowPhoneErrors(true); toast.error(`Téléphone du destinataire : ${recipientPhoneError}`); return }

    // Typing slip on an amount (audit m5): refused above the maximum, confirmed when unusual
    const amountCheck = checkAmounts([
      { value: Number(form.delivery_fee) || 0, rule: AMOUNT_RULES.parcelFee },
      { value: Number(form.declared_value) || 0, rule: AMOUNT_RULES.declaredValue },
    ])
    if (!amountCheck.ok) { if (amountCheck.error) toast.error(amountCheck.error); return }

    const fullRecipientPhone = toStoredPhoneCI(form.recipient_phone)
    const fullSenderPhone = toStoredPhoneCI(form.sender_phone)

    // Id fixed now: the photos' storage paths name the parcel, offline as online
    const parcelId = uuidV4()
    const photoPaths = await plannedPhotoPaths(parcelId, photos.map(p => p.id))

    setLoading(true)
    try {
      // Offline path: save locally, queue for sync, skip server-only features
      if (!courrierIsOnline()) {
        await saveOffline(fullRecipientPhone, parcelId, photoPaths)
        return
      }

      // Online path: original flow
      // Vérifier qu'un code agence est configuré pour cette destination
      const { data: destCode, error: destCodeError } = await supabase
        .from('station_destination_agency_codes')
        .select('agency_code')
        .eq('origin_station_id', myStation.id)
        .eq('destination_station_id', form.destination_station_id)
        .maybeSingle()

      if (!destCodeError && !destCode?.agency_code) {
        toast('Aucun code agence configuré pour cette destination — le code agence général de la gare sera utilisé.', { icon: '⚠️' })
      }

      let parcel: Awaited<ReturnType<typeof createParcel>>
      try {
        parcel = await createParcel({
          sender_name:            cleanedTexts().sender_name,
          sender_phone:           fullSenderPhone,
          sender_address:         null,
          recipient_name:         cleanedTexts().recipient_name,
          recipient_phone:        fullRecipientPhone,
          recipient_city:         cleanedTexts().recipient_city,
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
          content_description:    cleanedTexts().content_description,
          id:                     parcelId,
          parcel_photos:          photoPaths,
          notes:                  form.notes || null,
          company_id:             null,
        } as any)
      } catch (err) {
        // The connection dropped: the parcel is not on the server, save it on the device instead
        if (!isNetworkError(err)) throw err
        await saveOffline(fullRecipientPhone, parcelId, photoPaths)
        return
      }

      await supabase.from('parcel_tracking_events').insert({
        parcel_id:      parcel.id,
        event_type:     'enregistre',
        description:    'Courrier enregistré',
        station_id:     myStation.id,
        performer_name: user.full_name,
      })

      toast.success('Courrier enregistré avec succès !')

      // Photos sent right away by the queue (kept on the device if the connection drops)
      if (photos.length > 0) {
        try {
          await keepAndQueuePhotos(parcelId, photos)
          void flushSyncQueue()
        } catch { toast('Courrier enregistré, mais photos non gardées sur ce poste.', { icon: '⚠️' }) }
      }

      try {
        const agentInfo = await loadAgentInfo(myStation.id, form.destination_station_id)
        const { data: myStationQr } = await supabase
          .from('stations')
          .select('courier_qr_enabled')
          .eq('id', myStation.id)
          .maybeSingle()
        const receiptData = buildReceiptData(
          { ...parcel, origin_station_name: myStation.name } as Parcel,
          myStation.name,
          stationPhone,
          null,
          null,
          agentInfo,
          myStationQr?.courier_qr_enabled ?? true,
        )
        setPrintModal({
          data: receiptData,
          parcelId: parcel.id,
          isOffline: false,
          smsData: {
            id: parcel.id,
            parcel_code: parcel.parcel_code,
            recipient_name: parcel.recipient_name,
            recipient_phone: parcel.recipient_phone,
            recipient_city: parcel.recipient_city ?? form.recipient_city,
            tracking_url: parcel.tracking_url ?? '',
          },
        })
        setPrintCopy('client')
      } catch {
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
        } catch {
          // Service unreachable: kept and sent again with the other pending operations
          await enqueueSms({ kind: 'created', parcel_id: parcel.id, parcel_code: parcel.parcel_code, recipient_name: parcel.recipient_name, recipient_phone: parcel.recipient_phone, recipient_city: parcel.recipient_city ?? form.recipient_city, tracking_url: parcel.tracking_url ?? '' }).catch(() => {})
        }
        navigate(`${basePath}/dashboard`)
      }
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
          <button onClick={() => navigate(`${basePath}/dashboard`)} className="mt-4 px-4 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: '#0B7439', color: '#fff' }}>
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
        lastSyncedAt={conn.lastSyncedAt}
        onShowQueue={() => setShowSyncQueue(true)}
      />
      <CourrierSyncQueueModal
        open={showSyncQueue}
        onClose={() => setShowSyncQueue(false)}
        onSyncNow={async () => { await flushSyncQueue(); conn.setPendingCount(await getPendingCount()); }}
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
              <input className={inputCls} style={inputStyle} value={form.sender_name} maxLength={TEXT_LIMITS.name} onChange={e => set('sender_name', e.target.value)} required />
            </div>
            <div>
              <label htmlFor="sender-phone" className={labelCls} style={labelStyle}>Téléphone *</label>
              <PhoneInputCI id="sender-phone" value={form.sender_phone} onChange={v => set('sender_phone', v)} required showError={showPhoneErrors} className={inputCls} style={inputStyle} />
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
              <input className={inputCls} style={inputStyle} value={form.recipient_name} maxLength={TEXT_LIMITS.name} onChange={e => set('recipient_name', e.target.value)} required />
            </div>
            <div>
              <label htmlFor="recipient-phone" className={labelCls} style={labelStyle}>Téléphone (SMS/WhatsApp) *</label>
              <PhoneInputCI id="recipient-phone" value={form.recipient_phone} onChange={v => set('recipient_phone', v)} required showError={showPhoneErrors} placeholder="07 59 81 81 55" className={inputCls} style={inputStyle} />
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
              maxLength={TEXT_LIMITS.description}
              onChange={e => set('content_description', e.target.value)}
              required
            />
          </div>
          <div className="mt-4">
            <ParcelPhotoCapture photos={photos} onChange={setPhotos} disabled={loading} />
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

      {/* Print modal — two-step printing (CLIENT then AGENCE) */}
      {printModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div
            className="w-full max-w-sm rounded-2xl shadow-2xl p-5 space-y-4"
            style={{ backgroundColor: 'var(--surface)' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#d4edda', color: '#0B7439' }}>
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  Impression du recu
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {printCopy === 'client' ? '1er exemplaire : Client' : '2e exemplaire : Agence'}
                </p>
              </div>
            </div>

            <div className="rounded-lg px-3 py-2.5 space-y-1.5" style={{ backgroundColor: '#f0faf4', border: '1px solid #BBF7D0' }}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: printCopy === 'agency' ? '#0B7439' : '#D1D5DB' }} />
                <span className="text-xs font-medium" style={{ color: printCopy === 'agency' ? '#0B7439' : 'var(--text-muted)' }}>
                  Exemplaire Client {printCopy === 'agency' ? '(imprime)' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: '#D1D5DB' }} />
                <span className="text-xs font-medium" style={{ color: printCopy === 'agency' ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  Exemplaire Agence {printCopy === 'agency' ? '(a imprimer)' : '(en attente)'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={finalizeParcel}
                disabled={printLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border disabled:opacity-50"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Passer
              </button>
              <button
                type="button"
                onClick={handlePrintCopy}
                disabled={printLoading}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: '#0B7439', color: '#fff' }}
              >
                {printLoading ? 'Impression...' : (<><Printer className="w-4 h-4" /> Imprimer ({printCopy === 'client' ? 'Client' : 'Agence'})</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
