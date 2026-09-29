export type UserRole =
  | 'admin'
  | 'dg'
  | 'daf'
  | 'comptable'
  | 'rh'
  | 'gestionnaire'
  | 'planificateur'
  | 'charge_achat'
  | 'chauffeur'
  | 'guichetier'
  | 'chef_garage'
  | 'chef_gare'
  | 'bagagiste'
  | 'mecanicien'
  | 'pompiste'
  | 'superviseur_colis'
  | 'agent_colis'
  | 'agent_reservation'
  | 'carburant'
  | 'gerant_principal'
  | 'responsable_assurance'
  | 'responsable_logistique'
  | 'logistique'
  | 'agent_qhse'
  | 'gestion_agboville'
  | 'gestionnaire_borne'
  | 'client';

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type BusStatus =
  | 'disponible'
  | 'en_service'
  | 'panne_route'
  | 'reception_garage'
  | 'diagnostic'
  | 'attente_ot'
  | 'maintenance'
  | 'controle_qualite'
  | 'hors_service';

export type ReservationStatus = 'en_attente' | 'confirmee' | 'annulee' | 'terminee';
export type PaymentStatus = 'en_attente' | 'payee' | 'remboursee';
export type ScheduleStatus = 'planifie' | 'en_cours' | 'termine' | 'annule';

export interface Company {
  id: string;
  name: string;
  code: string;
  logo_url?: string;
  address?: string;
  phone?: string;
  email?: string;
  siret?: string;
  is_active: boolean;
  parent_id?: string | null;
  is_group?: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: UserRole;
  avatar_url?: string;
  company_id?: string;
  is_active: boolean;
  loyalty_points: number;
  loyalty_tier: LoyaltyTier;
  total_trips: number;
  driver_license_number?: string;
  driver_license_expiry?: string;
  driver_total_hours: number;
  driver_avg_rating: number;
  driver_total_reviews: number;
  created_at: string;
  updated_at: string;
}

export interface City {
  id: string;
  name: string;
  region?: string;
  country: string;
  latitude?: number;
  longitude?: number;
  is_active: boolean;
  created_at: string;
}

export interface Amenity {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  created_at: string;
}

export interface BusSeatConfig {
  id: string;
  name: string;
  total_seats: number;
  rows: number;
  columns: number;
  layout_map: Record<string, any>;
  created_at: string;
}

export interface Station {
  id: string;
  name: string;
  city_id: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  facilities?: Record<string, any>;
  is_active: boolean;
  created_at: string;
}

export interface Counter {
  id: string;
  station_id: string;
  counter_number: string;
  assigned_user_id?: string;
  is_active: boolean;
  created_at: string;
}

export interface BoardingPoint {
  id: string;
  station_id: string;
  name: string;
  location_description?: string;
  is_active: boolean;
  created_at: string;
}

export interface Bus {
  id: string;
  company_id: string;
  registration_number: string;
  model?: string;
  manufacturer?: string;
  year?: number;
  seat_config_id?: string;
  total_seats: number;
  amenities_ids?: string[];
  status: BusStatus;
  mileage: number;
  last_maintenance_date?: string;
  next_maintenance_due?: string;
  fill_rate_current: number;
  fill_rate_avg_30d: number;
  fill_rate_avg_90d: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Route {
  id: string;
  name: string;
  origin_city_id: string;
  destination_city_id: string;
  distance_km?: number;
  estimated_duration_minutes?: number;
  base_price?: number;
  is_active: boolean;
  created_at: string;
}

export interface Schedule {
  id: string;
  route_id: string;
  bus_id?: string;
  driver_id?: string;
  departure_station_id?: string;
  arrival_station_id?: string;
  departure_datetime: string;
  arrival_datetime: string;
  boarding_point_id?: string;
  status: ScheduleStatus;
  seats_available?: number;
  seats_reserved: number;
  price?: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Reservation {
  id: string;
  schedule_id: string;
  customer_id?: string;
  passenger_name: string;
  passenger_phone?: string;
  seat_numbers?: string[];
  total_seats: number;
  total_price: number;
  status: ReservationStatus;
  payment_status: PaymentStatus;
  booking_reference?: string;
  qr_code?: string;
  booked_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  reservation_id: string;
  amount: number;
  payment_method?: 'especes' | 'carte' | 'mobile_money' | 'virement';
  payment_reference?: string;
  status: 'en_attente' | 'reussie' | 'echouee' | 'remboursee';
  processed_by?: string;
  created_at: string;
}

export interface FuelVoucher {
  id: string;
  voucher_number: string;
  schedule_id?: string;
  bus_id: string;
  driver_id?: string;
  estimated_liters?: number;
  estimated_amount?: number;
  actual_liters?: number;
  actual_amount?: number;
  fuel_price_per_liter?: number;
  status: 'genere' | 'valide_comptable' | 'utilise' | 'annule';
  validated_by?: string;
  used_by?: string;
  created_at: string;
  used_at?: string;
}

export interface BusExpense {
  id: string;
  bus_id: string;
  expense_type: 'assurance' | 'taxes' | 'peage' | 'lavage' | 'autres';
  amount: number;
  description?: string;
  expense_date: string;
  receipt_url?: string;
  status: 'en_attente' | 'validee' | 'rejetee';
  validated_by?: string;
  created_by?: string;
  created_at: string;
}

export interface BreakdownReport {
  id: string;
  bus_id: string;
  reported_by?: string;
  schedule_id?: string;
  breakdown_type: 'mecanique' | 'electrique' | 'pneumatique' | 'carrosserie' | 'autres';
  severity: 'faible' | 'moyenne' | 'critique';
  description: string;
  location?: string;
  photos_urls?: string[];
  status: 'signale' | 'recu_garage' | 'en_diagnostic' | 'resolu';
  reported_at: string;
  resolved_at?: string;
}

export interface MaintenanceWorkOrder {
  id: string;
  work_order_number: string;
  bus_id: string;
  diagnostic_id?: string;
  assigned_to?: string;
  work_description: string;
  estimated_cost?: number;
  actual_cost?: number;
  estimated_hours?: number;
  actual_hours?: number;
  spare_parts_used?: Record<string, any>;
  status: 'attente_validation' | 'valide_comptable' | 'en_cours' | 'en_controle' | 'termine' | 'annule';
  priority?: 'faible' | 'moyenne' | 'haute' | 'urgente';
  validated_by?: string;
  created_by?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface LoyaltyReward {
  id: string;
  name: string;
  description?: string;
  points_required: number;
  reward_type: 'discount' | 'free_trip' | 'upgrade' | 'voucher' | 'gift';
  reward_value?: number;
  is_active: boolean;
  created_at: string;
}

export interface LoyaltyRedemption {
  id: string;
  customer_id: string;
  reward_id?: string;
  points_used: number;
  status: 'en_attente' | 'validee' | 'utilisee' | 'annulee';
  validated_by?: string;
  created_at: string;
  used_at?: string;
}
