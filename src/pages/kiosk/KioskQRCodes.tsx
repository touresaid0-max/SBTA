import { useEffect, useState } from 'react';
import { QrCode, Copy, ExternalLink, Loader2, Monitor } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import toast from 'react-hot-toast';
import { fetchKiosks, type DigitalKiosk } from '@/services/kiosk.service';
import { useRealtimeSync } from '@/pages/agent-reservation/shared';

export default function KioskQRCodes() {
  const [kiosks, setKiosks] = useState<DigitalKiosk[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetchKiosks().then(setKiosks).catch(() => toast.error('Erreur')).finally(() => setLoading(false));
  };

  useEffect(load, []);
  useRealtimeSync(['digital_kiosks'], load);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-[#0B7439]" /></div>;
  }

  const activeKiosks = kiosks.filter((k) => k.status === 'active');

  return (
    <div className="space-y-6 p-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-[#1A2E22]">Bornes virtuelles — QR codes</h1>
        <p className="text-sm text-[#6B7280] mt-1">Générez et imprimez les QR codes de repli pour chaque borne</p>
      </div>

      {activeKiosks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2EAE5] p-12 text-center text-[#6B7280]">
          <QrCode className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>Aucune borne active. Créez une borne depuis « Gestion des bornes » pour générer un QR code.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {activeKiosks.map((kiosk) => {
            const url = kiosk.slug ? `${window.location.origin}/bornes/${kiosk.slug}` : `${window.location.origin}/bornes/terminal?id=${kiosk.id}`;
            return (
              <div key={kiosk.id} className="bg-white rounded-2xl border border-[#E2EAE5] p-6 flex flex-col items-center text-center">
                <div className="flex items-center gap-2 mb-4">
                  {kiosk.kiosk_type === 'virtual_qr' ? <QrCode className="w-5 h-5 text-[#0B86B8]" /> : <Monitor className="w-5 h-5 text-[#0B7439]" />}
                  <h3 className="font-semibold text-[#1A2E22]">{kiosk.name}</h3>
                </div>
                <p className="text-xs text-[#6B7280] mb-4">{kiosk.station_name ?? 'Aucune gare'} • {kiosk.kiosk_type === 'virtual_qr' ? 'Virtuelle' : 'Physique'}</p>

                <div className="p-4 bg-white rounded-xl border-2 border-[#E2EAE5] mb-4">
                  <QRCodeCanvas value={url} size={200} level="M" />
                </div>

                <code className="text-xs text-[#6B7280] bg-[#F8FAF8] px-3 py-1.5 rounded-lg mb-3 break-all">{url}</code>

                <div className="flex gap-2">
                  <button
                    onClick={() => { navigator.clipboard?.writeText(url); toast.success('Lien copié'); }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-[#E2EAE5] text-[#6B7280] hover:bg-[#F8FAF8]"
                  >
                    <Copy className="w-4 h-4" /> Copier
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white"
                    style={{ backgroundColor: '#0B7439' }}
                  >
                    <ExternalLink className="w-4 h-4" /> Ouvrir
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
