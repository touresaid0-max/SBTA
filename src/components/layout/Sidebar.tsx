import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, MapPin, Building2, Users, Bus, Route, Calendar,
  TicketCheck, CreditCard, Fuel, Receipt, Wrench, Package, Star,
  FileText, Settings, Search, Gift, CircleUser as UserCircle, Gauge,
  ClipboardList, ClipboardCheck, AlertTriangle, CalendarClock, CalendarDays, Droplet,
  DoorOpen, Shield, Monitor, TrendingUp, UserCog, DollarSign, Banknote,
  PackagePlus, Truck, ChevronLeft, ChevronRight, ChevronDown, X, ShoppingCart, Car, BarChart2,
  Droplets, ArrowDownCircle, ArrowUpCircle, Zap,
  Wallet, MinusCircle, UserX, MessageSquareWarning, BookOpen, FileCheck, Landmark,
  PieChart, Luggage, ScrollText, Archive, Wifi, Container,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import type { UserRole } from '../../types';

interface MenuItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

interface MenuGroup {
  label: string;
  icon: React.ReactNode;
  children: MenuItem[];
}

type NavEntry = MenuItem | MenuGroup;

const isGroup = (e: NavEntry): e is MenuGroup => 'children' in e;

const SIDEBAR_MENUS: Record<UserRole, NavEntry[]> = {
  admin: [
    { label: 'Dashboard',          path: '/admin/dashboard',    icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Villes',             path: '/admin/cities',       icon: <MapPin className="w-5 h-5" /> },
    { label: 'Gares',              path: '/admin/stations',     icon: <Building2 className="w-5 h-5" /> },
    { label: 'Guichets',           path: '/admin/counters',     icon: <Monitor className="w-5 h-5" /> },
    { label: 'Sociétés',           path: '/admin/companies',    icon: <Building2 className="w-5 h-5" /> },
    { label: 'Utilisateurs',       path: '/admin/users',        icon: <Users className="w-5 h-5" /> },
    { label: 'Rôles & Droits',     path: '/admin/roles',        icon: <Shield className="w-5 h-5" /> },
    { label: 'Bus',                path: '/admin/buses',        icon: <Bus className="w-5 h-5" /> },
    { label: 'Itinéraires',        path: '/admin/routes',       icon: <Route className="w-5 h-5" /> },
    { label: 'Planification',      path: '/admin/schedules',    icon: <Calendar className="w-5 h-5" /> },
    { label: 'Stations',           path: '/admin/fuel-stations', icon: <Fuel className="w-5 h-5" /> },
    { label: 'Cuves',              path: '/admin/fuel-tanks',    icon: <Droplets className="w-5 h-5" /> },
    { label: 'Svc Carburant',      path: '/admin/fuel-services', icon: <Fuel className="w-5 h-5" /> },
    { label: 'Charges',            path: '/admin/expenses',      icon: <Receipt className="w-5 h-5" /> },
    { label: 'Garages',            path: '/admin/garages',      icon: <Wrench className="w-5 h-5" /> },
    { label: "Journal d'audit",    path: '/admin/audit-logs',   icon: <ScrollText className="w-5 h-5" /> },
    { label: 'Connexion',          path: '/admin/connexion',    icon: <Wifi className="w-5 h-5" /> },
    { label: 'Archives',           path: '/admin/archives',     icon: <Archive className="w-5 h-5" /> },
  ],
  daf: [
    { label: 'Tableau de bord',    path: '/daf/dashboard',          icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Rapport financier',  path: '/daf/financial-report',   icon: <BarChart2 className="w-5 h-5" /> },
    { label: "Rapport d'exploitation", path: '/daf/consolidated-report', icon: <PieChart className="w-5 h-5" /> },
    { label: 'Compte de résultat', path: '/daf/compte-resultat',    icon: <ScrollText className="w-5 h-5" /> },
    { label: 'Performance bus',    path: '/daf/bus-performance',    icon: <TrendingUp className="w-5 h-5" /> },
    { label: 'Pannes & Répartitions', path: '/daf/breakdowns', icon: <Wrench className="w-5 h-5" /> },
    { label: 'Rapports',           path: '/reports',                icon: <FileText className="w-5 h-5" /> },
  ],
  comptable: [
    { label: 'Dashboard',        path: '/comptable/dashboard',        icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Dépenses',         path: '/comptable/expenses',         icon: <ShoppingCart className="w-5 h-5" /> },
    { label: 'Parc véhicules',   path: '/comptable/fleet',            icon: <Car className="w-5 h-5" /> },
    { label: 'Rapport hebdo',    path: '/comptable/report',           icon: <FileText className="w-5 h-5" /> },
    { label: 'Stock',            path: '/comptable/stock',            icon: <Package className="w-5 h-5" /> },
    { label: 'Mvts stock',       path: '/comptable/stock/movements',  icon: <BarChart2 className="w-5 h-5" /> },
  ],
  gestionnaire: [
    { label: 'Dashboard',          path: '/gestionnaire/dashboard',        icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Rapport financier',  path: '/gestionnaire/financial-report', icon: <BarChart2 className="w-5 h-5" /> },
    { label: 'Perf. bus',          path: '/gestionnaire/bus-performance',  icon: <TrendingUp className="w-5 h-5" /> },
    { label: 'Activités bus',      path: '/gestionnaire/bus-activity',     icon: <Bus className="w-5 h-5" /> },
    { label: 'Rapports',           path: '/gestionnaire/reports',          icon: <FileText className="w-5 h-5" /> },
    { label: 'Chauffeurs',         path: '/gestionnaire/drivers',         icon: <Users className="w-5 h-5" /> },
    { label: 'Rapport chauffeurs', path: '/gestionnaire/drivers-report',  icon: <FileText className="w-5 h-5" /> },
    { label: 'Pannes',             path: '/gestionnaire/breakdowns',       icon: <Wrench className="w-5 h-5" /> },
    { label: 'Rapport pannes',     path: '/reports/breakdowns',            icon: <FileText className="w-5 h-5" /> },
  ],
  chauffeur: [
    { label: 'Dashboard',      path: '/chauffeur/dashboard',     icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Mes voyages',    path: '/chauffeur/trips',         icon: <Calendar className="w-5 h-5" /> },
    { label: 'Bons carburant', path: '/chauffeur/fuel-vouchers', icon: <Fuel className="w-5 h-5" /> },
    { label: 'Signaler panne', path: '/chauffeur/breakdown',     icon: <AlertTriangle className="w-5 h-5" /> },
    { label: 'Mes pannes',     path: '/chauffeur/my-breakdowns', icon: <ClipboardList className="w-5 h-5" /> },
    { label: 'Performance',    path: '/chauffeur/performance',   icon: <Gauge className="w-5 h-5" /> },
  ],
  guichetier: [
    { label: 'Dashboard',        path: '/guichetier/dashboard',         icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Vente de billet',  path: '/guichetier/booking',           icon: <TicketCheck className="w-5 h-5" /> },
    { label: 'Charges départs',  path: '/guichetier/charges',           icon: <Banknote className="w-5 h-5" /> },
    { label: 'Embarquement',     path: '/guichetier/boarding',          icon: <DoorOpen className="w-5 h-5" /> },
    { label: 'Caisse',           path: '/guichetier/cash-register',     icon: <CreditCard className="w-5 h-5" /> },
    { label: 'Fidélité',         path: '/guichetier/loyalty-redemption',icon: <Gift className="w-5 h-5" /> },
  ],
  chef_garage: [
    { label: 'Dashboard',      path: '/garage/dashboard',           icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Pannes reçues',  path: '/garage/breakdowns',          icon: <AlertTriangle className="w-5 h-5" /> },
    { label: 'Diagnostics',    path: '/garage/diagnostics',         icon: <ClipboardList className="w-5 h-5" /> },
    { label: 'Devis',          path: '/garage/quotes',              icon: <FileText className="w-5 h-5" /> },
    { label: 'OT',             path: '/garage/work-orders',         icon: <ClipboardCheck className="w-5 h-5" /> },
    { label: 'Maintenance',    path: '/garage/maintenance-schedule',icon: <CalendarClock className="w-5 h-5" /> },
  ],
  mecanicien: [
    { label: 'Dashboard', path: '/mecanicien/dashboard',  icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Mes OT',    path: '/mecanicien/work-orders',icon: <ClipboardCheck className="w-5 h-5" /> },
  ],
  planificateur: [
    { label: 'Dashboard',         path: '/planificateur/dashboard',   icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Calendrier voyages',path: '/planificateur/calendar',    icon: <Calendar className="w-5 h-5" /> },
    { label: 'Disponibilités',    path: '/planificateur/availability',icon: <Bus className="w-5 h-5" /> },
  ],
  pompiste: [
    { label: 'Tableau de bord',    path: '/pompiste/dashboard',        icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Dépotages',          path: '/pompiste/depotages',        icon: <ArrowDownCircle className="w-5 h-5" /> },
    { label: 'Enlèvements',        path: '/pompiste/enlevements',      icon: <ArrowUpCircle className="w-5 h-5" /> },
    { label: 'Fournisseurs',       path: '/pompiste/suppliers',        icon: <Building2 className="w-5 h-5" /> },
    { label: 'Produits',           path: '/pompiste/products',         icon: <Package className="w-5 h-5" /> },
    { label: 'Bons de commande',   path: '/pompiste/purchase-orders',  icon: <FileText className="w-5 h-5" /> },
    { label: 'Rapports',           path: '/pompiste/reports',          icon: <BarChart2 className="w-5 h-5" /> },
  ],
  chef_gare: [
    { label: 'Dashboard',           path: '/chef-gare/dashboard',    icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Planning départs',    path: '/chef-gare/planning',     icon: <Calendar className="w-5 h-5" /> },
    { label: 'Écran d\'affichage',  path: '/chef-gare/display',      icon: <Monitor className="w-5 h-5" /> },
    { label: 'Guichets',            path: '/chef-gare/counters',     icon: <Monitor className="w-5 h-5" /> },
    { label: 'Bagagistes',          path: '/chef-gare/baggage-handlers', icon: <Luggage className="w-5 h-5" /> },
    { label: 'Ventes guichets',     path: '/chef-gare/sales',        icon: <TicketCheck className="w-5 h-5" /> },
    { label: 'Rapport convois',     path: '/chef-gare/convoys',      icon: <Truck className="w-5 h-5" /> },
    { label: 'Rapport journalier',  path: '/chef-gare/daily-report', icon: <FileText className="w-5 h-5" /> },
  ],
  bagagiste: [
    { label: 'Vente bagages', path: '/bagagiste/baggage', icon: <Luggage className="w-5 h-5" /> },
    { label: 'Rapport bagages', path: '/bagagiste/report', icon: <FileText className="w-5 h-5" /> },
  ],
  rh: [
    { label: 'Dashboard', path: '/rh/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    {
      label: 'Personnel',
      icon: <Users className="w-5 h-5" />,
      children: [
        { label: 'Employés',             path: '/rh/employees',    icon: <Users className="w-5 h-5" /> },
        { label: 'Chauffeurs',           path: '/rh/drivers',      icon: <Bus className="w-5 h-5" /> },
        { label: 'Suspensions',          path: '/rh/suspensions',  icon: <UserX className="w-5 h-5" /> },
        { label: 'Employés désactivés',  path: '/rh/deactivated',  icon: <UserX className="w-5 h-5" /> },
        { label: "Demandes d'explication", path: '/rh/explanations', icon: <MessageSquareWarning className="w-5 h-5" /> },
      ],
    },
    {
      label: 'Paie',
      icon: <DollarSign className="w-5 h-5" />,
      children: [
        { label: 'Bulletins de paie', path: '/rh/pay-slips',     icon: <FileText className="w-5 h-5" /> },
        { label: 'Livre de paie',     path: '/rh/payroll-book',  icon: <BookOpen className="w-5 h-5" /> },
        { label: 'Masse salariale',   path: '/rh/masse-salariale', icon: <TrendingUp className="w-5 h-5" /> },
        { label: 'Primes & rubriques', path: '/rh/primes',       icon: <Gift className="w-5 h-5" /> },
        { label: 'Retenues',          path: '/rh/deductions',    icon: <MinusCircle className="w-5 h-5" /> },
        { label: 'Déclarations',      path: '/rh/declarations',  icon: <FileCheck className="w-5 h-5" /> },
      ],
    },
    {
      label: 'Congés et Permissions',
      icon: <CalendarClock className="w-5 h-5" />,
      children: [
        { label: 'Congés & Permissions', path: '/rh/leave',  icon: <CalendarDays className="w-5 h-5" /> },
        { label: 'Plafonds de congés',   path: '/rh/leave-ceiling', icon: <CalendarClock className="w-5 h-5" /> },
        { label: 'Rapport annuel',       path: '/rh/leave-report', icon: <FileText className="w-5 h-5" /> },
      ],
    },
    {
      label: 'Gestion financière du personnel',
      icon: <Landmark className="w-5 h-5" />,
      children: [
        { label: 'Emprunts / Avances', path: '/rh/loans', icon: <Wallet className="w-5 h-5" /> },
      ],
    },
    {
      label: 'Rapports RH',
      icon: <FileText className="w-5 h-5" />,
      children: [
        { label: 'Rapport des employés',                path: '/rh/reports?r=employes',     icon: <Users className="w-5 h-5" /> },
        { label: 'Rapport des chauffeurs',              path: '/rh/reports?r=chauffeurs',   icon: <Bus className="w-5 h-5" /> },
        { label: 'Rapport des suspensions',             path: '/rh/reports?r=suspensions',  icon: <UserX className="w-5 h-5" /> },
        { label: "Rapport des demandes d'explication",  path: '/rh/reports?r=explications', icon: <MessageSquareWarning className="w-5 h-5" /> },
        { label: 'Rapport de masse salariale',          path: '/rh/reports?r=masse',        icon: <TrendingUp className="w-5 h-5" /> },
        { label: 'Rapport des retenues',                path: '/rh/reports?r=retenues',     icon: <MinusCircle className="w-5 h-5" /> },
        { label: 'Rapport des emprunts / avances',      path: '/rh/reports?r=emprunts',     icon: <Wallet className="w-5 h-5" /> },
        { label: 'Rapport des déclarations sociales',   path: '/rh/reports?r=declarations', icon: <FileCheck className="w-5 h-5" /> },
      ],
    },
  ],
  client: [
    { label: 'Rechercher',       path: '/client/search',       icon: <Search className="w-5 h-5" /> },
    { label: 'Mes réservations', path: '/client/reservations', icon: <TicketCheck className="w-5 h-5" /> },
    { label: 'Fidélité',         path: '/client/loyalty',      icon: <Star className="w-5 h-5" /> },
    { label: 'Récompenses',      path: '/client/rewards',      icon: <Gift className="w-5 h-5" /> },
    { label: 'Mon profil',       path: '/client/profile',      icon: <UserCircle className="w-5 h-5" /> },
  ],
  superviseur_colis: [
    { label: 'Dashboard',   path: '/superviseur-colis/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Tous les courriers',path: '/superviseur-colis/parcels', icon: <Package className="w-5 h-5" /> },
    { label: 'Recettes par gare', path: '/superviseur-colis/revenue', icon: <Banknote className="w-5 h-5" /> },
    { label: 'Frais SMS par gare', path: '/superviseur-colis/sms-fees', icon: <MessageSquareWarning className="w-5 h-5" /> },
    { label: 'Depenses par gare', path: '/superviseur-colis/expenses', icon: <Wallet className="w-5 h-5" /> },
    { label: 'Rapport consolide', path: '/superviseur-colis/consolidated', icon: <BarChart2 className="w-5 h-5" /> },
  ],
  agent_colis: [
    { label: 'Dashboard',     path: '/agent-colis/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Nouveau courrier', path: '/agent-colis/new',       icon: <PackagePlus className="w-5 h-5" /> },
    { label: 'Suivi courrier',   path: '/track',                 icon: <Truck className="w-5 h-5" /> },
    { label: 'Depenses & Ratios', path: '/agent-colis/expenses', icon: <Wallet className="w-5 h-5" /> },
    { label: 'Rapport depenses', path: '/agent-colis/expense-report', icon: <BarChart2 className="w-5 h-5" /> },
    { label: 'Rapport Frais SMS', path: '/agent-colis/sms-fees', icon: <MessageSquareWarning className="w-5 h-5" /> },
  ],
  charge_achat: [
    { label: 'Dashboard',       path: '/charge-achat/dashboard',          icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Charges variables', path: '/charge-achat/expenses',         icon: <ShoppingCart className="w-5 h-5" /> },
    { label: 'Charges fixes',   path: '/charge-achat/fixed-expenses',     icon: <Zap className="w-5 h-5" /> },
    { label: 'Types charges',   path: '/charge-achat/fixed-expense-types', icon: <Settings className="w-5 h-5" /> },
    { label: 'Rapport fixes',   path: '/charge-achat/fixed-expenses-report', icon: <FileText className="w-5 h-5" /> },
    { label: 'Parc véhicules',  path: '/charge-achat/fleet',              icon: <Car className="w-5 h-5" /> },
    { label: 'Rapport hebdo',   path: '/charge-achat/report',             icon: <FileText className="w-5 h-5" /> },
    { label: 'Analyse',         path: '/charge-achat/analysis',           icon: <BarChart2 className="w-5 h-5" /> },
  ],
  carburant: [
    { label: 'Tableau de bord',     path: '/carburant/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    {
      label: 'Opérations',
      icon: <ClipboardList className="w-5 h-5" />,
      children: [
        { label: 'Nouveau prélèvement', path: '/carburant/new',      icon: <Fuel className="w-5 h-5" /> },
        { label: 'Stations',            path: '/carburant/stations', icon: <MapPin className="w-5 h-5" /> },
      ],
    },
    {
      label: 'Rapports',
      icon: <FileText className="w-5 h-5" />,
      children: [
        { label: 'Rapports',          path: '/carburant/report',             icon: <BarChart2 className="w-5 h-5" /> },
        { label: 'Conso. par client', path: '/carburant/consommation-client', icon: <Users className="w-5 h-5" /> },
        { label: 'Rapport Cuves',     path: '/carburant/tank-report',        icon: <Container className="w-5 h-5" /> },
        { label: 'Rapport Dépotage',  path: '/carburant/depotage-report',    icon: <ArrowDownCircle className="w-5 h-5" /> },
      ],
    },
  ],
  responsable_assurance: [
    { label: 'Tableau de bord', path: '/assurance/dashboard',  icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Assurances',      path: '/assurance/insurances', icon: <Shield className="w-5 h-5" /> },
    { label: 'Assureurs',       path: '/assurance/insurers',   icon: <Building2 className="w-5 h-5" /> },
    { label: 'Rapports',        path: '/assurance/reports',    icon: <FileText className="w-5 h-5" /> },
  ],
  gerant_principal: [
    { label: 'Tableau de bord',    path: '/gerant-principal/dashboard',  icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Articles & Pièces',  path: '/gerant-principal/articles',   icon: <Package className="w-5 h-5" /> },
    { label: 'Entrées de stock',   path: '/gerant-principal/entries',    icon: <ArrowDownCircle className="w-5 h-5" /> },
    { label: 'Sorties de stock',   path: '/gerant-principal/exits',      icon: <ArrowUpCircle className="w-5 h-5" /> },
    { label: 'Gestion pneus',      path: '/gerant-principal/tires',      icon: <Fuel className="w-5 h-5" /> },
    { label: 'Rapports',           path: '/gerant-principal/reports',    icon: <FileText className="w-5 h-5" /> },
  ],
  responsable_logistique: [
    { label: 'Tableau de bord', path: '/logistique/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Parc véhicules',  path: '/logistique/vehicles',  icon: <Bus className="w-5 h-5" /> },
    { label: 'Bus / Chauffeurs', path: '/logistique/drivers',   icon: <Users className="w-5 h-5" /> },
    { label: 'Documents',       path: '/logistique/documents', icon: <FileText className="w-5 h-5" /> },
    { label: 'Prestataires',    path: '/logistique/providers', icon: <Building2 className="w-5 h-5" /> },
    { label: 'Types de services', path: '/logistique/service-types', icon: <Settings className="w-5 h-5" /> },
    { label: 'Rapports',        path: '/logistique/reports',   icon: <BarChart2 className="w-5 h-5" /> },
    { label: 'Synthèse bus',   path: '/logistique/bus-synthesis', icon: <Bus className="w-5 h-5" /> },
    { label: 'Bilan',          path: '/logistique/bilan',         icon: <ClipboardList className="w-5 h-5" /> },
  ],
  agent_reservation: [
    { label: 'Tableau de bord',    path: '/agent-reservation/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { label: 'Utilisateurs Mobile', path: '/agent-reservation/users',    icon: <Users className="w-5 h-5" /> },
    { label: 'Liste des billets',  path: '/agent-reservation/tickets',   icon: <TicketCheck className="w-5 h-5" /> },
    { label: 'Rapports de ventes', path: '/agent-reservation/sales',     icon: <BarChart2 className="w-5 h-5" /> },
    { label: "Rapports d'analyse", path: '/agent-reservation/analytics', icon: <PieChart className="w-5 h-5" /> },
    { label: 'Frais de service',   path: '/agent-reservation/settings',  icon: <Settings className="w-5 h-5" /> },
    { label: 'FAQ',                path: '/agent-reservation/faq',       icon: <BookOpen className="w-5 h-5" /> },
    { label: "Politique d'annulation", path: '/agent-reservation/policies', icon: <Shield className="w-5 h-5" /> },
  ],
};

interface SidebarProps {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

export default function Sidebar({ open, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const location = useLocation();
  const { user } = useAuthStore();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  if (!user) return null;

  const menuItems = SIDEBAR_MENUS[user.role] || [];
  const sidebarW = collapsed ? 72 : 256;
  const currentFull = location.pathname + location.search;

  const matchPath = (path: string) => {
    if (path.includes('?')) return currentFull === path;
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const renderLeaf = (item: MenuItem, isCollapsed: boolean, onNavigate?: () => void) => {
    const isActive = matchPath(item.path);
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={onNavigate}
        title={isCollapsed ? item.label : undefined}
        className="flex items-center rounded-xl transition-all duration-150 group relative"
        style={{
          gap: isCollapsed ? 0 : 12,
          padding: isCollapsed ? '10px 0' : '10px 12px',
          justifyContent: isCollapsed ? 'center' : 'flex-start',
          backgroundColor: isActive ? 'var(--primary-light)' : 'transparent',
          color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
          fontWeight: isActive ? 600 : 400,
        }}
        onMouseEnter={e => {
          if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-subtle)';
        }}
        onMouseLeave={e => {
          if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        }}
      >
        {isActive && (
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full"
            style={{ height: 28, backgroundColor: 'var(--primary)' }}
          />
        )}
        <span className="flex-shrink-0">{item.icon}</span>
        {!isCollapsed && <span className="text-sm truncate">{item.label}</span>}
        {isCollapsed && (
          <span
            className="absolute left-full ml-3 px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg"
            style={{ backgroundColor: 'var(--text-primary)', color: '#fff' }}
          >
            {item.label}
          </span>
        )}
      </Link>
    );
  };

  const renderEntries = (entries: NavEntry[], isCollapsed: boolean, onNavigate?: () => void) =>
    entries.map(entry => {
      if (!isGroup(entry)) return renderLeaf(entry, isCollapsed, onNavigate);

      // Collapsed desktop: flatten children to icon-only links so all stay reachable.
      if (isCollapsed) {
        return (
          <div key={entry.label} className="space-y-0.5">
            {entry.children.map(child => renderLeaf(child, true, onNavigate))}
          </div>
        );
      }

      const autoOpen = entry.children.some(c => matchPath(c.path));
      const isOpen = openGroups[entry.label] ?? autoOpen;
      return (
        <div key={entry.label}>
          <button
            type="button"
            onClick={() => setOpenGroups(s => ({ ...s, [entry.label]: !isOpen }))}
            className="flex items-center w-full rounded-xl transition-colors"
            style={{ gap: 12, padding: '10px 12px', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-subtle)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          >
            <span className="flex-shrink-0">{entry.icon}</span>
            <span className="text-sm font-semibold flex-1 text-left truncate">{entry.label}</span>
            <ChevronDown
              className="w-4 h-4 flex-shrink-0 transition-transform"
              style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            />
          </button>
          {isOpen && (
            <div
              className="mt-0.5 space-y-0.5 pl-3 ml-4"
              style={{ borderLeft: '1px solid var(--border)' }}
            >
              {entry.children.map(child => renderLeaf(child, false, onNavigate))}
            </div>
          )}
        </div>
      );
    });

  return (
    <>
      {/* ── DESKTOP sidebar ─────────────────────────────────────────────── */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 transition-all duration-300 relative"
        style={{
          width: sidebarW,
          minHeight: '100vh',
          backgroundColor: 'var(--surface)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* Logo zone */}
        <div
          className="flex items-center gap-3 px-4 h-16 flex-shrink-0 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <img
            src="/logosbta.png"
            alt="SBTA"
            className="w-9 h-9 object-contain flex-shrink-0"
          />
          {!collapsed && (
            <div className="min-w-0 overflow-hidden">
              <p className="text-base font-bold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>SBTA</p>
              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user.role.replace('_', ' ').toUpperCase()}</p>
            </div>
          )}
          {/* Collapse toggle */}
          <button
            onClick={onToggleCollapse}
            className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title={collapsed ? 'Développer' : 'Réduire'}
          >
            {collapsed
              ? <ChevronRight className="w-4 h-4" />
              : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {renderEntries(menuItems, collapsed)}
        </nav>

        {/* User zone desktop */}
        {!collapsed && (
          <div
            className="px-3 py-3 border-t flex items-center gap-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'var(--primary-light)' }}
            >
              {user.avatar_url
                ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                : <UserCog className="w-4 h-4" style={{ color: 'var(--primary)' }} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user.full_name}</p>
              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
            </div>
          </div>
        )}
      </aside>

      {/* ── MOBILE drawer ───────────────────────────────────────────────── */}
      <aside
        className="fixed top-0 left-0 h-full z-50 flex flex-col lg:hidden transition-transform duration-300 ease-in-out"
        style={{
          width: 280,
          backgroundColor: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          boxShadow: open ? '4px 0 32px rgba(0,0,0,0.18)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        {/* Header drawer */}
        <div
          className="flex items-center gap-3 px-4 h-16 flex-shrink-0 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <img
            src="/logosbta.png"
            alt="SBTA"
            className="w-9 h-9 object-contain flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>SBTA</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user.role.replace('_', ' ').toUpperCase()}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-gray-100 flex-shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* User info strip */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--primary-light)' }}
          >
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
              : <UserCog className="w-4 h-4" style={{ color: 'var(--primary)' }} />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user.full_name}</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
          </div>
        </div>

        {/* Nav mobile */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {renderEntries(menuItems, false, onClose)}
        </nav>
      </aside>
    </>
  );
}
