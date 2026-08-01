import { useState, useEffect, useCallback } from 'react';
import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import { getPrintSettings, savePrintSettings, PrintService } from '@/services/pos/printService';
import type { PrintSettings, PrintBackend } from '@/services/pos/db';
import {
  Printer, Usb, Wifi, Monitor, Save, CheckCircle, Loader2,
  Plus, Trash2, AlertCircle, Cable,
} from 'lucide-react';

const BACKENDS: { value: PrintBackend; label: string; icon: typeof Printer; desc: string }[] = [
  { value: 'webserial', label: 'Web Serial (USB-Serial)', icon: Cable, desc: 'Imprimante thermique connectée en USB-Série (ESC/POS)' },
  { value: 'webusb', label: 'WebUSB', icon: Usb, desc: 'Imprimante USB directe (ESC/POS)' },
  { value: 'qztray', label: 'QZ Tray (agent local)', icon: Wifi, desc: 'Agent local QZ Tray via WebSocket' },
  { value: 'browser', label: 'Navigateur (kiosque)', icon: Monitor, desc: 'Impression navigateur en mode kiosque (--kiosk-printing)' },
];

export default function POSParametres() {
  const { session } = usePOSSession();
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const s = await getPrintSettings();
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      await savePrintSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    if (!settings) return;
    setTesting(true);
    setTestResult(null);
    try {
      await savePrintSettings(settings);
      const ok = await PrintService.printTicket({
        ticket: {
          id: 'test',
          depart_id: 'test',
          ticket_number: '01082026TEST0-1',
          seat_number: 1,
          seat_numbers: ['1'],
          destination: 'Bouaké',
          destination_id: 'test',
          passenger_name: 'Test',
          passenger_phone: '',
          price: 5000,
          original_price: 5000,
          is_reduced: false,
          is_reported: false,
          is_ac: true,
          print_ticket: true,
          payment_method: 'cash',
          status: 'sold',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        depart: {
          id: 'test',
          departure_number: 1,
          route_id: 'test',
          route_name: 'Abidjan - Bouaké',
          route_number: 1,
          bus_id: 'test',
          bus_plate: 'CI-1234-AB',
          bus_name: 'CI-1234-AB',
          driver_id: 'test',
          driver_name: 'Test',
          departure_datetime: new Date().toISOString(),
          departure_date: new Date().toISOString().split('T')[0],
          departure_time: '08:00',
          is_ac: true,
          status: 'planned',
          seats_total: 49,
          seats_from: 1,
          seats_sold: 0,
          station_id: 'test',
          station_name: 'Abidjan',
          cloture: false,
          mt_ticket: 0,
          mt_bagage: 0,
          tot_depense: 0,
          solde: 0,
          caisse: 0,
          confirmed: false,
          cancelled: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        stationName: session?.station_name,
      });
      setTestResult(ok ? 'Impression envoyée' : 'Échec de l\'impression — vérifiez le backend');
    } catch {
      setTestResult('Erreur lors du test');
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 4000);
    }
  };

  const addHeaderLine = () => {
    if (!settings) return;
    setSettings({ ...settings, header_lines: [...settings.header_lines, ''] });
  };
  const addFooterLine = () => {
    if (!settings) return;
    setSettings({ ...settings, footer_lines: [...settings.footer_lines, ''] });
  };
  const updateHeaderLine = (idx: number, val: string) => {
    if (!settings) return;
    const lines = [...settings.header_lines];
    lines[idx] = val;
    setSettings({ ...settings, header_lines: lines });
  };
  const updateFooterLine = (idx: number, val: string) => {
    if (!settings) return;
    const lines = [...settings.footer_lines];
    lines[idx] = val;
    setSettings({ ...settings, footer_lines: lines });
  };
  const removeHeaderLine = (idx: number) => {
    if (!settings) return;
    setSettings({ ...settings, header_lines: settings.header_lines.filter((_, i) => i !== idx) });
  };
  const removeFooterLine = (idx: number) => {
    if (!settings) return;
    setSettings({ ...settings, footer_lines: settings.footer_lines.filter((_, i) => i !== idx) });
  };

  const fieldLabel = 'block text-xs font-bold mb-1';
  const fieldInput = 'w-full px-3 py-2.5 rounded-lg border-2 text-sm outline-none transition-colors';
  const fieldStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' as const };

  if (loading || !settings) {
    return (
      <POSLayout showBack stationName={session?.station_name} activeRoute="Paramètres">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--primary)' }} />
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout showBack stationName={session?.station_name} activeRoute="Paramètres">
      <div className="max-w-2xl mx-auto space-y-4">
        {error && (
          <div className="rounded-xl px-3 py-2.5 flex items-start gap-2 text-sm" style={{ backgroundColor: 'var(--danger-light)', color: 'var(--danger)' }}>
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Printer backend selection */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Printer className="w-4 h-4" /> Imprimante thermique
          </h3>

          <div className="space-y-2">
            {BACKENDS.map(({ value, label, icon: Icon, desc }) => (
              <button
                key={value}
                onClick={() => setSettings({ ...settings, backend: value })}
                className="w-full flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-colors"
                style={{
                  borderColor: settings.backend === value ? 'var(--primary)' : 'var(--border)',
                  backgroundColor: settings.backend === value ? 'var(--primary-light)' : 'transparent',
                }}
              >
                <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: settings.backend === value ? 'var(--primary)' : 'var(--text-muted)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
                </div>
                {settings.backend === value && <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--primary)' }} />}
              </button>
            ))}
          </div>
        </div>

        {/* Width selection */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Largeur du papier</h3>
          <div className="grid grid-cols-2 gap-3">
            {[58, 80].map(w => (
              <button
                key={w}
                onClick={() => setSettings({ ...settings, width_mm: w as 58 | 80 })}
                className="py-4 rounded-xl border-2 font-bold text-base transition-colors"
                style={{
                  borderColor: settings.width_mm === w ? 'var(--primary)' : 'var(--border)',
                  backgroundColor: settings.width_mm === w ? 'var(--primary-light)' : 'transparent',
                  color: settings.width_mm === w ? 'var(--primary)' : 'var(--text-secondary)',
                }}
              >
                {w} mm
              </button>
            ))}
          </div>
        </div>

        {/* QZ Tray config (only if qztray backend) */}
        {settings.backend === 'qztray' && (
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Wifi className="w-4 h-4" /> Configuration QZ Tray
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Hôte</label>
                <input
                  type="text"
                  value={settings.qz_host}
                  onChange={e => setSettings({ ...settings, qz_host: e.target.value })}
                  className={fieldInput}
                  style={fieldStyle}
                  placeholder="localhost"
                />
              </div>
              <div>
                <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Port</label>
                <input
                  type="number"
                  value={settings.qz_port}
                  onChange={e => setSettings({ ...settings, qz_port: parseInt(e.target.value) || 8181 })}
                  className={fieldInput}
                  style={fieldStyle}
                  placeholder="8181"
                />
              </div>
              <div className="col-span-2">
                <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Nom de l'imprimante (optionnel)</label>
                <input
                  type="text"
                  value={settings.printer_name ?? ''}
                  onChange={e => setSettings({ ...settings, printer_name: e.target.value })}
                  className={fieldInput}
                  style={fieldStyle}
                  placeholder="Ex: EPSON_TM_T20"
                />
              </div>
            </div>
          </div>
        )}

        {/* Printer name for serial/usb */}
        {(settings.backend === 'webserial' || settings.backend === 'webusb') && (
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <label className={fieldLabel} style={{ color: 'var(--text-secondary)' }}>Nom de l'imprimante (optionnel)</label>
            <input
              type="text"
              value={settings.printer_name ?? ''}
              onChange={e => setSettings({ ...settings, printer_name: e.target.value })}
              className={fieldInput}
              style={fieldStyle}
              placeholder="Ex: EPSON_TM_T20"
            />
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              La sélection du port se fera au moment de l'impression (dialogue du navigateur pour autoriser l'accès USB).
            </p>
          </div>
        )}

        {/* Auto-cut */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_cut}
              onChange={e => setSettings({ ...settings, auto_cut: e.target.checked })}
              className="w-4 h-4"
              style={{ accentColor: 'var(--primary)' }}
            />
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Coupe automatique du papier</span>
          </label>
        </div>

        {/* Custom header */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>En-tête personnalisé</h3>
            <button onClick={addHeaderLine} className="p-1.5 rounded-lg" style={{ color: 'var(--primary)' }}>
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {settings.header_lines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  value={line}
                  onChange={e => updateHeaderLine(idx, e.target.value)}
                  className={fieldInput}
                  style={fieldStyle}
                  placeholder="Ligne d'en-tête..."
                />
                <button onClick={() => removeHeaderLine(idx)} className="p-2 rounded-lg" style={{ color: 'var(--danger)' }}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {settings.header_lines.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucune ligne d'en-tête</p>
            )}
          </div>
        </div>

        {/* Custom footer */}
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Pied de page personnalisé</h3>
            <button onClick={addFooterLine} className="p-1.5 rounded-lg" style={{ color: 'var(--primary)' }}>
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {settings.footer_lines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  value={line}
                  onChange={e => updateFooterLine(idx, e.target.value)}
                  className={fieldInput}
                  style={fieldStyle}
                  placeholder="Ligne de pied de page..."
                />
                <button onClick={() => removeFooterLine(idx)} className="p-2 rounded-lg" style={{ color: 'var(--danger)' }}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {settings.footer_lines.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Aucune ligne de pied de page</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pb-4">
          <button
            onClick={handleTestPrint}
            disabled={testing}
            className="flex-1 py-3.5 rounded-xl font-bold text-base border-2 disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {testing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Printer className="w-5 h-5" />}
            Test impression
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3.5 rounded-xl font-bold text-white text-base disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : saved ? <CheckCircle className="w-5 h-5" /> : <Save className="w-5 h-5" />}
            {saved ? 'Enregistré' : 'Enregistrer'}
          </button>
        </div>

        {testResult && (
          <div className="rounded-xl px-3 py-2.5 text-sm font-medium text-center" style={{
            backgroundColor: testResult.includes('envoyée') ? 'var(--success-light)' : 'var(--danger-light)',
            color: testResult.includes('envoyée') ? 'var(--success)' : 'var(--danger)',
          }}>
            {testResult}
          </div>
        )}
      </div>
    </POSLayout>
  );
}
