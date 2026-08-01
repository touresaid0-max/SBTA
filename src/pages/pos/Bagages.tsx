import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { getDepartById, type DepartRecord } from '@/services/pos/departService';
import { getStations, type StationRef } from '@/services/pos/ticketService';
import {
  registerBagage, getBagagesForDepart, findTicketByNumber,
  type BagageRecord,
} from '@/services/pos/bagageService';
import { PrintService } from '@/services/pos/printService';
import { formatCurrency } from '@/utils/formatCurrency';
import {
  AlertCircle, CheckCircle, Loader2, Plus, Lock,
  Package, Link2, Search,
  Ticket as TicketIcon,
} from 'lucide-react';

export default function POSBagages() {
  const { id: departId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = usePOSSession();

  const [depart, setDepart] = useState<DepartRecord | null>(null);
  const [bagages, setBagages] = useState<BagageRecord[]>([]);
  const [stations, setStations] = useState<StationRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [withTicket, setWithTicket] = useState(false);
  const [withTicketReport, setWithTicketReport] = useState(false);
  const [ticketNumber, setTicketNumber] = useState('');
  const [linkedTicketInfo, setLinkedTicketInfo] = useState<string | null>(null);
  const [price, setPrice] = useState(0);
  const [destination, setDestination] = useState('');
  const [description, setDescription] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [printBagage, setPrintBagage] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!departId) return;
    try {
      const d = await getDepartById(departId);
      if (!d) {
        setError('Départ introuvable');
        setLoading(false);
        return;
      }
      setDepart(d);
      const [b, s] = await Promise.all([
        getBagagesForDepart(departId),
        getStations(),
      ]);
      setBagages(b);
      setStations(s);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [departId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const bagageTotal = useMemo(() => {
    return bagages.reduce((sum, b) => sum + b.price, 0);
  }, [bagages]);

  const handleFindTicket = async () => {
    if (!departId || !ticketNumber) return;
    setError('');
    const ticket = await findTicketByNumber(departId, ticketNumber.trim());
    if (ticket) {
      setLinkedTicketInfo(`Ticket ${ticket.ticket_number} — Siège ${ticket.seat_number} — ${ticket.destination} — ${formatCurrency(ticket.price)}`);
      setDestination(ticket.destination_id ?? '');
      setOwnerName(ticket.passenger_name || ownerName);
      setOwnerPhone(ticket.passenger_phone || ownerPhone);
    } else {
      setLinkedTicketInfo(null);
      setError('Aucun ticket trouvé avec ce numéro pour ce départ');
    }
  };

  const handleSubmit = async () => {
    if (!depart || !departId) return;
    if (depart.cloture) {
      setError('Ce départ est clôturé — bagage impossible');
      return;
    }
    setError('');
    setSuccess('');

    if (withTicket && !ticketNumber.trim()) {
      setError('Veuillez saisir le numéro du ticket lié');
      return;
    }
    if (price <= 0) {
      setError('Veuillez saisir un prix valide');
      return;
    }
    if (!destination) {
      setError('Veuillez sélectionner une destination');
      return;
    }

    setSaving(true);
    try {
      const station = stations.find(s => s.id === destination);
      const bagage = await registerBagage({
        departId,
        withTicket,
        withTicketReport,
        ticketNumber: ticketNumber.trim() || undefined,
        price,
        destination: station?.name ?? destination,
        description,
        ownerName,
        ownerPhone,
        printBagage,
      });

      if (printBagage && depart) {
        PrintService.printBagage({ bagage, depart, stationName: session?.station_name });
      }

      // Refresh
      const [b, updatedDepart] = await Promise.all([
        getBagagesForDepart(departId),
        getDepartById(departId),
      ]);
      setBagages(b);
      if (updatedDepart) setDepart(updatedDepart);

      setSuccess(`Bagage enregistré — ${bagage.bagage_number}`);

      // Reset form
      setWithTicket(false);
      setWithTicketReport(false);
      setTicketNumber('');
      setLinkedTicketInfo(null);
      setPrice(0);
      setDestination('');
      setDescription('');
      setOwnerName('');
      setOwnerPhone('');
      setPrintBagage(true);

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de l\'enregistrement du bagage');
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = 'block text-xs font-bold mb-1';
  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

  if (loading) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Bagages">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  if (!depart) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Bagages">
        <div className="text-center py-20">
          <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--danger)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>{error || 'Départ introuvable'}</p>
          <button onClick={() => navigate('/guichet/departs')} className="mt-4 px-4 py-2 rounded-lg font-bold text-white" style={{ backgroundColor: 'var(--primary)' }}>
            Retour aux départs
          </button>
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute={`Bagages — Départ #${depart.route_number} (${depart.route_name ?? ''})`}>
      <div className="max-w-5xl mx-auto">
        {/* Cloture warning banner */}
        {depart.cloture && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-bold" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <Lock className="w-4 h-4" /> Ce départ est clôturé — bagages verrouillés
          </div>
        )}

        {/* Departure header */}
        <div className="rounded-xl p-3 mb-4 flex items-center justify-between" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-4 text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Départ #{depart.route_number}</span>
            <span style={{ color: 'var(--text-secondary)' }}>·</span>
            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{depart.route_name}</span>
            <span style={{ color: 'var(--text-secondary)' }}>·</span>
            <span style={{ color: 'var(--text-secondary)' }}>{depart.bus_plate}</span>
          </div>
          <div className="text-sm">
            <span className="font-bold" style={{ color: 'var(--text-muted)' }}>MT Bagage: </span>
            <span className="font-bold" style={{ color: 'var(--success)' }}>{formatCurrency(depart.mt_bagage)}</span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-start gap-2 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2 text-sm font-medium" style={{ backgroundColor: 'var(--success-light)', color: 'var(--success)' }}>
            <CheckCircle className="w-4 h-4" /> {success}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Bagage list */}
          <div className="lg:col-span-1 order-2 lg:order-1">
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--surface-raised)' }}>
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Package className="w-4 h-4" /> Bagages enregistrés
                </h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {bagages.length === 0 ? (
                  <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>Aucun bagage enregistré</p>
                ) : (
                  <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-muted)' }}>
                        <th className="px-2 py-1.5 text-xs font-bold text-left">N°Bagage</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-left">Destination</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-right">Prix</th>
                        <th className="px-2 py-1.5 text-xs font-bold text-center">Ticket</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bagages.map(b => (
                        <tr key={b.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-2 py-2 text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{b.bagage_number}</td>
                          <td className="px-2 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.destination}</td>
                          <td className="px-2 py-2 text-xs text-right" style={{ color: 'var(--text-primary)' }}>{formatCurrency(b.price)}</td>
                          <td className="px-2 py-2 text-xs text-center">
                            {b.with_ticket ? <Link2 className="w-3 h-3 mx-auto" style={{ color: 'var(--info)' }} /> : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td className="px-2 py-2 text-xs font-bold" colSpan={2} style={{ color: 'var(--text-primary)' }}>Somme</td>
                        <td className="px-2 py-2 text-xs text-right font-bold" style={{ color: 'var(--success)' }}>{formatCurrency(bagageTotal)}</td>
                        <td className="px-2 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Right: Form */}
          <div className="lg:col-span-2 order-1 lg:order-2">
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Nouveau Bagage</h3>

              {/* Checkboxes row */}
              <div className="flex flex-wrap gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={withTicket} onChange={e => { setWithTicket(e.target.checked); if (!e.target.checked) { setTicketNumber(''); setLinkedTicketInfo(null); } }} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Avec ticket</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={withTicketReport} onChange={e => setWithTicketReport(e.target.checked)} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Avec ticket report</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={printBagage} onChange={e => setPrintBagage(e.target.checked)} className="w-4 h-4" style={{ accentColor: 'var(--primary)' }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Imprimer ticket bagage</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Ticket number (conditional) */}
                {withTicket && (
                  <div className="col-span-2">
                    <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Numéro ticket</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={ticketNumber}
                          onChange={e => { setTicketNumber(e.target.value); setLinkedTicketInfo(null); }}
                          className={fieldInput}
                          style={fieldStyle}
                          placeholder="Ex: 0108202600001-1"
                        />
                        <TicketIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                      </div>
                      <button
                        onClick={handleFindTicket}
                        disabled={!ticketNumber.trim()}
                        className="px-4 rounded-lg font-bold text-white text-sm disabled:opacity-60 flex items-center gap-1.5"
                        style={{ backgroundColor: 'var(--primary)' }}
                      >
                        <Search className="w-4 h-4" /> OK
                      </button>
                    </div>
                    {linkedTicketInfo && (
                      <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--info)' }}>
                        <CheckCircle className="w-3 h-3" /> {linkedTicketInfo}
                      </p>
                    )}
                  </div>
                )}

                {/* Prix */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Prix</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      value={price || ''}
                      onChange={e => setPrice(parseInt(e.target.value) || 0)}
                      className={fieldInput}
                      style={fieldStyle}
                      placeholder="0"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>FCFA</span>
                  </div>
                </div>

                {/* N° Bagage (auto, read-only) */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>N° Bagage (auto)</label>
                  <input
                    type="text"
                    value="Auto-généré"
                    disabled
                    className={fieldInput}
                    style={{ ...fieldStyle, opacity: 0.6 }}
                  />
                </div>

                {/* Destination */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Destination</label>
                  <select
                    value={destination}
                    onChange={e => setDestination(e.target.value)}
                    className={fieldInput}
                    style={fieldStyle}
                  >
                    <option value="">Sélectionner...</option>
                    {stations
                      .filter(s => s.id !== depart.station_id)
                      .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                {/* Car (auto from depart) */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Car</label>
                  <input
                    type="text"
                    value={depart.bus_plate ?? ''}
                    disabled
                    className={fieldInput}
                    style={{ ...fieldStyle, opacity: 0.6 }}
                  />
                </div>

                {/* Description */}
                <div className="col-span-2">
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Description</label>
                  <input
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className={fieldInput}
                    style={fieldStyle}
                    placeholder="Description du bagage..."
                  />
                </div>

                {/* Nom et prénoms */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Nom et prénoms</label>
                  <input
                    type="text"
                    value={ownerName}
                    onChange={e => setOwnerName(e.target.value)}
                    className={fieldInput}
                    style={fieldStyle}
                    placeholder="Nom du propriétaire"
                  />
                </div>

                {/* Contact */}
                <div>
                  <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Contact</label>
                  <input
                    type="tel"
                    value={ownerPhone}
                    onChange={e => setOwnerPhone(e.target.value)}
                    className={fieldInput}
                    style={fieldStyle}
                    placeholder="Téléphone"
                  />
                </div>
              </div>

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={saving || price <= 0 || !destination || depart.cloture}
                className="w-full mt-4 py-3.5 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2 transition-opacity"
                style={{ backgroundColor: 'var(--primary)' }}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                Enregistrer le bagage
              </button>
            </div>
          </div>
        </div>
      </div>
    </POSLayout>
  );
}
