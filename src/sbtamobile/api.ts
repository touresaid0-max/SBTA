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

type RouteStop = {
  route_id: string;
  city_id: string;
  price: number;
  city: { id: string; name: string } | { id: string; name: string }[];
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
  scheduleId?: string;
  isPlanned?: boolean;
  seatsAvailable?: number;
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

export type RouteDestination = {
  cityId: string;
  cityName: string;
  routeId: string;
  routeName: string;
  price: number;
};

export async function fetchRouteOrigins(): Promise<City[]> {
  const { data, error } = await supabase
    .from('routes')
    .select('origin_city_id, cities!routes_origin_city_id_fkey(id, name)')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  const seen = new Set<string>();
  const result: City[] = [];
  for (const row of data ?? []) {
    const city = Array.isArray(row.cities) ? row.cities[0] : row.cities;
    if (city && !seen.has(city.id)) {
      seen.add(city.id);
      result.push({ id: city.id, name: city.name });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRouteDestinations(originCityId: string): Promise<RouteDestination[]> {
  const { data: routes, error } = await supabase
    .from('routes')
    .select('id, name, destination_city_id, base_price, destination:cities!routes_destination_city_id_fkey(id, name)')
    .eq('is_active', true)
    .eq('origin_city_id', originCityId)
    .order('name');
  if (error) throw error;

  const result: RouteDestination[] = [];
  const seenCityIds = new Set<string>();

  for (const route of routes ?? []) {
    const destCity = Array.isArray(route.destination) ? route.destination[0] : route.destination;
    if (destCity) {
      if (!seenCityIds.has(destCity.id)) {
        seenCityIds.add(destCity.id);
        result.push({
          cityId: destCity.id,
          cityName: destCity.name,
          routeId: route.id,
          routeName: route.name,
          price: Number(route.base_price ?? 0),
        });
      }
    }
  }

  const routeIds = (routes ?? []).map((r) => r.id);
  if (routeIds.length > 0) {
    const { data: stops } = await supabase
      .from('route_city_stops')
      .select('route_id, city_id, price, cities!inner(id, name)')
      .in('route_id', routeIds)
      .order('position');
    if (stops) {
      for (const stop of stops as unknown as { city_id: string; price: string; cities: { id: string; name: string } | { id: string; name: string }[]; route_id: string }[]) {
        const city = Array.isArray(stop.cities) ? stop.cities[0] : stop.cities;
        if (city && !seenCityIds.has(city.id)) {
          seenCityIds.add(city.id);
          result.push({
            cityId: city.id,
            cityName: city.name,
            routeId: stop.route_id,
            routeName: routes?.find((r) => r.id === stop.route_id)?.name ?? '',
            price: Number(stop.price ?? 0),
          });
        }
      }
    }
  }

  return result.sort((a, b) => a.cityName.localeCompare(b.cityName));
}

export async function fetchStationForCity(cityId: string): Promise<Station | null> {
  const { data, error } = await supabase
    .from('stations')
    .select('id, name, city_id')
    .eq('is_active', true)
    .eq('city_id', cityId)
    .order('name')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Station) ?? null;
}

export async function fetchServiceFee(): Promise<number> {
  const { data } = await supabase
    .from('mobile_app_settings')
    .select('service_fee')
    .eq('id', 1)
    .maybeSingle();
  return Number(data?.service_fee ?? 300);
}

export async function fetchRouteServiceFee(originCityId: string, destCityId: string): Promise<number> {
  const { data, error } = await supabase
    .rpc('get_mobile_service_fee', {
      p_origin_city_id: originCityId,
      p_destination_city_id: destCityId,
    });
  if (error) {
    // Fallback to default fee + 1000 if RPC fails
    const fallback = await fetchServiceFee();
    return fallback + 1000;
  }
  return Number(data ?? 300);
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

type BusRel = { registration_number: string | null; total_seats: number | null; capacity: number | null };

type ScheduleRow = {
  id: string;
  route_id: string;
  departure_datetime: string;
  arrival_datetime: string | null;
  departure_station_id: string | null;
  arrival_station_id: string | null;
  status: string | null;
  seats_available: number | null;
  price: number | null;
  buses: BusRel | BusRel[] | null;
};

const CANCELLED_STATUSES = ['annule', 'annulee', 'cancelled', 'termine'];

async function fetchPlannedSchedules(
  routeId: string,
  date: string,
  originStationId?: string,
  destStationId?: string
): Promise<ScheduleRow[]> {
  const dayStart = `${date}T00:00:00`;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const dayEnd = next.toISOString();

  let q = supabase
    .from('schedules')
    .select(
      'id, route_id, departure_datetime, arrival_datetime, departure_station_id, arrival_station_id, status, seats_available, price, buses(registration_number, total_seats, capacity)'
    )
    .eq('route_id', routeId)
    .gte('departure_datetime', dayStart)
    .lt('departure_datetime', dayEnd);
  if (originStationId) q = q.eq('departure_station_id', originStationId);
  if (destStationId) q = q.eq('arrival_station_id', destStationId);

  const { data, error } = await q.order('departure_datetime');
  if (error) throw error;
  return ((data ?? []) as unknown as ScheduleRow[]).filter(
    (s) => !CANCELLED_STATUSES.includes((s.status ?? '').toLowerCase())
  );
}

function utcHourMinute(iso: string): { hour: number; label: string } {
  const d = new Date(iso);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return { hour, label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

export type SearchResult = {
  planned: TripOption[];
  provisional: TripOption | null;
};

export async function searchTrips(
  originCityId: string,
  destCityId: string,
  slot: TimeSlot,
  date: string,
  originStationId?: string,
  destStationId?: string
): Promise<SearchResult> {
  const { data: routeData, error } = await supabase
    .from('routes')
    .select(
      'id, name, origin_city_id, destination_city_id, distance_km, estimated_duration_minutes, base_price, origin:cities!routes_origin_city_id_fkey(name), destination:cities!routes_destination_city_id_fkey(name)'
    )
    .eq('is_active', true)
    .eq('origin_city_id', originCityId);
  if (error) throw error;
  if (!routeData || routeData.length === 0) return { planned: [], provisional: null };

  const routeIds = routeData.map((route) => route.id);
  const { data: stopData, error: stopsError } = await supabase
    .from('route_city_stops')
    .select('route_id, city_id, price, city:cities!inner(id, name)')
    .in('route_id', routeIds)
    .eq('city_id', destCityId)
    .order('position');
  if (stopsError) throw stopsError;

  const matchingStops = new Map<string, RouteStop>();
  for (const rawStop of (stopData ?? []) as unknown as RouteStop[]) {
    if (!matchingStops.has(rawStop.route_id)) matchingStops.set(rawStop.route_id, rawStop);
  }

  const data = routeData.filter((route) => route.destination_city_id === destCityId || matchingStops.has(route.id));
  if (data.length === 0) return { planned: [], provisional: null };

  const companies = await fetchOperatingCompanies();
  if (companies.length === 0) return { planned: [], provisional: null };
  const company = companies[0];

  const planned: TripOption[] = [];
  let firstRoute: RouteRow | null = null;

  for (const raw of data) {
    const originRel = raw.origin as { name: string } | { name: string }[] | null;
    const finalDestRel = raw.destination as { name: string } | { name: string }[] | null;
    const originName = Array.isArray(originRel) ? originRel[0]?.name ?? '' : originRel?.name ?? '';
    const finalDestName = Array.isArray(finalDestRel) ? finalDestRel[0]?.name ?? '' : finalDestRel?.name ?? '';
    const selectedStop = matchingStops.get(raw.id);
    const selectedStopCity = selectedStop
      ? (Array.isArray(selectedStop.city) ? selectedStop.city[0] : selectedStop.city)
      : null;
    const isIntermediateDestination = Boolean(selectedStop);
    const route: RouteRow = {
      id: raw.id,
      name: raw.name,
      origin_city_id: raw.origin_city_id,
      destination_city_id: raw.destination_city_id,
      origin: originName,
      destination: selectedStopCity?.name ?? finalDestName,
      distance_km: Number(raw.distance_km ?? 0),
      estimated_duration_minutes: Number(raw.estimated_duration_minutes ?? 0),
      base_price: isIntermediateDestination ? Number(selectedStop?.price ?? 0) : Number(raw.base_price ?? 0),
    };
    if (!firstRoute) firstRoute = route;

    // Intermediate destinations use the route schedule without restricting arrival to the final station.
    const schedules = await fetchPlannedSchedules(
      route.id,
      date,
      originStationId,
      isIntermediateDestination ? undefined : destStationId,
    );
    const matched = schedules.filter((s) => {
      const { hour } = utcHourMinute(s.departure_datetime);
      return hour >= slot.startHour && hour <= slot.endHour;
    });

    for (const s of matched) {
      const dep = utcHourMinute(s.departure_datetime);
      const arrivalTime = s.arrival_datetime
        ? utcHourMinute(s.arrival_datetime).label
        : addMinutesToTime(dep.label, route.estimated_duration_minutes);
      const bus = Array.isArray(s.buses) ? s.buses[0] ?? null : s.buses;
      const capacity = bus?.total_seats ?? bus?.capacity ?? 45;
      const seatsAvailable = s.seats_available ?? capacity;
      const busType = bus?.registration_number ?? 'Bus planifié';
      planned.push({
        key: `sched-${s.id}`,
        route,
        company,
        departureTime: dep.label,
        arrivalTime,
        durationMinutes: route.estimated_duration_minutes,
        price: isIntermediateDestination ? route.base_price : Number(s.price ?? route.base_price),
        amenities: { ac: true, wifi: true, usb: true },
        busType,
        scheduleId: s.id,
        isPlanned: true,
        seatsAvailable,
      });
    }
  }

  if (planned.length > 0) {
    return {
      planned: planned.sort((a, b) => a.departureTime.localeCompare(b.departureTime)),
      provisional: null,
    };
  }

  // Cas 2 : aucun voyage planifie -> billet provisoire (pas de liste de trajets).
  if (!firstRoute) return { planned: [], provisional: null };
  const departureTime = `${String(slot.startHour).padStart(2, '0')}:00`;
  const provisional: TripOption = {
    key: `prov-${firstRoute.id}`,
    route: firstRoute,
    company,
    departureTime,
    arrivalTime: addMinutesToTime(departureTime, firstRoute.estimated_duration_minutes),
    durationMinutes: firstRoute.estimated_duration_minutes,
    price: firstRoute.base_price,
    amenities: { ac: true, wifi: true, usb: true },
    busType: 'À planifier',
    isPlanned: false,
  };
  return { planned: [], provisional };
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
  // When true, the booking is created with payment pending (e.g. awaiting Wave confirmation)
  // and is NOT confirmed yet. The webhook confirms it once the payment is settled.
  pending?: boolean;
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
      payment_status: input.pending ? 'pending' : 'paid',
    })
    .select('*')
    .single();
  if (error) throw error;

  const created = data as Booking;

  // Pending bookings (Wave) stay provisional until the payment webhook confirms them.
  if (input.pending) return created;

  if (input.trip.scheduleId) {
    await supabase
      .rpc('sbta_assign_and_confirm_mobile_booking', {
        p_booking_id: created.id,
        p_schedule_id: input.trip.scheduleId,
      })
      .then(() => undefined, () => undefined);
  } else {
    await supabase
      .rpc('sbta_confirm_pending_mobile_booking', { p_booking_id: created.id })
      .then(() => undefined, () => undefined);
  }

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

// Résout un billet à partir de son token de retour opaque (lien Wave sécurisé).
// La RLS garantit qu'un utilisateur ne peut résoudre que ses propres billets.
export async function fetchBookingByReturnToken(token: string): Promise<Booking | null> {
  const { data, error } = await supabase
    .from('mobile_bookings')
    .select('*')
    .eq('return_token', token)
    .maybeSingle();
  if (error) throw error;
  return (data as Booking) ?? null;
}

// Téléverse un fichier e-ticket (PDF/PNG) dans le bucket public `tickets`
// et renvoie son URL HTTPS publique. Nécessaire pour l'app WebToNative :
// le téléchargement et le partage natif fonctionnent sur une vraie URL HTTPS,
// pas sur un blob: interne à la WebView.
export async function uploadTicketFile(
  bookingRef: string,
  blob: Blob,
  ext: 'pdf' | 'png'
): Promise<string> {
  const contentType = ext === 'pdf' ? 'application/pdf' : 'image/png';
  const path = `${bookingRef}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('tickets')
    .upload(path, blob, { contentType, upsert: true, cacheControl: '3600' });
  if (error) throw error;
  const { data } = supabase.storage.from('tickets').getPublicUrl(path);
  return data.publicUrl;
}

// ── Paiement Wave ───────────────────────────────────────────────
export async function getWaveStatus(): Promise<{ isActive: boolean; mode: string }> {
  const { data, error } = await supabase.rpc('get_wave_public_status');
  if (error) return { isActive: false, mode: 'test' };
  const row = Array.isArray(data) ? data[0] : data;
  return { isActive: !!row?.is_active, mode: row?.mode ?? 'test' };
}

// ── Contexte application Android (WebToNative) ──────────────────

export type WaveCheckout = { launchUrl: string; returnToken: string };

export async function startWaveCheckout(bookingId: string): Promise<WaveCheckout> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wave-create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ bookingId, origin: window.location.origin }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.launchUrl) {
    throw new Error(data?.error || 'Le paiement Wave est indisponible.');
  }
  return { launchUrl: data.launchUrl as string, returnToken: (data.returnToken as string) ?? '' };
}

export type WaveVerifyResult = {
  status: 'paid' | 'failed' | 'pending';
  reason?: string;
};

// Vérifie côté serveur le vrai statut de la session Wave, puis confirme ou marque
// la réservation en échec selon le retour de l'API Wave.
export async function verifyWavePayment(bookingId: string): Promise<WaveVerifyResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wave-verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ bookingId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.status) return { status: 'pending' };
  return { status: data.status, reason: data.reason };
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
