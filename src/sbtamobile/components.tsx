import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { ChevronLeft, Home, Ticket, PackageSearch, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SBTA } from './theme';

export function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: '#0c1410', minHeight: '100vh' }} className="flex justify-center">
      <div
        className="relative w-full sm:max-w-[430px] flex flex-col"
        style={{ background: SBTA.bg, minHeight: '100vh', boxShadow: '0 0 60px rgba(0,0,0,0.35)' }}
      >
        {children}
      </div>
    </div>
  );
}

export function TopBar({
  title,
  onBack,
  light,
}: {
  title?: string;
  onBack?: boolean;
  light?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div
      className="sticky top-0 z-20 flex items-center gap-2 px-4 py-3"
      style={{
        background: light ? 'transparent' : SBTA.white,
        borderBottom: light ? 'none' : `1px solid ${SBTA.gray200}`,
      }}
    >
      {onBack && (
        <button
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full transition active:scale-90"
          style={{ background: light ? 'rgba(255,255,255,0.2)' : SBTA.gray100 }}
          aria-label="Retour"
        >
          <ChevronLeft size={22} color={light ? SBTA.white : SBTA.ink} />
        </button>
      )}
      {title && (
        <h1 className="text-lg font-bold" style={{ color: light ? SBTA.white : SBTA.ink }}>
          {title}
        </h1>
      )}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  full?: boolean;
};

export function Button({ variant = 'primary', full, style, children, ...rest }: BtnProps) {
  const base: React.CSSProperties = {
    borderRadius: 14,
    fontWeight: 700,
    fontSize: 16,
    padding: '14px 20px',
    transition: 'transform .12s ease, opacity .12s ease',
    width: full ? '100%' : undefined,
    cursor: 'pointer',
    border: 'none',
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: SBTA.green, color: SBTA.white },
    secondary: { background: SBTA.red, color: SBTA.white },
    outline: { background: 'transparent', color: SBTA.green, border: `2px solid ${SBTA.green}` },
    ghost: { background: SBTA.gray100, color: SBTA.ink },
  };
  return (
    <button
      {...rest}
      className={`active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed ${rest.className ?? ''}`}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; icon?: ReactNode };

export function Field({ label, icon, style, ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold" style={{ color: SBTA.gray600 }}>
        {label}
      </span>
      <div
        className="flex items-center gap-2 rounded-2xl px-4"
        style={{ background: SBTA.white, border: `1.5px solid ${SBTA.gray200}` }}
      >
        {icon}
        <input
          {...rest}
          className="w-full bg-transparent py-3.5 text-[15px] outline-none"
          style={{ color: SBTA.ink, ...style }}
        />
      </div>
    </label>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: SBTA.white, border: `1px solid ${SBTA.gray200}`, ...style }}
    >
      {children}
    </div>
  );
}

export const LOGO_SRC = '/LOGO_SBTA_-1.png';
export const LOGO_ALT = "SBTA - Société Bonikoungou Transport de l'Agnéby";

export function Logo({ width = 240, className = '' }: { width?: number; className?: string }) {
  return (
    <img
      src={LOGO_SRC}
      alt={LOGO_ALT}
      draggable={false}
      className={`h-auto select-none object-contain ${className}`}
      style={{ width }}
    />
  );
}

const NAV_ITEMS = [
  { to: '/sbtamobile/search', icon: Home, label: 'Accueil' },
  { to: '/sbtamobile/tickets', icon: Ticket, label: 'Mes Billets' },
  { to: '/sbtamobile/track-courrier', icon: PackageSearch, label: 'Suivi Courrier' },
  { to: '/sbtamobile/profile', icon: User, label: 'Profil' },
];

export function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav
      className="sticky bottom-0 z-20 grid grid-cols-4 px-2 py-2"
      style={{ background: SBTA.white, borderTop: `1px solid ${SBTA.gray200}` }}
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.to || pathname.startsWith(item.to + '/');
        return (
          <button
            key={item.to}
            onClick={() => navigate(item.to)}
            className="flex flex-col items-center gap-1 py-1 transition active:scale-95"
          >
            <span
              className="flex h-9 w-12 items-center justify-center rounded-full transition"
              style={{ background: active ? SBTA.greenLight : 'transparent' }}
            >
              <item.icon size={24} color={active ? SBTA.green : SBTA.gray400} />
            </span>
            <span
              className="text-[13px]"
              style={{ color: active ? SBTA.green : SBTA.gray400, fontWeight: active ? 800 : 600 }}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
