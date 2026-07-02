import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, ShieldCheck, Loader2, ArrowRight } from 'lucide-react';
import { SBTA, PAYMENT_METHODS, formatXOF } from '../theme';
import { Button, TopBar, Card } from '../components';
import { createBooking, startWaveCheckout } from '../api';
import { useBooking } from '../BookingContext';
import { useMobileAuth } from '../MobileAuthContext';

export default function PaymentScreen() {
  const navigate = useNavigate();
  const { draft, setPayment } = useBooking();
  const { user } = useMobileAuth();
  const [phone, setPhone] = useState(draft.paymentPhone || user?.phone || '');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  if (!draft.trip || !user) {
    navigate('/sbtamobile/search', { replace: true });
    return null;
  }

  const method = PAYMENT_METHODS.find((m) => m.id === draft.paymentMethod);
  const unit = draft.trip.price;
  const feeTotal = draft.serviceFee * draft.seatsCount;
  const total = unit * draft.seatsCount + feeTotal;
  const isCard = draft.paymentMethod === 'card';
  const isWave = draft.paymentMethod === 'wave';

  async function pay() {
    setError('');
    if (!isCard && !phone.trim()) return setError('Saisissez le numéro de téléphone à débiter.');
    setProcessing(true);
    setPayment(draft.paymentMethod, phone.trim());

    const bookingInput = {
      userId: user!.id,
      trip: draft.trip!,
      travelDate: draft.search!.date,
      slotId: draft.search!.slot.id,
      originStation: draft.search!.originStationName || null,
      destStation: draft.search!.destStationName || null,
      seatsCount: draft.seatsCount,
      passengers: draft.passengers,
      unitPrice: unit,
      serviceFee: feeTotal,
      total,
      paymentMethod: draft.paymentMethod,
      paymentPhone: phone.trim(),
    };

    // Wave: create a pending booking then redirect to the secure Wave checkout page.
    if (isWave) {
      try {
        const booking = await createBooking({ ...bookingInput, pending: true });
        const url = await startWaveCheckout(booking.id);

        const isAdvancedWebView = navigator.userAgent.includes('wv') || !!(window as any).WebToNative;

        if (isAdvancedWebView && url.startsWith('https://')) {
          try {
            const wavePath = url.replace('https://', '');
            const androidIntentUrl = `intent://${wavePath}#Intent;scheme=https;package=com.wave.personal;end`;
            window.location.href = androidIntentUrl;
          } catch (error) {
            console.error('Erreur lors de la conversion du lien Wave Intent', error);
            window.location.href = url;
          }
        } else {
          window.location.href = url;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Le paiement Wave a échoué. Réessayez.');
        setProcessing(false);
      }
      return;
    }

    try {
      await new Promise((r) => setTimeout(r, 1800));
      const booking = await createBooking(bookingInput);
      navigate(`/sbtamobile/ticket/${booking.id}`, { replace: true, state: { justPaid: true } });
    } catch {
      setError('Le paiement a échoué. Réessayez.');
      setProcessing(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Paiement" onBack />
      <div className="flex-1 space-y-4 px-6 pb-6 pt-2">
        <Card style={{ textAlign: 'center', padding: '24px 20px' }}>
          <div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl"
            style={{ background: isWave ? SBTA.white : `${method?.color ?? SBTA.green}1A` }}>
            {isWave ? (
              <img src="/sbtamobile/wave.JPG" alt="Wave" className="h-full w-full object-contain" />
            ) : (
              <span className="text-lg font-extrabold" style={{ color: method?.color ?? SBTA.green }}>
                {method?.label.charAt(0) ?? 'P'}
              </span>
            )}
          </div>
          <p className="mt-3 font-bold" style={{ color: SBTA.ink }}>{method?.label ?? 'Paiement'}</p>
          <p className="mt-1 text-sm" style={{ color: SBTA.gray600 }}>Montant à régler</p>
          <p className="mt-1 text-3xl font-extrabold" style={{ color: SBTA.green }}>{formatXOF(total)}</p>
        </Card>

        {draft.search && (
          <Card>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-extrabold" style={{ color: SBTA.ink }}>{draft.search.originName}</div>
                {draft.search.originStationName && <div className="text-[12px] font-semibold" style={{ color: SBTA.green }}>{draft.search.originStationName}</div>}
              </div>
              <ArrowRight size={16} color={SBTA.gray400} className="shrink-0" />
              <div className="min-w-0 flex-1 text-right">
                <div className="text-[15px] font-extrabold" style={{ color: SBTA.ink }}>{draft.search.destName}</div>
                {draft.search.destStationName && <div className="text-[12px] font-semibold" style={{ color: SBTA.red }}>{draft.search.destStationName}</div>}
              </div>
            </div>
          </Card>
        )}

        {!isCard && (
          <div>
            <span className="mb-1.5 block text-sm font-semibold" style={{ color: SBTA.gray600 }}>
              Numéro {method?.label}
            </span>
            <div className="flex items-center gap-2 rounded-2xl px-4" style={{ background: SBTA.white, border: `1.5px solid ${SBTA.gray200}` }}>
              <Phone size={18} color={SBTA.gray400} />
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07 00 00 00 00"
                className="w-full bg-transparent py-3.5 text-[15px] outline-none" style={{ color: SBTA.ink }} />
            </div>
          </div>
        )}

        <Card style={{ background: SBTA.greenLight, border: 'none' }}>
          <div className="flex gap-2">
            <ShieldCheck size={18} color={SBTA.green} className="shrink-0" />
            <p className="text-[13px] leading-relaxed" style={{ color: SBTA.greenDark }}>
              {isWave
                ? 'Vous allez être redirigé vers la page sécurisée Wave pour confirmer le paiement. Votre billet est validé automatiquement après confirmation.'
                : 'Paiement sécurisé. Une validation vous sera demandée sur votre téléphone (simulation de démonstration).'}
            </p>
          </div>
        </Card>

        {error && <div className="text-sm font-medium" style={{ color: SBTA.redDark }}>{error}</div>}
      </div>

      <div className="p-6">
        <Button full onClick={pay} disabled={processing}>
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={18} className="animate-spin" /> {isWave ? 'Redirection vers Wave...' : 'Traitement...'}
            </span>
          ) : isWave ? (
            <span className="flex items-center justify-center gap-2">
              <img src="/sbtamobile/wave.JPG" alt="Wave" className="h-5 w-5 rounded object-contain bg-white" /> Payer avec Wave · {formatXOF(total)}
            </span>
          ) : (
            `Payer ${formatXOF(total)}`
          )}
        </Button>
      </div>
    </div>
  );
}
