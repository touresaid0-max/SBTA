import { supabase } from './supabase'

export type SmsType = 'CREATED' | 'ARRIVED'

export interface SmsLog {
  id: string
  parcel_id: string
  recipient_phone: string
  message: string
  sms_type: SmsType
  provider: string
  status: 'SENT' | 'FAILED' | 'PENDING'
  response_api: Record<string, unknown>
  sent_at: string | null
  created_by: string | null
  created_at: string
}

interface SendResult {
  success: boolean
  duplicate?: boolean
  log_id?: string
}

async function callSmsEdgeFunction(payload: {
  parcel_id: string
  recipient_phone: string
  message: string
  sms_type: SmsType
}): Promise<SendResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false }

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-parcel-sms`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )

  if (!resp.ok) return { success: false }
  return resp.json()
}

const APP_BASE_URL = 'https://sbta-gestion.cloud'

function buildTrackingUrl(parcelCode: string, rawUrl?: string): string {
  if (rawUrl && (rawUrl.includes('sbta-gestion.cloud') || rawUrl.includes('vercel.app'))) return rawUrl
  return `${APP_BASE_URL}/track/${parcelCode}`
}

export async function sendCourierCreatedSms(parcel: {
  id: string
  parcel_code: string
  recipient_name: string
  recipient_phone: string
  recipient_city: string
  tracking_url?: string
}): Promise<SendResult> {
  const trackUrl = buildTrackingUrl(parcel.parcel_code, parcel.tracking_url)
  const message =
    `Colis: ${parcel.parcel_code} enregistre; par: ${parcel.recipient_name.toUpperCase()} ` +
    `destination ${parcel.recipient_city.toUpperCase()}. ` +
    `Lien suivre courrier : ${trackUrl}`

  return callSmsEdgeFunction({
    parcel_id: parcel.id,
    recipient_phone: parcel.recipient_phone,
    message,
    sms_type: 'CREATED',
  })
}

export async function sendCourierArrivedSms(parcel: {
  id: string
  recipient_phone: string
}): Promise<SendResult> {
  const message =
    'Colis arrivé. Disponible à la gare. Merci de le retirer.'

  return callSmsEdgeFunction({
    parcel_id: parcel.id,
    recipient_phone: parcel.recipient_phone,
    message,
    sms_type: 'ARRIVED',
  })
}

export async function resendSms(logId: string): Promise<SendResult> {
  const { data: log, error } = await supabase
    .from('sms_logs')
    .select('parcel_id, recipient_phone, message, sms_type')
    .eq('id', logId)
    .maybeSingle()

  if (error || !log) return { success: false }

  return callSmsEdgeFunction({
    parcel_id: log.parcel_id,
    recipient_phone: log.recipient_phone,
    message: log.message,
    sms_type: log.sms_type as SmsType,
  })
}

export async function fetchSmsLogs(parcelId: string): Promise<SmsLog[]> {
  const { data, error } = await supabase
    .from('sms_logs')
    .select('*')
    .eq('parcel_id', parcelId)
    .order('created_at', { ascending: false })

  if (error) return []
  return data ?? []
}
