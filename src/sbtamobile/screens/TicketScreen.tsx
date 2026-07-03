import { useCallback, useEffect, useRef, useState } from 'react';
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
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { SBTA, formatXOF, PAYMENT_METHODS } from '../theme';
import { Button, TopBar, LOGO_SRC, LOGO_ALT } from '../components';
import {
  Booking,
  fetchBooking,
  verifyWavePayment,
  startWaveCheckout,
  uploadTicketFile,
} from '../api';

// L'app mobile est empaquetée avec WebToNative : les téléchargements blob:
// et le partage de FICHIERS (Web Share niveau 2) y sont peu fiables. On
// détecte ce contexte pour privilégier une vraie URL HTTPS (téléchargement
// via le DownloadManager Android, partage via Web Share niveau 1 url).
function isNativeWebView(): boolean {
  return (
    !!(window as any).WebToNative ||
    /wv/.test(navigator.userAgent) ||
    (/Android/i.test(navigator.userAgent) && /Version\/[\d.]+/.test(navigator.userAgent))
  );
}

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
  const waveReturn = searchParams.has('wave');
  const justPaid = (location.state as { justPaid?: boolean } | null)?.justPaid ?? false;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [waveState, setWaveState] = useState<'idle' | 'verifying' | 'paid' | 'failed' | 'pending'>(
    waveReturn ? 'verifying' : 'idle'
  );
  const [waveReason, setWaveReason] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'share' | 'whatsapp' | null>(null);
  const ticketRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);
  const verifyTokenRef = useRef(0);
  const waveStateRef = useRef(waveState);
  waveStateRef.current = waveState;

  const reloadBooking = useCallback(async (): Promise<Booking | null> => {
    const b = await fetchBooking(id!);
    if (!b) { setError('Billet introuvable.'); return null; }
    setBooking(b);
    return b;
  }, [id]);

  // Interroge l'API Wave (via l'edge function) pour connaître le vrai statut du paiement.
  // Réutilisable : appelé au chargement, au retour au premier plan, et via « Vérifier ».
  const runVerification = useCallback((maxAttempts: number) => {
    if (!id) return;
    const token = ++verifyTokenRef.current;
    setWaveState('verifying');
    let attempts = 0;
    const loop = async () => {
      if (token !== verifyTokenRef.current) return;
      attempts += 1;
      const result = await verifyWavePayment(id);
      if (token !== verifyTokenRef.current) return;
      if (result.status === 'paid') {
        await reloadBooking();
        if (token === verifyTokenRef.current) setWaveState('paid');
        return;
      }
      if (result.status === 'failed') {
        setWaveReason(result.reason || 'Le paiement Wave a échoué.');
        setWaveState('failed');
        return;
      }
      if (attempts >= maxAttempts) { setWaveState('pending'); return; }
      setTimeout(loop, 2500);
    };
    loop();
  }, [id, reloadBooking]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const b = await fetchBooking(id);
        if (cancelled) return;
        if (!b) { setError('Billet introuvable.'); setLoading(false); return; }
        setBooking(b);
        setLoading(false);
        if (!waveReturn) return;
        if (b.payment_status === 'paid') { setWaveState('paid'); return; }
        runVerification(6);
      } catch {
        if (!cancelled) { setError('Impossible de charger le billet.'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; verifyTokenRef.current += 1; };
  }, [id, waveReturn, runVerification]);

  // Au retour de Wave, l'app revient au premier plan (l'app Wave était une app séparée) :
  // on relance la vérification pour confirmer le paiement sans action de l'utilisateur.
  useEffect(() => {
    if (!waveReturn) return;
    const recheckOnForeground = () => {
      if (document.visibilityState === 'hidden') return;
      if (waveStateRef.current === 'paid') return;
      runVerification(6);
    };
    document.addEventListener('visibilitychange', recheckOnForeground);
    window.addEventListener('focus', recheckOnForeground);
    return () => {
      document.removeEventListener('visibilitychange', recheckOnForeground);
      window.removeEventListener('focus', recheckOnForeground);
    };
  }, [waveReturn, runVerification]);

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

  // Capture fidèle du e-ticket affiché (logo, QR, infos) en image haute résolution.
  async function captureTicket(): Promise<HTMLCanvasElement | null> {
    const el = ticketRef.current;
    if (!el) return null;
    const { default: html2canvas } = await import('html2canvas');
    return html2canvas(el, {
      scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });
  }

  function canvasToPdf(canvas: HTMLCanvasElement): jsPDF {
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    let w = pageW - margin * 2;
    let h = (canvas.height * w) / canvas.width;
    const maxH = pageH - margin * 2;
    if (h > maxH) {
      h = maxH;
      w = (canvas.width * h) / canvas.height;
    }
    const x = (pageW - w) / 2;
    pdf.addImage(imgData, 'PNG', x, margin, w, h, undefined, 'FAST');
    return pdf;
  }

  async function downloadPdf() {
    setExporting('pdf');
    try {
      const canvas = await captureTicket();
      if (!canvas) throw new Error('capture');
      const pdf = canvasToPdf(canvas);
      const ref = booking!.booking_ref;
      if (isNativeWebView()) {
        // Dans la WebView Android, un blob:/<a download> est intercepté et le
        // fichier reste introuvable. On héberge le PDF puis on ouvre l'URL
        // HTTPS : le DownloadManager natif prend le relais correctement.
        const blob = pdf.output('blob') as Blob;
        const url = await uploadTicketFile(ref, blob, 'pdf');
        window.location.href = url;
      } else {
        pdf.save(`${ref}.pdf`);
      }
    } catch {
      setError('Impossible de générer le PDF du billet.');
    } finally {
      setExporting(null);
    }
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

  // Construit le fichier image (PNG) du e-ticket à partir du rendu affiché.
  async function buildTicketFile(): Promise<File | null> {
    const canvas = await captureTicket();
    if (!canvas) return null;
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (!blob) return null;
    return new File([blob], `${booking!.booking_ref}.png`, { type: 'image/png' });
  }

  // Tente le partage natif du FICHIER image (Web Share niveau 2). Certaines
  // WebView Android exposent navigator.share sans navigator.canShare : on essaie
  // quand même et on ne retombe sur un repli que si l'appel échoue réellement.
  async function tryShareFile(file: File): Promise<boolean> {
    if (typeof navigator.share !== 'function') return false;
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
      return false;
    }
    try {
      await navigator.share({ files: [file], title: 'E-Ticket SBTA', text: shareText() });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return true;
      return false;
    }
  }

  // Partage l'image PNG du e-ticket (mise en page complète + QR) via le
  // partage natif du téléphone. Ordre des tentatives :
  //  1. Web Share de FICHIER (image jointe directement) — idéal quand supporté.
  //  2. Sinon : on héberge le PNG et on partage son URL HTTPS (Web Share niveau
  //     1, largement supporté y compris en WebView).
  //  3. Repli WhatsApp : lien wa.me avec le récapitulatif + l'URL de l'image.
  async function shareTicket(mode: 'share' | 'whatsapp') {
    setExporting(mode);
    try {
      const file = await buildTicketFile();
      if (!file) throw new Error('capture');
      if (await tryShareFile(file)) return;

      const url = await uploadTicketFile(booking!.booking_ref, file, 'png');
      const message = `${shareText()}\n${url}`;

      if (mode === 'whatsapp') {
        window.open(
          `https://wa.me/?text=${encodeURIComponent(message)}`,
          '_blank',
          'noopener,noreferrer'
        );
        return;
      }

      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'E-Ticket SBTA', text: shareText(), url });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
        }
      }
      // Aucun partage natif : on ouvre l'image hébergée pour l'enregistrer/partager.
      window.location.href = url;
    } catch {
      setError('Impossible de partager le billet.');
    } finally {
      setExporting(null);
    }
  }

  async function retryWave() {
    if (!booking) return;
    setRetrying(true);
    try {
      const url = await startWaveCheckout(booking.id);
      const isAndroid =
        /Android/i.test(navigator.userAgent) ||
        navigator.userAgent.includes('wv') ||
        !!(window as any).WebToNative;
      if (isAndroid && url.startsWith('https://')) {
        const wavePath = url.replace('https://', '');
        const fallback = encodeURIComponent(url);
        window.location.href =
          `intent://${wavePath}#Intent;scheme=https;package=com.wave.personal;` +
          `S.browser_fallback_url=${fallback};end`;
        setRetrying(false);
      } else {
        window.location.href = url;
      }
    } catch (e) {
      setWaveReason(e instanceof Error ? e.message : 'Le paiement Wave est indisponible.');
      setRetrying(false);
    }
  }

  // Retour Wave : tant que le paiement n'est pas confirmé, on n'affiche PAS le e-ticket.
  if (waveReturn && !paid && waveState !== 'paid') {
    return (
      <WaveReturnScreen
        state={waveState}
        reason={waveReason}
        retrying={retrying}
        onRetry={retryWave}
        onRecheck={() => runVerification(4)}
        onHome={() => navigate('/sbtamobile/search')}
        onTickets={() => navigate('/sbtamobile/tickets')}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title={confirmed ? 'E-Ticket' : 'Billet provisoire'} onBack />
      <div className="flex-1 space-y-2 px-3 pb-3 pt-1.5 sm:space-y-3 sm:px-4 sm:pb-6 sm:pt-2">
        {(justPaid || (waveReturn && paid)) && (
          <div className="flex items-center gap-2 rounded-2xl p-2.5 sm:p-3" style={{ background: SBTA.greenLight }}>
            <CheckCircle2 size={18} color={SBTA.green} />
            <span className="text-[13px] font-semibold sm:text-sm" style={{ color: SBTA.greenDark }}>
              Paiement confirmé. Votre billet a été généré.
            </span>
          </div>
        )}

        {/* ── E-TICKET ─────────────────────────────────────────── */}
        <div
          ref={ticketRef}
          className="overflow-hidden rounded-[20px]"
          style={{ background: SBTA.white, border: `1px solid ${SBTA.gray200}`, boxShadow: '0 10px 30px rgba(0,0,0,0.06)' }}
        >
          {/* Logo header */}
          <div className="flex justify-center px-4 pt-3 pb-1.5 sm:pt-5 sm:pb-3">
            <img
              src={LOGO_SRC}
              alt={LOGO_ALT}
              draggable={false}
              className="h-auto w-[96px] select-none object-contain sm:w-[130px]"
            />
          </div>

          <div className="mx-4 border-t border-dashed sm:mx-5" style={{ borderColor: SBTA.gray200 }} />

          {/* Title */}
          <div className="px-4 pt-2 text-center sm:px-5 sm:pt-3">
            <div className="text-[20px] font-extrabold leading-none tracking-tight sm:text-[26px]" style={{ color: SBTA.ink }}>
              E-TICKET
            </div>
            <div className="mt-0.5 text-[11px] font-bold tracking-wide sm:text-sm" style={{ color: SBTA.red }}>
              BILLET ÉLECTRONIQUE
            </div>
            <div className="mt-0.5 text-[10px] leading-snug sm:text-[12px]" style={{ color: SBTA.gray600 }}>
              Merci d'arriver à l'embarquement 30 minutes avant le départ
            </div>
          </div>

          {/* Départ / Arrivée */}
          <div className="px-4 pt-2 sm:px-5 sm:pt-3">
            <div className="rounded-xl px-3 py-2.5 sm:px-4 sm:py-3" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <div className="flex items-stretch gap-2">
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[10px] font-bold tracking-wide sm:text-[11px]" style={{ color: SBTA.green }}>DEPART</div>
                  <div className="truncate text-[15px] font-extrabold uppercase sm:text-lg" style={{ color: SBTA.ink }}>
                    {booking.origin_city}
                  </div>
                  {booking.origin_station && (
                    <div className="truncate text-[11px] sm:text-[12px]" style={{ color: SBTA.gray600 }}>{booking.origin_station}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 px-1 pt-3" style={{ color: SBTA.gray400 }}>
                  <Bus size={15} />
                  <span className="tracking-[3px]">·····</span>
                  <Bus size={15} />
                </div>
                <div className="min-w-0 flex-1 text-right">
                  <div className="text-[10px] font-bold tracking-wide sm:text-[11px]" style={{ color: SBTA.green }}>ARRIVÉE</div>
                  <div className="truncate text-[15px] font-extrabold uppercase sm:text-lg" style={{ color: SBTA.ink }}>
                    {booking.destination_city}
                  </div>
                  {booking.destination_station && (
                    <div className="truncate text-[11px] sm:text-[12px]" style={{ color: SBTA.gray600 }}>{booking.destination_station}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Info grid */}
          <div className="px-4 pt-2 sm:px-5">
            <div className="grid grid-cols-5 rounded-xl" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <InfoCell
                icon={<CalendarDays size={15} color={SBTA.ink} />}
                label="DATE DU VOYAGE"
                value={dateShort}
                sub={weekday}
              />
              <InfoCell
                icon={<Clock size={15} color={SBTA.ink} />}
                label="HEURE DE DÉPART"
                value={booking.departure_time ?? '--:--'}
                divider
              />
              <InfoCell
                icon={<Bus size={15} color={SBTA.ink} />}
                label="BUS"
                value={busLabel}
                divider
              />
              <InfoCell
                icon={<Armchair size={15} color={SBTA.ink} />}
                label="SIÈGE(S)"
                value={seatsLabel}
                divider
              />
              <InfoCell
                icon={<FileText size={15} color={SBTA.ink} />}
                label="RÉFÉRENCE"
                value={booking.booking_ref}
                divider
                small
              />
            </div>
          </div>

          {/* Passagers */}
          <div className="px-4 pt-2 sm:px-5">
            <div className="rounded-xl" style={{ border: `1px solid ${SBTA.gray200}`, overflow: 'hidden' }}>
              <div className="px-3 py-1.5 text-[12px] font-bold sm:px-4" style={{ background: SBTA.gray100, color: SBTA.ink }}>
                PASSAGER(S)
              </div>
              <div className="divide-y" style={{ borderColor: SBTA.gray100 }}>
                {(booking.passengers ?? []).length === 0 ? (
                  <div className="px-3 py-2 text-[12px] sm:px-4" style={{ color: SBTA.gray600 }}>
                    {count} {count > 1 ? 'places' : 'place'}
                  </div>
                ) : (
                  booking.passengers.map((p, i) => (
                    <div
                      key={`${p.phone}-${i}`}
                      className="flex items-center justify-between px-3 py-1.5 sm:px-4"
                      style={{ borderColor: SBTA.gray100 }}
                    >
                      <span className="truncate pr-2 text-[13px] font-bold uppercase sm:text-[14px]" style={{ color: SBTA.ink }}>
                        {i + 1}. {p.lastName} {p.firstName}
                      </span>
                      <span className="shrink-0 text-[12px] font-semibold sm:text-[13px]" style={{ color: SBTA.gray600 }}>
                        {p.phone}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div className="px-4 pt-2 sm:px-5">
            <div className="rounded-xl px-3 py-2 sm:px-4 sm:py-3" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <PriceRow label={`Prix unitaire × ${count}`} value={formatXOF(subtotal)} />
              <div className="mt-1" />
              <PriceRow label={`Frais de service × ${count}`} value={formatXOF(fee)} />
              <div className="mt-2 border-t pt-2" style={{ borderColor: SBTA.gray200 }}>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-extrabold sm:text-lg" style={{ color: SBTA.ink }}>TOTAL PAYÉ</span>
                  <span className="text-[17px] font-extrabold sm:text-xl" style={{ color: SBTA.ink }}>{formatXOF(booking.total)}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t pt-2 text-[10px] font-bold sm:text-[11px]"
                style={{ borderColor: SBTA.gray100, color: SBTA.green }}>
                <span>PAIEMENT : {payLabel.toUpperCase()}</span>
                <span>STATUT : {confirmed ? 'CONFIRMÉ' : 'EN ATTENTE'}</span>
                {paymentDate && <span>DATE DE PAIEMENT : {paymentDate}</span>}
              </div>
            </div>
          </div>

          {/* Provisional note */}
          {!confirmed && (
            <div className="px-4 pt-2 sm:px-5">
              <div className="rounded-xl px-3 py-2 sm:px-4 sm:py-3" style={{ background: '#FFF8E6' }}>
                <p className="text-[11px] leading-snug sm:text-[12px] sm:leading-relaxed" style={{ color: '#7A5C00' }}>
                  Votre paiement est validé. Les sièges seront attribués automatiquement lorsque le chef
                  de gare planifiera le voyage. Vous recevrez votre billet définitif par notification, SMS et email.
                </p>
              </div>
            </div>
          )}

          {/* Informations importantes */}
          <div className="px-4 pt-2 sm:px-5">
            <div className="rounded-xl px-3 py-2 sm:px-4 sm:py-3" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <div className="text-[12px] font-bold sm:text-[13px]" style={{ color: SBTA.red }}>INFORMATIONS IMPORTANTES</div>
              <ul className="mt-1 space-y-0.5 sm:mt-2 sm:space-y-1.5">
                {IMPORTANT_NOTES.map((note) => (
                  <li key={note} className="flex gap-1.5 text-[11px] leading-snug sm:text-[12px]" style={{ color: SBTA.gray900 }}>
                    <span style={{ color: SBTA.ink }}>•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* QR code */}
          <div ref={qrRef} className="flex justify-center px-4 pt-2.5 sm:px-5 sm:pt-4">
            <div className="rounded-xl p-2 sm:p-3" style={{ border: `1px solid ${SBTA.gray200}` }}>
              <QRCodeCanvas value={qrValue} size={124} fgColor={SBTA.ink} level="M" className="sm:hidden" />
              <QRCodeCanvas value={qrValue} size={160} fgColor={SBTA.ink} level="M" className="hidden sm:block" />
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 pb-3 pt-2 text-center sm:px-5 sm:pb-6 sm:pt-4">
            <div className="text-[13px] font-extrabold italic sm:text-[15px]" style={{ color: SBTA.green }}>
              Merci de voyager avec SBTA
            </div>
            <div className="text-[11px] italic sm:text-[13px]" style={{ color: SBTA.gray600 }}>
              Le trajet en toute sécurité
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="ghost" onClick={downloadPdf} disabled={exporting !== null} style={{ padding: '9px 8px', fontSize: 13 }}>
            <span className="flex items-center justify-center gap-1.5">
              {exporting === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} PDF
            </span>
          </Button>
          <Button variant="ghost" onClick={() => shareTicket('share')} disabled={exporting !== null} style={{ padding: '9px 8px', fontSize: 13 }}>
            <span className="flex items-center justify-center gap-1.5">
              {exporting === 'share' ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />} Partager
            </span>
          </Button>
          <Button
            onClick={() => shareTicket('whatsapp')}
            disabled={exporting !== null}
            style={{ padding: '9px 8px', fontSize: 13, background: '#25D366', color: SBTA.white }}
          >
            <span className="flex items-center justify-center gap-1.5">
              {exporting === 'whatsapp' ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} />} WhatsApp
            </span>
          </Button>
        </div>
      </div>

      <div className="px-3 pb-3 pt-0 sm:p-6 sm:pt-0">
        <Button full variant="outline" onClick={() => navigate('/sbtamobile/search')}>
          <span className="flex items-center justify-center gap-2">
            <Home size={16} /> Accueil
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
      className="flex flex-col items-center px-1 py-2 text-center sm:py-3"
      style={divider ? { borderLeft: `1px solid ${SBTA.gray200}` } : undefined}
    >
      <div className="text-[8px] font-bold leading-tight tracking-wide" style={{ color: SBTA.gray600 }}>
        {label}
      </div>
      <div className="my-1">{icon}</div>
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

function WaveReturnScreen({
  state,
  reason,
  retrying,
  onRetry,
  onRecheck,
  onHome,
  onTickets,
}: {
  state: 'verifying' | 'paid' | 'failed' | 'pending' | 'idle';
  reason: string;
  retrying: boolean;
  onRetry: () => void;
  onRecheck: () => void;
  onHome: () => void;
  onTickets: () => void;
}) {
  const failed = state === 'failed';
  const pending = state === 'pending';

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="Paiement Wave" onBack />
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
        {state === 'verifying' && (
          <>
            <Loader2 size={44} className="animate-spin" color={SBTA.green} />
            <p className="mt-5 text-lg font-extrabold" style={{ color: SBTA.ink }}>
              Vérification du paiement...
            </p>
            <p className="mt-1 text-sm" style={{ color: SBTA.gray600 }}>
              Nous confirmons votre paiement Wave. Merci de patienter.
            </p>
          </>
        )}

        {failed && (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: '#FDECEC' }}>
              <XCircle size={38} color={SBTA.red} />
            </div>
            <p className="mt-5 text-lg font-extrabold" style={{ color: SBTA.ink }}>
              Paiement non abouti
            </p>
            <p className="mt-2 max-w-[300px] text-sm leading-relaxed" style={{ color: SBTA.gray600 }}>
              {reason || 'Le paiement Wave a échoué. Aucun billet n\u2019a été généré.'}
            </p>
          </>
        )}

        {pending && (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: '#FFF8E6' }}>
              <Clock size={36} color="#B8860B" />
            </div>
            <p className="mt-5 text-lg font-extrabold" style={{ color: SBTA.ink }}>
              Paiement en attente
            </p>
            <p className="mt-2 max-w-[300px] text-sm leading-relaxed" style={{ color: SBTA.gray600 }}>
              Votre paiement Wave n'est pas encore confirmé. Vous pouvez relancer le paiement
              ou réessayer dans un instant.
            </p>
          </>
        )}
      </div>

      {(failed || pending) && (
        <div className="space-y-2 p-6 pt-0">
          {pending && (
            <Button full onClick={onRecheck} disabled={retrying}>
              <span className="flex items-center justify-center gap-2">
                <RefreshCw size={17} /> Vérifier le paiement
              </span>
            </Button>
          )}
          <Button full variant={pending ? 'outline' : undefined} onClick={onRetry} disabled={retrying}>
            {retrying ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin" /> Redirection vers Wave...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw size={17} /> Relancer le paiement
              </span>
            )}
          </Button>
          <Button full variant="outline" onClick={onTickets} disabled={retrying}>
            Mes billets
          </Button>
          <Button full variant="ghost" onClick={onHome} disabled={retrying}>
            <span className="flex items-center justify-center gap-2">
              <Home size={17} /> Accueil
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
