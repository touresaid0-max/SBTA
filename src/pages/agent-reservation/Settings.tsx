import { useEffect, useState } from 'react';
import { Save, Wallet, Info, Waves, Copy, Check, Eye, EyeOff, Route as RouteIcon, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrency } from '@/utils/formatCurrency';
import { supabase } from '@/services/supabase';
import {
  fetchServiceFee, updateServiceFee,
  fetchWaveSettings, updateWaveSettings, type WaveSettings,
  fetchRouteFees, upsertRouteFee, deleteRouteFee, type RouteFee,
} from '@/services/agentReservation.service';
import { useRealtimeSync } from './shared';

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wave-webhook`;

interface City {
  id: string;
  name: string;
}

export default function Settings() {
  const [fee, setFee] = useState<number>(300);
  const [wave, setWave] = useState<WaveSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingWave, setSavingWave] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [copied, setCopied] = useState(false);

  const [routeFees, setRouteFees] = useState<RouteFee[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [newRoute, setNewRoute] = useState({ origin: '', destination: '', fee: 1000 });
  const [savingRoute, setSavingRoute] = useState(false);

  const load = () => {
    Promise.all([
      fetchServiceFee(),
      fetchWaveSettings(),
      fetchRouteFees(),
      supabase.from('cities').select('id, name').eq('is_active', true).order('name'),
    ])
      .then(([f, w, rf, c]) => {
        setFee(f);
        setWave(w);
        setRouteFees(rf);
        setCities((c.data ?? []) as City[]);
      })
      .catch((e) => { console.error(e); toast.error('Erreur lors du chargement des paramètres'); })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useRealtimeSync(['mobile_app_settings', 'wave_settings', 'mobile_route_fees'], load);

  const save = async () => {
    if (fee < 0 || isNaN(fee)) { toast.error('Montant invalide'); return; }
    setSaving(true);
    try {
      await updateServiceFee(fee);
      toast.success('Frais de service mis à jour');
    } catch (e) {
      console.error(e);
      toast.error('Échec de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  const saveWave = async () => {
    if (!wave) return;
    if (wave.is_active && (!wave.api_key.trim() || !wave.signing_secret.trim())) {
      toast.error('Clé API et secret de signature requis pour activer Wave');
      return;
    }
    setSavingWave(true);
    try {
      await updateWaveSettings({ ...wave, webhook_url: WEBHOOK_URL });
      toast.success('Paramètres Wave enregistrés');
    } catch (e) {
      console.error(e);
      toast.error('Échec de l\'enregistrement Wave');
    } finally {
      setSavingWave(false);
    }
  };

  const copyWebhook = async () => {
    await navigator.clipboard?.writeText(WEBHOOK_URL).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const setW = (patch: Partial<WaveSettings>) => setWave((prev) => prev ? { ...prev, ...patch } : prev);

  const addRouteFee = async () => {
    if (!newRoute.origin || !newRoute.destination) {
      toast.error('Sélectionnez les villes de départ et d\'arrivée');
      return;
    }
    if (newRoute.origin === newRoute.destination) {
      toast.error('Les villes doivent être différentes');
      return;
    }
    if (newRoute.fee < 0 || isNaN(newRoute.fee)) {
      toast.error('Montant invalide');
      return;
    }
    setSavingRoute(true);
    try {
      await upsertRouteFee({
        origin_city_id: newRoute.origin,
        destination_city_id: newRoute.destination,
        service_fee: newRoute.fee,
        is_active: true,
      });
      toast.success('Frais par trajet ajouté');
      setNewRoute({ origin: '', destination: '', fee: 1000 });
      load();
    } catch (e) {
      console.error(e);
      toast.error('Échec de l\'ajout');
    } finally {
      setSavingRoute(false);
    }
  };

  const updateRouteFeeAmount = async (id: string, amount: number) => {
    const rf = routeFees.find((r) => r.id === id);
    if (!rf) return;
    try {
      await upsertRouteFee({
        origin_city_id: rf.origin_city_id,
        destination_city_id: rf.destination_city_id,
        service_fee: amount,
        is_active: rf.is_active,
      });
      setRouteFees((prev) => prev.map((r) => r.id === id ? { ...r, service_fee: amount } : r));
    } catch (e) {
      console.error(e);
      toast.error('Échec de la mise à jour');
    }
  };

  const removeRouteFee = async (id: string) => {
    try {
      await deleteRouteFee(id);
      toast.success('Frais supprimé');
      setRouteFees((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error(e);
      toast.error('Échec de la suppression');
    }
  };

  if (loading || !wave) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-4 border-[#0B7439] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const samplePrice = 5000;
  const inputCls = 'w-full border border-[#E2EAE5] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30';
  const selectCls = 'w-full border border-[#E2EAE5] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30 bg-white';

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Paramètres de réservation</h1>
        <p className="text-sm text-[#6B7280] mt-1">Frais de service et configuration du paiement Wave</p>
      </div>

      {/* Frais de service */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#E7F6EC] flex items-center justify-center flex-shrink-0">
            <Wallet className="w-6 h-6 text-[#0B7439]" />
          </div>
          <div>
            <h2 className="font-semibold text-[#1A2E22]">Frais de service par défaut</h2>
            <p className="text-sm text-[#6B7280]">Frais de base appliqué aux lignes non configurées ci-dessous (+1000 F automatiquement)</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Montant des frais par défaut (FCFA)</label>
          <input type="number" min={0} step={50} value={fee}
            onChange={(e) => setFee(Number(e.target.value))} className={inputCls} />
        </div>

        <div className="rounded-xl bg-[#F8FAF8] border border-[#E2EAE5] p-4 flex gap-3">
          <Info className="w-4 h-4 text-[#0B7439] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[#4A6B55] space-y-1">
            <p className="font-medium text-[#1A2E22]">Impact sur le paiement mobile</p>
            <p>Prix du billet : <span className="font-medium">{formatCurrency(samplePrice)}</span></p>
            <p>Frais de service (ligne non configurée) : <span className="font-medium">{formatCurrency(fee + 1000)}</span></p>
            <p className="pt-1 border-t border-[#E2EAE5] text-[#0B7439] font-semibold">
              Total à payer : {formatCurrency(samplePrice + fee + 1000)}
            </p>
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
          style={{ backgroundColor: '#0B7439' }}>
          <Save className="w-4 h-4" /> {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>

      {/* Frais de service par trajet */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#E7F6EC] flex items-center justify-center flex-shrink-0">
            <RouteIcon className="w-6 h-6 text-[#0B7439]" />
          </div>
          <div>
            <h2 className="font-semibold text-[#1A2E22]">Frais de service par trajet</h2>
            <p className="text-sm text-[#6B7280]">Frais spécifiques appliqués automatiquement selon la ligne sélectionnée</p>
          </div>
        </div>

        {routeFees.length > 0 && (
          <div className="space-y-2">
            {routeFees.map((rf) => (
              <div key={rf.id} className="flex items-center gap-3 rounded-xl border border-[#E2EAE5] p-3">
                <div className="flex-1 text-sm font-medium text-[#1A2E22]">
                  {rf.origin_city_name} → {rf.destination_city_name}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={rf.service_fee}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setRouteFees((prev) => prev.map((r) => r.id === rf.id ? { ...r, service_fee: val } : r));
                    }}
                    onBlur={(e) => updateRouteFeeAmount(rf.id, Number(e.target.value))}
                    className="w-28 border border-[#E2EAE5] rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
                  />
                  <span className="text-xs text-[#6B7280]">FCFA</span>
                  <button
                    onClick={() => removeRouteFee(rf.id)}
                    className="flex-shrink-0 p-1.5 rounded-lg text-[#B45309] hover:bg-[#FEF3C7] transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {routeFees.length === 0 && (
          <p className="text-sm text-[#6B7280] italic">Aucun frais par trajet configuré. Toutes les lignes utilisent le frais par défaut + 1000 F.</p>
        )}

        <div className="border-t border-[#E2EAE5] pt-4 space-y-3">
          <p className="text-sm font-medium text-[#1A2E22]">Ajouter un frais pour un trajet</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={newRoute.origin} onChange={(e) => setNewRoute((p) => ({ ...p, origin: e.target.value }))} className={selectCls}>
              <option value="">Ville de départ</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={newRoute.destination} onChange={(e) => setNewRoute((p) => ({ ...p, destination: e.target.value }))} className={selectCls}>
              <option value="">Ville d'arrivée</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={50}
                value={newRoute.fee}
                onChange={(e) => setNewRoute((p) => ({ ...p, fee: Number(e.target.value) }))}
                className="w-full border border-[#E2EAE5] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0B7439]/30"
                placeholder="Frais (FCFA)"
              />
              <span className="text-xs text-[#6B7280] whitespace-nowrap">FCFA</span>
            </div>
          </div>
          <button onClick={addRouteFee} disabled={savingRoute}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white text-sm transition-colors disabled:opacity-60"
            style={{ backgroundColor: '#0B7439' }}>
            <Plus className="w-4 h-4" /> {savingRoute ? 'Ajout...' : 'Ajouter'}
          </button>
        </div>

        <div className="rounded-xl bg-[#F8FAF8] border border-[#E2EAE5] p-4 flex gap-3">
          <Info className="w-4 h-4 text-[#0B7439] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[#4A6B55] space-y-1">
            <p className="font-medium text-[#1A2E22]">Règles d'application</p>
            <p>• Les trajets configurés ci-dessus utilisent le montant indiqué.</p>
            <p>• Toutes les autres lignes : frais par défaut + 1000 FCFA automatiquement.</p>
            <p>• Le prix du billet de transport n'est jamais modifié.</p>
          </div>
        </div>
      </div>

      {/* Configuration Wave */}
      <div className="bg-white rounded-2xl border border-[#E2EAE5] p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#E6F8FF' }}>
            <Waves className="w-6 h-6" style={{ color: '#1DC4FF' }} />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-[#1A2E22]">Paiement Wave</h2>
            <p className="text-sm text-[#6B7280]">Clés API, webhook et activation du paiement Wave en ligne</p>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <span className="text-sm font-medium text-[#1A2E22]">{wave.is_active ? 'Actif' : 'Inactif'}</span>
            <button type="button" onClick={() => setW({ is_active: !wave.is_active })}
              className="relative w-11 h-6 rounded-full transition-colors"
              style={{ backgroundColor: wave.is_active ? '#0B7439' : '#CBD5D0' }}>
              <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform"
                style={{ transform: wave.is_active ? 'translateX(20px)' : 'translateX(0)' }} />
            </button>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Mode</label>
          <div className="flex gap-2">
            {(['test', 'production'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setW({ mode: m })}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors"
                style={{
                  borderColor: wave.mode === m ? '#0B7439' : '#E2EAE5',
                  backgroundColor: wave.mode === m ? '#E7F6EC' : '#fff',
                  color: wave.mode === m ? '#0B7439' : '#6B7280',
                }}>
                {m === 'test' ? 'Test' : 'Production'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-[#1A2E22]">Clé API Wave</label>
            <button type="button" onClick={() => setShowSecrets((s) => !s)}
              className="inline-flex items-center gap-1 text-xs text-[#6B7280] hover:text-[#1A2E22]">
              {showSecrets ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showSecrets ? 'Masquer' : 'Afficher'}
            </button>
          </div>
          <input type={showSecrets ? 'text' : 'password'} value={wave.api_key} autoComplete="off"
            onChange={(e) => setW({ api_key: e.target.value })} placeholder="wave_ci_prod_..." className={inputCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Secret de signature API (requête)</label>
          <input type={showSecrets ? 'text' : 'password'} value={wave.api_secret} autoComplete="off"
            onChange={(e) => setW({ api_secret: e.target.value })} placeholder="wave_ci_AKS_..." className={inputCls} />
          <p className="text-xs text-[#6B7280] mt-1.5">
            Requis si la signature de requête est activée sur la clé API (préfixe AKS). Utilisé pour signer les appels de paiement.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">Secret de signature (webhook)</label>
          <input type={showSecrets ? 'text' : 'password'} value={wave.signing_secret} autoComplete="off"
            onChange={(e) => setW({ signing_secret: e.target.value })} placeholder="wave_sn_..." className={inputCls} />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-1.5">URL Webhook</label>
          <div className="flex items-center gap-2">
            <input type="text" value={WEBHOOK_URL} readOnly className={`${inputCls} bg-[#F8FAF8] text-[#4A6B55]`} />
            <button type="button" onClick={copyWebhook}
              className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-2.5 rounded-xl border border-[#E2EAE5] text-sm font-medium text-[#4A6B55] hover:bg-[#F8FAF8]">
              {copied ? <Check className="w-4 h-4 text-[#0B7439]" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
          </div>
          <p className="text-xs text-[#6B7280] mt-1.5">
            À renseigner dans le portail développeur Wave (stratégie SIGNING_SECRET).
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1A2E22] mb-2">API activées</label>
          <div className="space-y-2">
            {([
              { key: 'checkout_enabled', label: 'Checkout API', required: true },
              { key: 'balance_enabled', label: 'Balance API', required: false },
              { key: 'payout_enabled', label: 'Payout API', required: false },
            ] as const).map((api) => (
              <label key={api.key} className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={wave[api.key]}
                  onChange={(e) => setW({ [api.key]: e.target.checked } as Partial<WaveSettings>)}
                  className="w-4 h-4 rounded accent-[#0B7439]" />
                <span className="text-sm text-[#1A2E22]">{api.label}</span>
                {api.required && <span className="text-xs text-[#B45309]">(requis)</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-[#E6F8FF] border border-[#BEE9FB] p-4 flex gap-3">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#0B86B8' }} />
          <p className="text-sm" style={{ color: '#0B6B92' }}>
            Événements à activer côté Wave : <span className="font-medium">checkout.session.completed</span>,
            <span className="font-medium"> checkout.session.payment_failed</span>,
            <span className="font-medium"> merchant.payment_received</span>.
          </p>
        </div>

        <button onClick={saveWave} disabled={savingWave}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white transition-colors disabled:opacity-60"
          style={{ backgroundColor: '#0B7439' }}>
          <Save className="w-4 h-4" /> {savingWave ? 'Enregistrement...' : 'Enregistrer Wave'}
        </button>
      </div>
    </div>
  );
}
