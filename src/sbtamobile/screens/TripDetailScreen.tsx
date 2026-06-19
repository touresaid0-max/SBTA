import { useNavigate } from 'react-router-dom';
import { MapPin, Clock, Route as RouteIcon, Bus, Wifi, Snowflake, Usb, Check, CheckCircle2 } from 'lucide-react';
import { SBTA, formatXOF, minutesToDuration } from '../theme';
import { Button, TopBar, Card } from '../components';
import { useBooking } from '../BookingContext';

export default function TripDetailScreen() {
  const navigate = useNavigate();
  const { draft } = useBooking();
  const trip = draft.trip;
  const search = draft.search;

  if (!trip || !search) {
    navigate('/sbtamobile/search', { replace: true });
    return null;
  }

  const features = [
    { ok: trip.amenities.ac, icon: Snowflake, label: 'Climatisation' },
    { ok: trip.amenities.wifi, icon: Wifi, label: 'WiFi à bord' },
    { ok: trip.amenities.usb, icon: Usb, label: 'Prises USB' },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Détail du trajet" onBack />
      <div className="flex-1 space-y-4 px-6 pb-6 pt-2">
        <Card>
          <div className="flex items-center justify-between">
            <span className="rounded-lg px-2 py-1 text-xs font-bold" style={{ background: SBTA.greenLight, color: SBTA.greenDark }}>
              {trip.company.name}
            </span>
            <span className="text-xl font-extrabold" style={{ color: SBTA.green }}>{formatXOF(trip.price)}</span>
          </div>

          {trip.isPlanned ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: SBTA.greenLight }}>
              <CheckCircle2 size={16} color={SBTA.green} />
              <span className="text-[13px] font-semibold" style={{ color: SBTA.greenDark }}>
                Voyage planifié · {trip.seatsAvailable ?? 0} place(s) · billet définitif après paiement
              </span>
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: '#FFF8E6' }}>
              <Clock size={16} color="#B8860B" />
              <span className="text-[13px] font-semibold" style={{ color: '#7A5C00' }}>
                Billet provisoire · sièges attribués dès la planification du voyage
              </span>
            </div>
          )}

          <div className="mt-4 space-y-4">
            <div className="flex gap-3">
              <div className="flex flex-col items-center pt-1">
                <div className="h-3 w-3 rounded-full" style={{ background: SBTA.green }} />
                <div className="my-1 w-px flex-1" style={{ background: SBTA.gray200, minHeight: 28 }} />
                <div className="h-3 w-3 rounded-full" style={{ background: SBTA.red }} />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <div className="text-lg font-extrabold" style={{ color: SBTA.ink }}>{trip.departureTime} · {search.originName}</div>
                  <div className="flex items-center gap-1 text-xs" style={{ color: SBTA.gray600 }}>
                    <MapPin size={12} /> {search.originStationName || `Gare ${search.originName}`}
                  </div>
                </div>
                <div>
                  <div className="text-lg font-extrabold" style={{ color: SBTA.ink }}>{trip.arrivalTime} · {search.destName}</div>
                  <div className="flex items-center gap-1 text-xs" style={{ color: SBTA.gray600 }}>
                    <MapPin size={12} /> {search.destStationName || `Gare ${search.destName}`}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-3">
          <Card style={{ textAlign: 'center', padding: 14 }}>
            <RouteIcon size={20} color={SBTA.green} className="mx-auto" />
            <div className="mt-1 text-sm font-extrabold" style={{ color: SBTA.ink }}>{trip.route.distance_km} km</div>
            <div className="text-xs" style={{ color: SBTA.gray400 }}>Distance</div>
          </Card>
          <Card style={{ textAlign: 'center', padding: 14 }}>
            <Clock size={20} color={SBTA.green} className="mx-auto" />
            <div className="mt-1 text-sm font-extrabold" style={{ color: SBTA.ink }}>{minutesToDuration(trip.durationMinutes)}</div>
            <div className="text-xs" style={{ color: SBTA.gray400 }}>Durée</div>
          </Card>
          <Card style={{ textAlign: 'center', padding: 14 }}>
            <Bus size={20} color={SBTA.green} className="mx-auto" />
            <div className="mt-1 text-xs font-extrabold leading-tight" style={{ color: SBTA.ink }}>{trip.busType}</div>
            <div className="text-xs" style={{ color: SBTA.gray400 }}>Bus</div>
          </Card>
        </div>

        <Card>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide" style={{ color: SBTA.gray400 }}>
            Équipements
          </h3>
          <div className="space-y-2">
            {features.map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: f.ok ? SBTA.greenLight : SBTA.gray100 }}>
                  <f.icon size={16} color={f.ok ? SBTA.green : SBTA.gray400} />
                </div>
                <span className="flex-1 text-[15px] font-medium" style={{ color: SBTA.ink }}>{f.label}</span>
                {f.ok ? (
                  <Check size={18} color={SBTA.green} />
                ) : (
                  <span className="text-xs" style={{ color: SBTA.gray400 }}>Non disponible</span>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ background: SBTA.greenLight, border: 'none' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: SBTA.greenDark }}>Prix unitaire</span>
            <span className="text-2xl font-extrabold" style={{ color: SBTA.green }}>{formatXOF(trip.price)}</span>
          </div>
        </Card>
      </div>

      <div className="p-6">
        <Button full onClick={() => navigate('/sbtamobile/seats')}>Continuer</Button>
      </div>
    </div>
  );
}
