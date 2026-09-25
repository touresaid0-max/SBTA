import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, Calendar, Clock, ArrowDownUp, LogOut, Menu, User } from 'lucide-react';
import { SBTA, TIME_SLOTS } from '../theme';
import { Button, BottomNav } from '../components';
import {
  City,
  Station,
  RouteDestination,
  fetchRouteOrigins,
  fetchRouteDestinations,
  fetchStationForCity,
  fetchStations,
  fetchRouteServiceFee,
  searchTrips,
} from '../api';
import { useBooking } from '../BookingContext';
import { useMobileAuth } from '../MobileAuthContext';
import heroImg from './hero-banner.jpg';

function CityAutocomplete({
  cities,
  value,
  onChange,
  placeholder,
  inputClassName,
  inputStyle,
}: {
  cities: City[];
  value: string;
  onChange: (cityId: string) => void;
  placeholder: string;
  inputClassName: string;
  inputStyle: React.CSSProperties;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = cities.find((city) => city.id === value);
  const filteredCities = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('fr');
    if (!normalizedQuery) return cities;
    return cities.filter((city) => city.name.toLocaleLowerCase('fr').includes(normalizedQuery));
  }, [cities, query]);

  useEffect(() => {
    if (!open) setQuery(selected?.name ?? '');
  }, [open, selected?.name]);

  return (
    <div className="relative">
      <input
        name={placeholder}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange('');
          setOpen(true);
        }}
        className={inputClassName}
        style={inputStyle}
      />
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border shadow-lg"
          style={{ background: SBTA.white, borderColor: SBTA.gray200 }}
        >
          {filteredCities.length > 0 ? filteredCities.map((city) => (
            <button
              key={city.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery(city.name);
                onChange(city.id);
                setOpen(false);
              }}
              className="block w-full px-4 py-3 text-left text-[16px] font-semibold transition active:bg-black/5"
              style={{ color: SBTA.ink }}
            >
              {city.name}
            </button>
          )) : (
            <div className="px-4 py-3 text-[15px]" style={{ color: SBTA.gray600 }}>
              Aucune ville trouvée
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchScreen() {
  const navigate = useNavigate();
  const { setSearch, setServiceFee, setTrip } = useBooking();
  const { logout } = useMobileAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [originCities, setOriginCities] = useState<City[]>([]);
  const [destinations, setDestinations] = useState<RouteDestination[]>([]);
  const [origin, setOrigin] = useState('');
  const [dest, setDest] = useState('');
  const [originStations, setOriginStations] = useState<Station[]>([]);
  const [destStations, setDestStations] = useState<Station[]>([]);
  const [originStation, setOriginStation] = useState('');
  const [destStation, setDestStation] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [slotId, setSlotId] = useState('');
  const [error, setError] = useState('');
  const [slotMsg, setSlotMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    fetchRouteOrigins().then(setOriginCities).catch(() => setError('Impossible de charger les villes.'));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // When origin changes: load route destinations, auto-select the station, reset destination
  useEffect(() => {
    setDest('');
    setDestStation('');
    setDestStations([]);
    if (!origin) {
      setDestinations([]);
      setOriginStations([]);
      setOriginStation('');
      return;
    }
    fetchRouteDestinations(origin).then(setDestinations).catch(() => setDestinations([]));
    fetchStations(origin).then(setOriginStations).catch(() => setOriginStations([]));
    // Auto-select the station for this city
    fetchStationForCity(origin).then((station) => {
      if (station) setOriginStation(station.id);
    }).catch(() => undefined);
  }, [origin]);

  useEffect(() => {
    setDestStation('');
    if (!dest) { setDestStations([]); return; }
    fetchStations(dest).then(setDestStations).catch(() => setDestStations([]));
  }, [dest]);

  const destCities = useMemo<City[]>(
    () => destinations.map((d) => ({ id: d.cityId, name: d.cityName })),
    [destinations],
  );

  const isPastDate = date < today;
  const isToday = date === today;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isSlotLocked = (s: (typeof TIME_SLOTS)[number]) =>
    isToday && nowMinutes >= s.endHour * 60;

  useEffect(() => {
    setSlotMsg('');
    if (isPastDate) {
      setSlotId('');
      return;
    }
    const selected = TIME_SLOTS.find((s) => s.id === slotId);
    if (!selected) {
      const firstAvailable = TIME_SLOTS.find((s) => !(isToday && nowMinutes >= s.endHour * 60));
      if (firstAvailable) setSlotId(firstAvailable.id);
    } else if (isToday && nowMinutes >= selected.endHour * 60) {
      setSlotId('');
      setSlotMsg('Le créneau sélectionné est passé. Veuillez choisir un autre créneau disponible.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, nowMinutes]);

  function swap() {
    const prevOrigin = origin;
    const prevDest = dest;
    const prevOriginStation = originStation;
    const prevDestStation = destStation;
    setOrigin(prevDest);
    setDest(prevOrigin);
    setOriginStation(prevDestStation);
    setDestStation(prevOriginStation);
  }

  async function submit() {
    setError('');
    if (!origin) return setError('Choisissez la ville de départ.');
    if (originStations.length > 0 && !originStation) return setError('Choisissez la gare de départ.');
    if (!dest) return setError("Choisissez la ville d'arrivée.");
    if (destStations.length > 0 && !destStation) return setError("Choisissez la gare d'arrivée.");
    if (origin === dest) return setError('Les villes doivent être différentes.');
    if (isPastDate) return setError('Vous ne pouvez pas réserver sur une date passée.');
    if (!slotId) return setError('Choisissez un intervalle horaire disponible.');

    const slot = TIME_SLOTS.find((s) => s.id === slotId)!;
    setLoading(true);
    try {
      const [result, routeFee] = await Promise.all([
        searchTrips(origin, dest, slot, date, originStation || undefined, destStation || undefined),
        fetchRouteServiceFee(origin, dest),
      ]);
      const originName = originCities.find((c) => c.id === origin)?.name ?? '';
      const destName = destCities.find((c) => c.id === dest)?.name ?? '';
      const originStationName = originStations.find((s) => s.id === originStation)?.name ?? '';
      const destStationName = destStations.find((s) => s.id === destStation)?.name ?? '';
      setServiceFee(routeFee);
      setSearch({
        originCityId: origin,
        originName,
        originStationId: originStation,
        originStationName,
        destCityId: dest,
        destName,
        destStationId: destStation,
        destStationName,
        date,
        slot,
      });
      if (result.planned.length > 0) {
        navigate('/sbtamobile/trips', { state: { trips: result.planned } });
      } else if (result.provisional) {
        setTrip(result.provisional);
        navigate('/sbtamobile/trip');
      } else {
        setError('Aucun trajet disponible pour cette sélection.');
      }
    } catch {
      setError('La recherche a échoué. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  const selectCls = 'w-full bg-transparent pt-0.5 pb-1 text-[17px] font-semibold outline-none appearance-none';

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative">
        <img
          src={heroImg}
          alt="SBTA Express"
          className="h-[248px] w-full select-none object-cover"
          draggable={false}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(0,143,57,0.55) 0%, rgba(0,143,57,0.05) 42%, rgba(0,143,57,0.82) 100%)' }}
        />
        <div className="absolute left-5 top-5">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-2 ring-white/80 transition active:scale-90"
            style={{ background: SBTA.white }}
            aria-label="Menu"
          >
            <Menu size={24} color={SBTA.green} />
          </button>
          {menuOpen && (
            <div
              className="absolute left-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-2xl shadow-lg"
              style={{ background: SBTA.white, border: `1px solid ${SBTA.gray200}` }}
            >
              <button
                onClick={() => { setMenuOpen(false); navigate('/sbtamobile/profile'); }}
                className="flex w-full items-center gap-2.5 px-4 py-3.5 text-[15px] font-semibold transition active:bg-black/5"
                style={{ color: SBTA.ink }}
              >
                <User size={19} color={SBTA.green} /> Mon profil
              </button>
              <button
                onClick={() => { logout(); navigate('/sbtamobile'); }}
                className="flex w-full items-center gap-2.5 px-4 py-3.5 text-[15px] font-semibold transition active:bg-black/5"
                style={{ color: SBTA.redDark, borderTop: `1px solid ${SBTA.gray200}` }}
              >
                <LogOut size={19} color={SBTA.red} /> Déconnexion
              </button>
            </div>
          )}
        </div>
        <div className="absolute inset-x-6 bottom-12">
          <h1 className="text-[27px] font-extrabold leading-tight text-white" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.45)' }}>
            Réservez votre voyage
          </h1>
          <p className="mt-1 text-[15px] font-semibold text-white/95" style={{ textShadow: '0 1px 8px rgba(0,0,0,0.4)' }}>
            SBTA Express — L'aventure continue
          </p>
        </div>
      </div>

      <div className="-mt-8 flex-1 px-6">
        <div className="rounded-3xl p-5" style={{ background: SBTA.white, border: `1px solid ${SBTA.gray200}`, boxShadow: '0 8px 30px rgba(0,0,0,0.06)' }}>
          <div className="relative overflow-hidden rounded-2xl border-2" style={{ background: SBTA.white, borderColor: SBTA.greenLight }}>
            <div className="flex items-center gap-3 py-3.5 pl-4 pr-16">
              <MapPin size={24} color={SBTA.green} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold" style={{ color: SBTA.green }}>Ville de départ</span>
                <CityAutocomplete
                  cities={originCities}
                  value={origin}
                  onChange={setOrigin}
                  placeholder="Choisir une ville"
                  inputClassName={selectCls}
                  inputStyle={{ color: origin ? SBTA.ink : SBTA.gray400 }}
                />
              </div>
            </div>

            <div className="h-px" style={{ background: SBTA.gray100 }} />

            <div className="flex items-center gap-3 py-3 pl-4 pr-16">
              <Building2 size={22} color={origin ? SBTA.green : SBTA.gray400} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold" style={{ color: SBTA.green }}>Gare de départ</span>
                <select name="sbta-origin-station" autoComplete="off" disabled={!origin} value={originStation} onChange={(e) => setOriginStation(e.target.value)} className={selectCls} style={{ color: originStation ? SBTA.ink : SBTA.gray400 }}>
                  <option value="">{!origin ? "Sélectionnez d'abord une ville" : originStations.length === 0 ? 'Aucune gare disponible' : 'Choisir une gare'}</option>
                  {originStations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div className="h-px" style={{ background: SBTA.gray200 }} />

            <div className="flex items-center gap-3 py-3.5 pl-4 pr-16">
              <MapPin size={24} color={SBTA.red} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold" style={{ color: SBTA.green }}>Ville d'arrivée</span>
                <CityAutocomplete
                  cities={destCities}
                  value={dest}
                  onChange={setDest}
                  placeholder={origin ? "Choisir une destination" : "Sélectionnez d'abord une ville de départ"}
                  inputClassName={selectCls}
                  inputStyle={{ color: dest ? SBTA.ink : SBTA.gray400 }}
                />
              </div>
            </div>

            <div className="h-px" style={{ background: SBTA.gray100 }} />

            <div className="flex items-center gap-3 py-3 pl-4 pr-16">
              <Building2 size={22} color={dest ? SBTA.red : SBTA.gray400} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold" style={{ color: SBTA.green }}>Gare d'arrivée</span>
                <select name="sbta-dest-station" autoComplete="off" disabled={!dest} value={destStation} onChange={(e) => setDestStation(e.target.value)} className={selectCls} style={{ color: destStation ? SBTA.ink : SBTA.gray400 }}>
                  <option value="">{!dest ? "Sélectionnez d'abord une ville" : destStations.length === 0 ? 'Aucune gare disponible' : 'Choisir une gare'}</option>
                  {destStations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <button onClick={swap}
              className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full shadow-md transition active:scale-90"
              style={{ background: SBTA.white, border: `2px solid ${SBTA.greenLight}` }} aria-label="Inverser les villes">
              <ArrowDownUp size={18} color={SBTA.green} />
            </button>
          </div>

          <div className="mt-4">
            <span className="mb-1.5 block text-[15px] font-bold" style={{ color: SBTA.green }}>Date du voyage</span>
            <div className="flex items-center gap-2 rounded-2xl px-4" style={{ background: SBTA.gray100 }}>
              <Calendar size={20} color={SBTA.green} />
              <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full bg-transparent py-3.5 text-[17px] font-semibold outline-none" style={{ color: SBTA.ink }} />
            </div>
          </div>

          <div className="mt-4">
            <span className="mb-1.5 flex items-center gap-1.5 text-[15px] font-bold" style={{ color: SBTA.green }}>
              <Clock size={17} color={SBTA.green} /> Intervalle horaire
            </span>
            <div className="grid grid-cols-3 gap-2">
              {TIME_SLOTS.map((s) => {
                const locked = isSlotLocked(s);
                const active = s.id === slotId;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (locked) {
                        setSlotMsg('Ce créneau horaire est déjà passé. Veuillez choisir un autre créneau.');
                        return;
                      }
                      setSlotMsg('');
                      setSlotId(s.id);
                    }}
                    aria-disabled={locked}
                    className="rounded-xl py-3 text-[15px] font-bold transition active:scale-95"
                    style={{
                      background: active ? SBTA.green : SBTA.gray100,
                      color: locked ? SBTA.gray400 : active ? SBTA.white : SBTA.gray600,
                      opacity: locked ? 0.5 : 1,
                      cursor: locked ? 'not-allowed' : 'pointer',
                    }}>
                    {s.label}
                  </button>
                );
              })}
            </div>
            {slotMsg && (
              <div className="mt-2 text-[13px] font-semibold" style={{ color: SBTA.redDark }}>{slotMsg}</div>
            )}
          </div>

          {isPastDate && (
            <div className="mt-4 text-[15px] font-semibold" style={{ color: SBTA.redDark }}>
              Vous ne pouvez pas réserver sur une date passée.
            </div>
          )}
          {error && <div className="mt-4 text-[15px] font-semibold" style={{ color: SBTA.redDark }}>{error}</div>}
        </div>

        <div className="mt-6">
          <Button full onClick={submit} disabled={loading || !origin || !dest || !date || !slotId || isPastDate || (originStations.length > 0 && !originStation) || (destStations.length > 0 && !destStation)} style={{ fontSize: 18, padding: '16px 20px' }}>
            {loading ? 'Recherche...' : 'Rechercher'}
          </Button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
