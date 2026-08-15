import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/authStore';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import Layout from './components/layout/Layout';
import MobileApp from './sbtamobile/MobileApp';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import AcceptInvitation from './pages/auth/AcceptInvitation';
import MyProfile from './pages/auth/MyProfile';
import AdminDashboard from './pages/admin/Dashboard';
import PerformanceAnalytics from './pages/admin/PerformanceAnalytics';
import Companies from './pages/admin/Companies';
import FuelServices from './pages/admin/FuelServices';
import Users from './pages/admin/Users';
import Roles from './pages/admin/Roles';
import Buses from './pages/admin/Buses';
import AdminRoutes from './pages/admin/Routes';
import AdminSchedules from './pages/admin/Schedules';
import Cities from './pages/admin/Cities';
import Stations from './pages/admin/Stations';
import StationDetail from './pages/admin/StationDetail';
import Counters from './pages/admin/Counters';
import SearchTrips from './pages/client/SearchTrips';
import Booking from './pages/client/Booking';
import PlanificateurCalendar from './pages/planificateur/Calendar';
import PlanificateurAvailability from './pages/planificateur/Availability';
import NewSchedule from './pages/planificateur/NewSchedule';
import Reservations from './pages/admin/Reservations';
import Refunds from './pages/admin/Refunds';
import Boarding from './pages/guichetier/Boarding';
import CashRegister from './pages/guichetier/CashRegister';
import LoyaltyRedemption from './pages/guichetier/LoyaltyRedemption';
import TicketSale from './pages/guichetier/TicketSale';
import ChauffeurFuelVouchers from './pages/chauffeur/FuelVouchers';
import ChauffeurBreakdown from './pages/chauffeur/Breakdown';
import ChauffeurMyBreakdowns from './pages/chauffeur/MyBreakdowns';
import ChauffeurTrips from './pages/chauffeur/Trips';
import ChauffeurPerformance from './pages/chauffeur/Performance';
import ComptableFuelVouchers from './pages/comptable/FuelVouchers';
import ComptableNewDashboard from './pages/comptable/NewDashboard';
import ComptableExpenseForm from './pages/comptable/ComptableExpenseForm';
import ComptableExpensesList from './pages/comptable/ComptableExpensesList';
import ComptableFleet from './pages/comptable/ComptableFleet';
import ComptableWeeklyReport from './pages/comptable/ComptableWeeklyReport';
import ComptableCaisse from './pages/comptable/ComptableCaisse';
import ComptableStock from './pages/comptable/ComptableStock';
import ComptableStockMovements from './pages/comptable/ComptableStockMovements';
import FuelReport from './pages/fuel/Report';
import GarageDashboard from './pages/garage/Dashboard';
import GarageBreakdowns from './pages/garage/Breakdowns';
import GarageDiagnostics from './pages/garage/Diagnostics';
import GarageWorkOrders from './pages/garage/WorkOrders';
import GarageMaintenanceSchedule from './pages/garage/MaintenanceSchedule';
import BreakdownReceive from './pages/garage/BreakdownReceive';
import QualityCheck from './pages/garage/QualityCheck';
import MechanicDiagnostic from './pages/mecanicien/Diagnostic';
import WorkOrderNew from './pages/mecanicien/WorkOrderNew';
import WorkOrderExecute from './pages/mecanicien/WorkOrderExecute';
import ComptableWorkOrders from './pages/comptable/WorkOrders';
import WorkOrderDetail from './pages/comptable/WorkOrderDetail';
import Parts from './pages/stock/Parts';
import Suppliers from './pages/stock/Suppliers';
import PurchaseOrders from './pages/stock/PurchaseOrders';
import PurchaseOrderNew from './pages/stock/PurchaseOrderNew';
import PurchaseOrderDetail from './pages/stock/PurchaseOrderDetail';
import Movements from './pages/stock/Movements';
import Expenses from './pages/admin/Expenses';
import ExpenseValidation from './pages/comptable/ExpenseValidation';
import ComptableExpenses from './pages/comptable/Expenses';
import ExpensesReport from './pages/admin/ExpensesReport';
import StationDisplay from './pages/display/StationDisplay';
import DAFDashboard from './pages/daf/Dashboard';
import DAFFinancialReport from './pages/daf/FinancialReport';
import DAFConsolidatedReport from './pages/daf/ConsolidatedReport';
import DAFBusPerformance from './pages/daf/BusPerformance';
import DAFParcelReport from './pages/daf/ParcelReport';
import DAFBreakdownReport from './pages/daf/BreakdownReport';
import DAFBreakdowns from './pages/daf/Breakdowns';
import DAFCompteResultat from './pages/daf/CompteResultat';
import ComptableDashboard from './pages/comptable/Dashboard';
import GestionnaireDashboard from './pages/gestionnaire/Dashboard';
import GestionnaireReports from './pages/gestionnaire/Reports';
import GestionnaireBusPerformance from './pages/gestionnaire/BusPerformance';
import GestionnaireBusActivity from './pages/gestionnaire/BusActivity';
import GestionnaireDriversReport from './pages/gestionnaire/DriversReport';
import GestionnaireDrivers from './pages/gestionnaire/Drivers';
import GestionnaireFinancialReport from './pages/gestionnaire/FinancialReport';
import GestionnaireBreakdowns from './pages/gestionnaire/Breakdowns';
import BreakdownRevenueReport from './pages/reports/BreakdownRevenueReport';
import BreakdownDistributions from './pages/daf/BreakdownDistributions';
import ChauffeurDashboard from './pages/chauffeur/Dashboard';
import GuichetierDashboard from './pages/guichetier/Dashboard';
import GuichetierCharges from './pages/guichetier/Charges';
import GroupedSale from './pages/guichetier/GroupedSale';
import MecanicienDashboard from './pages/mecanicien/Dashboard';
import PlanificateurDashboard from './pages/planificateur/Dashboard';
import PompisteDashboard from './pages/pompiste/Dashboard';
import PompisteSuppliers from './pages/pompiste/Suppliers';
import PompisteProducts from './pages/pompiste/Products';
import PompistePurchaseOrders from './pages/pompiste/PurchaseOrders';
import PompisteDepotages from './pages/pompiste/Depotages';
import PompisteEnlevements from './pages/pompiste/Enlevements';
import PompisteReports from './pages/pompiste/Reports';
import ChefGareDashboard from './pages/chef_gare/Dashboard';
import ChefGareBreakdowns from './pages/chef_gare/Breakdowns';
import ChefGareDailyPlanning from './pages/chef_gare/DailyPlanning';
import ChefGareNewSchedule from './pages/chef_gare/NewSchedule';
import ChefGareCounters from './pages/chef_gare/Counters';
import ChefGareBaggageHandlers from './pages/chef_gare/BaggageHandlers';
import ChefGareSalesTracking from './pages/chef_gare/SalesTracking';
import ChefGareDailyReport from './pages/chef_gare/DailyReport';
import ChefGareStationDisplay from './pages/chef_gare/StationDisplayWrapper';
import ChefGareGroupedPlanning from './pages/chef_gare/GroupedPlanning';
import ChefGareConvoyReport from './pages/chef_gare/ConvoyReport';
import ChefGareConvoys from './pages/chef_gare/Convoys';
import ChefGareRamassage from './pages/chef_gare/Ramassage';
import ChefGareRamassageReport from './pages/chef_gare/RamassageReport';
import BagagisteBaggageSale from './pages/bagagiste/BaggageSale';
import BagagisteBaggageReport from './pages/bagagiste/BaggageReport';
import Review from './pages/client/Review';
import DriverPerformanceReport from './pages/admin/DriverPerformanceReport';
import Loyalty from './pages/client/Loyalty';
import Rewards from './pages/client/Rewards';
import LoyaltyHistory from './pages/client/LoyaltyHistory';
import ClientReservations from './pages/client/Reservations';
import AdminLoyalty from './pages/admin/Loyalty';
import Reports from './pages/reports/Reports';
import SalesReport from './pages/reports/SalesReport';
import FinancialReport from './pages/reports/FinancialReport';
import MaintenanceReport from './pages/reports/MaintenanceReport';
import DriverHoursReport from './pages/reports/DriverHoursReport';
import StockReport from './pages/reports/StockReport';
import BusActivityReport from './pages/reports/BusActivityReport';
import LoyaltyReport from './pages/reports/LoyaltyReport';
import ActivityLogs from './pages/admin/ActivityLogs';
import AuditLogs from './pages/admin/AuditLogs';
import Archives from './pages/admin/Archives';
import RamassageHistorique from './pages/admin/RamassageHistorique';
import Connexion from './pages/admin/Connexion';
import RHDashboard from './pages/rh/Dashboard';
import EmployeesPage from './pages/rh/EmployeesPage';
import EmployeeDetail from './pages/rh/EmployeeDetail';
import EmployeeForm from './pages/rh/EmployeeForm';
import DriversPage from './pages/rh/DriversPage';
import PayrollPage from './pages/rh/PayrollPage';
import RHReportsPage from './pages/rh/ReportsPage';
import ContractualPayPage from './pages/rh/ContractualPayPage';
import RHSettings from './pages/rh/RHSettings';
import DailyRatesPage from './pages/rh/DailyRatesPage';
import PaySlipsPage from './pages/rh/PaySlipsPage';
import PayrollBookPage from './pages/rh/PayrollBookPage';
import MasseSalarialePage from './pages/rh/MasseSalarialePage';
import LoansPage from './pages/rh/LoansPage';
import DeductionsPage from './pages/rh/DeductionsPage';
import PrimesPage from './pages/rh/PrimesPage';
import SuspensionsPage from './pages/rh/SuspensionsPage';
import DeactivatedEmployeesPage from './pages/rh/DeactivatedEmployeesPage';
import ExplanationsPage from './pages/rh/ExplanationsPage';
import LeavePermissionsPage from './pages/rh/LeavePermissions';
import LeaveReportPage from './pages/rh/LeaveReport';
import LeaveCeilingPage from './pages/rh/LeaveCeiling';
import DeclarationsPage from './pages/rh/DeclarationsPage';
import AgentColisDashboard from './pages/agent-colis/Dashboard';
import NewParcelForm from './pages/agent-colis/NewParcelForm';
import ParcelDetail from './pages/agent-colis/ParcelDetail';
import QrScanner from './pages/agent-colis/QrScanner';
import AgentColisExpenses from './pages/agent-colis/Expenses';
import AgentColisExpenseReport from './pages/agent-colis/ExpenseReport';
import AgentColisSmsFeesReport from './pages/agent-colis/SmsFeesReport';
import SuperviseurColisDashboard from './pages/superviseur-colis/Dashboard';
import SuperviseurParcelsList from './pages/superviseur-colis/ParcelsList';
import SuperviseurParcelDetail from './pages/superviseur-colis/ParcelDetail';
import SuperviseurRevenueByStation from './pages/superviseur-colis/RevenueByStation';
import SuperviseurSmsFeesByStation from './pages/superviseur-colis/SmsFeesByStation';
import SuperviseurExpensesByStation from './pages/superviseur-colis/ExpensesByStation';
import SuperviseurConsolidatedReport from './pages/superviseur-colis/ConsolidatedReport';
import TrackParcel from './pages/track/TrackParcel';
import ChargeAchatDashboard from './pages/charge-achat/Dashboard';
import ChargeAchatExpensesList from './pages/charge-achat/ExpensesList';
import ChargeAchatExpenseForm from './pages/charge-achat/ExpenseForm';
import ChargeAchatFleet from './pages/charge-achat/Fleet';
import ChargeAchatWeeklyReport from './pages/charge-achat/WeeklyReport';
import ChargeAchatAnalysis from './pages/charge-achat/Analysis'
import FixedExpensesList from './pages/charge-achat/FixedExpensesList'
import FixedExpenseForm from './pages/charge-achat/FixedExpenseForm'
import FixedExpenseTypes from './pages/charge-achat/FixedExpenseTypes'
import FixedExpensesReport from './pages/charge-achat/FixedExpensesReport'
import GaragesPage from './pages/admin/GaragesPage';
import FuelTanks from './pages/admin/FuelTanks';
import FuelStations from './pages/admin/FuelStations';
import GarageDetail from './pages/admin/GarageDetail'
import GarageQuoteForm from './pages/garage/QuoteForm'
import GarageQuotesList from './pages/garage/QuotesList'
import ComptableQuoteValidation from './pages/comptable/QuoteValidation';
import ComptableCarburantDashboard from './pages/comptable/ComptableCarburantDashboard';
import ComptableCarburantForm from './pages/comptable/ComptableCarburantForm';
import ComptableCarburantReport from './pages/comptable/ComptableCarburantReport';
import CarburantDashboard from './pages/carburant/Dashboard';
import CarburantNewWithdrawal from './pages/carburant/NewWithdrawal';
import CarburantReport from './pages/carburant/Report';
import CarburantConsommationClient from './pages/carburant/ConsommationClient';
import CarburantFuelStations from './pages/carburant/FuelStations';
import CarburantTankReport from './pages/carburant/TankReport';
import CarburantDepotageReport from './pages/carburant/DepotageReport';
import GerantPrincipalDashboard from './pages/gerant_principal/Dashboard';
import GerantPrincipalArticles from './pages/gerant_principal/Articles';
import GerantPrincipalReparations from './pages/gerant_principal/Reparations';
import GerantPrincipalStock from './pages/gerant_principal/Stock';
import GerantPrincipalParametres from './pages/gerant_principal/Parametres';
import GerantPrincipalReports from './pages/gerant_principal/Reports';
import AssuranceDashboard from './pages/assurance/Dashboard';
import AssuranceInsurancesList from './pages/assurance/InsurancesList';
import AssuranceInsuranceForm from './pages/assurance/InsuranceForm';
import AssuranceReports from './pages/assurance/Reports';
import AssuranceInsurersList from './pages/assurance/InsurersList';
import AssuranceInsurerForm from './pages/assurance/InsurerForm';
import LogistiqueDashboard from './pages/logistique/Dashboard';
import LogistiqueVehiclesList from './pages/logistique/VehiclesList';
import LogistiqueDriversPage from './pages/logistique/DriversPage';
import LogistiqueVehicleDetail from './pages/logistique/VehicleDetail';
import LogistiqueDocumentsList from './pages/logistique/DocumentsList';
import LogistiqueProviders from './pages/logistique/Providers';
import LogistiqueServiceTypes from './pages/logistique/ServiceTypes';
import LogistiqueReports from './pages/logistique/Reports';
import LogistiqueBusSynthesis from './pages/logistique/BusSynthesis';
import LogistiqueFleetBilan from './pages/logistique/FleetBilan';
import LogistiqueDriverReport from './pages/logistique/DriverReport';
import AgentReservationDashboard from './pages/agent-reservation/Dashboard';
import AgentReservationUsers from './pages/agent-reservation/MobileUsers';
import AgentReservationTickets from './pages/agent-reservation/Tickets';
import AgentReservationSales from './pages/agent-reservation/SalesReports';
import AgentReservationAnalytics from './pages/agent-reservation/Analytics';
import AgentReservationSettings from './pages/agent-reservation/Settings';
import AgentReservationFaq from './pages/agent-reservation/Faq';
import AgentReservationPolicies from './pages/agent-reservation/CancellationPolicies';

// Gestion Agboville module (LOT 0 — additive, no existing route modified)
import GestionAgbovilleDashboard from './pages/gestion_agboville/Dashboard';
import GestionAgbovilleDepenses from './pages/gestion_agboville/Depenses';
import GestionAgbovilleParametrage from './pages/gestion_agboville/Parametrage';
import GestionAgbovilleSuiviRecettes from './pages/gestion_agboville/SuiviRecettes';
import GestionAgbovilleRapportConsolide from './pages/gestion_agboville/RapportConsolide';

// POS module (LOT 0 — additive, no existing route modified)
import POSConnexion from './pages/pos/Connexion';
import POSAccueil from './pages/pos/Accueil';
import POSDepartNouveau from './pages/pos/DepartNouveau';
import POSDeparts from './pages/pos/Departs';
import POSVente from './pages/pos/Vente';
import POSBagages from './pages/pos/Bagages';
import POSDepenses from './pages/pos/Depenses';
import POSAutresGares from './pages/pos/AutresGares';
import POSCloture from './pages/pos/Cloture';
import POSRamassage from './pages/pos/Ramassage';
import POSConvois from './pages/pos/Convois';
import POSParametres from './pages/pos/Parametres';
import { POSSessionProvider } from './services/pos/POSSessionContext';

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
          <Route path="/register" element={<Register />} />
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
            <Route path="reports/driver-performance" element={<ProtectedRoute roles={['admin', 'gestionnaire']}><DriverPerformanceReport /></ProtectedRoute>} />
            <Route path="daf/dashboard" element={<ProtectedRoute roles={['daf']}><DAFDashboard /></ProtectedRoute>} />
            <Route path="daf/financial-report" element={<ProtectedRoute roles={['daf']}><DAFFinancialReport /></ProtectedRoute>} />
            <Route path="daf/consolidated-report" element={<ProtectedRoute roles={['daf']}><DAFConsolidatedReport /></ProtectedRoute>} />
            <Route path="daf/bus-performance" element={<ProtectedRoute roles={['daf']}><DAFBusPerformance /></ProtectedRoute>} />
            <Route path="daf/parcel-report" element={<ProtectedRoute roles={['daf']}><DAFParcelReport /></ProtectedRoute>} />
            <Route path="daf/breakdowns" element={<ProtectedRoute roles={['daf']}><DAFBreakdownReport /></ProtectedRoute>} />
            <Route path="daf/pannes" element={<ProtectedRoute roles={['daf']}><DAFBreakdowns /></ProtectedRoute>} />
            <Route path="daf/performance" element={<ProtectedRoute roles={['daf']}><PerformanceAnalytics /></ProtectedRoute>} />
            <Route path="daf/expenses-report" element={<ProtectedRoute roles={['daf']}><ExpensesReport /></ProtectedRoute>} />
            <Route path="daf/compte-resultat" element={<ProtectedRoute roles={['daf']}><DAFCompteResultat /></ProtectedRoute>} />
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
            <Route path="gerant-principal/reports" element={<ProtectedRoute roles={['gerant_principal']}><GerantPrincipalReports /></ProtectedRoute>} />
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
            <Route path="chef-gare/sales" element={<ProtectedRoute roles={['chef_gare']}><ChefGareSalesTracking /></ProtectedRoute>} />
            <Route path="chef-gare/convoys" element={<ProtectedRoute roles={['chef_gare']}><ChefGareConvoys /></ProtectedRoute>} />
            <Route path="chef-gare/ramassage" element={<ProtectedRoute roles={['chef_gare']}><ChefGareRamassage /></ProtectedRoute>} />
            <Route path="chef-gare/ramassage/report" element={<ProtectedRoute roles={['chef_gare']}><ChefGareRamassageReport /></ProtectedRoute>} />
            <Route path="chef-gare/convoys/report" element={<ProtectedRoute roles={['chef_gare']}><ChefGareConvoyReport /></ProtectedRoute>} />
            <Route path="chef-gare/daily-report" element={<ProtectedRoute roles={['chef_gare']}><ChefGareDailyReport /></ProtectedRoute>} />
            <Route path="chef-gare/breakdowns" element={<ProtectedRoute roles={['chef_gare']}><ChefGareBreakdowns /></ProtectedRoute>} />
            <Route path="chef-gare/display" element={<ProtectedRoute roles={['chef_gare']}><ChefGareStationDisplay /></ProtectedRoute>} />

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
            <Route path="rh/reports"                element={<ProtectedRoute roles={['rh', 'admin', 'daf']}><RHReportsPage /></ProtectedRoute>} />
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
            <Route path="logistique/vehicles"          element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueVehiclesList /></ProtectedRoute>} />
            <Route path="logistique/vehicles/:id"      element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueVehicleDetail /></ProtectedRoute>} />
            <Route path="logistique/drivers"          element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueDriversPage /></ProtectedRoute>} />
            <Route path="logistique/documents"         element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueDocumentsList /></ProtectedRoute>} />
            <Route path="logistique/providers"         element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueProviders /></ProtectedRoute>} />
            <Route path="logistique/service-types"     element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueServiceTypes /></ProtectedRoute>} />
            <Route path="logistique/reports"           element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueReports /></ProtectedRoute>} />
            <Route path="logistique/bus-synthesis"     element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueBusSynthesis /></ProtectedRoute>} />
            <Route path="logistique/bilan"            element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueFleetBilan /></ProtectedRoute>} />
            <Route path="logistique/driver-report"    element={<ProtectedRoute roles={['responsable_logistique', 'admin']}><LogistiqueDriverReport /></ProtectedRoute>} />

            <Route path="agent-reservation/dashboard"  element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationDashboard /></ProtectedRoute>} />
            <Route path="agent-reservation/users"      element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationUsers /></ProtectedRoute>} />
            <Route path="agent-reservation/tickets"    element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationTickets /></ProtectedRoute>} />
            <Route path="agent-reservation/sales"      element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationSales /></ProtectedRoute>} />
            <Route path="agent-reservation/analytics"  element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationAnalytics /></ProtectedRoute>} />
            <Route path="agent-reservation/settings"   element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationSettings /></ProtectedRoute>} />
            <Route path="agent-reservation/faq"        element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationFaq /></ProtectedRoute>} />
            <Route path="agent-reservation/policies"   element={<ProtectedRoute roles={['agent_reservation', 'admin']}><AgentReservationPolicies /></ProtectedRoute>} />

            <Route path="agent-colis/dashboard" element={<ProtectedRoute roles={['agent_colis']}><AgentColisDashboard /></ProtectedRoute>} />
            <Route path="agent-colis/new" element={<ProtectedRoute roles={['agent_colis']}><NewParcelForm /></ProtectedRoute>} />
            <Route path="agent-colis/parcels/:id" element={<ProtectedRoute roles={['agent_colis']}><ParcelDetail /></ProtectedRoute>} />
            <Route path="agent-colis/scan" element={<ProtectedRoute roles={['agent_colis']}><QrScanner /></ProtectedRoute>} />
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
          <Route path="/guichet/connexion" element={<POSConnexion />} />
          <Route path="/guichet" element={<POSSessionProvider />}>
            <Route path="accueil" element={<POSAccueil />} />
            <Route path="depart/nouveau" element={<POSDepartNouveau />} />
            <Route path="departs" element={<POSDeparts />} />
            <Route path="depart/:id/vente" element={<POSVente />} />
            <Route path="depart/:id/bagages" element={<POSBagages />} />
            <Route path="depenses" element={<POSDepenses />} />
            <Route path="autres-gares" element={<POSAutresGares />} />
            <Route path="cloture" element={<POSCloture />} />
            <Route path="ramassage" element={<POSRamassage />} />
            <Route path="convois" element={<POSConvois />} />
            <Route path="parametres" element={<POSParametres />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
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
