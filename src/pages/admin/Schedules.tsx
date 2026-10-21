import React, { useState, useEffect } from 'react';
import {
  Calendar, Plus, CreditCard as Edit2, Trash2, Bus, Route as RouteIcon,
  Clock, User, RotateCcw, CheckCircle2, X, History, AlertTriangle, Loader2,
  Search, Filter
} from 'lucide-react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { format, startOfDay } from 'date-fns';

function toLocalDatetimeInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface RouteData {
  id: string;
  name: string;
}

interface BusData {
  id: string;
  registration_number: string;
  capacity: number;
}

interface Driver {
  id: string;
  full_name: string;
}

interface Schedule {
  id: string;
  route_id: string;
  route_name: string;
  bus_id: string;
  driver_id: string;
  copilot_id?: string;
  departure_datetime: string;
  arrival_datetime: string;
  price: number;
  seats_available: number;
  seats_reserved: number;
  fill_rate: number;
  status: 'planifie' | 'en_cours' | 'termine' | 'annule';
  routes?: { name: string };
  buses?: { registration_number: string };
  drivers?: { full_name: string };
  copilots?: { full_name: string };
}

interface ReactivationLog {
  id: string;
  schedule_id: string;
  action: string;
  old_status: string;
  new_status: string;
  reason: string;
  performed_at: string;
  user_role: string;
  user_full_name: string;
}

export default function Schedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [routes, setRoutes] = useState<RouteData[]>([]);
  const [buses, setBuses] = useState<BusData[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Search / filter state
  const [searchRoute, setSearchRoute] = useState('');
  const [searchBus, setSearchBus] = useState('');
  const [searchDriver, setSearchDriver] = useState('');
  const [searchDeparture, setSearchDeparture] = useState('');
  const [searchArrival, setSearchArrival] = useState('');

  // Reactivation state
  const [reactivateModal, setReactivateModal] = useState<{ schedule: Schedule; action: 'reactivate' | 'reterminate' } | null>(null);
  const [reactivateReason, setReactivateReason] = useState('');
  const [reactivateLoading, setReactivateLoading] = useState(false);

  // History state
  const [historyModal, setHistoryModal] = useState<string | null>(null);
  const [historyLogs, setHistoryLogs] = useState<ReactivationLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [formData, setFormData] = useState({
    route_id: '',
    bus_id: '',
    driver_id: '',
    copilot_id: '',
    departure_datetime: '',
    arrival_datetime: '',
    price: 0,
    status: 'planifie' as 'planifie' | 'en_cours' | 'termine' | 'annule'
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [schedulesRes, routesRes, busesRes, driversRes] = await Promise.all([
        supabase
          .from('schedules')
          .select(`
            *,
            routes(name),
            buses:bus_id(registration_number),
            drivers:driver_id(full_name),
            copilots:copilot_id(full_name)
          `)
          .order('departure_datetime', { ascending: false }),
        supabase.from('routes').select('id, name').eq('is_active', true).order('name'),
        supabase.from('buses').select('id, registration_number, capacity').eq('status', 'disponible').is('archived_at', null).order('registration_number'),
        supabase.from('users').select('id, full_name').eq('role', 'chauffeur').eq('is_active', true).order('full_name')
      ]);

      if (schedulesRes.error) throw schedulesRes.error;
      if (routesRes.error) throw routesRes.error;
      if (busesRes.error) throw busesRes.error;
      if (driversRes.error) throw driversRes.error;

      setSchedules(schedulesRes.data || []);
      setRoutes(routesRes.data || []);
      setBuses(busesRes.data || []);
      setDrivers(driversRes.data || []);
    } catch (error: any) {
      toast.error('Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate arrival is strictly after departure
    if (formData.departure_datetime && formData.arrival_datetime) {
      const dep = new Date(formData.departure_datetime);
      const arr = new Date(formData.arrival_datetime);
      if (arr <= dep) {
        toast.error("La date d'arrivée doit être strictement postérieure à la date de départ.");
        return;
      }
    }

    try {
      const payload = {
        route_id: formData.route_id,
        bus_id: formData.bus_id,
        driver_id: formData.driver_id,
        copilot_id: formData.copilot_id || null,
        departure_datetime: new Date(formData.departure_datetime).toISOString(),
        arrival_datetime: new Date(formData.arrival_datetime).toISOString(),
        price: formData.price,
        status: formData.status
      };

      if (editingId) {
        const { error } = await supabase
          .from('schedules')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
        toast.success('Horaire mis à jour');
      } else {
        const { error } = await supabase
          .from('schedules')
          .insert([payload]);

        if (error) throw error;
        toast.success('Horaire créé');
      }

      setShowForm(false);
      setEditingId(null);
      resetForm();
      loadData();
    } catch (error: any) {
      console.error('Error saving schedule:', error);
      toast.error(error.message || 'Erreur lors de l\'enregistrement');
    }
  };

  const handleEdit = (schedule: Schedule) => {
    setFormData({
      route_id: schedule.route_id,
      bus_id: schedule.bus_id,
      driver_id: schedule.driver_id,
      copilot_id: schedule.copilot_id || '',
      departure_datetime: toLocalDatetimeInput(schedule.departure_datetime),
      arrival_datetime: toLocalDatetimeInput(schedule.arrival_datetime),
      price: schedule.price,
      status: schedule.status
    });
    setEditingId(schedule.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Voulez-vous vraiment supprimer cet horaire?')) return;

    try {
      const { error } = await supabase
        .from('schedules')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Horaire supprimé');
      loadData();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      route_id: '',
      bus_id: '',
      driver_id: '',
      copilot_id: '',
      departure_datetime: '',
      arrival_datetime: '',
      price: 0,
      status: 'planifie'
    });
  };

  // --- Reactivation Logic ---
  const handleToggleStatus = async () => {
    if (!reactivateModal || !reactivateReason.trim()) {
      toast.error('Veuillez saisir un motif');
      return;
    }

    setReactivateLoading(true);
    try {
      const newStatus = reactivateModal.action === 'reactivate' ? 'en_cours' : 'termine';
      const { data, error } = await supabase.rpc('admin_toggle_schedule_status', {
        p_schedule_id: reactivateModal.schedule.id,
        p_new_status: newStatus,
        p_reason: reactivateReason.trim()
      });

      if (error) throw error;

      toast.success(
        reactivateModal.action === 'reactivate'
          ? 'Voyage réactivé avec succès'
          : 'Voyage reterminé avec succès'
      );
      setReactivateModal(null);
      setReactivateReason('');
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Erreur lors du changement de statut');
    } finally {
      setReactivateLoading(false);
    }
  };

  const loadHistory = async (scheduleId: string) => {
    setHistoryModal(scheduleId);
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('schedule_reactivation_logs')
        .select('*')
        .eq('schedule_id', scheduleId)
        .order('performed_at', { ascending: false });

      if (error) throw error;
      setHistoryLogs(data || []);
    } catch (error: any) {
      toast.error('Erreur chargement historique');
    } finally {
      setHistoryLoading(false);
    }
  };

  const isPastSchedule = (schedule: Schedule) => {
    const depDate = new Date(schedule.departure_datetime);
    return depDate < startOfDay(new Date());
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'planifie': return { bg: '#EFF6FF', text: '#2563EB' };
      case 'en_cours': return { bg: '#FFF7ED', text: '#EA580C' };
      case 'termine': return { bg: '#F0FDF4', text: '#16A34A' };
      case 'annule': return { bg: '#FEF2F2', text: '#DC2626' };
      default: return { bg: '#F3F4F6', text: '#6B7280' };
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'planifie': return 'Planifié';
      case 'en_cours': return 'En cours';
      case 'termine': return 'Terminé';
      case 'annule': return 'Annulé';
      default: return status;
    }
  };

  if (loading) {
    return <div className="p-8">Chargement...</div>;
  }

  const filteredSchedules = schedules.filter(s => {
    const routeName = (s.route_name || s.routes?.name || '').toLowerCase();
    const busReg = (s.buses?.registration_number || '').toLowerCase();
    const driverName = (s.drivers?.full_name || '').toLowerCase();
    const depDate = s.departure_datetime ? format(new Date(s.departure_datetime), 'yyyy-MM-dd') : '';
    const arrDate = s.arrival_datetime ? format(new Date(s.arrival_datetime), 'yyyy-MM-dd') : '';

    if (searchRoute && !routeName.includes(searchRoute.toLowerCase())) return false;
    if (searchBus && !busReg.includes(searchBus.toLowerCase())) return false;
    if (searchDriver && !driverName.includes(searchDriver.toLowerCase())) return false;
    if (searchDeparture && depDate !== searchDeparture) return false;
    if (searchArrival && arrDate !== searchArrival) return false;
    return true;
  });

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Planification
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {filteredSchedules.length} / {schedules.length} horaires
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-6 py-3 rounded-lg flex items-center gap-2 text-white font-medium"
          style={{ backgroundColor: 'var(--primary)' }}
        >
          <Plus className="w-5 h-5" />
          Nouvel horaire
        </button>
      </div>

      {/* Search filters */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-[#64748B]" />
          <span className="text-sm font-semibold text-[#374151]">Filtres de recherche</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Itinéraire..."
              value={searchRoute}
              onChange={e => setSearchRoute(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
          <div className="relative">
            <Bus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Bus (immatriculation)..."
              value={searchBus}
              onChange={e => setSearchBus(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Chauffeur..."
              value={searchDriver}
              onChange={e => setSearchDriver(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
          <div>
            <input
              type="date"
              value={searchDeparture}
              onChange={e => setSearchDeparture(e.target.value)}
              title="Date de départ"
              className="w-full px-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
          <div>
            <input
              type="date"
              value={searchArrival}
              onChange={e => setSearchArrival(e.target.value)}
              title="Date d'arrivée"
              className="w-full px-3 py-2.5 border border-[#E2E8F0] rounded-lg text-sm
                         focus:ring-2 focus:ring-[#0B7439]/20 focus:border-[#0B7439] transition-colors"
            />
          </div>
        </div>
        {(searchRoute || searchBus || searchDriver || searchDeparture || searchArrival) && (
          <button
            onClick={() => { setSearchRoute(''); setSearchBus(''); setSearchDriver(''); setSearchDeparture(''); setSearchArrival(''); }}
            className="mt-3 text-xs text-[#64748B] hover:text-[#1E293B] underline"
          >
            Effacer les filtres
          </button>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-2xl my-8">
            <div className="p-6 border-b">
              <h2 className="text-2xl font-bold">
                {editingId ? 'Modifier' : 'Nouvel'} horaire
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block mb-2 font-medium">Itinéraire *</label>
                  <select
                    value={formData.route_id}
                    onChange={(e) => setFormData({ ...formData, route_id: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                    required
                  >
                    <option value="">Sélectionner un itinéraire</option>
                    {routes.map(route => (
                      <option key={route.id} value={route.id}>{route.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Bus *</label>
                    <select
                      value={formData.bus_id}
                      onChange={(e) => setFormData({ ...formData, bus_id: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    >
                      <option value="">Sélectionner un bus</option>
                      {buses.map(bus => (
                        <option key={bus.id} value={bus.id}>
                          {bus.registration_number} ({bus.capacity} places)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Chauffeur *</label>
                    <select
                      value={formData.driver_id}
                      onChange={(e) => setFormData({ ...formData, driver_id: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    >
                      <option value="">Sélectionner un chauffeur</option>
                      {drivers.map(driver => (
                        <option key={driver.id} value={driver.id}>{driver.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Copilote (optionnel)</label>
                  <select
                    value={formData.copilot_id}
                    onChange={(e) => setFormData({ ...formData, copilot_id: e.target.value })}
                    className="w-full p-3 border rounded-lg"
                  >
                    <option value="">Aucun copilote</option>
                    {drivers.filter(d => d.id !== formData.driver_id).map(driver => (
                      <option key={driver.id} value={driver.id}>{driver.full_name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-2 font-medium">Date et heure de départ *</label>
                    <input
                      type="datetime-local"
                      value={formData.departure_datetime}
                      onChange={(e) => setFormData({ ...formData, departure_datetime: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    />
                  </div>

                  <div>
                    <label className="block mb-2 font-medium">Date et heure d'arrivée *</label>
                    <input
                      type="datetime-local"
                      value={formData.arrival_datetime}
                      onChange={(e) => setFormData({ ...formData, arrival_datetime: e.target.value })}
                      className="w-full p-3 border rounded-lg"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-2 font-medium">Prix du billet (FCFA) *</label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                    className="w-full p-3 border rounded-lg"
                    min="0"
                    step="100"
                    required
                  />
                </div>

                <div>
                  <label className="block mb-2 font-medium">Statut</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full p-3 border rounded-lg"
                  >
                    <option value="planifie">Planifié</option>
                    <option value="en_cours">En cours</option>
                    <option value="termine">Terminé</option>
                    <option value="annule">Annulé</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <button
                  type="submit"
                  className="px-6 py-3 rounded-lg text-white font-medium"
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {editingId ? 'Mettre à jour' : 'Créer'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditingId(null); resetForm(); }}
                  className="px-6 py-3 rounded-lg border"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reactivation Modal */}
      {reactivateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6 border-b border-[#F1F5F9]">
              <div className="flex items-center gap-3">
                {reactivateModal.action === 'reactivate' ? (
                  <div className="w-10 h-10 rounded-full bg-[#FFF7ED] flex items-center justify-center">
                    <RotateCcw className="w-5 h-5 text-[#EA580C]" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[#F0FDF4] flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-[#16A34A]" />
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-bold text-[#1E293B]">
                    {reactivateModal.action === 'reactivate' ? 'Réactiver le voyage' : 'Terminer le voyage'}
                  </h3>
                  <p className="text-sm text-[#64748B]">
                    {reactivateModal.schedule.routes?.name || 'N/A'} - {format(new Date(reactivateModal.schedule.departure_datetime), 'dd/MM/yyyy HH:mm')}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {reactivateModal.action === 'reactivate' && (
                <div className="flex items-start gap-3 p-3 bg-[#FFFBEB] rounded-lg border border-[#FDE68A]">
                  <AlertTriangle className="w-5 h-5 text-[#D97706] flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-[#92400E]">
                    La réactivation remettra ce voyage au statut "En cours" et permettra au Chef de gare et au Guichet d'effectuer des modifications.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-[#374151] mb-2">
                  Motif de {reactivateModal.action === 'reactivate' ? 'la réactivation' : 'la clôture'} *
                </label>
                <textarea
                  value={reactivateReason}
                  onChange={(e) => setReactivateReason(e.target.value)}
                  placeholder="Saisissez le motif obligatoire..."
                  rows={3}
                  className="w-full p-3 border border-[#D1D5DB] rounded-lg text-sm focus:ring-2 focus:ring-[#0B7439] focus:border-transparent resize-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="p-6 border-t border-[#F1F5F9] flex gap-3">
              <button
                onClick={() => { setReactivateModal(null); setReactivateReason(''); }}
                className="flex-1 px-4 py-2.5 border border-[#D1D5DB] rounded-lg text-sm font-medium text-[#374151] hover:bg-[#F9FAFB] transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleToggleStatus}
                disabled={reactivateLoading || !reactivateReason.trim()}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors
                  flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed
                  ${reactivateModal.action === 'reactivate'
                    ? 'bg-[#EA580C] hover:bg-[#C2410C]'
                    : 'bg-[#16A34A] hover:bg-[#15803D]'
                  }`}
              >
                {reactivateLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {reactivateModal.action === 'reactivate' ? 'Réactiver' : 'Terminer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-[#F1F5F9] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#F1F5F9] flex items-center justify-center">
                  <History className="w-5 h-5 text-[#475569]" />
                </div>
                <h3 className="text-lg font-bold text-[#1E293B]">Historique des modifications</h3>
              </div>
              <button onClick={() => setHistoryModal(null)} className="p-2 hover:bg-[#F1F5F9] rounded-lg">
                <X className="w-5 h-5 text-[#64748B]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#0B7439]" />
                </div>
              ) : historyLogs.length === 0 ? (
                <div className="text-center py-8">
                  <History className="w-12 h-12 text-[#D1D5DB] mx-auto mb-3" />
                  <p className="text-sm text-[#64748B]">Aucune modification enregistrée</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {historyLogs.map(log => (
                    <div key={log.id} className="border border-[#E2E8F0] rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        {log.action === 'reactivate' ? (
                          <RotateCcw className="w-4 h-4 text-[#EA580C]" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                        )}
                        <span className="text-sm font-semibold text-[#1E293B]">
                          {log.action === 'reactivate' ? 'Réactivation' : 'Reterminaison'}
                        </span>
                        <span className="ml-auto text-xs text-[#64748B]">
                          {format(new Date(log.performed_at), 'dd/MM/yyyy HH:mm')}
                        </span>
                      </div>
                      <div className="text-xs text-[#64748B] space-y-1">
                        <p><span className="font-medium text-[#374151]">Par :</span> {log.user_full_name} ({log.user_role})</p>
                        <p><span className="font-medium text-[#374151]">Statut :</span> {getStatusLabel(log.old_status)} → {getStatusLabel(log.new_status)}</p>
                        <p><span className="font-medium text-[#374151]">Motif :</span> {log.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full">
          <thead style={{ backgroundColor: 'var(--neutral-100)' }}>
            <tr>
              <th className="text-left p-4 font-semibold">Itinéraire</th>
              <th className="text-left p-4 font-semibold">Bus</th>
              <th className="text-left p-4 font-semibold">Chauffeur</th>
              <th className="text-left p-4 font-semibold">Départ</th>
              <th className="text-left p-4 font-semibold">Arrivée</th>
              <th className="text-left p-4 font-semibold">Occupation</th>
              <th className="text-left p-4 font-semibold">Prix</th>
              <th className="text-left p-4 font-semibold">Statut</th>
              <th className="text-left p-4 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSchedules.map((schedule) => {
              const statusColors = getStatusColor(schedule.status);
              const past = isPastSchedule(schedule);
              const canReactivate = schedule.status === 'termine' && past;
              const canReterminate = schedule.status === 'en_cours' && past;
              return (
                <tr key={schedule.id} className="border-t hover:bg-gray-50">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <RouteIcon className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      <span className="font-medium">{schedule.route_name || schedule.routes?.name || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Bus className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      {schedule.buses?.registration_number || 'N/A'}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      <div>
                        <div className="font-medium">{schedule.drivers?.full_name || 'N/A'}</div>
                        {schedule.copilots?.full_name && (
                          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            Copilote: {schedule.copilots.full_name}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      <div>
                        <div className="text-sm font-medium">
                          {format(new Date(schedule.departure_datetime), 'HH:mm')}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {format(new Date(schedule.departure_datetime), 'dd/MM/yyyy')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-sm font-medium">
                      {format(new Date(schedule.arrival_datetime), 'HH:mm')}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {format(new Date(schedule.arrival_datetime), 'dd/MM/yyyy')}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="text-sm">
                      <div className="font-medium">{schedule.seats_reserved || 0}/{schedule.seats_available || 0}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {schedule.fill_rate?.toFixed(0) || 0}% rempli
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="font-medium">{schedule.price?.toLocaleString() || 0} FCFA</div>
                  </td>
                  <td className="p-4">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: statusColors.bg,
                        color: statusColors.text
                      }}
                    >
                      {getStatusLabel(schedule.status)}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1 items-center">
                      {/* Reactivation buttons */}
                      {canReactivate && (
                        <button
                          onClick={() => setReactivateModal({ schedule, action: 'reactivate' })}
                          className="p-2 hover:bg-[#FFF7ED] rounded-lg transition-colors group"
                          title="Réactiver ce voyage (remettre En cours)"
                        >
                          <RotateCcw className="w-4 h-4 text-[#EA580C] group-hover:text-[#C2410C]" />
                        </button>
                      )}
                      {canReterminate && (
                        <button
                          onClick={() => setReactivateModal({ schedule, action: 'reterminate' })}
                          className="p-2 hover:bg-[#F0FDF4] rounded-lg transition-colors group"
                          title="Terminer ce voyage"
                        >
                          <CheckCircle2 className="w-4 h-4 text-[#16A34A] group-hover:text-[#15803D]" />
                        </button>
                      )}
                      {/* History button for past schedules */}
                      {past && (
                        <button
                          onClick={() => loadHistory(schedule.id)}
                          className="p-2 hover:bg-[#F1F5F9] rounded-lg transition-colors"
                          title="Historique des modifications"
                        >
                          <History className="w-4 h-4 text-[#64748B]" />
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(schedule)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Modifier"
                      >
                        <Edit2 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                      </button>
                      <button
                        onClick={() => handleDelete(schedule.id)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filteredSchedules.length === 0 && (
          <div className="text-center py-12">
            <Calendar className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--neutral-400)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>
              {schedules.length === 0 ? 'Aucun horaire trouvé' : 'Aucun résultat pour ces filtres'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
