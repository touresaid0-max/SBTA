import { supabase } from './supabase';
import { offlineStore, OfflineTicket } from './offlineStore';

type SyncListener = (ticket: OfflineTicket) => void;

class OfflineSyncService {
  private isSyncing = false;
  private listeners: SyncListener[] = [];

  onTicketSynced(fn: SyncListener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private emit(ticket: OfflineTicket) {
    this.listeners.forEach(l => l(ticket));
  }

  async syncAll(): Promise<{ synced: number; failed: number }> {
    if (this.isSyncing) return { synced: 0, failed: 0 };
    this.isSyncing = true;
    let synced = 0;
    let failed = 0;

    try {
      const pending = await offlineStore.getPendingTickets();
      for (const ticket of pending) {
        const ok = await this.syncOne(ticket);
        if (ok) synced++;
        else failed++;
      }
    } finally {
      this.isSyncing = false;
    }
    return { synced, failed };
  }

  async syncOne(ticket: OfflineTicket): Promise<boolean> {
    await offlineStore.updateTicketStatus(ticket.localId, 'syncing');

    try {
      const { data: schedule, error: schedErr } = await supabase
        .from('schedules')
        .select('id, seats_available, seats_reserved')
        .eq('id', ticket.scheduleId)
        .maybeSingle();

      if (schedErr || !schedule) {
        throw new Error('Voyage introuvable sur le serveur');
      }

      if (schedule.seats_available < ticket.totalSeats) {
        throw new Error(`Plus assez de places disponibles (${schedule.seats_available} restante(s))`);
      }

      const { data: reservation, error: resErr } = await supabase
        .from('reservations')
        .insert({
          schedule_id: ticket.scheduleId,
          passenger_name: ticket.passengerName,
          passenger_phone: ticket.passengerPhone,
          seat_numbers: ticket.seatNumbers,
          total_seats: ticket.totalSeats,
          total_price: ticket.totalPrice,
          booking_reference: ticket.bookingReference,
          qr_code: ticket.bookingReference,
          status: 'confirmee',
          payment_status: ['especes', 'carte'].includes(ticket.paymentMethod) ? 'payee' : 'en_attente',
          booked_by: ticket.bookedBy,
          destination_city_name: ticket.destinationCityName || null,
        })
        .select('id')
        .single();

      if (resErr || !reservation) {
        throw new Error(resErr?.message || 'Erreur création réservation');
      }

      await supabase.from('payments').insert({
        reservation_id: reservation.id,
        amount: ticket.totalPrice,
        payment_method: ticket.paymentMethod,
        payment_reference: ticket.paymentReference || null,
        status: ['especes', 'carte'].includes(ticket.paymentMethod) ? 'reussie' : 'en_attente',
        processed_by: ticket.bookedBy,
      });

      await supabase.from('schedules').update({
        seats_available: Math.max(0, schedule.seats_available - ticket.totalSeats),
        seats_reserved: (schedule.seats_reserved || 0) + ticket.totalSeats,
      }).eq('id', ticket.scheduleId);

      const updated: OfflineTicket = {
        ...ticket,
        status: 'synced',
        syncedAt: new Date().toISOString(),
        onlineId: reservation.id,
      };
      await offlineStore.saveTicket(updated);
      this.emit(updated);
      return true;
    } catch (err: any) {
      const errMsg = err?.message || 'Erreur inconnue';
      const updated: OfflineTicket = {
        ...ticket,
        status: 'error',
        errorMessage: errMsg,
      };
      await offlineStore.saveTicket(updated);
      this.emit(updated);
      return false;
    }
  }

  startAutoSync(intervalMs = 30_000) {
    const handler = async () => {
      if (navigator.onLine) {
        await this.syncAll();
      }
    };

    window.addEventListener('online', handler);
    const interval = setInterval(handler, intervalMs);

    return () => {
      window.removeEventListener('online', handler);
      clearInterval(interval);
    };
  }
}

export const offlineSyncService = new OfflineSyncService();
