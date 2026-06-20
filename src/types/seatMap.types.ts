export type SeatType = 'normal' | 'vip' | 'handicape' | 'hors_service'
export type SeatSide = 'left' | 'right' | 'back'
export type SeatStatus =
  | 'available'
  | 'occupied'
  | 'selected'
  | 'out_of_service'
  | 'boarding'
  | 'my_reservation'
  | 'online_reserved' // reserved via the /sbtamobile app (yellow)
  | 'locked'       // locked by another user (3-min temp hold)
  | 'locked_by_me' // locked by current user (countdown visible)

export interface OnlineReservationInfo {
  booking_ref: string
  customer_name: string
  customer_phone: string
  amount: number
  service_fee: number
  payment_method: string
  status: string
}

export interface SeatDefinition {
  id: string
  label: string
  side: SeatSide
  type: SeatType
  position: {
    row: number
    col: number
  }
}

export interface SeatRow {
  row: number
  seats: SeatDefinition[]
}

export interface SeatConfig {
  id: string
  name: string
  total_seats: number
  rows: number
  columns_left: number
  columns_right: number
  has_back_row: boolean
  back_row_seats: number
  aisle_position: number
  seat_layout: SeatRow[]
}

export interface EnrichedSeat extends SeatDefinition {
  status: SeatStatus
  reservation_id?: string
  passenger_name?: string
  price: number
  lock_expires_at?: string  // ISO string, present when locked or locked_by_me
  online_reservation?: OnlineReservationInfo
}

export interface EnrichedRow {
  row: number
  seats: EnrichedSeat[]
}

export interface ScheduleSeatMap {
  schedule_id: string
  bus_id: string
  bus_registration: string
  bus_class: string
  bus_deck_type?: string
  config: SeatConfig
  enriched_layout: EnrichedRow[]
  total_seats: number
  available_count: number
  occupied_count: number
  out_of_service_count: number
  base_price: number
  vip_price: number
}
