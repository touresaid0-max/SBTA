import { supabase } from '@/services/supabase';

export interface DigitalKiosk {
  id: string;
  name: string;
  station_id: string | null;
  station_name?: string;
  kiosk_type: 'physical' | 'virtual_qr';
  status: 'active' | 'defective' | 'offline';
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  background_image_url: string | null;
  welcome_text: string;
  idle_timeout_seconds: number;
  payment_confirmation_mode: 'wave_api' | 'manual';
  services: Record<string, boolean>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KioskTicket {
  id: string;
  kiosk_id: string;
  kiosk_name?: string;
  schedule_id: string | null;
  route_id: string | null;
  bus_id: string | null;
  origin_city_id: string | null;
  destination_city_id: string | null;
  passenger_name: string;
  passenger_phone: string | null;
  seat_numbers: string[];
  unit_price: number;
  service_fee: number;
  total_amount: number;
  payment_method: string;
  payment_status: 'pending' | 'paid' | 'failed';
  wave_session_id: string | null;
  ticket_ref: string;
  qr_code: string | null;
  printed: boolean;
  station_id: string | null;
  created_at: string;
  updated_at: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export async function fetchKiosks(): Promise<DigitalKiosk[]> {
  const { data, error } = await supabase
    .from('digital_kiosks')
    .select(`
      *,
      station:stations(name)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    station_id: row.station_id,
    station_name: Array.isArray(row.station) ? row.station[0]?.name ?? null : row.station?.name ?? null,
    kiosk_type: row.kiosk_type,
    status: row.status,
    logo_url: row.logo_url,
    primary_color: row.primary_color ?? '#0B7439',
    secondary_color: row.secondary_color ?? '#E7F6EC',
    background_image_url: row.background_image_url,
    welcome_text: row.welcome_text ?? "Touchez l'écran pour commencer",
    idle_timeout_seconds: row.idle_timeout_seconds ?? 60,
    payment_confirmation_mode: row.payment_confirmation_mode ?? 'wave_api',
    services: row.services ?? { ticket_sale: true, info: true },
    is_active: row.is_active ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function fetchKiosk(id: string): Promise<DigitalKiosk | null> {
  const { data, error } = await supabase
    .from('digital_kiosks')
    .select(`*, station:stations(name)`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as any;
  return {
    id: row.id,
    name: row.name,
    station_id: row.station_id,
    station_name: Array.isArray(row.station) ? row.station[0]?.name ?? null : row.station?.name ?? null,
    kiosk_type: row.kiosk_type,
    status: row.status,
    logo_url: row.logo_url,
    primary_color: row.primary_color ?? '#0B7439',
    secondary_color: row.secondary_color ?? '#E7F6EC',
    background_image_url: row.background_image_url,
    welcome_text: row.welcome_text ?? "Touchez l'écran pour commencer",
    idle_timeout_seconds: row.idle_timeout_seconds ?? 60,
    payment_confirmation_mode: row.payment_confirmation_mode ?? 'wave_api',
    services: row.services ?? { ticket_sale: true, info: true },
    is_active: row.is_active ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchKioskByStation(stationId: string): Promise<DigitalKiosk | null> {
  const { data, error } = await supabase
    .from('digital_kiosks')
    .select(`*, station:stations(name)`)
    .eq('station_id', stationId)
    .eq('is_active', true)
    .eq('status', 'active')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as any;
  return {
    id: row.id,
    name: row.name,
    station_id: row.station_id,
    station_name: Array.isArray(row.station) ? row.station[0]?.name ?? null : row.station?.name ?? null,
    kiosk_type: row.kiosk_type,
    status: row.status,
    logo_url: row.logo_url,
    primary_color: row.primary_color ?? '#0B7439',
    secondary_color: row.secondary_color ?? '#E7F6EC',
    background_image_url: row.background_image_url,
    welcome_text: row.welcome_text ?? "Touchez l'écran pour commencer",
    idle_timeout_seconds: row.idle_timeout_seconds ?? 60,
    payment_confirmation_mode: row.payment_confirmation_mode ?? 'wave_api',
    services: row.services ?? { ticket_sale: true, info: true },
    is_active: row.is_active ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createKiosk(kiosk: Partial<DigitalKiosk>): Promise<DigitalKiosk> {
  const payload = {
    name: kiosk.name,
    station_id: kiosk.station_id,
    kiosk_type: kiosk.kiosk_type ?? 'physical',
    status: kiosk.status ?? 'active',
    logo_url: kiosk.logo_url ?? null,
    primary_color: kiosk.primary_color ?? '#0B7439',
    secondary_color: kiosk.secondary_color ?? '#E7F6EC',
    background_image_url: kiosk.background_image_url ?? null,
    welcome_text: kiosk.welcome_text ?? "Touchez l'écran pour commencer",
    idle_timeout_seconds: kiosk.idle_timeout_seconds ?? 60,
    payment_confirmation_mode: kiosk.payment_confirmation_mode ?? 'wave_api',
    services: kiosk.services ?? { ticket_sale: true, info: true },
    is_active: kiosk.is_active ?? true,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('digital_kiosks')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as DigitalKiosk;
}

export async function updateKiosk(id: string, patch: Partial<DigitalKiosk>): Promise<void> {
  const { error } = await supabase
    .from('digital_kiosks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteKiosk(id: string): Promise<void> {
  const { error } = await supabase.from('digital_kiosks').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchKioskTickets(kioskId?: string): Promise<KioskTicket[]> {
  let q = supabase
    .from('kiosk_tickets')
    .select(`*, kiosk:digital_kiosks(name)`)
    .order('created_at', { ascending: false });
  if (kioskId) q = q.eq('kiosk_id', kioskId);
  const { data, error } = await q.limit(200);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    kiosk_id: row.kiosk_id,
    kiosk_name: Array.isArray(row.kiosk) ? row.kiosk[0]?.name ?? null : row.kiosk?.name ?? null,
    schedule_id: row.schedule_id,
    route_id: row.route_id,
    bus_id: row.bus_id,
    origin_city_id: row.origin_city_id,
    destination_city_id: row.destination_city_id,
    passenger_name: row.passenger_name ?? 'Voyageur',
    passenger_phone: row.passenger_phone,
    seat_numbers: row.seat_numbers ?? [],
    unit_price: num(row.unit_price),
    service_fee: num(row.service_fee),
    total_amount: num(row.total_amount),
    payment_method: row.payment_method ?? 'wave',
    payment_status: row.payment_status ?? 'pending',
    wave_session_id: row.wave_session_id,
    ticket_ref: row.ticket_ref,
    qr_code: row.qr_code,
    printed: row.printed ?? false,
    station_id: row.station_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export async function createKioskTicket(ticket: {
  kiosk_id: string;
  schedule_id: string | null;
  route_id: string | null;
  bus_id?: string | null;
  origin_city_id: string;
  destination_city_id: string;
  passenger_name: string;
  passenger_phone?: string | null;
  seat_numbers: string[];
  unit_price: number;
  service_fee: number;
  total_amount: number;
  payment_method?: string;
  station_id?: string | null;
}): Promise<KioskTicket> {
  const { data, error } = await supabase
    .from('kiosk_tickets')
    .insert({
      kiosk_id: ticket.kiosk_id,
      schedule_id: ticket.schedule_id,
      route_id: ticket.route_id,
      bus_id: ticket.bus_id ?? null,
      origin_city_id: ticket.origin_city_id,
      destination_city_id: ticket.destination_city_id,
      passenger_name: ticket.passenger_name,
      passenger_phone: ticket.passenger_phone ?? null,
      seat_numbers: ticket.seat_numbers,
      unit_price: ticket.unit_price,
      service_fee: ticket.service_fee,
      total_amount: ticket.total_amount,
      payment_method: ticket.payment_method ?? 'wave',
      payment_status: 'pending',
      station_id: ticket.station_id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as KioskTicket;
}

export async function updateKioskTicketPayment(
  ticketId: string,
  status: 'pending' | 'paid' | 'failed',
  waveSessionId?: string
): Promise<void> {
  const patch: Record<string, unknown> = {
    payment_status: status,
    updated_at: new Date().toISOString(),
  };
  if (waveSessionId) patch.wave_session_id = waveSessionId;
  if (status === 'paid') patch.printed = true;
  const { error } = await supabase.from('kiosk_tickets').update(patch).eq('id', ticketId);
  if (error) throw error;
}

export async function fetchKioskRevenue(kioskId?: string): Promise<{
  totalRevenue: number;
  totalTickets: number;
  paidTickets: number;
  pendingTickets: number;
  todayRevenue: number;
  todayTickets: number;
}> {
  let q = supabase.from('kiosk_tickets').select('total_amount, payment_status, created_at');
  if (kioskId) q = q.eq('kiosk_id', kioskId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const today = new Date().toISOString().split('T')[0];
  let totalRevenue = 0, totalTickets = rows.length, paidTickets = 0, pendingTickets = 0;
  let todayRevenue = 0, todayTickets = 0;
  for (const r of rows) {
    if (r.payment_status === 'paid') {
      paidTickets++;
      totalRevenue += num(r.total_amount);
      if ((r.created_at ?? '').startsWith(today)) {
        todayRevenue += num(r.total_amount);
        todayTickets++;
      }
    } else if (r.payment_status === 'pending') {
      pendingTickets++;
    }
  }
  return { totalRevenue, totalTickets, paidTickets, pendingTickets, todayRevenue, todayTickets };
}
