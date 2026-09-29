import { useEffect, useState } from 'react';
import { Monitor, Plus, Settings, Trash2, QrCode, Check, X, AlertTriangle, Ticket as TicketIcon, TrendingUp, Calendar } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import toast from 'react-hot-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  fetchKiosks, createKiosk, updateKiosk, deleteKiosk,
  fetchKioskTickets, fetchKioskRevenue,
  type DigitalKiosk, type KioskTicket,
} from '@/services/kiosk.service';
import { supabase } from '@/services/supabase';
import { useRealtimeSync } from '@/pages/agent-reservation/shared';

interface Station { id: string; name: string; }

export default function KioskDashboard() {
  const [kiosks, setKiosks] = useState<DigitalKiosk[]>([]);
  const [tickets, setTickets] = useState<KioskTicket[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [revenue, setRevenue] = useState({ totalRevenue: 0, totalTickets: 0, paidTickets: 0, pendingTickets: 0, todayRevenue: 0, todayTickets: 0 });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingKiosk, setEditingKiosk] = useState<DigitalKiosk | null>(null);
  const [showTickets, setShowTickets] = useState(false);
  const [qrKiosk, setQrKiosk] = useState<DigitalKiosk | null>(null);
  const [newKiosk, setNewKiosk] = useState({ name: '', station_id: '', kiosk_type: 'physical' as 'physical' | 'virtual_qr' });

  const load = () => {
    Promise.all([
      fetchKiosks(),
      fetchKioskTickets(),
      fetchKioskRevenue(),
      supabase.from('stations').select('id, name').eq('is_active', true).order('name'),
    ])
      .then(([k, t, r, s]) => {
        setKiosks(k);
        setTickets(t);
        setRevenue(r);
        setStations((s.data ?? []) as Station[]);
      })
      .catch((e) => { console.error(e); toast.error('Erreur lors du chargement'); })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useRealtimeSync(['digital_kiosks', 'kiosk_tickets'], load);

  const handleCreate = async () => {
    if (!newKiosk.name.trim()) { toast.error('Nom requis'); return; }
    try {
      await createKiosk({
        name: newKiosk.name.trim(),
        station_id: newKiosk.station_id || null,
        kiosk_type: newKiosk.kiosk_type,
      });
      toast.success('Borne créée');
      setShowCreate(false);
      setNewKiosk({ name: '', station_id: '', kiosk_type: 'physical' });
      load();
    } catch (e) {
      console.error(e);
      toast.error('Échec de la création');
    }
  };

  const handleToggleStatus = async (kiosk: DigitalKiosk) => {
    const nextStatus = kiosk.status === 'active' ? 'offline' : 'active';
    try {
      await updateKiosk(kiosk.id, { status: nextStatus, is_active: nextStatus === 'active' });
      toast.success(nextStatus === 'active' ? 'Borne activée' : 'Borne désactivée');
      load();
    } catch { toast.error('Échec'); }
  };

  const handleMarkDefective = async (kiosk: DigitalKiosk) => {
    const nextStatus = kiosk.status === 'defective' ? 'active' : 'defective';
    try {
      await updateKiosk(kiosk.id, { status: nextStatus });
      toast.success(nextStatus === 'defective' ? 'Borne marquée défectueuse' : 'Borne remise en service');
      load();
    } catch { toast.error('Échec'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette borne ?')) return;
    try {
      await deleteKiosk(id);
      toast.success('Borne supprimée');
      load();
    } catch { toast.error('Échec'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const statusBadge = (status: string) => {
    const styles: Record<string, { bg: string; text: string; label: string }> = {
      active: { bg: '#E7F6EC', text: '#0B7439', label: 'Active' },
      defective: { bg: '#FEF3C7', text: '#B45309', label: 'Défectueuse' },
      offline: { bg: '#FEE2E2', text: '#DC2626', label: 'Hors service' },
    };
    const s = styles[status] ?? styles.offline;
    return <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: s.bg, color: s.text }}>{s.label}</span>;
  };

  return (
    <div className="space-y-6 p-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2E22]">Gestion des bornes</h1>
          <p className="text-sm text-[#6B7280] mt-1">Bornes digitales de vente de tickets en gare</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white transition-colors"
          style={{ backgroundColor: '#0B7439' }}
        >
          <Plus className="w-4 h-4" /> Nouvelle borne
        </button>
      </div>

      {/* Revenue KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI icon={TrendingUp} label="Recettes totales" value={formatCurrency(revenue.totalRevenue)} color="#0B7439" />
        <KPI icon={TicketIcon} label="Tickets payés" value={String(revenue.paidTickets)} color="#0B7439" />
        <KPI icon={Calendar} label="Recettes du jour" value={formatCurrency(revenue.todayRevenue)} color="#0B86B8" />
        <KPI icon={AlertTriangle} label="En attente" value={String(revenue.pendingTickets)} color="#B45309" />
      </div>

      {/* Kiosks list */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2EAE5] flex items-center justify-between">
          <h2 className="font-semibold text-[#1A2E22]">Bornes ({kiosks.length})</h2>
          <button onClick={() => setShowTickets(true)} className="text-sm font-medium text-[#0B7439] hover:underline">
            Voir les tickets vendus ({tickets.length})
          </button>
        </div>
        {kiosks.length === 0 ? (
          <div className="p-12 text-center text-[#6B7280]">
            <Monitor className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>Aucune borne configurée. Cliquez sur « Nouvelle borne » pour commencer.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#E2EAE5]">
            {kiosks.map((kiosk) => (
              <div key={kiosk.id} className="flex items-center gap-4 px-6 py-4 hover:bg-[#F8FAF8] transition-colors">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: kiosk.kiosk_type === 'virtual_qr' ? '#E6F8FF' : '#E7F6EC' }}>
                  {kiosk.kiosk_type === 'virtual_qr' ? <QrCode className="w-5 h-5 text-[#0B86B8]" /> : <Monitor className="w-5 h-5 text-[#0B7439]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#1A2E22]">{kiosk.name}</span>
                    {statusBadge(kiosk.status)}
                  </div>
                  <div className="text-sm text-[#6B7280]">
                    {kiosk.station_name ?? 'Aucune gare'} • {kiosk.kiosk_type === 'virtual_qr' ? 'Borne virtuelle QR' : 'Borne physique'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingKiosk(kiosk)}
                    className="p-2 rounded-lg text-[#6B7280] hover:bg-[#E2EAE5] transition-colors"
                    title="Paramètres"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleMarkDefective(kiosk)}
                    className="p-2 rounded-lg text-[#B45309] hover:bg-[#FEF3C7] transition-colors"
                    title={kiosk.status === 'defective' ? 'Remettre en service' : 'Marquer défectueuse'}
                  >
                    <AlertTriangle className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggleStatus(kiosk)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${kiosk.status === 'active' ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}
                  >
                    {kiosk.status === 'active' ? 'Désactiver' : 'Activer'}
                  </button>
                  <button
                    onClick={() => handleDelete(kiosk.id)}
                    className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* QR code access links */}
      {kiosks.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6">
          <h2 className="font-semibold text-[#1A2E22] mb-4">Accès aux bornes</h2>
          <div className="space-y-2">
            {kiosks.filter(k => k.status === 'active').map((kiosk) => {
              const kioskUrl = kiosk.slug ? `${window.location.origin}/bornes/${kiosk.slug}` : `${window.location.origin}/bornes/terminal?id=${kiosk.id}`;
              return (
              <div key={kiosk.id} className="flex items-center justify-between rounded-xl border border-[#E2EAE5] p-3">
                <div className="flex items-center gap-3">
                  {kiosk.kiosk_type === 'virtual_qr' && (
                    <button onClick={() => setQrKiosk(kiosk)} className="p-2 rounded-lg hover:bg-[#F0F4F1] transition-colors" title="Afficher le QR code">
                      <QrCode className="w-5 h-5 text-[#0B7439]" />
                    </button>
                  )}
                  <div>
                    <span className="text-sm font-medium text-[#1A2E22] block">{kiosk.name}</span>
                    <span className="text-xs text-[#6B7280]">{kiosk.kiosk_type === 'virtual_qr' ? 'Borne virtuelle' : 'Borne physique'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-[#6B7280] bg-[#F8FAF8] px-2 py-1 rounded max-w-xs truncate">
                    {kioskUrl}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(kioskUrl); toast.success('Lien copié'); }}
                    className="text-xs font-medium text-[#0B7439] hover:underline"
                  >
                    Copier
                  </button>
                  <a
                    href={kiosk.slug ? `/bornes/${kiosk.slug}` : `/bornes/terminal?id=${kiosk.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-[#0B7439] hover:underline"
                  >
                    Ouvrir
                  </a>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* QR code modal for virtual kiosks */}
      {qrKiosk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setQrKiosk(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[#1A2E22]">QR Code — {qrKiosk.name}</h3>
            <p className="text-sm text-[#6B7280]">Scannez ce QR code avec un téléphone pour accéder à la borne virtuelle</p>
            <div className="p-4 bg-white rounded-xl border-2 border-[#E2EAE5]">
              <QRCodeCanvas
                value={`${window.location.origin}/bornes/${qrKiosk.slug ?? qrKiosk.id}`}
                size={256}
                level="M"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/bornes/${qrKiosk.slug ?? qrKiosk.id}`); toast.success('Lien copié'); }}
                className="px-5 py-2.5 rounded-xl font-semibold text-white"
                style={{ backgroundColor: '#0B7439' }}
              >
                Copier le lien
              </button>
              <button onClick={() => setQrKiosk(null)} className="px-5 py-2.5 rounded-xl border border-[#E2EAE5] font-semibold text-[#6B7280]">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="Nouvelle borne" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Nom de la borne</label>
              <input
                type="text"
                value={newKiosk.name}
                onChange={(e) => setNewKiosk((p) => ({ ...p, name: e.target.value }))}
                placeholder="ex: Borne Gare d'Abidjan 1"
                className="w-full border border-[#E2EAE5] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Gare</label>
              <select
                value={newKiosk.station_id}
                onChange={(e) => setNewKiosk((p) => ({ ...p, station_id: e.target.value }))}
                className="w-full border border-[#E2EAE5] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30 bg-white"
              >
                <option value="">Aucune gare</option>
                {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Type de borne</label>
              <div className="flex gap-2">
                {(['physical', 'virtual_qr'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewKiosk((p) => ({ ...p, kiosk_type: t }))}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors"
                    style={{
                      borderColor: newKiosk.kiosk_type === t ? '#0B7439' : '#E2EAE5',
                      backgroundColor: newKiosk.kiosk_type === t ? '#E7F6EC' : '#fff',
                      color: newKiosk.kiosk_type === t ? '#0B7439' : '#6B7280',
                    }}
                  >
                    {t === 'physical' ? 'Borne physique' : 'Borne virtuelle QR'}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleCreate}
              className="w-full py-3 rounded-xl font-semibold text-white"
              style={{ backgroundColor: '#0B7439' }}
            >
              Créer la borne
            </button>
          </div>
        </Modal>
      )}

      {/* Edit/Settings modal */}
      {editingKiosk && (
        <KioskSettingsModal kiosk={editingKiosk} stations={stations} onClose={() => setEditingKiosk(null)} onSaved={load} />
      )}

      {/* Tickets modal */}
      {showTickets && (
        <Modal title={`Tickets vendus (${tickets.length})`} onClose={() => setShowTickets(false)} wide>
          <div className="max-h-[60vh] overflow-y-auto">
            {tickets.length === 0 ? (
              <p className="text-center text-[#6B7280] py-8">Aucun ticket vendu pour le moment.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white border-b border-[#E2EAE5]">
                  <tr className="text-left text-[#6B7280]">
                    <th className="py-2 px-3 font-medium">Référence</th>
                    <th className="py-2 px-3 font-medium">Borne</th>
                    <th className="py-2 px-3 font-medium">Sièges</th>
                    <th className="py-2 px-3 font-medium">Montant</th>
                    <th className="py-2 px-3 font-medium">Statut</th>
                    <th className="py-2 px-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F4F1]">
                  {tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-[#F8FAF8]">
                      <td className="py-2 px-3 font-mono font-semibold text-[#1A2E22]">{t.ticket_ref}</td>
                      <td className="py-2 px-3 text-[#6B7280]">{t.kiosk_name ?? '—'}</td>
                      <td className="py-2 px-3 text-[#6B7280]">{t.seat_numbers.join(', ') || '—'}</td>
                      <td className="py-2 px-3 font-bold text-[#1A2E22]">{formatCurrency(t.total_amount)}</td>
                      <td className="py-2 px-3">
                        {t.payment_status === 'paid' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#E7F6EC] text-[#0B7439]">Payé</span>}
                        {t.payment_status === 'pending' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#FEF3C7] text-[#B45309]">En attente</span>}
                        {t.payment_status === 'failed' && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[#FEE2E2] text-[#DC2626]">Échoué</span>}
                      </td>
                      <td className="py-2 px-3 text-[#6B7280] text-xs">{new Date(t.created_at).toLocaleString('fr-FR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function KPI({ icon: Icon, label, value, color }: { icon: typeof TrendingUp; label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2EAE5] p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}15` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <span className="text-sm text-[#6B7280]">{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full p-6" style={{ maxWidth: wide ? '900px' : '500px' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[#1A2E22]">{title}</h3>
          <button onClick={onClose} className="text-[#6B7280] hover:text-[#1A2E22]"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function KioskSettingsModal({ kiosk, stations, onClose, onSaved }: {
  kiosk: DigitalKiosk;
  stations: Station[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: kiosk.name,
    station_id: kiosk.station_id ?? '',
    welcome_text: kiosk.welcome_text,
    primary_color: kiosk.primary_color,
    secondary_color: kiosk.secondary_color,
    logo_url: kiosk.logo_url ?? '',
    background_image_url: kiosk.background_image_url ?? '',
    idle_timeout_seconds: kiosk.idle_timeout_seconds,
    payment_confirmation_mode: kiosk.payment_confirmation_mode,
    ticket_sale: kiosk.services?.ticket_sale ?? true,
    info: kiosk.services?.info ?? true,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateKiosk(kiosk.id, {
        name: form.name,
        station_id: form.station_id || null,
        welcome_text: form.welcome_text,
        primary_color: form.primary_color,
        secondary_color: form.secondary_color,
        logo_url: form.logo_url || null,
        background_image_url: form.background_image_url || null,
        idle_timeout_seconds: form.idle_timeout_seconds,
        payment_confirmation_mode: form.payment_confirmation_mode,
        services: { ticket_sale: form.ticket_sale, info: form.info },
      });
      toast.success('Paramètres enregistrés');
      onSaved();
      onClose();
    } catch { toast.error('Échec'); }
    finally { setSaving(false); }
  };

  const inputCls = 'w-full border border-[#E2EAE5] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30';
  const selectCls = `${inputCls} bg-white`;

  return (
    <Modal title={`Paramètres — ${kiosk.name}`} onClose={onClose}>
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Nom</label>
          <input className={inputCls} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Gare</label>
          <select className={selectCls} value={form.station_id} onChange={(e) => setForm((p) => ({ ...p, station_id: e.target.value }))}>
            <option value="">Aucune gare</option>
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Texte d'accueil</label>
          <input className={inputCls} value={form.welcome_text} onChange={(e) => setForm((p) => ({ ...p, welcome_text: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Couleur principale</label>
            <div className="flex gap-2">
              <input type="color" value={form.primary_color} onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))} className="w-12 h-10 rounded-lg border border-[#E2EAE5]" />
              <input className={inputCls} value={form.primary_color} onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Couleur secondaire</label>
            <div className="flex gap-2">
              <input type="color" value={form.secondary_color} onChange={(e) => setForm((p) => ({ ...p, secondary_color: e.target.value }))} className="w-12 h-10 rounded-lg border border-[#E2EAE5]" />
              <input className={inputCls} value={form.secondary_color} onChange={(e) => setForm((p) => ({ ...p, secondary_color: e.target.value }))} />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">URL du logo</label>
          <input className={inputCls} value={form.logo_url} onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))} placeholder="https://..." />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">URL image de fond</label>
          <input className={inputCls} value={form.background_image_url} onChange={(e) => setForm((p) => ({ ...p, background_image_url: e.target.value }))} placeholder="https://..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Timeout inactivité (secondes)</label>
            <input type="number" min={10} max={600} className={inputCls} value={form.idle_timeout_seconds} onChange={(e) => setForm((p) => ({ ...p, idle_timeout_seconds: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Mode de confirmation</label>
            <select className={selectCls} value={form.payment_confirmation_mode} onChange={(e) => setForm((p) => ({ ...p, payment_confirmation_mode: e.target.value as 'wave_api' | 'manual' }))}>
              <option value="wave_api">Wave API (automatique)</option>
              <option value="manual">Manuel (validation agent)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-2">Services activés</label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.ticket_sale} onChange={(e) => setForm((p) => ({ ...p, ticket_sale: e.target.checked }))} className="w-4 h-4 rounded accent-[#0B7439]" />
              <span className="text-sm text-[#1A2E22]">Achat de billet</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={form.info} onChange={(e) => setForm((p) => ({ ...p, info: e.target.checked }))} className="w-4 h-4 rounded accent-[#0B7439]" />
              <span className="text-sm text-[#1A2E22]">Informations</span>
            </label>
          </div>
        </div>
        <button onClick={save} disabled={saving} className="w-full py-3 rounded-xl font-semibold text-white disabled:opacity-60" style={{ backgroundColor: '#0B7439' }}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </Modal>
  );
}
