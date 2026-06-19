import { useNavigate } from 'react-router-dom';
import { Minus, Plus, Users, Info } from 'lucide-react';
import { SBTA, formatXOF } from '../theme';
import { Button, TopBar, Card } from '../components';
import { useBooking } from '../BookingContext';

export default function SeatCountScreen() {
  const navigate = useNavigate();
  const { draft, setSeatsCount } = useBooking();
  const trip = draft.trip;

  if (!trip) {
    navigate('/sbtamobile/search', { replace: true });
    return null;
  }

  const count = draft.seatsCount;
  const unit = trip.price;
  const fee = draft.serviceFee * count;
  const subtotal = unit * count;
  const total = subtotal + fee;
  const maxSeats = trip.isPlanned
    ? Math.max(1, Math.min(10, trip.seatsAvailable ?? 10))
    : 10;

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Nombre de places" onBack />
      <div className="flex-1 space-y-4 px-6 pb-6 pt-2">
        <Card style={{ textAlign: 'center', padding: '28px 20px' }}>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: SBTA.greenLight }}>
            <Users size={26} color={SBTA.green} />
          </div>
          <p className="mt-4 text-[15px]" style={{ color: SBTA.gray600 }}>
            Combien de places souhaitez-vous réserver ?
          </p>

          <div className="mt-6 flex items-center justify-center gap-6">
            <button onClick={() => setSeatsCount(Math.max(1, count - 1))} disabled={count <= 1}
              className="flex h-14 w-14 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40"
              style={{ background: SBTA.gray100 }}>
              <Minus size={24} color={SBTA.ink} />
            </button>
            <div className="w-16 text-5xl font-extrabold" style={{ color: SBTA.ink }}>{count}</div>
            <button onClick={() => setSeatsCount(Math.min(maxSeats, count + 1))} disabled={count >= maxSeats}
              className="flex h-14 w-14 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-40"
              style={{ background: SBTA.green }}>
              <Plus size={24} color={SBTA.white} />
            </button>
          </div>
          <p className="mt-4 text-xs" style={{ color: SBTA.gray400 }}>
            {trip.isPlanned
              ? `De 1 à ${maxSeats} place${maxSeats > 1 ? 's' : ''} disponible${maxSeats > 1 ? 's' : ''}`
              : 'De 1 à 10 places par réservation'}
          </p>
        </Card>

        <Card style={{ background: trip.isPlanned ? SBTA.greenLight : '#FFF8E6', border: 'none' }}>
          <div className="flex gap-2">
            {trip.isPlanned ? (
              <>
                <Info size={18} color={SBTA.green} className="shrink-0" />
                <p className="text-[13px] leading-relaxed" style={{ color: SBTA.greenDark }}>
                  Voyage planifié. Vos sièges (côte à côte si possible) sont attribués
                  automatiquement dès le paiement et votre billet définitif est généré.
                </p>
              </>
            ) : (
              <>
                <Info size={18} color="#B8860B" className="shrink-0" />
                <p className="text-[13px] leading-relaxed" style={{ color: '#7A5C00' }}>
                  Vous choisissez le nombre de places. Les sièges seront attribués automatiquement
                  (côte à côte ou regroupés) lors de la planification du voyage.
                </p>
              </>
            )}
          </div>
        </Card>

        <Card>
          <div className="space-y-2.5">
            <Row label={`Prix unitaire × ${count}`} value={formatXOF(subtotal)} />
            <Row label={`Frais de service × ${count}`} value={formatXOF(fee)} />
            <div className="border-t pt-2.5" style={{ borderColor: SBTA.gray100 }}>
              <div className="flex items-center justify-between">
                <span className="font-bold" style={{ color: SBTA.ink }}>Total</span>
                <span className="text-xl font-extrabold" style={{ color: SBTA.green }}>{formatXOF(total)}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="p-6">
        <Button full onClick={() => navigate('/sbtamobile/recap')}>Continuer</Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[15px]" style={{ color: SBTA.gray600 }}>{label}</span>
      <span className="font-semibold" style={{ color: SBTA.ink }}>{value}</span>
    </div>
  );
}
