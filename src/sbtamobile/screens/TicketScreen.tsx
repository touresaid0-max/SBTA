import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import jsPDF from 'jspdf';
import {
  CheckCircle2,
  Clock,
  Download,
  Share2,
  MessageCircle,
  CalendarDays,
  Armchair,
  Bus,
  FileText,
  Loader2,
  Home,
} from 'lucide-react';
import { SBTA, formatXOF, PAYMENT_METHODS } from '../theme';
import { Button, TopBar, Card, LOGO_SRC, LOGO_ALT } from '../components';
import { Booking, fetchBooking } from '../api';

const IMPORTANT_NOTES = [
  'Présentez ce e-ticket (QR code) au contrôleur lors de l\u2019embarquement.',
  'Ce billet est personnel, non cessible et non remboursable.',
  'En cas de perte, contactez le service client SBTA.',
  'Conservez votre e-ticket jusqu\u2019à la fin du voyage.',
];

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

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

  const count = booking.seats_count;
  const subtotal = booking.unit_price * count;
  const fee = booking.service_fee * count;

  const travel = new Date(booking.travel_date);
  const dateShort = travel.toLocaleDateString('fr-FR');
  const weekday = capitalize(travel.toLocaleDateString('fr-FR', { weekday: 'long' }));
  const seatsLabel = (booking.assigned_seats ?? []).join(', ') || (confirmed ? '-' : 'À attribuer');
  const busLabel = booking.bus_label ?? (confirmed ? '-' : 'À planifier');
  const payLabel =
    PAYMENT_METHODS.find((m) => m.id === booking.payment_method)?.label ??
    (booking.payment_method ? booking.payment_method.toUpperCase() : '-');
  const paymentDate = paid
    ? new Date(booking.created_at).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

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
    doc.text(confirmed ? 'E-TICKET - Billet définitif' : 'E-TICKET - Billet provisoire', 14, 44);
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
    line('Date', dateShort);
    line('Départ', b.departure_time ?? '-');
    line('Places', String(b.seats_count));
    if (confirmed) {
      line('Bus', busLabel);
      line('Sièges', seatsLabel);
    }
    line('Statut', confirmed ? 'CONFIRME' : 'EN ATTENTE DE PLANIFICATION');
    line('Prix unitaire x ' + count, formatXOF(subtotal));
    line('Frais de service x ' + count, formatXOF(fee));
    line('Total payé', formatXOF(b.total));

    const canvas = qrRef.current?.querySelector('canvas');
    if (canvas) {
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 150, 44, 45, 45);
    }
    doc.save(`${b.booking_ref}.pdf`);
  }

  function shareText(): string {
    const b = booking!;
    return [
      `E-TICKET SBTA`,
      `Réf : ${b.booking_ref}`,
      `${b.origin_city} → ${b.destination_city}`,
      `Date : ${dateShort} · Départ : ${b.departure_time ?? '--:--'}`,
      `Places : ${count}${confirmed ? ` · Sièges : ${seatsLabel}` : ''}`,
      `Total payé : ${formatXOF(b.total)}`,
      `Statut : ${confirmed ? 'CONFIRMÉ' : 'EN ATTENTE'}`,
    ].join('\n');
  }

  async function share() {
    const text = shareText();
    if (navigator.share) {
      try {
        await navigator.share({ title: 'E-Ticket SBTA', text });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  function shareWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(shareText())}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title={confirmed ? 'E-Ticket' : 'Billet provisoire'} onBack />
      <div className="flex-1 space-y-4 px-4 pb-6 pt-2">
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

        {/* ── E-TICKET ─────────────────────────────────────────── */}
        <div
          className="overflow-hidden rounded-[22px]"
          style={{ background: SBTA.white, border: `1px solid ${SBTA.gray200}`, boxShadow: '0 10px 30px rgba(0,0,0,0.06)' }}
        >
          {/* Logo header */}
          <div className="flex justify-center px-5 pt-6 pb-4">
            <img
              src={LOGO_SRC}
              alt={LOGO_ALT}
              draggable={false}
              className="h-auto w-[150px] select-none object-contain"
            />
          </div>

          <div className="mx-5 border-t border-dashed" style={{ borderColor: SBTA.gray200 }} />

          {/* Title */}
          <div className="px-5 pt-4 text-center">
            <div className="text-[30px] font-extrabold leading-none tracking-tight" style={{ color: SBTA.ink }}>
              E-TICKET
            </div>
            <div className="mt-1 text-sm font-bold tracking-wide" style={{ color: SBTA.red }}>
              BILLET ÉLECTRONIQUE
            </div>
            <div className="mt-1.5 text-[12px]" style={{ color: SBTA.gray600 }}>
              Merci d'arriver à l'embarquement 30 minutes avant le départ
            </div>
          </div>

          {/* Départ / Arrivée */}
          <div className="px-5 pt-4">
            <div className="rounded-2xl px-4 py-4" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <div className="flex items-stretch gap-2">
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[11px] font-bold tracking-wide" style={{ color: SBTA.green }}>DEPART</div>
                  <div className="truncate text-lg font-extrabold uppercase" style={{ color: SBTA.ink }}>
                    {booking.origin_city}
                  </div>
                  {booking.origin_station && (
                    <div className="truncate text-[12px]" style={{ color: SBTA.gray600 }}>{booking.origin_station}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 px-1 pt-4" style={{ color: SBTA.gray400 }}>
                  <Bus size={16} />
                  <span className="tracking-[3px]">·····</span>
                  <Bus size={16} />
                </div>
                <div className="min-w-0 flex-1 text-right">
                  <div className="text-[11px] font-bold tracking-wide" style={{ color: SBTA.green }}>ARRIVÉE</div>
                  <div className="truncate text-lg font-extrabold uppercase" style={{ color: SBTA.ink }}>
                    {booking.destination_city}
                  </div>
                  {booking.destination_station && (
                    <div className="truncate text-[12px]" style={{ color: SBTA.gray600 }}>{booking.destination_station}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Info grid */}
          <div className="px-5 pt-3">
            <div className="grid grid-cols-5 rounded-2xl" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <InfoCell
                icon={<CalendarDays size={17} color={SBTA.ink} />}
                label="DATE DU VOYAGE"
                value={dateShort}
                sub={weekday}
              />
              <InfoCell
                icon={<Clock size={17} color={SBTA.ink} />}
                label="HEURE DE DÉPART"
                value={booking.departure_time ?? '--:--'}
                divider
              />
              <InfoCell
                icon={<Bus size={17} color={SBTA.ink} />}
                label="BUS"
                value={busLabel}
                divider
              />
              <InfoCell
                icon={<Armchair size={17} color={SBTA.ink} />}
                label="SIÈGE(S)"
                value={seatsLabel}
                divider
              />
              <InfoCell
                icon={<FileText size={17} color={SBTA.ink} />}
                label="RÉFÉRENCE"
                value={booking.booking_ref}
                divider
                small
              />
            </div>
          </div>

          {/* Passagers */}
          <div className="px-5 pt-4">
            <div className="rounded-2xl" style={{ border: `1px solid ${SBTA.gray200}`, overflow: 'hidden' }}>
              <div className="px-4 py-2.5 text-[13px] font-bold" style={{ background: SBTA.gray100, color: SBTA.ink }}>
                PASSAGER(S)
              </div>
              <div className="divide-y" style={{ borderColor: SBTA.gray100 }}>
                {(booking.passengers ?? []).length === 0 ? (
                  <div className="px-4 py-3 text-[13px]" style={{ color: SBTA.gray600 }}>
                    {count} {count > 1 ? 'places' : 'place'}
                  </div>
                ) : (
                  booking.passengers.map((p, i) => (
                    <div
                      key={`${p.phone}-${i}`}
                      className="flex items-center justify-between px-4 py-2.5"
                      style={{ borderColor: SBTA.gray100 }}
                    >
                      <span className="truncate pr-2 text-[14px] font-bold uppercase" style={{ color: SBTA.ink }}>
                        {i + 1}. {p.lastName} {p.firstName}
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold" style={{ color: SBTA.gray600 }}>
                        {p.phone}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div className="px-5 pt-4">
            <div className="rounded-2xl px-4 py-3" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <PriceRow label={`Prix unitaire × ${count}`} value={formatXOF(subtotal)} />
              <div className="mt-2" />
              <PriceRow label={`Frais de service × ${count}`} value={formatXOF(fee)} />
              <div className="mt-3 border-t pt-3" style={{ borderColor: SBTA.gray200 }}>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-extrabold" style={{ color: SBTA.ink }}>TOTAL PAYÉ</span>
                  <span className="text-xl font-extrabold" style={{ color: SBTA.ink }}>{formatXOF(booking.total)}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-[11px] font-bold"
                style={{ borderColor: SBTA.gray100, color: SBTA.green }}>
                <span>PAIEMENT : {payLabel.toUpperCase()}</span>
                <span>STATUT : {confirmed ? 'CONFIRMÉ' : 'EN ATTENTE'}</span>
                {paymentDate && <span>DATE DE PAIEMENT : {paymentDate}</span>}
              </div>
            </div>
          </div>

          {/* Provisional note */}
          {!confirmed && (
            <div className="px-5 pt-4">
              <div className="rounded-2xl px-4 py-3" style={{ background: '#FFF8E6' }}>
                <p className="text-[12px] leading-relaxed" style={{ color: '#7A5C00' }}>
                  Votre paiement est validé. Les sièges seront attribués automatiquement lorsque le chef
                  de gare planifiera le voyage. Vous recevrez votre billet définitif par notification, SMS et email.
                </p>
              </div>
            </div>
          )}

          {/* Informations importantes */}
          <div className="px-5 pt-4">
            <div className="rounded-2xl px-4 py-3" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <div className="text-[13px] font-bold" style={{ color: SBTA.red }}>INFORMATIONS IMPORTANTES</div>
              <ul className="mt-2 space-y-1.5">
                {IMPORTANT_NOTES.map((note) => (
                  <li key={note} className="flex gap-2 text-[12px] leading-snug" style={{ color: SBTA.gray900 }}>
                    <span style={{ color: SBTA.ink }}>•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* QR code */}
          <div ref={qrRef} className="flex justify-center px-5 pt-5">
            <div className="rounded-2xl p-3" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <QRCodeCanvas value={qrValue} size={170} fgColor={SBTA.ink} level="M" />
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 pb-6 pt-4 text-center">
            <div className="text-[15px] font-extrabold italic" style={{ color: SBTA.green }}>
              Merci de voyager avec SBTA
            </div>
            <div className="text-[13px] italic" style={{ color: SBTA.gray600 }}>
              Le trajet en toute sécurité
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="ghost" onClick={downloadPdf} style={{ padding: '12px 8px', fontSize: 14 }}>
            <span className="flex items-center justify-center gap-1.5">
              <Download size={16} /> PDF
            </span>
          </Button>
          <Button variant="ghost" onClick={share} style={{ padding: '12px 8px', fontSize: 14 }}>
            <span className="flex items-center justify-center gap-1.5">
              <Share2 size={16} /> Partager
            </span>
          </Button>
          <Button
            onClick={shareWhatsApp}
            style={{ padding: '12px 8px', fontSize: 14, background: '#25D366', color: SBTA.white }}
          >
            <span className="flex items-center justify-center gap-1.5">
              <MessageCircle size={16} /> WhatsApp
            </span>
          </Button>
        </div>
      </div>

      <div className="p-6 pt-0">
        <Button full variant="outline" onClick={() => navigate('/sbtamobile/search')}>
          <span className="flex items-center justify-center gap-2">
            <Home size={17} /> Accueil
          </span>
        </Button>
      </div>
    </div>
  );
}

function InfoCell({
  icon,
  label,
  value,
  sub,
  divider,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  divider?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center px-1 py-3 text-center"
      style={divider ? { borderLeft: `1px solid ${SBTA.gray200}` } : undefined}
    >
      <div className="text-[8px] font-bold leading-tight tracking-wide" style={{ color: SBTA.gray600 }}>
        {label}
      </div>
      <div className="my-1.5">{icon}</div>
      <div
        className={`${small ? 'text-[9px]' : 'text-[11px]'} font-extrabold leading-tight`}
        style={{ color: SBTA.ink, wordBreak: 'break-word' }}
      >
        {value}
      </div>
      {sub && <div className="text-[9px]" style={{ color: SBTA.gray600 }}>{sub}</div>}
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[14px]" style={{ color: SBTA.gray900 }}>{label}</span>
      <span className="text-[14px] font-semibold" style={{ color: SBTA.ink }}>{value}</span>
    </div>
  );
}
