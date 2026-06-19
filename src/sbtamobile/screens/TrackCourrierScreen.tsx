import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Search, Loader2, PackageSearch, Package, PackageCheck, Truck,
  MapPin, CheckCircle2, User, Phone, Building2, CalendarDays,
} from 'lucide-react';
import { SBTA } from '../theme';
import { TopBar, Card, BottomNav } from '../components';
import { fetchParcelByCode } from '../../services/parcel.service';
import type { Parcel, ParcelStatus } from '../../types/parcel.types';

const STEPS: { status: ParcelStatus; label: string; icon: typeof Package }[] = [
  { status: 'enregistre', label: 'Enregistré', icon: Package },
  { status: 'mis_en_paquet', label: 'En paquet', icon: PackageCheck },
  { status: 'expedie', label: 'Expédié', icon: Truck },
  { status: 'arrive', label: 'Arrivé', icon: MapPin },
  { status: 'livre', label: 'Livré', icon: CheckCircle2 },
];

const STEP_INDEX: Record<string, number> = {
  enregistre: 0, mis_en_paquet: 1, expedie: 2, arrive: 3, livre: 4,
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function TrackCourrierScreen() {
  const navigate = useNavigate();
  const { code } = useParams<{ code: string }>();
  const [query, setQuery] = useState(code ?? '');
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  async function doSearch(value: string) {
    const c = value.trim();
    if (!c) return;
    setLoading(true);
    setNotFound(false);
    setParcel(null);
    try {
      const found = await fetchParcelByCode(c);
      if (!found) setNotFound(true);
      else setParcel(found);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (code) {
      setQuery(code);
      doSearch(code);
    }
  }, [code]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = query.trim();
    if (!c) return;
    navigate(`/sbtamobile/track-courrier/${encodeURIComponent(c)}`);
  }

  const currentStep = parcel ? (STEP_INDEX[parcel.status] ?? -1) : -1;
  const isTerminal = parcel ? ['retourne', 'perdu'].includes(parcel.status) : false;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Suivi Courrier" />
      <div className="flex-1 space-y-4 px-6 pb-6 pt-2">
        <form onSubmit={submit}>
          <span className="mb-1.5 block text-sm font-semibold" style={{ color: SBTA.gray600 }}>
            Numéro de courrier
          </span>
          <div className="flex items-center gap-2 rounded-2xl px-4"
            style={{ background: SBTA.white, border: `1.5px solid ${SBTA.gray200}` }}>
            <PackageSearch size={18} color={SBTA.gray400} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ex : 260508"
              className="w-full bg-transparent py-3.5 text-[15px] outline-none"
              style={{ color: SBTA.ink }}
            />
          </div>
          <button type="submit" disabled={loading || !query.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[15px] font-bold transition active:scale-[0.98] disabled:opacity-50"
            style={{ background: SBTA.green, color: SBTA.white }}>
            {loading
              ? <><Loader2 size={18} className="animate-spin" /> Recherche...</>
              : <><Search size={18} /> RECHERCHER</>}
          </button>
        </form>

        {notFound && (
          <Card style={{ textAlign: 'center', padding: '28px 20px' }}>
            <Package size={40} color={SBTA.gray400} className="mx-auto" />
            <p className="mt-3 font-bold" style={{ color: SBTA.ink }}>Courrier introuvable</p>
            <p className="mt-1 text-sm" style={{ color: SBTA.gray600 }}>
              Vérifiez le numéro de courrier saisi.
            </p>
          </Card>
        )}

        {parcel && (
          <>
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: SBTA.gray400 }}>
                Numéro du courrier
              </p>
              <p className="text-2xl font-extrabold" style={{ color: SBTA.green }}>{parcel.parcel_code}</p>
              {parcel.reference && parcel.reference !== parcel.parcel_code && (
                <p className="text-xs" style={{ color: SBTA.gray400 }}>Réf : {parcel.reference}</p>
              )}

              <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: SBTA.gray100 }}>
                <InfoRow icon={User} label="Expéditeur" value={parcel.sender_name} />
                <InfoRow icon={User} label="Destinataire" value={parcel.recipient_name} />
                <InfoRow icon={Phone} label="Tél. destinataire" value={parcel.recipient_phone} />
                <InfoRow icon={Building2} label="Ville de départ" value={parcel.origin_station_name} />
                <InfoRow icon={MapPin} label="Ville d'arrivée"
                  value={parcel.recipient_city || parcel.destination_station_name} />
                <InfoRow icon={CalendarDays} label="Date d'enregistrement"
                  value={formatDate(parcel.registered_at)} />
              </div>
            </Card>

            <Card>
              <p className="mb-4 text-sm font-bold" style={{ color: SBTA.ink }}>Progression</p>
              {isTerminal ? (
                <div className="rounded-xl px-4 py-3 text-sm font-semibold"
                  style={{ background: '#FDECEC', color: SBTA.redDark }}>
                  Statut : {parcel.status === 'perdu' ? 'Perdu' : 'Retourné'}
                </div>
              ) : (
                <div className="space-y-1">
                  {STEPS.map((step, idx) => {
                    const done = idx <= currentStep;
                    const isCurrent = idx === currentStep;
                    const Icon = step.icon;
                    return (
                      <div key={step.status} className="flex items-center gap-3">
                        <div className="flex flex-col items-center">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full transition"
                            style={{
                              background: done ? SBTA.green : SBTA.gray100,
                              color: done ? SBTA.white : SBTA.gray400,
                            }}>
                            {done ? <CheckCircle2 size={18} /> : <Icon size={17} />}
                          </div>
                          {idx < STEPS.length - 1 && (
                            <div className="h-6 w-0.5"
                              style={{ background: idx < currentStep ? SBTA.green : SBTA.gray200 }} />
                          )}
                        </div>
                        <span className="text-[15px]"
                          style={{
                            color: done ? SBTA.ink : SBTA.gray400,
                            fontWeight: isCurrent ? 800 : done ? 600 : 500,
                          }}>
                          {step.label}
                          {isCurrent && (
                            <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold"
                              style={{ background: SBTA.greenLight, color: SBTA.green }}>
                              En cours
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: SBTA.greenLight }}>
        <Icon size={17} color={SBTA.green} />
      </div>
      <span className="text-sm" style={{ color: SBTA.gray600 }}>{label}</span>
      <span className="ml-auto text-right text-[15px] font-semibold" style={{ color: SBTA.ink }}>{value || '—'}</span>
    </div>
  );
}
