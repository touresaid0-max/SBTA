import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import { Luggage, Plus, X, RefreshCw, User, Mail, Phone } from 'lucide-react';

interface HandlerUser {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

interface AssignmentRow {
  id: string;
  handler_id: string;
  handler?: HandlerUser;
}

function displayName(h?: HandlerUser | null): string {
  if (!h) return '—';
  return (
    h.full_name ||
    `${h.first_name ?? ''} ${h.last_name ?? ''}`.trim() ||
    h.email ||
    '—'
  );
}

export default function ChefGareBaggageHandlers() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stationId, setStationId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [allHandlers, setAllHandlers] = useState<HandlerUser[]>([]);
  const [selectedId, setSelectedId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sid, error: sidErr } = await supabase.rpc('get_my_station_id');
      if (sidErr) throw sidErr;
      if (!sid) {
        toast.error('Impossible de récupérer votre gare');
        return;
      }
      setStationId(sid);

      const [assignRes, handlersRes] = await Promise.all([
        supabase
          .from('station_baggage_handlers')
          .select('id, handler_id, handler:handler_id(id, full_name, first_name, last_name, email, phone)')
          .eq('station_id', sid)
          .order('created_at', { ascending: true }),
        supabase
          .from('users')
          .select('id, full_name, first_name, last_name, email, phone')
          .eq('role', 'bagagiste')
          .eq('is_active', true)
          .order('full_name'),
      ]);

      if (assignRes.error) throw assignRes.error;
      if (handlersRes.error) throw handlersRes.error;

      setAssignments((assignRes.data as any) || []);
      setAllHandlers((handlersRes.data as any) || []);
    } catch (err: any) {
      toast.error(err.message || 'Erreur de chargement');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const assignedIds = new Set(assignments.map(a => a.handler_id));
  const available = allHandlers.filter(h => !assignedIds.has(h.id));

  const handleAdd = async () => {
    if (!selectedId || !stationId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('station_baggage_handlers')
        .insert([{ station_id: stationId, handler_id: selectedId }]);
      if (error) throw error;
      toast.success('Bagagiste affecté');
      setSelectedId('');
      await load();
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'affectation");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (rowId: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('station_baggage_handlers')
        .delete()
        .eq('id', rowId);
      if (error) throw error;
      toast.success('Bagagiste retiré');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors du retrait');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div
          className="w-8 h-8 border-4 rounded-full animate-spin"
          style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Bagagistes de la gare
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Affectez un ou plusieurs bagagistes à votre gare
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw className="w-4 h-4" /> Rafraîchir
        </button>
      </div>

      <div
        className="rounded-2xl border shadow-sm p-6 mb-8"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
          Affecter un bagagiste
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            disabled={available.length === 0 || saving}
            className="flex-1 px-4 py-2.5 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
          >
            <option value="">
              {available.length === 0 ? 'Aucun bagagiste disponible' : 'Sélectionner un bagagiste…'}
            </option>
            {available.map(h => (
              <option key={h.id} value={h.id}>
                {displayName(h)}
                {h.email ? ` — ${h.email}` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!selectedId || saving}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            <Plus className="w-4 h-4" /> Affecter
          </button>
        </div>
      </div>

      <div
        className="rounded-2xl border shadow-sm overflow-hidden"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <Luggage className="w-5 h-5" style={{ color: 'var(--primary)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Bagagistes affectés ({assignments.length})
          </h2>
        </div>

        {assignments.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Luggage className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Aucun bagagiste affecté à cette gare pour le moment.
            </p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {assignments.map(a => (
              <li key={a.id} className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'var(--primary)18', color: 'var(--primary)' }}
                  >
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {displayName(a.handler)}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-0.5">
                      {a.handler?.email && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <Mail className="w-3 h-3" /> {a.handler.email}
                        </span>
                      )}
                      {a.handler?.phone && (
                        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                          <Phone className="w-3 h-3" /> {a.handler.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(a.id)}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium disabled:opacity-50"
                  style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
                >
                  <X className="w-4 h-4" /> Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
