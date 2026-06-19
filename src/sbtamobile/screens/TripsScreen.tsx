import { useLocation, useNavigate } from 'react-router-dom';
import { Wifi, Snowflake, Usb, ArrowRight, Bus, CheckCircle2, Clock } from 'lucide-react';
import { SBTA, formatXOF, minutesToDuration } from '../theme';
import { TopBar } from '../components';
import { TripOption } from '../api';
import { useBooking } from '../BookingContext';

export default function TripsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { draft, setTrip } = useBooking();
  const trips = ((location.state as { trips?: TripOption[] } | null)?.trips ?? []) as TripOption[];
  const search = draft.search;

  function choose(trip: TripOption) {
    setTrip(trip);
    navigate('/sbtamobile/trip');
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Trajets disponibles" onBack />
      {search && (
        <div className="px-6 pb-2 pt-1">
          <p className="text-[15px] font-semibold" style={{ color: SBTA.ink }}>
            {search.originName} <ArrowRight size={14} className="inline" /> {search.destName}
          </p>
          <p className="text-sm" style={{ color: SBTA.gray600 }}>
            {new Date(search.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · {search.slot.label}
          </p>
        </div>
      )}

      <div className="flex-1 space-y-3 px-6 pb-6 pt-3">
        {trips.length === 0 ? (
          <div className="flex flex-col items-center pt-20 text-center">
            <Bus size={48} color={SBTA.gray400} />
            <p className="mt-4 font-bold" style={{ color: SBTA.ink }}>Aucun trajet trouvé</p>
            <p className="mt-1 text-sm" style={{ color: SBTA.gray600 }}>
              Essayez une autre date ou un autre intervalle horaire.
            </p>
          </div>
        ) : (
          trips.map((t) => (
            <button key={t.key} onClick={() => choose(t)}
              className="w-full rounded-2xl p-4 text-left transition active:scale-[0.98]"
              style={{ background: SBTA.white, border: `1px solid ${SBTA.gray200}` }}>
              <div className="flex items-center justify-between">
                <span className="rounded-lg px-2 py-1 text-xs font-bold"
                  style={{ background: SBTA.greenLight, color: SBTA.greenDark }}>
                  {t.company.name}
                </span>
                <span className="text-lg font-extrabold" style={{ color: SBTA.green }}>
                  {formatXOF(t.price)}
                </span>
              </div>

              {t.isPlanned ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{ background: SBTA.green, color: SBTA.white }}>
                    <CheckCircle2 size={12} /> Voyage planifié
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: SBTA.gray600 }}>
                    {t.seatsAvailable ?? 0} place{(t.seatsAvailable ?? 0) > 1 ? 's' : ''} disponible{(t.seatsAvailable ?? 0) > 1 ? 's' : ''}
                  </span>
                </div>
              ) : (
                <div className="mt-2">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{ background: '#FFF8E6', color: '#7A5C00' }}>
                    <Clock size={12} /> Billet provisoire
                  </span>
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                <div className="text-center">
                  <div className="text-xl font-extrabold" style={{ color: SBTA.ink }}>{t.departureTime}</div>
                  <div className="text-xs" style={{ color: SBTA.gray400 }}>{search?.originName}</div>
                  {search?.originStationName && <div className="text-[11px] font-semibold" style={{ color: SBTA.green }}>{search.originStationName}</div>}
                </div>
                <div className="flex flex-1 flex-col items-center">
                  <div className="text-xs font-semibold" style={{ color: SBTA.gray400 }}>{minutesToDuration(t.durationMinutes)}</div>
                  <div className="my-1 flex w-full items-center">
                    <div className="h-2 w-2 rounded-full" style={{ background: SBTA.green }} />
                    <div className="h-px flex-1" style={{ background: SBTA.gray200 }} />
                    <ArrowRight size={14} color={SBTA.gray400} />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-extrabold" style={{ color: SBTA.ink }}>{t.arrivalTime}</div>
                  <div className="text-xs" style={{ color: SBTA.gray400 }}>{search?.destName}</div>
                  {search?.destStationName && <div className="text-[11px] font-semibold" style={{ color: SBTA.red }}>{search.destStationName}</div>}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3 border-t pt-3" style={{ borderColor: SBTA.gray100 }}>
                {t.amenities.ac && <Snowflake size={15} color={SBTA.gray600} />}
                {t.amenities.wifi && <Wifi size={15} color={SBTA.gray600} />}
                {t.amenities.usb && <Usb size={15} color={SBTA.gray600} />}
                <span className="ml-auto text-xs font-semibold" style={{ color: SBTA.gray600 }}>{t.busType}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
