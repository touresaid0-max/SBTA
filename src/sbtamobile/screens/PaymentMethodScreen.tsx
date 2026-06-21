import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Smartphone, CreditCard } from 'lucide-react';
import { SBTA, PAYMENT_METHODS, formatXOF } from '../theme';
import { Button, TopBar, Card } from '../components';
import { useBooking } from '../BookingContext';

export default function PaymentMethodScreen() {
  const navigate = useNavigate();
  const { draft, setPayment } = useBooking();
  const [selected, setSelected] = useState(draft.paymentMethod || '');

  if (!draft.trip) {
    navigate('/sbtamobile/search', { replace: true });
    return null;
  }

  const total = (draft.trip.price + draft.serviceFee) * draft.seatsCount;

  function next() {
    if (!selected) return;
    setPayment(selected, draft.paymentPhone);
    navigate('/sbtamobile/payment');
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Mode de paiement" onBack />
      <div className="flex-1 space-y-3 px-6 pb-6 pt-2">
        <p className="text-[15px]" style={{ color: SBTA.gray600 }}>
          Choisissez votre moyen de paiement préféré.
        </p>
        {PAYMENT_METHODS.map((m) => {
          const active = selected === m.id;
          const isCard = m.id === 'card';
          const isWave = m.id === 'wave';
          return (
            <button key={m.id} onClick={() => setSelected(m.id)} className="w-full text-left">
              <Card style={{ border: `2px solid ${active ? SBTA.green : SBTA.gray200}` }}>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl"
                    style={{ background: isWave ? SBTA.white : `${m.color}1A` }}>
                    {isCard
                      ? <CreditCard size={20} color={m.color} />
                      : isWave
                        ? <img src="/sbtamobile/wave.JPG" alt="Wave" className="h-full w-full object-contain" />
                        : <Smartphone size={20} color={m.color} />}
                  </div>
                  <span className="flex-1 text-[15px] font-bold" style={{ color: SBTA.ink }}>{m.label}</span>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full"
                    style={{ background: active ? SBTA.green : SBTA.gray100 }}>
                    {active && <Check size={15} color={SBTA.white} />}
                  </div>
                </div>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: SBTA.gray600 }}>Total</span>
          <span className="text-lg font-extrabold" style={{ color: SBTA.green }}>{formatXOF(total)}</span>
        </div>
        <Button full onClick={next} disabled={!selected}>Continuer</Button>
      </div>
    </div>
  );
}
