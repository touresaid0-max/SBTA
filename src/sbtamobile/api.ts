import { supabase } from '../services/supabase';
import { addMinutesToTime, TimeSlot } from './theme';

export type City = { id: string; name: string };

export type Station = { id: string; name: string; city_id: string };

export type Company = { id: string; name: string; code: string; logo_url: string | null };

export type RouteRow = {
  id: string;
  name: string;
  origin_city_id: string;
  destination_city_id: string;
  origin: string;
  destination: string;
  distance_km: number;
  estimated_duration_minutes: number;
  base_price: number;
};

export type TripOption = {
  key: string;
  route: RouteRow;
  company: Company;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  price: number;
  amenities: { ac: boolean; wifi: boolean; usb: boolean };
  busType: string;
};

export type Passenger = {
  firstName: string;
  lastName: string;
  phone: string;
  idNumber: string;
};

export type Booking = {
  id: string;
  booking_ref: string;
  origin_city: string;
  destination_city: string;
  origin_station: string | null;
  destination_station: string | null;
  travel_date: string;
  time_slot: string;
  departure_time: string | null;
  arrival_time: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
  seats_count: number;
  passengers: Passenger[];
  unit_price: number;
  service_fee: number;
  total: number;
  status: 'provisional' | 'confirmed' | 'cancelled';
  payment_method: string | null;
  payment_status: 'pending' | 'paid' | 'failed';
  assigned_seats: number[] | null;
  bus_label: string | null;
  company_id: string | null;
  route_id: string | null;
  created_at: string;
};

export async function fetchCities(): Promise<City[]> {
  const { data, error } = await supabase
    .from('cities')
    .select('id, name')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function fetchStations(cityId: string): Promise<Station[]> {
  const { data, error } = await supabase
    .from('stations')
    .select('id, name, city_id')
    .eq('is_active', true)
    .eq('city_id', cityId)
    .order('name');
  if (error) throw error;
  return (data ?? []) as Station[];
}

export async function fetchServiceFee(): Promise<number> {
  const { data } = await supabase
    .from('mobile_app_settings')
    .select('service_fee')
    .eq('id', 1)
    .maybeSingle();
  return Number(data?.service_fee ?? 300);
}

async function fetchOperatingCompanies(): Promise<Company[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, code, logo_url')
    .eq('is_active', true)
    .eq('is_group', false)
    .ilike('code', 'SBTA%')
    .order('name');
  if (error) throw error;
  return (data ?? []).slice(0, 4);
}

const AMENITY_PRESETS = [
  { ac: true, wifi: true, usb: true, busType: 'VIP 2x2 climatisé' },
  { ac: true, wifi: false, usb: true, busType: 'Confort climatisé' },
  { ac: true, wifi: true, usb: false, busType: 'Standard climatisé' },
];

export async function searchTrips(
  originCityId: string,
  destCityId: string,
  slot: TimeSlot
): Promise<TripOption[]> {
  const { data, error } = await supabase
    .from('routes')
    .select(
      'id, name, origin_city_id, destination_city_id, distance_km, estimated_duration_minutes, base_price, origin:cities!routes_origin_city_id_fkey(name), destination:cities!routes_destination_city_id_fkey(name)'
    )
    .eq('is_active', true)
    .eq('origin_city_id', originCityId)
    .eq('destination_city_id', destCityId);
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const companies = await fetchOperatingCompanies();
  if (companies.length === 0) return [];

  const options: TripOption[] = [];
  for (const raw of data) {
    const originRel = raw.origin as { name: string } | { name: string }[] | null;
    const destRel = raw.destination as { name: string } | { name: string }[] | null;
    const originName = Array.isArray(originRel) ? originRel[0]?.name ?? '' : originRel?.name ?? '';
    const destName = Array.isArray(destRel) ? destRel[0]?.name ?? '' : destRel?.name ?? '';
    const route: RouteRow = {
      id: raw.id,
      name: raw.name,
      origin_city_id: raw.origin_city_id,
      destination_city_id: raw.destination_city_id,
      origin: originName,
      destination: destName,
      distance_km: Number(raw.distance_km ?? 0),
      estimated_duration_minutes: Number(raw.estimated_duration_minutes ?? 0),
      base_price: Number(raw.base_price ?? 0),
    };
    const span = slot.endHour - slot.startHour;
    const departures = [slot.startHour, slot.startHour + Math.max(1, Math.round(span / 2))];
    departures.forEach((hour, idx) => {
      if (hour > slot.endHour) return;
      const company = companies[(idx + options.length) % companies.length];
      const preset = AMENITY_PRESETS[idx % AMENITY_PRESETS.length];
      const departureTime = `${String(hour).padStart(2, '0')}:00`;
      const arrivalTime = addMinutesToTime(departureTime, route.estimated_duration_minutes);
      options.push({
        key: `${route.id}-${company.id}-${departureTime}`,
        route,
        company,
        departureTime,
        arrivalTime,
        durationMinutes: route.estimated_duration_minutes,
        price: route.base_price,
        amenities: { ac: preset.ac, wifi: preset.wifi, usb: preset.usb },
        busType: preset.busType,
      });
    });
  }
  return options.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}

type CreateBookingInput = {
  userId: string;
  trip: TripOption;
  travelDate: string;
  slotId: string;
  originStation: string | null;
  destStation: string | null;
  seatsCount: number;
  passengers: Passenger[];
  unitPrice: number;
  serviceFee: number;
  total: number;
  paymentMethod: string;
  paymentPhone: string;
};

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const { data, error } = await supabase
    .from('mobile_bookings')
    .insert({
      user_id: input.userId,
      route_id: input.trip.route.id,
      company_id: input.trip.company.id,
      origin_city: input.trip.route.origin,
      destination_city: input.trip.route.destination,
      origin_station: input.originStation,
      destination_station: input.destStation,
      travel_date: input.travelDate,
      time_slot: input.slotId,
      departure_time: input.trip.departureTime,
      arrival_time: input.trip.arrivalTime,
      duration_minutes: input.trip.durationMinutes,
      distance_km: input.trip.route.distance_km,
      seats_count: input.seatsCount,
      passengers: input.passengers,
      unit_price: input.unitPrice,
      service_fee: input.serviceFee,
      total: input.total,
      status: 'provisional',
      payment_method: input.paymentMethod,
      payment_phone: input.paymentPhone,
      payment_status: 'paid',
    })
    .select('*')
    .single();
  if (error) throw error;

  const created = data as Booking;

  await supabase
    .rpc('sbta_confirm_pending_mobile_booking', { p_booking_id: created.id })
    .then(() => undefined, () => undefined);

  const refreshed = await fetchBooking(created.id);
  return refreshed ?? created;
}

export async function fetchMyBookings(userId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('mobile_bookings')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Booking[];
}

export async function fetchBooking(id: string): Promise<Booking | null> {
  const { data, error } = await supabase
    .from('mobile_bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Booking) ?? null;
}

export type Faq = {
  id: string;
  question: string;
  answer: string;
  category: string;
  display_order: number;
};

export async function fetchFaqs(): Promise<Faq[]> {
  const { data, error } = await supabase
    .from('reservation_faqs')
    .select('id, question, answer, category, display_order')
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Faq[];
}

export type CancellationPolicy = {
  id: string;
  title: string;
  description: string;
  hours_before_departure: number;
  refund_rate: number;
};

export async function fetchPolicies(): Promise<CancellationPolicy[]> {
  const { data, error } = await supabase
    .from('cancellation_policies')
    .select('id, title, description, hours_before_departure, refund_rate')
    .eq('is_active', true)
    .order('hours_before_departure', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CancellationPolicy[];
}
