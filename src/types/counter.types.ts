export type ChargeType = 'ration' | 'carburant_complement' | 'peage' | 'autres'

export interface CounterCharge {
  id:               string
  schedule_id:      string
  counter_id:       string
  station_id:       string
  bus_id:           string
  charge_date:      string
  charge_type:      ChargeType
  description:      string | null
  amount:           number
  created_by:       string
  validated_by:     string | null
  validated_at:     string | null
  status:           'en_attente' | 'valide' | 'rejete'
  rejection_reason: string | null
  receipt_url:      string | null
  created_at:       string
}

export interface ScheduleReceiptSummary {
  schedule_id:         string
  departure_datetime:  string
  status:              string
  counter_id:          string | null
  departure_number:    number | null
  departure_date:      string | null
  counter_name:        string | null
  station_id:          string | null
  station_name:        string | null
  route_id:            string
  route_name:          string
  origin_city:         string
  destination_city:    string
  base_price:          number
  bus_id:              string
  registration_number: string
  capacity:            number
  driver_name:         string
  seats_sold:          number
  seats_remaining:     number
  total_ticket_amount: number
  total_baggage:       number
  total_charges:       number
  total_rations:       number
  total_carburant:     number
  total_peages:        number
  total_autres:        number
  convoy_amount:       number
  solde_ticket:        number
  sold_seat_numbers:   string[]
  is_ramassage:        boolean
  ramassage_amount:    number
}

export interface DailyCounterReport {
  counter_id:          string
  departure_date:      string
  counter_number:      number
  station_name:        string
  route_name:          string
  total_departures:    number
  total_seats_sold:    number
  total_ticket_amount: number
  total_charges:       number
  total_solde:         number
  total_baggage:       number
  total_ramassage:     number
  departures_detail: Array<{
    schedule_id:         string
    departure_number:    number
    registration_number: string
    driver_name:         string
    seats_sold:          number
    total_ticket:        number
    total_charges:       number
    solde_ticket:        number
    total_baggage:       number
  }>
}

export interface BordereauDestinationGroup {
  destination:   string
  seats_sold:    number
  unit_price:    number
  amount:        number
  seat_numbers:  string[]
}

export interface BordereauDepartData {
  station_name:        string
  departure_number:    number
  route_name:          string
  departure_date:      string
  departure_time:      string
  registration_number: string
  driver_name:         string
  total_seats:         number
  seats_sold:          number
  seats_remaining:     number
  destination:         string
  unit_price:          number
  total_ticket_amount: number
  total_charges:       number
  total_rations:       number
  total_carburant:     number
  total_peages:        number
  total_autres:        number
  convoy_amount:       number
  is_convoy:           boolean
  solde_ticket:        number
  total_baggage:       number
  sold_seat_numbers:   string[]
  destination_groups:  BordereauDestinationGroup[]
  print_date:          string
  print_time:          string
}

export interface BordereauRecettesData {
  station_name:  string
  route_name:    string
  date_from:     string
  date_to:       string
  print_date:    string
  print_time:    string
  rows: Array<{
    registration_number: string
    departure_number:    number
    seats_sold:          number
    total_ticket:        number
    total_charges:       number
    solde_ticket:        number
    total_baggage:       number
  }>
  totals: {
    departures:    number
    seats_sold:    number
    total_ticket:  number
    total_charges: number
    solde_ticket:  number
    total_baggage: number
  }
}

export interface BordereauRamassageData {
  station_name:        string
  departure_number:    number
  route_name:          string
  departure_date:      string
  departure_time:      string
  registration_number: string
  driver_name:         string
  total_seats:         number
  seats_sold:          number
  seats_remaining:     number
  destination:         string
  unit_price:          number
  total_ticket_amount: number
  total_charges:       number
  solde_ticket:        number
  total_baggage:       number
  ramassage_amount:    number
  sold_seat_numbers:   string[]
  print_date:          string
  print_time:          string
}
