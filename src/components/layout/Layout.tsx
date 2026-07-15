import { useState, useEffect } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, PackagePlus, Truck, TicketCheck, DoorOpen,
  CreditCard, Calendar, Fuel, AlertTriangle, Gauge, ClipboardCheck,
  FileText, Users, DollarSign, Search, Star, ShoppingCart, Car, BarChart2,
} from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import ChatInbox from '../shared/ChatInbox';
import { useAuthStore } from '../../store/authStore';
import { usePresenceHeartbeat } from '../../hooks/usePresenceHeartbeat';
import type { UserRole } from '../../types';

// Bottom nav items per role (max 5 items for comfortable touch targets)
const BOTTOM_NAV: Partial<Record<UserRole, { label: string; path: string; icon: React.ReactNode }[]>> = {
  agent_colis: [
    { label: 'Accueil',   path: '/agent-colis/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Nouveau',   path: '/agent-colis/new',        icon: <PackagePlus className="w-5 h-5" /> },
    { label: 'Suivi',     path: '/track',                  icon: <Truck className="w-5 h-5" /> },
  ],
  guichetier: [
    { label: 'Accueil',      path: '/guichetier/dashboard',         icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Vente',        path: '/guichetier/booking',           icon: <TicketCheck className="w-5 h-5" /> },
    { label: 'Embarquement', path: '/guichetier/boarding',          icon: <DoorOpen className="w-5 h-5" /> },
    { label: 'Caisse',       path: '/guichetier/cash-register',     icon: <CreditCard className="w-5 h-5" /> },
    { label: 'Fidélité',     path: '/guichetier/loyalty-redemption',icon: <Star className="w-5 h-5" /> },
  ],
  chauffeur: [
    { label: 'Accueil',   path: '/chauffeur/dashboard',     icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Voyages',   path: '/chauffeur/trips',         icon: <Calendar className="w-5 h-5" /> },
    { label: 'Carburant', path: '/chauffeur/fuel-vouchers', icon: <Fuel className="w-5 h-5" /> },
    { label: 'Panne',     path: '/chauffeur/breakdown',     icon: <AlertTriangle className="w-5 h-5" /> },
    { label: 'Perf.',     path: '/chauffeur/performance',   icon: <Gauge className="w-5 h-5" /> },
  ],
  mecanicien: [
    { label: 'Accueil', path: '/mecanicien/dashboard',  icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Mes OT',  path: '/mecanicien/work-orders',icon: <ClipboardCheck className="w-5 h-5" /> },
  ],
  chef_gare: [
    { label: 'Accueil',   path: '/chef-gare/dashboard',    icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Planning',  path: '/chef-gare/planning',     icon: <Calendar className="w-5 h-5" /> },
    { label: 'Rapport',   path: '/chef-gare/daily-report', icon: <FileText className="w-5 h-5" /> },
  ],
  rh: [
    { label: 'Accueil',   path: '/rh/dashboard',   icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Employés',  path: '/rh/employees',   icon: <Users className="w-5 h-5" /> },
    { label: 'Salaires',  path: '/rh/payroll',     icon: <DollarSign className="w-5 h-5" /> },
    { label: 'Rapports',  path: '/rh/reports',     icon: <FileText className="w-5 h-5" /> },
  ],
  client: [
    { label: 'Rechercher',    path: '/client/search',       icon: <Search className="w-5 h-5" /> },
    { label: 'Réservations',  path: '/client/reservations', icon: <TicketCheck className="w-5 h-5" /> },
    { label: 'Fidélité',      path: '/client/loyalty',      icon: <Star className="w-5 h-5" /> },
  ],
  charge_achat: [
    { label: 'Accueil',    path: '/charge-achat/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Dépenses',   path: '/charge-achat/expenses',  icon: <ShoppingCart className="w-5 h-5" /> },
    { label: 'Flotte',     path: '/charge-achat/fleet',     icon: <Car className="w-5 h-5" /> },
    { label: 'Rapport',    path: '/charge-achat/report',    icon: <FileText className="w-5 h-5" /> },
    { label: 'Analyse',    path: '/charge-achat/analysis',  icon: <BarChart2 className="w-5 h-5" /> },
  ],
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  const { user } = useAuthStore();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  usePresenceHeartbeat();

  const bottomItems = user ? (BOTTOM_NAV[user.role] ?? null) : null;
  const showChatInbox = user && user.role !== 'admin' && user.role !== 'client';

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--bg-app)' }}>
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={() => setSidebarCollapsed(v => !v)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onMenuToggle={() => setSidebarOpen(v => !v)}
          sidebarCollapsed={sidebarCollapsed}
        />
        <main
          className={`flex-1 overflow-auto${bottomItems ? ' pb-bottom-nav' : ''}`}
          style={{ backgroundColor: 'var(--bg-subtle)' }}
        >
          <Outlet />
        </main>
      </div>

      {/* ── Chat Inbox for non-admin users ────────────────────────────── */}
      {showChatInbox && <ChatInbox />}

      {/* ── Mobile Bottom Navigation ────────────────────────────────────── */}
      {bottomItems && (
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch bottom-nav-safe"
          style={{
            backgroundColor: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            minHeight: 60,
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
          }}
        >
          {bottomItems.map((item) => {
            const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
            return (
              <Link
                key={item.path}
                to={item.path}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative"
                style={{ color: isActive ? 'var(--primary)' : 'var(--text-muted)' }}
              >
                {isActive && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-full"
                    style={{ width: 32, height: 3, backgroundColor: 'var(--primary)' }}
                  />
                )}
                <span
                  className="transition-transform"
                  style={{ transform: isActive ? 'scale(1.15)' : 'scale(1)' }}
                >
                  {item.icon}
                </span>
                <span
                  className="text-center font-medium"
                  style={{ fontSize: 10, lineHeight: 1.2 }}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
