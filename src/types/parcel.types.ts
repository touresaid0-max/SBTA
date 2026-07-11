export type ParcelStatus =
  | 'enregistre' | 'mis_en_paquet' | 'expedie'
  | 'arrive' | 'livre' | 'retourne' | 'perdu'

export type ParcelNature =
  | 'autre' | 'electronique' | 'vetement' | 'document'
  | 'alimentaire' | 'medicament' | 'electromenager' | 'fragile'

export type ParcelPriority = 'standard' | 'urgent' | 'fragile'

export interface Parcel {
  id:                       string
  parcel_code:              string
  reference:                string
  daily_sequence:           number
  sender_name:              string
  sender_phone:             string
  sender_address:           string | null
  recipient_name:           string
  recipient_phone:          string
  recipient_city:           string
  recipient_address:        string | null
  origin_station_id:        string
  origin_station_name:      string
  destination_station_id:   string
  destination_station_name: string
  schedule_id:              string | null
  driver_id:                string | null
  driver_name:              string | null
  bus_registration:         string | null
  declared_value:           number
  delivery_fee:             number
  sms_tracking_fee:         number
  total_amount:             number
  priority:                 ParcelPriority
  planned_date:             string | null
  nature:                   ParcelNature
  content_description:      string
  parcel_photos:            string[]
  notes:                    string | null
  status:                   ParcelStatus
  registered_at:            string
  registered_by_name:       string
  packaged_at:              string | null
  shipped_at:               string | null
  arrived_at:               string | null
  delivered_at:             string | null
  tracking_url:             string
  sms_sent_at:              string | null
  company_id:               string | null
  company_name:             string | null
}

export interface ParcelTrackingEvent {
  id:             string
  parcel_id:      string
  event_type:     ParcelStatus | 'note_ajoutee'
  description:    string | null
  location:       string | null
  station_id:     string | null
  performed_by:   string | null
  performer_name: string | null
  event_at:       string
  metadata:       Record<string, unknown>
}

export interface ParcelReceiptData {
  agency_name:      string
  agency_phone:     string
  print_date:       string
  receipt_type:     string
  destination:      string
  declared_value:   number
  delivery_fee:     number
  parcel_code:      string
  reference:        string
  sms_tracking_fee: number
  sender_name:      string
  sender_phone:     string
  recipient_name:   string
  recipient_phone:  string
  nature:           string
  designation:      string
  legal_note_1:     string
  legal_note_2:     string
  // Transport — optional, set when a scheduled bus is linked
  bus_registration: string | null
  driver_name:      string | null
  departure_time:   string | null
  origin_station:   string | null
  // Agent colis phone numbers (from station assignments)
  origin_agent_phone:      string | null
  destination_agent_phone: string | null
  // Superviseur colis info (auto-fetched)
  supervisor_name:  string | null
  supervisor_email: string | null
  supervisor_phone: string | null
}

export interface ParcelAgencyStat {
  station_id:       string
  station_name:     string
  company_name:     string
  total_registered: number
  total_packaged:   number
  total_shipped:    number
  total_arrived:    number
  total_delivered:  number
  total_revenue:    number
  period_revenue:   number
}

export interface ParcelKPIs {
  total_today:         number
  total_en_transit:    number
  total_arrived:       number
  total_delivered:     number
  total_revenue_today: number
  total_revenue_month: number
  avg_delivery_hours:  number
}
