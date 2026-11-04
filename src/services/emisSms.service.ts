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
  /** HTTP status of the SMS function when it answered with an error (401, 500…) */
  http_status?: number
}

/**
 * Calls the SMS edge function through the Supabase client: it adds the "apikey" header the API
 * gateway requires and an up-to-date access token. The former direct fetch had no apikey: the
 * gateway refused the call before the function (without CORS headers), and the browser only
 * reported "Failed to fetch".
 *
 * Throws when the server cannot be reached (the caller may retry later); a refusal by the function
 * or the SMS provider returns success: false (recorded in sms_logs, resendable from the parcel page).
 */
async function callSmsEdgeFunction(payload: {
  parcel_id: string
  recipient_phone: string
  message: string
  sms_type: SmsType
}): Promise<SendResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('SMS non envoyé : aucune session en ligne')

  const { data, error } = await supabase.functions.invoke('send-parcel-sms', { body: payload })
  if (error) {
    const name = (error as { name?: string }).name ?? ''
    if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') {
      throw new Error('SMS non envoyé : le service d\'envoi des SMS ne répond pas')
    }
    // FunctionsHttpError: the function answered with an error (session refused, server error…)
    const status = Number((error as { context?: { status?: number } }).context?.status) || undefined
    return { success: false, http_status: status }
  }
  return (data ?? { success: false }) as SendResult
}

const APP_BASE_URL = 'https://sbta-gestion.cloud'

function buildTrackingUrl(parcelCode: string, rawUrl?: string): string {
  if (rawUrl && rawUrl.includes('sbta-gestion.cloud')) return rawUrl
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
