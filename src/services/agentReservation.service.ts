import { supabase } from '@/services/supabase';

export type BookingStatus = 'provisional' | 'confirmed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface Passenger {
  firstName: string;
  lastName: string;
  phone: string;
  idNumber: string;
}

export interface MobileBooking {
  id: string;
  user_id: string | null;
  route_id: string | null;
  company_id: string | null;
  origin_city: string | null;
  destination_city: string | null;
  travel_date: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  seats_count: number;
  passengers: Passenger[];
  unit_price: number;
  service_fee: number;
  total: number;
  status: BookingStatus;
  payment_method: string | null;
  payment_phone: string | null;
  payment_status: PaymentStatus;
  booking_ref: string;
  schedule_id: string | null;
  assigned_seats: number[] | null;
  bus_label: string | null;
  created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  wave_transaction_ref: string | null;
  wave_checkout_status: string | null;
  payment_date: string | null;
}

export interface MobileUser {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  is_active: boolean | null;
  is_self_registered: boolean | null;
  created_at: string;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  category: string;
  display_order: number;
  is_active: boolean;
}

export interface CancellationPolicy {
  id: string;
  title: string;
  description: string;
  hours_before_departure: number;
  refund_rate: number;
  is_active: boolean;
}

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function mapBooking(row: any, user?: { full_name: string | null; email: string | null; phone: string | null } | null): MobileBooking {
  const u = user ?? null;
  const pax = Array.isArray(row.passengers) && row.passengers.length > 0 ? row.passengers[0] : null;
  const paxName = pax ? `${pax.firstName ?? ''} ${pax.lastName ?? ''}`.trim() : '';
  return {
    id: row.id,
    user_id: row.user_id,
    route_id: row.route_id,
    company_id: row.company_id,
    origin_city: row.origin_city,
    destination_city: row.destination_city,
    travel_date: row.travel_date,
    departure_time: row.departure_time,
    arrival_time: row.arrival_time,
    seats_count: num(row.seats_count),
    passengers: Array.isArray(row.passengers) ? row.passengers : [],
    unit_price: num(row.unit_price),
    service_fee: num(row.service_fee),
    total: num(row.total),
    status: row.status,
    payment_method: row.payment_method,
    payment_phone: row.payment_phone,
    payment_status: row.payment_status,
    booking_ref: row.booking_ref,
    schedule_id: row.schedule_id,
    assigned_seats: row.assigned_seats,
    bus_label: row.bus_label,
    created_at: row.created_at,
    customer_name: u?.full_name ?? (paxName || null),
    customer_email: u?.email ?? null,
    customer_phone: u?.phone ?? row.payment_phone ?? (pax?.phone ?? null),
    wave_transaction_ref: row.wave_transaction_ref ?? null,
    wave_checkout_status: row.wave_checkout_status ?? null,
    payment_date: row.payment_date ?? null,
  };
}

export async function fetchBookings(): Promise<MobileBooking[]> {
  const { data, error } = await supabase
    .from('mobile_bookings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean))) as string[];
  const usersById: Record<string, { full_name: string | null; email: string | null; phone: string | null }> = {};
  if (userIds.length > 0) {
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('id, full_name, email, phone')
      .in('id', userIds);
    if (usersError) throw usersError;
    for (const u of usersData ?? []) {
      usersById[u.id] = { full_name: u.full_name, email: u.email, phone: u.phone };
    }
  }

  return rows.map((row) => mapBooking(row, row.user_id ? usersById[row.user_id] : null));
}

export async function cancelBooking(id: string): Promise<void> {
  const { error } = await supabase
    .from('mobile_bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function fetchMobileUsers(): Promise<MobileUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, phone, status, is_active, is_self_registered, created_at')
    .eq('role', 'client')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MobileUser[];
}

export async function setUserStatus(id: string, status: 'active' | 'suspended'): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ status, is_active: status === 'active', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function fetchServiceFee(): Promise<number> {
  const { data, error } = await supabase
    .from('mobile_app_settings')
    .select('service_fee')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return num(data?.service_fee ?? 300);
}

export async function updateServiceFee(fee: number): Promise<void> {
  const { error } = await supabase
    .from('mobile_app_settings')
    .upsert({ id: 1, service_fee: fee, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ── Frais de service par trajet ─────────────────────────────────
export interface RouteFee {
  id: string;
  origin_city_id: string;
  origin_city_name: string;
  destination_city_id: string;
  destination_city_name: string;
  service_fee: number;
  is_active: boolean;
}

export async function fetchRouteFees(): Promise<RouteFee[]> {
  const { data, error } = await supabase
    .from('mobile_route_fees')
    .select(`
      id,
      origin_city_id,
      destination_city_id,
      service_fee,
      is_active,
      origin:cities!mobile_route_fees_origin_city_id_fkey(name),
      destination:cities!mobile_route_fees_destination_city_id_fkey(name)
    `)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    origin_city_id: row.origin_city_id,
    origin_city_name: Array.isArray(row.origin) ? row.origin[0]?.name ?? '' : row.origin?.name ?? '',
    destination_city_id: row.destination_city_id,
    destination_city_name: Array.isArray(row.destination) ? row.destination[0]?.name ?? '' : row.destination?.name ?? '',
    service_fee: num(row.service_fee),
    is_active: row.is_active ?? true,
  }));
}

export async function upsertRouteFee(fee: Partial<RouteFee> & { origin_city_id: string; destination_city_id: string; service_fee: number }): Promise<void> {
  const payload = {
    origin_city_id: fee.origin_city_id,
    destination_city_id: fee.destination_city_id,
    service_fee: fee.service_fee,
    is_active: fee.is_active ?? true,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('mobile_route_fees')
    .upsert(payload, { onConflict: 'origin_city_id,destination_city_id' });
  if (error) throw error;
}

export async function deleteRouteFee(id: string): Promise<void> {
  const { error } = await supabase.from('mobile_route_fees').delete().eq('id', id);
  if (error) throw error;
}

// ── FAQ ──────────────────────────────────────────────────────────
export async function fetchFaqs(): Promise<Faq[]> {
  const { data, error } = await supabase
    .from('reservation_faqs')
    .select('*')
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Faq[];
}

export async function saveFaq(faq: Partial<Faq> & { id?: string }): Promise<void> {
  const payload = {
    question: faq.question,
    answer: faq.answer,
    category: faq.category ?? 'general',
    display_order: faq.display_order ?? 0,
    is_active: faq.is_active ?? true,
    updated_at: new Date().toISOString(),
  };
  const { error } = faq.id
    ? await supabase.from('reservation_faqs').update(payload).eq('id', faq.id)
    : await supabase.from('reservation_faqs').insert(payload);
  if (error) throw error;
}

export async function deleteFaq(id: string): Promise<void> {
  const { error } = await supabase.from('reservation_faqs').delete().eq('id', id);
  if (error) throw error;
}

// ── Politiques d'annulation ─────────────────────────────────────
export async function fetchPolicies(): Promise<CancellationPolicy[]> {
  const { data, error } = await supabase
    .from('cancellation_policies')
    .select('*')
    .order('hours_before_departure', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CancellationPolicy[];
}

export async function savePolicy(p: Partial<CancellationPolicy> & { id?: string }): Promise<void> {
  const payload = {
    title: p.title,
    description: p.description ?? '',
    hours_before_departure: p.hours_before_departure ?? 0,
    refund_rate: p.refund_rate ?? 0,
    is_active: p.is_active ?? true,
    updated_at: new Date().toISOString(),
  };
  const { error } = p.id
    ? await supabase.from('cancellation_policies').update(payload).eq('id', p.id)
    : await supabase.from('cancellation_policies').insert(payload);
  if (error) throw error;
}

export async function deletePolicy(id: string): Promise<void> {
  const { error } = await supabase.from('cancellation_policies').delete().eq('id', id);
  if (error) throw error;
}

// ── Paramètres Wave ─────────────────────────────────────────────
export interface WaveSettings {
  api_key: string;
  api_secret: string;
  signing_secret: string;
  webhook_url: string;
  mode: 'test' | 'production';
  is_active: boolean;
  checkout_enabled: boolean;
  balance_enabled: boolean;
  payout_enabled: boolean;
}

export async function fetchWaveSettings(): Promise<WaveSettings> {
  const { data, error } = await supabase
    .from('wave_settings')
    .select('api_key, api_secret, signing_secret, webhook_url, mode, is_active, checkout_enabled, balance_enabled, payout_enabled')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return {
    api_key: data?.api_key ?? '',
    api_secret: data?.api_secret ?? '',
    signing_secret: data?.signing_secret ?? '',
    webhook_url: data?.webhook_url ?? '',
    mode: (data?.mode as 'test' | 'production') ?? 'test',
    is_active: data?.is_active ?? false,
    checkout_enabled: data?.checkout_enabled ?? true,
    balance_enabled: data?.balance_enabled ?? false,
    payout_enabled: data?.payout_enabled ?? false,
  };
}

export async function updateWaveSettings(s: WaveSettings): Promise<void> {
  const { error } = await supabase
    .from('wave_settings')
    .update({
      api_key: s.api_key.trim() || null,
      api_secret: s.api_secret.trim(),
      signing_secret: s.signing_secret.trim() || null,
      webhook_url: s.webhook_url.trim() || null,
      mode: s.mode,
      is_active: s.is_active,
      checkout_enabled: s.checkout_enabled,
      balance_enabled: s.balance_enabled,
      payout_enabled: s.payout_enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  if (error) throw error;
}
