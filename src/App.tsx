import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppUpdateBanner } from './components/shared/AppUpdateBanner';
import { useAuthStore } from './store/authStore';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import Layout from './components/layout/Layout';
import { lazyPage } from './utils/lazyPage';
import { POSSessionProvider, usePOSSession } from './services/pos/POSSessionContext';
import { ConnectionProvider } from './services/pos/ConnectionContext';
import { ConnectionProvider as CourrierConnectionProvider } from './services/courrier/ConnectionContext';
const MobileApp = lazyPage(() => import('./sbtamobile/MobileApp'));
const Login = lazyPage(() => import('./pages/auth/Login'));
const ForgotPassword = lazyPage(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazyPage(() => import('./pages/auth/ResetPassword'));
const AcceptInvitation = lazyPage(() => import('./pages/auth/AcceptInvitation'));
const MyProfile = lazyPage(() => import('./pages/auth/MyProfile'));
const AdminDashboard = lazyPage(() => import('./pages/admin/Dashboard'));
const PerformanceAnalytics = lazyPage(() => import('./pages/admin/PerformanceAnalytics'));
const Companies = lazyPage(() => import('./pages/admin/Companies'));
const FuelServices = lazyPage(() => import('./pages/admin/FuelServices'));
const Users = lazyPage(() => import('./pages/admin/Users'));
const Roles = lazyPage(() => import('./pages/admin/Roles'));
const Buses = lazyPage(() => import('./pages/admin/Buses'));
const AdminRoutes = lazyPage(() => import('./pages/admin/Routes'));
const AdminSchedules = lazyPage(() => import('./pages/admin/Schedules'));
const Cities = lazyPage(() => import('./pages/admin/Cities'));
const Stations = lazyPage(() => import('./pages/admin/Stations'));
const StationDetail = lazyPage(() => import('./pages/admin/StationDetail'));
const Counters = lazyPage(() => import('./pages/admin/Counters'));
const SearchTrips = lazyPage(() => import('./pages/client/SearchTrips'));
const Booking = lazyPage(() => import('./pages/client/Booking'));
const PlanificateurCalendar = lazyPage(() => import('./pages/planificateur/Calendar'));
const PlanificateurAvailability = lazyPage(() => import('./pages/planificateur/Availability'));
const NewSchedule = lazyPage(() => import('./pages/planificateur/NewSchedule'));
const Reservations = lazyPage(() => import('./pages/admin/Reservations'));
const Refunds = lazyPage(() => import('./pages/admin/Refunds'));
const Boarding = lazyPage(() => import('./pages/guichetier/Boarding'));
const CashRegister = lazyPage(() => import('./pages/guichetier/CashRegister'));
const LoyaltyRedemption = lazyPage(() => import('./pages/guichetier/LoyaltyRedemption'));
const TicketSale = lazyPage(() => import('./pages/guichetier/TicketSale'));
const ChauffeurFuelVouchers = lazyPage(() => import('./pages/chauffeur/FuelVouchers'));
const ChauffeurBreakdown = lazyPage(() => import('./pages/chauffeur/Breakdown'));
const ChauffeurMyBreakdowns = lazyPage(() => import('./pages/chauffeur/MyBreakdowns'));
const ChauffeurTrips = lazyPage(() => import('./pages/chauffeur/Trips'));
const ChauffeurPerformance = lazyPage(() => import('./pages/chauffeur/Performance'));
const ComptableFuelVouchers = lazyPage(() => import('./pages/comptable/FuelVouchers'));
const ComptableNewDashboard = lazyPage(() => import('./pages/comptable/NewDashboard'));
const ComptableExpenseForm = lazyPage(() => import('./pages/comptable/ComptableExpenseForm'));
const ComptableExpensesList = lazyPage(() => import('./pages/comptable/ComptableExpensesList'));
const ComptableFleet = lazyPage(() => import('./pages/comptable/ComptableFleet'));
const ComptableWeeklyReport = lazyPage(() => import('./pages/comptable/ComptableWeeklyReport'));
const ComptableCaisse = lazyPage(() => import('./pages/comptable/ComptableCaisse'));
const ComptableStock = lazyPage(() => import('./pages/comptable/ComptableStock'));
const ComptableStockMovements = lazyPage(() => import('./pages/comptable/ComptableStockMovements'));
const FuelReport = lazyPage(() => import('./pages/fuel/Report'));
const GarageDashboard = lazyPage(() => import('./pages/garage/Dashboard'));
const GarageBreakdowns = lazyPage(() => import('./pages/garage/Breakdowns'));
const GarageDiagnostics = lazyPage(() => import('./pages/garage/Diagnostics'));
const GarageWorkOrders = lazyPage(() => import('./pages/garage/WorkOrders'));
const GarageMaintenanceSchedule = lazyPage(() => import('./pages/garage/MaintenanceSchedule'));
const BreakdownReceive = lazyPage(() => import('./pages/garage/BreakdownReceive'));
const QualityCheck = lazyPage(() => import('./pages/garage/QualityCheck'));
const MechanicDiagnostic = lazyPage(() => import('./pages/mecanicien/Diagnostic'));
const WorkOrderNew = lazyPage(() => import('./pages/mecanicien/WorkOrderNew'));
const WorkOrderExecute = lazyPage(() => import('./pages/mecanicien/WorkOrderExecute'));
const ComptableWorkOrders = lazyPage(() => import('./pages/comptable/WorkOrders'));
const WorkOrderDetail = lazyPage(() => import('./pages/comptable/WorkOrderDetail'));
const Parts = lazyPage(() => import('./pages/stock/Parts'));
const Suppliers = lazyPage(() => import('./pages/stock/Suppliers'));
const PurchaseOrders = lazyPage(() => import('./pages/stock/PurchaseOrders'));
const PurchaseOrderNew = lazyPage(() => import('./pages/stock/PurchaseOrderNew'));
const PurchaseOrderDetail = lazyPage(() => import('./pages/stock/PurchaseOrderDetail'));
const Movements = lazyPage(() => import('./pages/stock/Movements'));
const Expenses = lazyPage(() => import('./pages/admin/Expenses'));
const ExpenseValidation = lazyPage(() => import('./pages/comptable/ExpenseValidation'));
const ComptableExpenses = lazyPage(() => import('./pages/comptable/Expenses'));
const ExpensesReport = lazyPage(() => import('./pages/admin/ExpensesReport'));
const StationDisplay = lazyPage(() => import('./pages/display/StationDisplay'));
const DAFDashboard = lazyPage(() => import('./pages/daf/Dashboard'));
const DAFFinancialReport = lazyPage(() => import('./pages/daf/FinancialReport'));
const DAFConsolidatedReport = lazyPage(() => import('./pages/daf/ConsolidatedReport'));
const DAFBusPerformance = lazyPage(() => import('./pages/daf/BusPerformance'));
const DAFParcelReport = lazyPage(() => import('./pages/daf/ParcelReport'));
const DAFBreakdownReport = lazyPage(() => import('./pages/daf/BreakdownReport'));
const DAFBreakdowns = lazyPage(() => import('./pages/daf/Breakdowns'));
const DAFCompteResultat = lazyPage(() => import('./pages/daf/CompteResultat'));
const DAFGarageReports = lazyPage(() => import('./pages/daf/GarageReports'));
const ComptableDashboard = lazyPage(() => import('./pages/comptable/Dashboard'));
const GestionnaireDashboard = lazyPage(() => import('./pages/gestionnaire/Dashboard'));
const GestionnaireReports = lazyPage(() => import('./pages/gestionnaire/Reports'));
const GestionnaireGarageReports = lazyPage(() => import('./pages/gestionnaire/GarageReports'));
const GestionnaireBusPerformance = lazyPage(() => import('./pages/gestionnaire/BusPerformance'));
const GestionnaireBusActivity = lazyPage(() => import('./pages/gestionnaire/BusActivity'));
const GestionnaireDriversReport = lazyPage(() => import('./pages/gestionnaire/DriversReport'));
const GestionnaireDrivers = lazyPage(() => import('./pages/gestionnaire/Drivers'));
const GestionnaireFinancialReport = lazyPage(() => import('./pages/gestionnaire/FinancialReport'));
const GestionnaireBreakdowns = lazyPage(() => import('./pages/gestionnaire/Breakdowns'));
const BreakdownRevenueReport = lazyPage(() => import('./pages/reports/BreakdownRevenueReport'));
const BreakdownDistributions = lazyPage(() => import('./pages/daf/BreakdownDistributions'));
const ChauffeurDashboard = lazyPage(() => import('./pages/chauffeur/Dashboard'));
const GuichetierDashboard = lazyPage(() => import('./pages/guichetier/Dashboard'));
const GuichetierCharges = lazyPage(() => import('./pages/guichetier/Charges'));
const GroupedSale = lazyPage(() => import('./pages/guichetier/GroupedSale'));
const MecanicienDashboard = lazyPage(() => import('./pages/mecanicien/Dashboard'));
const PlanificateurDashboard = lazyPage(() => import('./pages/planificateur/Dashboard'));
const PompisteDashboard = lazyPage(() => import('./pages/pompiste/Dashboard'));
const PompisteSuppliers = lazyPage(() => import('./pages/pompiste/Suppliers'));
const PompisteProducts = lazyPage(() => import('./pages/pompiste/Products'));
const PompistePurchaseOrders = lazyPage(() => import('./pages/pompiste/PurchaseOrders'));
const PompisteDepotages = lazyPage(() => import('./pages/pompiste/Depotages'));
const PompisteEnlevements = lazyPage(() => import('./pages/pompiste/Enlevements'));
const PompisteReports = lazyPage(() => import('./pages/pompiste/Reports'));
const ChefGareDashboard = lazyPage(() => import('./pages/chef_gare/Dashboard'));
const ChefGareBreakdowns = lazyPage(() => import('./pages/chef_gare/Breakdowns'));
const ChefGareDailyPlanning = lazyPage(() => import('./pages/chef_gare/DailyPlanning'));
const ChefGareNewSchedule = lazyPage(() => import('./pages/chef_gare/NewSchedule'));
const ChefGareCounters = lazyPage(() => import('./pages/chef_gare/Counters'));
const ChefGareBaggageHandlers = lazyPage(() => import('./pages/chef_gare/BaggageHandlers'));
const ChefGareDailyBaggageReport = lazyPage(() => import('./pages/chef_gare/DailyBaggageReport'));
const ChefGareSalesTracking = lazyPage(() => import('./pages/chef_gare/SalesTracking'));
const ChefGareDailyReport = lazyPage(() => import('./pages/chef_gare/DailyReport'));
const ChefGareStationDisplay = lazyPage(() => import('./pages/chef_gare/StationDisplayWrapper'));
const ChefGareGroupedPlanning = lazyPage(() => import('./pages/chef_gare/GroupedPlanning'));
const ChefGareConvoyReport = lazyPage(() => import('./pages/chef_gare/ConvoyReport'));
const ChefGareConvoys = lazyPage(() => import('./pages/chef_gare/Convoys'));
const ChefGareRamassage = lazyPage(() => import('./pages/chef_gare/Ramassage'));
const ChefGareRamassageReport = lazyPage(() => import('./pages/chef_gare/RamassageReport'));
const BagagisteBaggageSale = lazyPage(() => import('./pages/bagagiste/BaggageSale'));
const BagagisteBaggageReport = lazyPage(() => import('./pages/bagagiste/BaggageReport'));
const Review = lazyPage(() => import('./pages/client/Review'));
const DriverPerformanceReport = lazyPage(() => import('./pages/admin/DriverPerformanceReport'));
const Loyalty = lazyPage(() => import('./pages/client/Loyalty'));
const Rewards = lazyPage(() => import('./pages/client/Rewards'));
const LoyaltyHistory = lazyPage(() => import('./pages/client/LoyaltyHistory'));
const ClientReservations = lazyPage(() => import('./pages/client/Reservations'));
const AdminLoyalty = lazyPage(() => import('./pages/admin/Loyalty'));
const Reports = lazyPage(() => import('./pages/reports/Reports'));
const SalesReport = lazyPage(() => import('./pages/reports/SalesReport'));
const FinancialReport = lazyPage(() => import('./pages/reports/FinancialReport'));
const MaintenanceReport = lazyPage(() => import('./pages/reports/MaintenanceReport'));
const DriverHoursReport = lazyPage(() => import('./pages/reports/DriverHoursReport'));
const StockReport = lazyPage(() => import('./pages/reports/StockReport'));
const BusActivityReport = lazyPage(() => import('./pages/reports/BusActivityReport'));
const LoyaltyReport = lazyPage(() => import('./pages/reports/LoyaltyReport'));
const ActivityLogs = lazyPage(() => import('./pages/admin/ActivityLogs'));
const AuditLogs = lazyPage(() => import('./pages/admin/AuditLogs'));
const ChangeRequestsPage = lazyPage(() => import('./pages/change-requests/ChangeRequestsPage'));
const Archives = lazyPage(() => import('./pages/admin/Archives'));
const RamassageHistorique = lazyPage(() => import('./pages/admin/RamassageHistorique'));
const Connexion = lazyPage(() => import('./pages/admin/Connexion'));
const PrintCustomization = lazyPage(() => import('./pages/admin/PrintCustomization'));
const RHDashboard = lazyPage(() => import('./pages/rh/Dashboard'));
const EmployeesPage = lazyPage(() => import('./pages/rh/EmployeesPage'));
const EmployeeDetail = lazyPage(() => import('./pages/rh/EmployeeDetail'));
const EmployeeForm = lazyPage(() => import('./pages/rh/EmployeeForm'));
const DriversPage = lazyPage(() => import('./pages/rh/DriversPage'));
const PayrollPage = lazyPage(() => import('./pages/rh/PayrollPage'));
const RHReportsPage = lazyPage(() => import('./pages/rh/ReportsPage'));
const ContractualPayPage = lazyPage(() => import('./pages/rh/ContractualPayPage'));
const RHSettings = lazyPage(() => import('./pages/rh/RHSettings'));
const DailyRatesPage = lazyPage(() => import('./pages/rh/DailyRatesPage'));
const PaySlipsPage = lazyPage(() => import('./pages/rh/PaySlipsPage'));
const PayrollBookPage = lazyPage(() => import('./pages/rh/PayrollBookPage'));
const MasseSalarialePage = lazyPage(() => import('./pages/rh/MasseSalarialePage'));
const LoansPage = lazyPage(() => import('./pages/rh/LoansPage'));
const DeductionsPage = lazyPage(() => import('./pages/rh/DeductionsPage'));
const PrimesPage = lazyPage(() => import('./pages/rh/PrimesPage'));
const SuspensionsPage = lazyPage(() => import('./pages/rh/SuspensionsPage'));
const DeactivatedEmployeesPage = lazyPage(() => import('./pages/rh/DeactivatedEmployeesPage'));
const ExplanationsPage = lazyPage(() => import('./pages/rh/ExplanationsPage'));
const LeavePermissionsPage = lazyPage(() => import('./pages/rh/LeavePermissions'));
const LeaveReportPage = lazyPage(() => import('./pages/rh/LeaveReport'));
const LeaveCeilingPage = lazyPage(() => import('./pages/rh/LeaveCeiling'));
const DeclarationsPage = lazyPage(() => import('./pages/rh/DeclarationsPage'));
const AgentColisDashboard = lazyPage(() => import('./pages/agent-colis/Dashboard'));
const NewParcelForm = lazyPage(() => import('./pages/agent-colis/NewParcelForm'));
const ParcelDetail = lazyPage(() => import('./pages/agent-colis/ParcelDetail'));
const QrScanner = lazyPage(() => import('./pages/agent-colis/QrScanner'));
const AgentColisExpenses = lazyPage(() => import('./pages/agent-colis/Expenses'));
const AgentColisExpenseReport = lazyPage(() => import('./pages/agent-colis/ExpenseReport'));
const AgentColisSmsFeesReport = lazyPage(() => import('./pages/agent-colis/SmsFeesReport'));
const SuperviseurColisDashboard = lazyPage(() => import('./pages/superviseur-colis/Dashboard'));
const SuperviseurParcelsList = lazyPage(() => import('./pages/superviseur-colis/ParcelsList'));
const SuperviseurParcelDetail = lazyPage(() => import('./pages/superviseur-colis/ParcelDetail'));
const SuperviseurRevenueByStation = lazyPage(() => import('./pages/superviseur-colis/RevenueByStation'));
const SuperviseurSmsFeesByStation = lazyPage(() => import('./pages/superviseur-colis/SmsFeesByStation'));
const SuperviseurExpensesByStation = lazyPage(() => import('./pages/superviseur-colis/ExpensesByStation'));
const SuperviseurConsolidatedReport = lazyPage(() => import('./pages/superviseur-colis/ConsolidatedReport'));
const TrackParcel = lazyPage(() => import('./pages/track/TrackParcel'));
const ChargeAchatDashboard = lazyPage(() => import('./pages/charge-achat/Dashboard'));
const ChargeAchatExpensesList = lazyPage(() => import('./pages/charge-achat/ExpensesList'));
const ChargeAchatExpenseForm = lazyPage(() => import('./pages/charge-achat/ExpenseForm'));
const ChargeAchatFleet = lazyPage(() => import('./pages/charge-achat/Fleet'));
const ChargeAchatWeeklyReport = lazyPage(() => import('./pages/charge-achat/WeeklyReport'));
const ChargeAchatAnalysis = lazyPage(() => import('./pages/charge-achat/Analysis'));
const FixedExpensesList = lazyPage(() => import('./pages/charge-achat/FixedExpensesList'));
const FixedExpenseForm = lazyPage(() => import('./pages/charge-achat/FixedExpenseForm'));
const FixedExpenseTypes = lazyPage(() => import('./pages/charge-achat/FixedExpenseTypes'));
const FixedExpensesReport = lazyPage(() => import('./pages/charge-achat/FixedExpensesReport'));
const GaragesPage = lazyPage(() => import('./pages/admin/GaragesPage'));
const FuelTanks = lazyPage(() => import('./pages/admin/FuelTanks'));
const FuelStations = lazyPage(() => import('./pages/admin/FuelStations'));
const GarageDetail = lazyPage(() => import('./pages/admin/GarageDetail'));
const GarageQuoteForm = lazyPage(() => import('./pages/garage/QuoteForm'));
const GarageQuotesList = lazyPage(() => import('./pages/garage/QuotesList'));
const ComptableQuoteValidation = lazyPage(() => import('./pages/comptable/QuoteValidation'));
const ComptableCarburantDashboard = lazyPage(() => import('./pages/comptable/ComptableCarburantDashboard'));
const ComptableCarburantForm = lazyPage(() => import('./pages/comptable/ComptableCarburantForm'));
const ComptableCarburantReport = lazyPage(() => import('./pages/comptable/ComptableCarburantReport'));
const CarburantDashboard = lazyPage(() => import('./pages/carburant/Dashboard'));
const CarburantNewWithdrawal = lazyPage(() => import('./pages/carburant/NewWithdrawal'));
const CarburantReport = lazyPage(() => import('./pages/carburant/Report'));
const CarburantConsommationClient = lazyPage(() => import('./pages/carburant/ConsommationClient'));
const CarburantFuelStations = lazyPage(() => import('./pages/carburant/FuelStations'));
const CarburantTankReport = lazyPage(() => import('./pages/carburant/TankReport'));
const CarburantDepotageReport = lazyPage(() => import('./pages/carburant/DepotageReport'));
const GerantPrincipalDashboard = lazyPage(() => import('./pages/gerant_principal/Dashboard'));
const GerantPrincipalArticles = lazyPage(() => import('./pages/gerant_principal/Articles'));
const GerantPrincipalReparations = lazyPage(() => import('./pages/gerant_principal/Reparations'));
const GerantPrincipalStock = lazyPage(() => import('./pages/gerant_principal/Stock'));
const GerantPrincipalParametres = lazyPage(() => import('./pages/gerant_principal/Parametres'));
const AssuranceDashboard = lazyPage(() => import('./pages/assurance/Dashboard'));
const AssuranceInsurancesList = lazyPage(() => import('./pages/assurance/InsurancesList'));
const AssuranceInsuranceForm = lazyPage(() => import('./pages/assurance/InsuranceForm'));
const AssuranceReports = lazyPage(() => import('./pages/assurance/Reports'));
const AssuranceInsurersList = lazyPage(() => import('./pages/assurance/InsurersList'));
const AssuranceInsurerForm = lazyPage(() => import('./pages/assurance/InsurerForm'));
const LogistiqueDashboard = lazyPage(() => import('./pages/logistique/Dashboard'));
const LogistiqueVehiclesList = lazyPage(() => import('./pages/logistique/VehiclesList'));
const LogistiqueDriversPage = lazyPage(() => import('./pages/logistique/DriversPage'));
const LogistiqueVehicleDetail = lazyPage(() => import('./pages/logistique/VehicleDetail'));
const LogistiqueDocumentsList = lazyPage(() => import('./pages/logistique/DocumentsList'));
const LogistiqueProviders = lazyPage(() => import('./pages/logistique/Providers'));
const LogistiqueServiceTypes = lazyPage(() => import('./pages/logistique/ServiceTypes'));
const LogistiqueReports = lazyPage(() => import('./pages/logistique/Reports'));
const LogistiqueBusSynthesis = lazyPage(() => import('./pages/logistique/BusSynthesis'));
const LogistiqueFleetBilan = lazyPage(() => import('./pages/logistique/FleetBilan'));
const LogistiqueDriverReport = lazyPage(() => import('./pages/logistique/DriverReport'));
const LogistiqueReparations = lazyPage(() => import('./pages/logistique/Reparations'));
const LogistiqueRapportReparations = lazyPage(() => import('./pages/logistique/RapportReparations'));
const LogistiqueBaggageReportDashboard = lazyPage(() => import('./pages/logistique/BaggageReportDashboard'));
const AgentReservationDashboard = lazyPage(() => import('./pages/agent-reservation/Dashboard'));
const AgentReservationUsers = lazyPage(() => import('./pages/agent-reservation/MobileUsers'));
const AgentReservationTickets = lazyPage(() => import('./pages/agent-reservation/Tickets'));
const AgentReservationSales = lazyPage(() => import('./pages/agent-reservation/SalesReports'));
const AgentReservationAnalytics = lazyPage(() => import('./pages/agent-reservation/Analytics'));
const AgentReservationSettings = lazyPage(() => import('./pages/agent-reservation/Settings'));
const AgentReservationFaq = lazyPage(() => import('./pages/agent-reservation/Faq'));
const AgentReservationPolicies = lazyPage(() => import('./pages/agent-reservation/CancellationPolicies'));

// Gestion Agboville module (LOT 0 — additive, no existing route modified)
const GestionAgbovilleDashboard = lazyPage(() => import('./pages/gestion_agboville/Dashboard'));
const GestionAgbovilleDepenses = lazyPage(() => import('./pages/gestion_agboville/Depenses'));
const GestionAgbovilleParametrage = lazyPage(() => import('./pages/gestion_agboville/Parametrage'));
const GestionAgbovilleSuiviRecettes = lazyPage(() => import('./pages/gestion_agboville/SuiviRecettes'));
const GestionAgbovilleRapportConsolide = lazyPage(() => import('./pages/gestion_agboville/RapportConsolide'));

// POS module (LOT 0 — additive, no existing route modified)
const POSConnexion = lazyPage(() => import('./pages/pos/Connexion'));
const POSAccueil = lazyPage(() => import('./pages/pos/Accueil'));
const POSDepartNouveau = lazyPage(() => import('./pages/pos/DepartNouveau'));
const POSDeparts = lazyPage(() => import('./pages/pos/Departs'));
const POSVente = lazyPage(() => import('./pages/pos/Vente'));
const POSBagages = lazyPage(() => import('./pages/pos/Bagages'));
const POSRecetteBagage = lazyPage(() => import('./pages/pos/RecetteBagage'));
const POSDepenses = lazyPage(() => import('./pages/pos/Depenses'));
const POSAutresGares = lazyPage(() => import('./pages/pos/AutresGares'));
const POSCloture = lazyPage(() => import('./pages/pos/Cloture'));
const POSRamassage = lazyPage(() => import('./pages/pos/Ramassage'));
const POSRamassageNouveau = lazyPage(() => import('./pages/pos/RamassageNouveau'));
const POSConvois = lazyPage(() => import('./pages/pos/Convois'));
const POSParametres = lazyPage(() => import('./pages/pos/Parametres'));

// TPE-POS module — TPE-optimized baggage terminal (additive, standalone)
const TPEConnexion = lazyPage(() => import('./pages/tpe-pos/Connexion'));
const BaggageTerminal = lazyPage(() => import('./pages/tpe-pos/BaggageTerminal'));

// Kiosk / Bornes digitales module (additive, standalone)
const KioskDashboard = lazyPage(() => import('./pages/kiosk/KioskDashboard'));
const KioskTerminal = lazyPage(() => import('./pages/kiosk/KioskTerminal'));
const KioskReports = lazyPage(() => import('./pages/kiosk/KioskReports'));
const KioskLogin = lazyPage(() => import('./pages/kiosk/KioskLogin'));
const KioskTransactions = lazyPage(() => import('./pages/kiosk/KioskTransactions'));
const KioskQRCodes = lazyPage(() => import('./pages/kiosk/KioskQRCodes'));

function CourrierAccessGuard({ children }: { children: ReactNode }) {
  const { session, loading } = usePOSSession();
  if (loading) return null;
  if (!session?.courrier_enabled) return <Navigate to="/guichet/accueil" replace />;
  return <>{children}</>;
}

function GuichetRoleGuard() {
  const { session, loading } = usePOSSession();
  if (loading) return null;
  if (!session) return <Navigate to="/guichet/connexion" replace />;
  if (session.role !== 'guichetier') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <div className="text-center p-8 rounded-lg shadow-lg max-w-md w-full" style={{ backgroundColor: 'var(--surface)' }}>
          <h2 className="text-2xl font-semibold mb-3" style={{ color: 'var(--danger)' }}>Accès non autorisé</h2>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            Cet espace est réservé aux guichetiers. Votre profil ({session.role}) n'est pas autorisé à accéder au Guichet POS.
          </p>
          <Link to="/guichet/connexion" className="px-6 py-2 rounded-lg font-medium inline-block" style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}>
            Retour à la connexion
          </Link>
        </div>
      </div>
    );
  }
  return <Outlet />;
}

function StatusPage({ title, message, linkTo, linkLabel }: { title: string; message: string; linkTo: string; linkLabel: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <div className="text-center p-8 rounded-lg shadow-lg max-w-md w-full" style={{ backgroundColor: 'var(--surface)' }}>
        <h2 className="text-2xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>{message}</p>
        <Link to={linkTo} className="px-6 py-2 rounded-lg font-medium inline-block" style={{ backgroundColor: 'var(--primary)', color: 'var(--text-on-primary)' }}>
          {linkLabel}
        </Link>
      </div>
    </div>
  );
}

function App() {
  const { initialized, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <div className="text-center">
          <div className="w-12 h-12 border-4 rounded-full animate-spin mx-auto mb-4"
               style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Accounts are created by the administration only: no self sign-up */}
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/accept-invitation" element={<AcceptInvitation />} />
          <Route path="/display/station/:id" element={<StationDisplay />} />
          <Route path="/review/:token" element={<Review />} />
          <Route path="/track" element={<TrackParcel />} />
          <Route path="/track/:code" element={<TrackParcel />} />
          <Route path="/unauthorized" element={<StatusPage title="Accès refusé" message="Vous n'avez pas les permissions nécessaires pour accéder à cette page." linkTo="/login" linkLabel="Retour à l'accueil" />} />
          <Route path="/account-suspended" element={<StatusPage title="Compte suspendu" message="Votre compte a été suspendu. Veuillez contacter votre administrateur." linkTo="/login" linkLabel="Se connecter" />} />
          <Route path="/pending-confirmation" element={<StatusPage title="Compte en attente" message="Votre compte est en attente de confirmation. Veuillez vérifier votre email." linkTo="/login" linkLabel="Se connecter" />} />

          <Route path="/sbtamobile/*" element={<MobileApp />} />

          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/login" replace />} />

            <Route path="profile" element={<ProtectedRoute><MyProfile /></ProtectedRoute>} />

            <Route path="admin/dashboard" element={<ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>} />
            <Route path="admin/performance" element={<ProtectedRoute roles={['admin']}><PerformanceAnalytics /></ProtectedRoute>} />
            <Route path="admin/cities" element={<ProtectedRoute roles={['admin']}><Cities /></ProtectedRoute>} />
            <Route path="admin/stations" element={<ProtectedRoute roles={['admin']}><Stations /></ProtectedRoute>} />
            <Route path="admin/stations/:id" element={<ProtectedRoute roles={['admin']}><StationDetail /></ProtectedRoute>} />
            <Route path="admin/counters" element={<ProtectedRoute roles={['admin']}><Counters /></ProtectedRoute>} />
            <Route path="admin/companies" element={<ProtectedRoute roles={['admin']}><Companies /></ProtectedRoute>} />
            <Route path="admin/users" element={<ProtectedRoute roles={['admin']}><Users /></ProtectedRoute>} />
            <Route path="admin/roles" element={<ProtectedRoute roles={['admin']}><Roles /></ProtectedRoute>} />
            <Route path="admin/buses" element={<ProtectedRoute roles={['admin']}><Buses /></ProtectedRoute>} />
            <Route path="admin/fuel-tanks" element={<ProtectedRoute roles={['admin']}><FuelTanks /></ProtectedRoute>} />
            <Route path="admin/fuel-services" element={<ProtectedRoute roles={['admin']}><FuelServices /></ProtectedRoute>} />
            <Route path="admin/fuel-stations" element={<ProtectedRoute roles={['admin']}><FuelStations /></ProtectedRoute>} />
            <Route path="admin/garages" element={<ProtectedRoute roles={['admin']}><GaragesPage /></ProtectedRoute>} />
            <Route path="admin/garages/:id" element={<ProtectedRoute roles={['admin']}><GarageDetail /></ProtectedRoute>} />
            <Route path="admin/routes" element={<ProtectedRoute roles={['admin']}><AdminRoutes /></ProtectedRoute>} />
            <Route path="admin/schedules" element={<ProtectedRoute roles={['admin']}><AdminSchedules /></ProtectedRoute>} />
            <Route path="admin/reservations" element={<ProtectedRoute roles={['admin']}><Reservations /></ProtectedRoute>} />
            <Route path="admin/refunds" element={<ProtectedRoute roles={['admin']}><Refunds /></ProtectedRoute>} />
            <Route path="admin/expenses" element={<ProtectedRoute roles={['admin']}><Expenses /></ProtectedRoute>} />
            <Route path="admin/expenses-report" element={<ProtectedRoute roles={['admin']}><ExpensesReport /></ProtectedRoute>} />
            <Route path="admin/loyalty" element={<ProtectedRoute roles={['admin']}><AdminLoyalty /></ProtectedRoute>} />
            <Route path="admin/activity-logs" element={<ProtectedRoute roles={['admin']}><ActivityLogs /></ProtectedRoute>} />
            <Route path="admin/audit-logs" element={<ProtectedRoute roles={['admin']}><AuditLogs /></ProtectedRoute>} />
            <Route path="admin/archives" element={<ProtectedRoute roles={['admin']}><Archives /></ProtectedRoute>} />
            <Route path="admin/ramassage-historique" element={<ProtectedRoute roles={['admin','daf','gestionnaire']}><RamassageHistorique /></ProtectedRoute>} />
            <Route path="admin/connexion" element={<ProtectedRoute roles={['admin']}><Connexion /></ProtectedRoute>} />
            <Route path="admin/personnalisation" element={<ProtectedRoute roles={['admin']}><PrintCustomization /></ProtectedRoute>} />
            <Route path="reports/driver-performance" element={<ProtectedRoute roles={['admin', 'gestionnaire']}><DriverPerformanceReport /></ProtectedRoute>} />
            <Route path="daf/dashboard" element={<ProtectedRoute roles={['daf','dg']}><DAFDashboard /></ProtectedRoute>} />
            <Route path="daf/financial-report" element={<ProtectedRoute roles={['daf','dg']}><DAFFinancialReport /></ProtectedRoute>} />
            <Route path="daf/consolidated-report" element={<ProtectedRoute roles={['daf','dg']}><DAFConsolidatedReport /></ProtectedRoute>} />
            <Route path="daf/bus-performance" element={<ProtectedRoute roles={['daf','dg']}><DAFBusPerformance /></ProtectedRoute>} />
            <Route path="daf/parcel-report" element={<ProtectedRoute roles={['daf']}><DAFParcelReport /></ProtectedRoute>} />
            <Route path="daf/breakdowns" element={<ProtectedRoute roles={['daf']}><DAFBreakdownReport /></ProtectedRoute>} />
            <Route path="daf/pannes" element={<ProtectedRoute roles={['daf']}><DAFBreakdowns /></ProtectedRoute>} />
            <Route path="daf/performance" element={<ProtectedRoute roles={['daf']}><PerformanceAnalytics /></ProtectedRoute>} />
            <Route path="daf/expenses-report" element={<ProtectedRoute roles={['daf']}><ExpensesReport /></ProtectedRoute>} />
            <Route path="daf/compte-resultat" element={<ProtectedRoute roles={['daf','dg']}><DAFCompteResultat /></ProtectedRoute>} />
            <Route path="daf/garage-reports" element={<ProtectedRoute roles={['daf']}><DAFGarageReports /></ProtectedRoute>} />
            <Route path="daf/ramassage-historique" element={<ProtectedRoute roles={['daf','admin']}><RamassageHistorique /></ProtectedRoute>} />
            <Route path="comptable/dashboard" element={<ProtectedRoute roles={['comptable']}><ComptableNewDashboard /></ProtectedRoute>} />
            <Route path="comptable/expenses" element={<ProtectedRoute roles={['comptable']}><ComptableExpensesList /></ProtectedRoute>} />
            <Route path="comptable/expenses/new" element={<ProtectedRoute roles={['comptable']}><ComptableExpenseForm /></ProtectedRoute>} />
            <Route path="comptable/expenses/:id/edit" element={<ProtectedRoute roles={['comptable']}><ComptableExpenseForm /></ProtectedRoute>} />
            <Route path="comptable/fleet" element={<ProtectedRoute roles={['comptable']}><ComptableFleet /></ProtectedRoute>} />
            <Route path="comptable/report" element={<ProtectedRoute roles={['comptable']}><ComptableWeeklyReport /></ProtectedRoute>} />
            <Route path="comptable/caisse" element={<ProtectedRoute roles={['comptable']}><ComptableCaisse /></ProtectedRoute>} />
            <Route path="comptable/stock" element={<ProtectedRoute roles={['comptable']}><ComptableStock /></ProtectedRoute>} />
            <Route path="comptable/stock/movements" element={<ProtectedRoute roles={['comptable']}><ComptableStockMovements /></ProtectedRoute>} />
            <Route path="comptable/carburant" element={<ProtectedRoute roles={['comptable']}><ComptableCarburantDashboard /></ProtectedRoute>} />
            <Route path="comptable/carburant/new" element={<ProtectedRoute roles={['comptable']}><ComptableCarburantForm /></ProtectedRoute>} />
            <Route path="comptable/carburant/report" element={<ProtectedRoute roles={['comptable']}><ComptableCarburantReport /></ProtectedRoute>} />
            <Route path="carburant/dashboard" element={<ProtectedRoute roles={['carburant']}><CarburantDashboard /></ProtectedRoute>} />
            <Route path="carburant/new" element={<ProtectedRoute roles={['carburant']}><CarburantNewWithdrawal /></ProtectedRoute>} />
            <Route path="carburant/report" element={<ProtectedRoute roles={['carburant']}><CarburantReport /></ProtectedRoute>} />
            <Route path="carburant/consommation-client" element={<ProtectedRoute roles={['carburant']}><CarburantConsommationClient /></ProtectedRoute>} />
            <Route path="carburant/stations" element={<ProtectedRoute roles={['carburant']}><CarburantFuelStations /></ProtectedRoute>} />
            <Route path="carburant/tank-report" element={<ProtectedRoute roles={['carburant']}><CarburantTankReport /></ProtectedRoute>} />
            <Route path="carburant/depotage-report" element={<ProtectedRoute roles={['carburant']}><CarburantDepotageReport /></ProtectedRoute>} />
            <Route path="gestionnaire/dashboard" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireDashboard /></ProtectedRoute>} />
            <Route path="gestionnaire/reports" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireReports /></ProtectedRoute>} />
            <Route path="gestionnaire/garage-reports" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireGarageReports /></ProtectedRoute>} />
            <Route path="gestionnaire/financial-report" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireFinancialReport /></ProtectedRoute>} />
            <Route path="gestionnaire/bus-performance" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireBusPerformance /></ProtectedRoute>} />
            <Route path="gestionnaire/bus-activity" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireBusActivity /></ProtectedRoute>} />
            <Route path="gestionnaire/drivers" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireDrivers /></ProtectedRoute>} />
            <Route path="gestionnaire/drivers-report" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireDriversReport /></ProtectedRoute>} />
            <Route path="gestionnaire/breakdowns" element={<ProtectedRoute roles={['gestionnaire']}><GestionnaireBreakdowns /></ProtectedRoute>} />
            <Route path="gestionnaire/ramassage-historique" element={<ProtectedRoute roles={['gestionnaire','admin']}><RamassageHistorique /></ProtectedRoute>} />

            <Route path="gerant-principal/dashboard" element={<ProtectedRoute roles={['gerant_principal']}><GerantPrincipalDashboard /></ProtectedRoute>} />
            <Route path="gerant-principal/articles" element={<ProtectedRoute roles={['gerant_principal']}><GerantPrincipalArticles /></ProtectedRoute>} />
            <Route path="gerant-principal/reparations" element={<ProtectedRoute roles={['gerant_principal']}><GerantPrincipalReparations /></ProtectedRoute>} />
            <Route path="gerant-principal/stock" element={<ProtectedRoute roles={['gerant_principal']}><GerantPrincipalStock /></ProtectedRoute>} />
            <Route path="gerant-principal/parametres" element={<ProtectedRoute roles={['gerant_principal']}><GerantPrincipalParametres /></ProtectedRoute>} />
            <Route path="gerant-principal/reports" element={<ProtectedRoute roles={['gerant_principal']}><GerantPrincipalParametres /></ProtectedRoute>} />
            <Route path="reports/breakdowns" element={<ProtectedRoute roles={['admin', 'daf', 'gestionnaire', 'comptable']}><BreakdownRevenueReport /></ProtectedRoute>} />
            <Route path="daf/breakdown-distributions" element={<ProtectedRoute roles={['admin', 'daf']}><BreakdownDistributions /></ProtectedRoute>} />
            <Route path="chauffeur/dashboard" element={<ProtectedRoute roles={['chauffeur']}><ChauffeurDashboard /></ProtectedRoute>} />
            <Route path="chauffeur/trips" element={<ProtectedRoute roles={['chauffeur']}><ChauffeurTrips /></ProtectedRoute>} />
            <Route path="chauffeur/fuel-vouchers" element={<ProtectedRoute roles={['chauffeur']}><ChauffeurFuelVouchers /></ProtectedRoute>} />
            <Route path="chauffeur/breakdown" element={<ProtectedRoute roles={['chauffeur']}><ChauffeurBreakdown /></ProtectedRoute>} />
            <Route path="chauffeur/my-breakdowns" element={<ProtectedRoute roles={['chauffeur']}><ChauffeurMyBreakdowns /></ProtectedRoute>} />
            <Route path="chauffeur/performance" element={<ProtectedRoute roles={['chauffeur']}><ChauffeurPerformance /></ProtectedRoute>} />
            <Route path="guichetier/dashboard" element={<ProtectedRoute roles={['guichetier']}><GuichetierDashboard /></ProtectedRoute>} />
            <Route path="guichetier/booking" element={<ProtectedRoute roles={['guichetier']}><TicketSale /></ProtectedRoute>} />
            <Route path="guichetier/boarding" element={<ProtectedRoute roles={['guichetier']}><Boarding /></ProtectedRoute>} />
            <Route path="guichetier/reservations" element={<ProtectedRoute roles={['guichetier']}><Reservations /></ProtectedRoute>} />
            <Route path="guichetier/cash-register" element={<ProtectedRoute roles={['guichetier']}><CashRegister /></ProtectedRoute>} />
            <Route path="guichetier/loyalty-redemption" element={<ProtectedRoute roles={['guichetier']}><LoyaltyRedemption /></ProtectedRoute>} />
            <Route path="guichetier/charges" element={<ProtectedRoute roles={['guichetier']}><GuichetierCharges /></ProtectedRoute>} />
            <Route path="guichetier/grouped-sale" element={<ProtectedRoute roles={['guichetier']}><GroupedSale /></ProtectedRoute>} />
            <Route path="garage/dashboard" element={<ProtectedRoute roles={['chef_garage']}><GarageDashboard /></ProtectedRoute>} />
            <Route path="garage/quotes" element={<ProtectedRoute roles={['chef_garage']}><GarageQuotesList /></ProtectedRoute>} />
            <Route path="garage/quotes/new" element={<ProtectedRoute roles={['chef_garage']}><GarageQuoteForm /></ProtectedRoute>} />
            <Route path="garage/breakdowns" element={<ProtectedRoute roles={['chef_garage']}><GarageBreakdowns /></ProtectedRoute>} />
            <Route path="garage/breakdowns/:id/receive" element={<ProtectedRoute roles={['chef_garage']}><BreakdownReceive /></ProtectedRoute>} />
            <Route path="garage/diagnostics" element={<ProtectedRoute roles={['chef_garage']}><GarageDiagnostics /></ProtectedRoute>} />
            <Route path="garage/work-orders" element={<ProtectedRoute roles={['chef_garage']}><GarageWorkOrders /></ProtectedRoute>} />
            <Route path="garage/quality-check/:id" element={<ProtectedRoute roles={['chef_garage']}><QualityCheck /></ProtectedRoute>} />
            <Route path="garage/maintenance-schedule" element={<ProtectedRoute roles={['chef_garage']}><GarageMaintenanceSchedule /></ProtectedRoute>} />
            <Route path="mecanicien/dashboard" element={<ProtectedRoute roles={['mecanicien']}><MecanicienDashboard /></ProtectedRoute>} />
            <Route path="mecanicien/diagnostics/:id" element={<ProtectedRoute roles={['mecanicien']}><MechanicDiagnostic /></ProtectedRoute>} />
            <Route path="mecanicien/work-orders/new/:diagnosticId" element={<ProtectedRoute roles={['mecanicien']}><WorkOrderNew /></ProtectedRoute>} />
            <Route path="mecanicien/work-orders/:id/execute" element={<ProtectedRoute roles={['mecanicien']}><WorkOrderExecute /></ProtectedRoute>} />
            <Route path="planificateur/dashboard" element={<ProtectedRoute roles={['planificateur']}><PlanificateurDashboard /></ProtectedRoute>} />
            <Route path="planificateur/calendar" element={<ProtectedRoute roles={['planificateur']}><PlanificateurCalendar /></ProtectedRoute>} />
            <Route path="planificateur/availability" element={<ProtectedRoute roles={['planificateur']}><PlanificateurAvailability /></ProtectedRoute>} />
            <Route path="planificateur/schedules/new" element={<ProtectedRoute roles={['planificateur']}><NewSchedule /></ProtectedRoute>} />
            <Route path="pompiste/dashboard" element={<ProtectedRoute roles={['pompiste']}><PompisteDashboard /></ProtectedRoute>} />
            <Route path="pompiste/suppliers" element={<ProtectedRoute roles={['pompiste']}><PompisteSuppliers /></ProtectedRoute>} />
            <Route path="pompiste/products" element={<ProtectedRoute roles={['pompiste']}><PompisteProducts /></ProtectedRoute>} />
            <Route path="pompiste/purchase-orders" element={<ProtectedRoute roles={['pompiste']}><PompistePurchaseOrders /></ProtectedRoute>} />
            <Route path="pompiste/depotages" element={<ProtectedRoute roles={['pompiste']}><PompisteDepotages /></ProtectedRoute>} />
            <Route path="pompiste/enlevements" element={<ProtectedRoute roles={['pompiste']}><PompisteEnlevements /></ProtectedRoute>} />
            <Route path="pompiste/reports" element={<ProtectedRoute roles={['pompiste']}><PompisteReports /></ProtectedRoute>} />
            <Route path="chef-gare/dashboard" element={<ProtectedRoute roles={['chef_gare']}><ChefGareDashboard /></ProtectedRoute>} />
            <Route path="chef-gare/planning" element={<ProtectedRoute roles={['chef_gare']}><ChefGareDailyPlanning /></ProtectedRoute>} />
            <Route path="chef-gare/schedules/new" element={<ProtectedRoute roles={['chef_gare']}><ChefGareNewSchedule /></ProtectedRoute>} />
            <Route path="chef-gare/schedules/grouped" element={<ProtectedRoute roles={['chef_gare']}><ChefGareGroupedPlanning /></ProtectedRoute>} />
            <Route path="chef-gare/counters" element={<ProtectedRoute roles={['chef_gare']}><ChefGareCounters /></ProtectedRoute>} />
            <Route path="chef-gare/baggage-handlers" element={<ProtectedRoute roles={['chef_gare']}><ChefGareBaggageHandlers /></ProtectedRoute>} />
            <Route path="chef-gare/baggage-report" element={<ProtectedRoute roles={['chef_gare']}><ChefGareDailyBaggageReport /></ProtectedRoute>} />
            <Route path="chef-gare/sales" element={<ProtectedRoute roles={['chef_gare']}><ChefGareSalesTracking /></ProtectedRoute>} />
            <Route path="chef-gare/convoys" element={<ProtectedRoute roles={['chef_gare']}><ChefGareConvoys /></ProtectedRoute>} />
            <Route path="chef-gare/ramassage" element={<ProtectedRoute roles={['chef_gare']}><ChefGareRamassage /></ProtectedRoute>} />
            <Route path="chef-gare/ramassage/report" element={<ProtectedRoute roles={['chef_gare']}><ChefGareRamassageReport /></ProtectedRoute>} />
            <Route path="chef-gare/convoys/report" element={<ProtectedRoute roles={['chef_gare']}><ChefGareConvoyReport /></ProtectedRoute>} />
            <Route path="chef-gare/daily-report" element={<ProtectedRoute roles={['chef_gare']}><ChefGareDailyReport /></ProtectedRoute>} />
            <Route path="chef-gare/breakdowns" element={<ProtectedRoute roles={['chef_gare']}><ChefGareBreakdowns /></ProtectedRoute>} />
            <Route path="chef-gare/display" element={<ProtectedRoute roles={['chef_gare']}><ChefGareStationDisplay /></ProtectedRoute>} />
            <Route path="chef-gare/my-requests" element={<ProtectedRoute roles={['chef_gare','guichetier','agent_colis']}><ChangeRequestsPage mode="my_requests" /></ProtectedRoute>} />
            <Route path="dg/change-requests" element={<ProtectedRoute roles={['dg','admin']}><ChangeRequestsPage mode="approval" /></ProtectedRoute>} />
            <Route path="dg/audit" element={<ProtectedRoute roles={['dg','admin']}><ChangeRequestsPage mode="audit" /></ProtectedRoute>} />
            <Route path="admin/change-requests/execution" element={<ProtectedRoute roles={['admin','dg']}><ChangeRequestsPage mode="execution" /></ProtectedRoute>} />
            <Route path="admin/change-requests/audit" element={<ProtectedRoute roles={['admin','dg']}><ChangeRequestsPage mode="audit" /></ProtectedRoute>} />

            <Route path="bagagiste/baggage" element={<ProtectedRoute roles={['bagagiste']}><BagagisteBaggageSale /></ProtectedRoute>} />
            <Route path="bagagiste/report" element={<ProtectedRoute roles={['bagagiste']}><BagagisteBaggageReport /></ProtectedRoute>} />

            <Route path="client/search" element={<SearchTrips />} />
            <Route path="client/booking/:scheduleId" element={<Booking />} />
            <Route path="client/reservations" element={<ProtectedRoute roles={['client']}><ClientReservations /></ProtectedRoute>} />
            <Route path="client/loyalty" element={<ProtectedRoute roles={['client']}><Loyalty /></ProtectedRoute>} />
            <Route path="client/rewards" element={<ProtectedRoute roles={['client']}><Rewards /></ProtectedRoute>} />
            <Route path="client/loyalty/history" element={<ProtectedRoute roles={['client']}><LoyaltyHistory /></ProtectedRoute>} />
            <Route path="client/profile" element={<ProtectedRoute roles={['client']}><MyProfile /></ProtectedRoute>} />

            <Route path="rh/dashboard"              element={<ProtectedRoute roles={['rh', 'admin']}><RHDashboard /></ProtectedRoute>} />
            <Route path="rh/employees"              element={<ProtectedRoute roles={['rh', 'admin']}><EmployeesPage /></ProtectedRoute>} />
            <Route path="rh/employees/new"          element={<ProtectedRoute roles={['rh', 'admin']}><EmployeeForm /></ProtectedRoute>} />
            <Route path="rh/employees/:id"          element={<ProtectedRoute roles={['rh', 'admin']}><EmployeeDetail /></ProtectedRoute>} />
            <Route path="rh/employees/:id/edit"     element={<ProtectedRoute roles={['rh', 'admin']}><EmployeeForm /></ProtectedRoute>} />
            <Route path="rh/drivers"                element={<ProtectedRoute roles={['rh', 'admin']}><DriversPage /></ProtectedRoute>} />
            <Route path="rh/payroll"                element={<ProtectedRoute roles={['rh', 'admin']}><PayrollPage /></ProtectedRoute>} />
            <Route path="rh/reports"                element={<ProtectedRoute roles={['rh', 'admin', 'daf', 'dg']}><RHReportsPage /></ProtectedRoute>} />
            <Route path="rh/contractual-pay"        element={<ProtectedRoute roles={['rh', 'admin']}><ContractualPayPage /></ProtectedRoute>} />
            <Route path="rh/daily-rates"            element={<ProtectedRoute roles={['rh', 'admin']}><DailyRatesPage /></ProtectedRoute>} />
            <Route path="rh/pay-slips"              element={<ProtectedRoute roles={['rh', 'admin']}><PaySlipsPage /></ProtectedRoute>} />
            <Route path="rh/payroll-book"           element={<ProtectedRoute roles={['rh', 'admin', 'daf']}><PayrollBookPage /></ProtectedRoute>} />
            <Route path="rh/masse-salariale"        element={<ProtectedRoute roles={['rh', 'admin', 'daf']}><MasseSalarialePage /></ProtectedRoute>} />
            <Route path="rh/loans"                  element={<ProtectedRoute roles={['rh', 'admin']}><LoansPage /></ProtectedRoute>} />
            <Route path="rh/deductions"             element={<ProtectedRoute roles={['rh', 'admin']}><DeductionsPage /></ProtectedRoute>} />
            <Route path="rh/primes"                 element={<ProtectedRoute roles={['rh', 'admin']}><PrimesPage /></ProtectedRoute>} />
            <Route path="rh/suspensions"            element={<ProtectedRoute roles={['rh', 'admin']}><SuspensionsPage /></ProtectedRoute>} />
            <Route path="rh/deactivated"            element={<ProtectedRoute roles={['rh', 'admin']}><DeactivatedEmployeesPage /></ProtectedRoute>} />
            <Route path="rh/leave"                  element={<ProtectedRoute roles={['rh', 'admin']}><LeavePermissionsPage /></ProtectedRoute>} />
            <Route path="rh/leave-ceiling"          element={<ProtectedRoute roles={['rh', 'admin']}><LeaveCeilingPage /></ProtectedRoute>} />
            <Route path="rh/leave-report"           element={<ProtectedRoute roles={['rh', 'admin', 'daf']}><LeaveReportPage /></ProtectedRoute>} />
            <Route path="rh/explanations"           element={<ProtectedRoute roles={['rh', 'admin']}><ExplanationsPage /></ProtectedRoute>} />
            <Route path="rh/declarations"           element={<ProtectedRoute roles={['rh', 'admin', 'daf']}><DeclarationsPage /></ProtectedRoute>} />
            <Route path="rh/settings"               element={<ProtectedRoute roles={['rh', 'admin']}><RHSettings /></ProtectedRoute>} />

            <Route path="assurance/dashboard"          element={<ProtectedRoute roles={['responsable_assurance', 'admin']}><AssuranceDashboard /></ProtectedRoute>} />
            <Route path="assurance/insurances"         element={<ProtectedRoute roles={['responsable_assurance', 'admin']}><AssuranceInsurancesList /></ProtectedRoute>} />
            <Route path="assurance/insurances/new"     element={<ProtectedRoute roles={['responsable_assurance', 'admin']}><AssuranceInsuranceForm /></ProtectedRoute>} />
            <Route path="assurance/insurances/:id/edit" element={<ProtectedRoute roles={['responsable_assurance', 'admin']}><AssuranceInsuranceForm /></ProtectedRoute>} />
            <Route path="assurance/insurers"           element={<ProtectedRoute roles={['responsable_assurance', 'admin']}><AssuranceInsurersList /></ProtectedRoute>} />
            <Route path="assurance/insurers/new"       element={<ProtectedRoute roles={['responsable_assurance', 'admin']}><AssuranceInsurerForm /></ProtectedRoute>} />
            <Route path="assurance/insurers/:id/edit"  element={<ProtectedRoute roles={['responsable_assurance', 'admin']}><AssuranceInsurerForm /></ProtectedRoute>} />
            <Route path="assurance/reports"            element={<ProtectedRoute roles={['responsable_assurance', 'admin']}><AssuranceReports /></ProtectedRoute>} />

            <Route path="logistique/dashboard"         element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueDashboard /></ProtectedRoute>} />
            <Route path="logistique/vehicles"          element={<ProtectedRoute roles={['responsable_logistique', 'logistique', 'admin']}><LogistiqueVehiclesList /></ProtectedRoute>} />
            <Route path="logistique/vehicles/:id"      element={<ProtectedRoute roles={['responsable_logistique', 'logistique', 'admin']}><LogistiqueVehicleDetail /></ProtectedRoute>} />
            <Route path="logistique/drivers"          element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueDriversPage /></ProtectedRoute>} />
            <Route path="logistique/documents"         element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueDocumentsList /></ProtectedRoute>} />
            <Route path="logistique/providers"         element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueProviders /></ProtectedRoute>} />
            <Route path="logistique/service-types"     element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueServiceTypes /></ProtectedRoute>} />
            <Route path="logistique/reports"           element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueReports /></ProtectedRoute>} />
            <Route path="logistique/bus-synthesis"     element={<ProtectedRoute roles={['responsable_logistique', 'logistique', 'admin', 'dg']}><LogistiqueBusSynthesis /></ProtectedRoute>} />
            <Route path="logistique/bilan"            element={<ProtectedRoute roles={['responsable_logistique', 'admin', 'dg']}><LogistiqueFleetBilan /></ProtectedRoute>} />
            <Route path="logistique/driver-report"    element={<ProtectedRoute roles={['responsable_logistique', 'logistique', 'admin', 'dg']}><LogistiqueDriverReport /></ProtectedRoute>} />
            <Route path="logistique/reparations"      element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueReparations /></ProtectedRoute>} />
            <Route path="logistique/rapport-reparations" element={<ProtectedRoute roles={['responsable_logistique', 'admin', 'dg']}><LogistiqueRapportReparations /></ProtectedRoute>} />
            <Route path="logistique/baggage-report" element={<ProtectedRoute roles={['responsable_logistique', 'admin', 'dg']}><LogistiqueBaggageReportDashboard /></ProtectedRoute>} />
            <Route path="logistique/courrier-report" element={<ProtectedRoute roles={['responsable_logistique', 'logistique', 'dg']}><SuperviseurConsolidatedReport /></ProtectedRoute>} />

            <Route path="agent-reservation/dashboard"  element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationDashboard /></ProtectedRoute>} />
            <Route path="agent-reservation/users"      element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationUsers /></ProtectedRoute>} />
            <Route path="agent-reservation/tickets"    element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationTickets /></ProtectedRoute>} />
            <Route path="agent-reservation/sales"      element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationSales /></ProtectedRoute>} />
            <Route path="agent-reservation/analytics"  element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationAnalytics /></ProtectedRoute>} />
            <Route path="agent-reservation/settings"   element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationSettings /></ProtectedRoute>} />
            <Route path="agent-reservation/faq"        element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationFaq /></ProtectedRoute>} />
            <Route path="agent-reservation/policies"   element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationPolicies /></ProtectedRoute>} />

            <Route path="agent-colis/dashboard" element={<ProtectedRoute roles={['agent_colis']}><CourrierConnectionProvider><AgentColisDashboard /></CourrierConnectionProvider></ProtectedRoute>} />
            <Route path="agent-colis/new" element={<ProtectedRoute roles={['agent_colis']}><CourrierConnectionProvider><NewParcelForm /></CourrierConnectionProvider></ProtectedRoute>} />
            <Route path="agent-colis/parcels/:id" element={<ProtectedRoute roles={['agent_colis']}><CourrierConnectionProvider><ParcelDetail /></CourrierConnectionProvider></ProtectedRoute>} />
            <Route path="agent-colis/scan" element={<ProtectedRoute roles={['agent_colis']}><CourrierConnectionProvider><QrScanner /></CourrierConnectionProvider></ProtectedRoute>} />
            <Route path="superviseur-colis/expense-entry" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><AgentColisExpenses /></ProtectedRoute>} />
            <Route path="superviseur-colis/expense-report" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><AgentColisExpenseReport /></ProtectedRoute>} />
            <Route path="agent-colis/sms-fees" element={<ProtectedRoute roles={['agent_colis', 'superviseur_colis']}><AgentColisSmsFeesReport /></ProtectedRoute>} />
            <Route path="superviseur-colis/dashboard" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><SuperviseurColisDashboard /></ProtectedRoute>} />
            <Route path="superviseur-colis/parcels" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><SuperviseurParcelsList /></ProtectedRoute>} />
            <Route path="superviseur-colis/parcels/:id" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><SuperviseurParcelDetail /></ProtectedRoute>} />
            <Route path="superviseur-colis/revenue" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><SuperviseurRevenueByStation /></ProtectedRoute>} />
            <Route path="superviseur-colis/sms-fees" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><SuperviseurSmsFeesByStation /></ProtectedRoute>} />
            <Route path="superviseur-colis/expenses" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><SuperviseurExpensesByStation /></ProtectedRoute>} />
            <Route path="superviseur-colis/consolidated" element={<ProtectedRoute roles={['superviseur_colis', 'admin', 'daf']}><SuperviseurConsolidatedReport /></ProtectedRoute>} />

            <Route path="fuel/report" element={<ProtectedRoute roles={['pompiste', 'admin', 'daf']}><FuelReport /></ProtectedRoute>} />

            <Route path="charge-achat/dashboard"       element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><ChargeAchatDashboard /></ProtectedRoute>} />
            <Route path="charge-achat/expenses"        element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><ChargeAchatExpensesList /></ProtectedRoute>} />
            <Route path="charge-achat/expenses/new"    element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><ChargeAchatExpenseForm /></ProtectedRoute>} />
            <Route path="charge-achat/expenses/:id/edit" element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><ChargeAchatExpenseForm /></ProtectedRoute>} />
            <Route path="charge-achat/fleet"           element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><ChargeAchatFleet /></ProtectedRoute>} />
            <Route path="charge-achat/report"          element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><ChargeAchatWeeklyReport /></ProtectedRoute>} />
            <Route path="charge-achat/analysis"        element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><ChargeAchatAnalysis /></ProtectedRoute>} />
            <Route path="charge-achat/fixed-expenses"        element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><FixedExpensesList /></ProtectedRoute>} />
            <Route path="charge-achat/fixed-expenses/new"    element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><FixedExpenseForm /></ProtectedRoute>} />
            <Route path="charge-achat/fixed-expenses/:id/edit" element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><FixedExpenseForm /></ProtectedRoute>} />
            <Route path="charge-achat/fixed-expense-types"   element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><FixedExpenseTypes /></ProtectedRoute>} />
            <Route path="charge-achat/fixed-expenses-report" element={<ProtectedRoute roles={['charge_achat', 'admin', 'daf']}><FixedExpensesReport /></ProtectedRoute>} />

            <Route path="reports" element={<ProtectedRoute roles={['admin', 'daf', 'comptable', 'gestionnaire']}><Reports /></ProtectedRoute>} />
            <Route path="reports/sales" element={<ProtectedRoute roles={['admin', 'daf', 'comptable', 'gestionnaire']}><SalesReport /></ProtectedRoute>} />
            <Route path="reports/financial" element={<ProtectedRoute roles={['admin', 'daf', 'comptable', 'gestionnaire']}><FinancialReport /></ProtectedRoute>} />
            <Route path="reports/fuel" element={<ProtectedRoute roles={['admin', 'daf', 'comptable', 'gestionnaire']}><FuelReport /></ProtectedRoute>} />
            <Route path="reports/maintenance" element={<ProtectedRoute roles={['admin', 'chef_garage', 'gestionnaire', 'daf']}><MaintenanceReport /></ProtectedRoute>} />
            <Route path="reports/driver-hours" element={<ProtectedRoute roles={['admin', 'gestionnaire', 'daf']}><DriverHoursReport /></ProtectedRoute>} />
            <Route path="reports/stock" element={<ProtectedRoute roles={['admin', 'gestionnaire', 'daf']}><StockReport /></ProtectedRoute>} />
            <Route path="reports/bus-activity" element={<ProtectedRoute roles={['admin', 'gestionnaire', 'daf']}><BusActivityReport /></ProtectedRoute>} />
            <Route path="reports/driver-performance" element={<ProtectedRoute roles={['admin', 'gestionnaire', 'daf']}><DriverPerformanceReport /></ProtectedRoute>} />
            <Route path="reports/loyalty" element={<ProtectedRoute roles={['admin', 'daf', 'gestionnaire']}><LoyaltyReport /></ProtectedRoute>} />

            <Route path="stock/parts" element={<ProtectedRoute roles={['admin', 'chef_garage', 'mecanicien']}><Parts /></ProtectedRoute>} />
            <Route path="stock/suppliers" element={<ProtectedRoute roles={['admin', 'chef_garage']}><Suppliers /></ProtectedRoute>} />
            <Route path="stock/purchase-orders" element={<ProtectedRoute roles={['admin', 'chef_garage']}><PurchaseOrders /></ProtectedRoute>} />
            <Route path="stock/purchase-orders/new" element={<ProtectedRoute roles={['admin', 'chef_garage']}><PurchaseOrderNew /></ProtectedRoute>} />
            <Route path="stock/purchase-orders/:id" element={<ProtectedRoute roles={['admin', 'chef_garage']}><PurchaseOrderDetail /></ProtectedRoute>} />
            <Route path="stock/movements" element={<ProtectedRoute roles={['admin', 'chef_garage', 'mecanicien']}><Movements /></ProtectedRoute>} />

            {/* Gestion Agboville — LOT 0: additive module, cloisonné à la ligne Agboville */}
            <Route path="gestion-agboville/dashboard" element={<ProtectedRoute roles={['gestion_agboville']}><GestionAgbovilleDashboard /></ProtectedRoute>} />
            <Route path="gestion-agboville/depenses" element={<ProtectedRoute roles={['gestion_agboville']}><GestionAgbovilleDepenses /></ProtectedRoute>} />
            <Route path="gestion-agboville/parametrage" element={<ProtectedRoute roles={['gestion_agboville']}><GestionAgbovilleParametrage /></ProtectedRoute>} />
            <Route path="gestion-agboville/suivi-recettes" element={<ProtectedRoute roles={['gestion_agboville']}><GestionAgbovilleSuiviRecettes /></ProtectedRoute>} />
            <Route path="gestion-agboville/rapport-consolide" element={<ProtectedRoute roles={['gestion_agboville']}><GestionAgbovilleRapportConsolide /></ProtectedRoute>} />
          </Route>

          {/* POS /guichet module — LOT 0+1: additive, standalone layout, offline-first */}
          <Route path="/guichet/connexion" element={<ConnectionProvider><POSConnexion /></ConnectionProvider>} />
          <Route path="/guichet" element={<ConnectionProvider><POSSessionProvider><GuichetRoleGuard /></POSSessionProvider></ConnectionProvider>}>
            <Route path="accueil" element={<POSAccueil />} />
            <Route path="depart/nouveau" element={<POSDepartNouveau />} />
            <Route path="departs" element={<POSDeparts />} />
            <Route path="depart/:id/vente" element={<POSVente />} />
            <Route path="depart/:id/bagages" element={<POSBagages />} />
            <Route path="recette-bagage" element={<POSRecetteBagage />} />
            <Route path="depenses" element={<POSDepenses />} />
            <Route path="autres-gares" element={<POSAutresGares />} />
            <Route path="cloture" element={<POSCloture />} />
            <Route path="ramassage" element={<POSRamassage />} />
            <Route path="ramassage/nouveau" element={<POSRamassageNouveau />} />
            <Route path="convois" element={<POSConvois />} />
            <Route path="parametres" element={<POSParametres />} />
            {/* ── Courrier accessible from POS guichet when station has courrier_enabled ── */}
            <Route path="courrier" element={<CourrierAccessGuard><CourrierConnectionProvider><AgentColisDashboard /></CourrierConnectionProvider></CourrierAccessGuard>} />
            {/* The courrier screens go back to ".../dashboard": without this route, the guichet landed on the login page */}
            <Route path="courrier/dashboard" element={<Navigate to="/guichet/courrier" replace />} />
            <Route path="courrier/new" element={<CourrierAccessGuard><CourrierConnectionProvider><NewParcelForm /></CourrierConnectionProvider></CourrierAccessGuard>} />
            <Route path="courrier/parcels/:id" element={<CourrierAccessGuard><CourrierConnectionProvider><ParcelDetail /></CourrierConnectionProvider></CourrierAccessGuard>} />
            <Route path="courrier/scan" element={<CourrierAccessGuard><CourrierConnectionProvider><QrScanner /></CourrierConnectionProvider></CourrierAccessGuard>} />
          </Route>

          {/* TPE-POS module — TPE-optimized baggage terminal, offline-first, reuses POS infrastructure */}
          <Route path="/tpe-pos/connexion" element={<ConnectionProvider><TPEConnexion /></ConnectionProvider>} />
          <Route path="/tpe-pos" element={<ConnectionProvider><POSSessionProvider /></ConnectionProvider>}>
            <Route path="accueil" element={<BaggageTerminal />} />
          </Route>

          {/* Bornes digitales — public routes (no auth for travelers) */}
          <Route path="/bornes/login" element={<KioskLogin />} />
          <Route path="/bornes/terminal" element={<KioskTerminal />} />
          <Route path="/bornes/:slug" element={<KioskTerminal />} />

          {/* Bornes admin — protected, inside Layout */}
          <Route path="bornes/admin/dashboard" element={<ProtectedRoute roles={['gestionnaire_borne','admin']}><KioskDashboard /></ProtectedRoute>} />
          <Route path="bornes/admin/gestion" element={<ProtectedRoute roles={['gestionnaire_borne','admin']}><KioskDashboard /></ProtectedRoute>} />
          <Route path="bornes/admin/recettes" element={<ProtectedRoute roles={['gestionnaire_borne','admin']}><KioskReports /></ProtectedRoute>} />
          <Route path="bornes/admin/transactions" element={<ProtectedRoute roles={['gestionnaire_borne','admin']}><KioskTransactions /></ProtectedRoute>} />
          <Route path="bornes/admin/qr-codes" element={<ProtectedRoute roles={['gestionnaire_borne','admin']}><KioskQRCodes /></ProtectedRoute>} />
          <Route path="bornes/dashboard" element={<ProtectedRoute roles={['gestionnaire_borne','admin']}><KioskDashboard /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
      <AppUpdateBanner />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          },
        }}
      />
    </>
  );
}

export default App;
