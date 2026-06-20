import { useNavigate } from 'react-router-dom';
import { Building2, CalendarDays, Clock, Users, ArrowRight } from 'lucide-react';
import { SBTA, formatXOF, TIME_SLOTS } from '../theme';
import { Button, TopBar, Card } from '../components';
import { useBooking } from '../BookingContext';

export default function RecapScreen() {
  const navigate = useNavigate();
  const { draft } = useBooking();
  const { trip, search } = draft;

  if (!trip || !search) {
    navigate('/sbtamobile/search', { replace: true });
    return null;
  }

  const count = draft.seatsCount;
  const subtotal = trip.price * count;
  const fee = draft.serviceFee * count;
  const total = subtotal + fee;
  const slotLabel = TIME_SLOTS.find((s) => s.id === search.slot.id)?.label ?? search.slot.label;
  const dateLabel = new Date(search.date).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Récapitulatif" onBack />
      <div className="flex-1 space-y-4 px-6 pb-6 pt-2">
        <Card>
          <div className="flex items-center gap-3">
            <div className="text-center">
              {trip.isPlanned && <div className="text-xl font-extrabold" style={{ color: SBTA.ink }}>{trip.departureTime}</div>}
              <div className="text-xs" style={{ color: SBTA.gray400 }}>{search.originName}</div>
              {search.originStationName && <div className="text-[11px] font-semibold" style={{ color: SBTA.green }}>{search.originStationName}</div>}
            </div>
            <div className="flex flex-1 items-center">
              <div className="h-2 w-2 rounded-full" style={{ background: SBTA.green }} />
              <div className="h-px flex-1" style={{ background: SBTA.gray200 }} />
              <ArrowRight size={14} color={SBTA.gray400} />
            </div>
            <div className="text-center">
              {trip.isPlanned && <div className="text-xl font-extrabold" style={{ color: SBTA.ink }}>{trip.arrivalTime}</div>}
              <div className="text-xs" style={{ color: SBTA.gray400 }}>{search.destName}</div>
              {search.destStationName && <div className="text-[11px] font-semibold" style={{ color: SBTA.red }}>{search.destStationName}</div>}
            </div>
          </div>
        </Card>

        <Card>
          <div className="space-y-3">
            <InfoRow icon={Building2} label="Société" value={trip.company.name} />
            <InfoRow icon={CalendarDays} label="Date" value={dateLabel} />
            <InfoRow icon={Clock} label="Intervalle" value={slotLabel} />
            <InfoRow icon={Users} label="Places" value={`${count} ${count > 1 ? 'places' : 'place'}`} />
          </div>
        </Card>

        <Card>
          <div className="space-y-2.5">
            <PriceRow label={`Prix unitaire × ${count}`} value={formatXOF(subtotal)} />
            <PriceRow label={`Frais de service × ${count}`} value={formatXOF(fee)} />
            <div className="border-t pt-2.5" style={{ borderColor: SBTA.gray100 }}>
              <div className="flex items-center justify-between">
                <span className="font-bold" style={{ color: SBTA.ink }}>Total à payer</span>
                <span className="text-xl font-extrabold" style={{ color: SBTA.green }}>{formatXOF(total)}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="p-6">
        <Button full onClick={() => navigate('/sbtamobile/passengers')}>Continuer</Button>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: SBTA.greenLight }}>
        <Icon size={17} color={SBTA.green} />
      </div>
      <span className="text-sm" style={{ color: SBTA.gray600 }}>{label}</span>
      <span className="ml-auto text-right text-[15px] font-semibold capitalize" style={{ color: SBTA.ink }}>{value}</span>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[15px]" style={{ color: SBTA.gray600 }}>{label}</span>
      <span className="font-semibold" style={{ color: SBTA.ink }}>{value}</span>
    </div>
  );
}
