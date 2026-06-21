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
