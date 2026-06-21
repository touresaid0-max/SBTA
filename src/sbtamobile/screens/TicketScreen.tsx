import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import jsPDF from 'jspdf';
import {
  CheckCircle2,
  Clock,
  Download,
  Share2,
  MapPin,
  Armchair,
  Bus,
  Loader2,
  Home,
} from 'lucide-react';
import { SBTA, formatXOF } from '../theme';
import { Button, TopBar, Card, Logo } from '../components';
import { Booking, fetchBooking } from '../api';

export default function TicketScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const waveReturn = searchParams.get('wave') === 'success';
  const justPaid = (location.state as { justPaid?: boolean } | null)?.justPaid ?? false;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let attempts = 0;

    async function loadOnce(): Promise<Booking | null> {
      const b = await fetchBooking(id!);
      if (cancelled) return null;
      if (!b) { setError('Billet introuvable.'); return null; }
      setBooking(b);
      return b;
    }

    // When returning from Wave, the webhook may still be settling the payment:
    // poll a few times until it is marked paid before giving up.
    async function run() {
      try {
        const first = await loadOnce();
        setLoading(false);
        if (!first) return;
        if (waveReturn && first.payment_status !== 'paid') {
          setVerifying(true);
          const poll = async () => {
            if (cancelled || attempts >= 10) { setVerifying(false); return; }
            attempts += 1;
            const b = await loadOnce();
            if (b && b.payment_status === 'paid') { setVerifying(false); return; }
            setTimeout(poll, 2500);
          };
          setTimeout(poll, 2500);
        }
      } catch {
        if (!cancelled) { setError('Impossible de charger le billet.'); setLoading(false); }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [id, waveReturn]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-32">
        <Loader2 size={28} className="animate-spin" color={SBTA.green} />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar title="Billet" onBack />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="font-bold" style={{ color: SBTA.ink }}>{error || 'Billet introuvable.'}</p>
          <div className="mt-4">
            <Button onClick={() => navigate('/sbtamobile/tickets')}>Mes billets</Button>
          </div>
        </div>
      </div>
    );
  }

  const confirmed = booking.status === 'confirmed';
  const paid = booking.payment_status === 'paid';
  const qrValue = booking.booking_ref;

  function downloadPdf() {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const b = booking!;
    doc.setFillColor(0, 143, 57);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text('SBTA', 14, 15);
    doc.setFontSize(10);
    doc.text("L'aventure continue", 14, 23);

    doc.setTextColor(20, 30, 25);
    doc.setFontSize(14);
    doc.text(confirmed ? 'Billet définitif' : 'Billet provisoire', 14, 44);
    doc.setFontSize(11);
    let y = 56;
    const line = (k: string, v: string) => {
      doc.setTextColor(110, 120, 115);
      doc.text(k, 14, y);
      doc.setTextColor(20, 30, 25);
      doc.text(v, 80, y);
      y += 9;
    };
    line('Référence', b.booking_ref);
    line('Trajet', `${b.origin_city} -> ${b.destination_city}`);
    if (b.origin_station) line('Gare départ', b.origin_station);
    if (b.destination_station) line('Gare arrivée', b.destination_station);
    line('Date', new Date(b.travel_date).toLocaleDateString('fr-FR'));
    line('Départ', b.departure_time ?? '-');
    line('Places', String(b.seats_count));
    if (confirmed) {
      line('Bus', b.bus_label ?? '-');
      line('Sièges', (b.assigned_seats ?? []).join(', ') || '-');
    }
    line('Statut', confirmed ? 'CONFIRME' : 'EN ATTENTE DE PLANIFICATION');
    line('Total payé', formatXOF(b.total));

    const canvas = qrRef.current?.querySelector('canvas');
    if (canvas) {
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 150, 44, 45, 45);
    }
    doc.save(`${b.booking_ref}.pdf`);
  }

  async function share() {
    const b = booking!;
    const text = `Billet SBTA ${b.booking_ref} - ${b.origin_city} vers ${b.destination_city} le ${new Date(b.travel_date).toLocaleDateString('fr-FR')}.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Billet SBTA', text });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title={confirmed ? 'Billet définitif' : 'Billet provisoire'} onBack />
      <div className="flex-1 space-y-4 px-6 pb-6 pt-2">
        {verifying && (
          <div className="flex items-center gap-2 rounded-2xl p-3" style={{ background: '#E6F8FF' }}>
            <Loader2 size={18} className="animate-spin" color="#0B86B8" />
            <span className="text-sm font-semibold" style={{ color: '#0B6B92' }}>
              Vérification du paiement Wave en cours...
            </span>
          </div>
        )}

        {!verifying && waveReturn && !paid && (
          <div className="flex items-center gap-2 rounded-2xl p-3" style={{ background: '#FFF8E6' }}>
            <Clock size={18} color="#B8860B" />
            <span className="text-sm font-semibold" style={{ color: '#7A5C00' }}>
              Paiement non confirmé pour l'instant. Il sera mis à jour automatiquement.
            </span>
          </div>
        )}

        {(justPaid || (waveReturn && paid)) && (
          <div className="flex items-center gap-2 rounded-2xl p-3" style={{ background: SBTA.greenLight }}>
            <CheckCircle2 size={20} color={SBTA.green} />
            <span className="text-sm font-semibold" style={{ color: SBTA.greenDark }}>
              Paiement confirmé. Votre billet a été généré.
            </span>
          </div>
        )}

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-5 py-4"
            style={{ background: confirmed ? SBTA.green : '#FFF8E6' }}>
            <div className="flex items-center gap-2">
              {confirmed
                ? <CheckCircle2 size={18} color={SBTA.white} />
                : <Clock size={18} color="#B8860B" />}
              <span className="text-sm font-bold"
                style={{ color: confirmed ? SBTA.white : '#7A5C00' }}>
                {confirmed ? 'CONFIRMÉ' : 'EN ATTENTE DE PLANIFICATION'}
              </span>
            </div>
            <span className="rounded-full px-2.5 py-1 text-[11px] font-bold"
              style={{
                background: confirmed ? 'rgba(255,255,255,0.25)' : '#B8860B',
                color: SBTA.white,
              }}>
              {confirmed ? 'Billet définitif' : 'Billet provisoire'}
            </span>
          </div>

          <div className="px-5 py-5">
            <div className="flex justify-center pb-3">
              <Logo width={140} />
            </div>
            <div className="text-center">
              <div className="text-xs" style={{ color: SBTA.gray400 }}>Référence de réservation</div>
              <div className="text-lg font-extrabold tracking-wide" style={{ color: SBTA.ink }}>
                {booking.booking_ref}
              </div>
            </div>

            <div ref={qrRef} className="mt-4 flex justify-center">
              <div className="rounded-2xl p-3" style={{ border: `1px solid ${SBTA.gray200}` }}>
                <QRCodeCanvas value={qrValue} size={150} fgColor={SBTA.ink} level="M" />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <div className="flex flex-col items-center pt-1">
                <div className="h-3 w-3 rounded-full" style={{ background: SBTA.green }} />
                <div className="my-1 w-px flex-1" style={{ background: SBTA.gray200, minHeight: 24 }} />
                <div className="h-3 w-3 rounded-full" style={{ background: SBTA.red }} />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <div className="font-extrabold" style={{ color: SBTA.ink }}>
                    {booking.departure_time ?? '--:--'} · {booking.origin_city}
                  </div>
                  <div className="flex items-center gap-1 text-xs" style={{ color: SBTA.gray600 }}>
                    <MapPin size={12} /> {booking.origin_station ? `Départ · ${booking.origin_station}` : 'Départ'}
                  </div>
                </div>
                <div>
                  <div className="font-extrabold" style={{ color: SBTA.ink }}>
                    {booking.arrival_time ?? '--:--'} · {booking.destination_city}
                  </div>
                  <div className="flex items-center gap-1 text-xs" style={{ color: SBTA.gray600 }}>
                    <MapPin size={12} /> {booking.destination_station ? `Arrivée · ${booking.destination_station}` : 'Arrivée'}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4" style={{ borderColor: SBTA.gray100 }}>
              <Detail label="Date" value={new Date(booking.travel_date).toLocaleDateString('fr-FR')} />
              <Detail label="Places" value={String(booking.seats_count)} />
              {confirmed && (
                <>
                  <Detail
                    label="Bus"
                    value={booking.bus_label ?? '-'}
                    icon={<Bus size={13} color={SBTA.green} />}
                  />
                  <Detail
                    label="Sièges"
                    value={(booking.assigned_seats ?? []).join(', ') || '-'}
                    icon={<Armchair size={13} color={SBTA.green} />}
                  />
                </>
              )}
              <Detail label="Total payé" value={formatXOF(booking.total)} />
            </div>
          </div>
        </Card>

        {!confirmed && (
          <Card style={{ background: '#FFF8E6', border: 'none' }}>
            <p className="text-[13px] leading-relaxed" style={{ color: '#7A5C00' }}>
              Votre paiement est validé. Les sièges seront attribués automatiquement lorsque le chef
              de gare planifiera le voyage. Vous recevrez alors votre billet définitif par
              notification, SMS et email.
            </p>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={downloadPdf}>
            <span className="flex items-center justify-center gap-2">
              <Download size={17} /> PDF
            </span>
          </Button>
          <Button variant="ghost" onClick={share}>
            <span className="flex items-center justify-center gap-2">
              <Share2 size={17} /> Partager
            </span>
          </Button>
        </div>
      </div>

      <div className="p-6">
        <Button full variant="outline" onClick={() => navigate('/sbtamobile/search')}>
          <span className="flex items-center justify-center gap-2">
            <Home size={17} /> Accueil
          </span>
        </Button>
      </div>
    </div>
  );
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs" style={{ color: SBTA.gray400 }}>
        {icon}
        {label}
      </div>
      <div className="text-[15px] font-bold" style={{ color: SBTA.ink }}>{value}</div>
    </div>
  );
}
