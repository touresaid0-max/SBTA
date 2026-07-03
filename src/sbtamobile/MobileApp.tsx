import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MobileAuthProvider, useMobileAuth } from './MobileAuthContext';
import { BookingProvider } from './BookingContext';
import { PhoneShell, LOGO_SRC, LOGO_ALT } from './components';
import { ReactNode, useEffect, useState } from 'react';

import AccueilScreen from './screens/AccueilScreen';
import RegisterScreen from './screens/RegisterScreen';
import OtpScreen from './screens/OtpScreen';
import LoginScreen from './screens/LoginScreen';
import ForgotScreen from './screens/ForgotScreen';
import SearchScreen from './screens/SearchScreen';
import TripsScreen from './screens/TripsScreen';
import TripDetailScreen from './screens/TripDetailScreen';
import SeatCountScreen from './screens/SeatCountScreen';
import RecapScreen from './screens/RecapScreen';
import PassengersScreen from './screens/PassengersScreen';
import PaymentMethodScreen from './screens/PaymentMethodScreen';
import PaymentScreen from './screens/PaymentScreen';
import TicketScreen from './screens/TicketScreen';
import MyTicketsScreen from './screens/MyTicketsScreen';
import ProfileScreen from './screens/ProfileScreen';
import HelpScreen from './screens/HelpScreen';
import TrackCourrierScreen from './screens/TrackCourrierScreen';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useMobileAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-32 text-sm text-gray-400">
        Chargement...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/sbtamobile/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function SplashScreen() {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: '#FFFFFF' }}
    >
      <img
        src={LOGO_SRC}
        alt={LOGO_ALT}
        draggable={false}
        className="sbta-splash-logo h-auto w-[72%] max-w-[300px] select-none object-contain"
      />
    </div>
  );
}

export default function MobileApp() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <MobileAuthProvider>
      <BookingProvider>
        <PhoneShell>
          {showSplash && <SplashScreen />}
          <Routes>
            <Route index element={<AccueilScreen />} />
            <Route path="register" element={<RegisterScreen />} />
            <Route path="otp" element={<OtpScreen />} />
            <Route path="login" element={<LoginScreen />} />
            <Route path="forgot-password" element={<ForgotScreen />} />
            <Route path="search" element={<RequireAuth><SearchScreen /></RequireAuth>} />
            <Route path="trips" element={<RequireAuth><TripsScreen /></RequireAuth>} />
            <Route path="trip" element={<RequireAuth><TripDetailScreen /></RequireAuth>} />
            <Route path="seats" element={<RequireAuth><SeatCountScreen /></RequireAuth>} />
            <Route path="recap" element={<RequireAuth><RecapScreen /></RequireAuth>} />
            <Route path="passengers" element={<RequireAuth><PassengersScreen /></RequireAuth>} />
            <Route path="payment-method" element={<RequireAuth><PaymentMethodScreen /></RequireAuth>} />
            <Route path="payment" element={<RequireAuth><PaymentScreen /></RequireAuth>} />
            <Route path="tickets" element={<RequireAuth><MyTicketsScreen /></RequireAuth>} />
            <Route path="reservations" element={<RequireAuth><MyTicketsScreen /></RequireAuth>} />
            <Route path="track-courrier" element={<RequireAuth><TrackCourrierScreen /></RequireAuth>} />
            <Route path="track-courrier/:code" element={<RequireAuth><TrackCourrierScreen /></RequireAuth>} />
            <Route path="profile" element={<RequireAuth><ProfileScreen /></RequireAuth>} />
            <Route path="help" element={<RequireAuth><HelpScreen /></RequireAuth>} />
            <Route path="ticket" element={<RequireAuth><TicketScreen /></RequireAuth>} />
            <Route path="ticket/:id" element={<RequireAuth><TicketScreen /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/sbtamobile" replace />} />
          </Routes>
        </PhoneShell>
      </BookingProvider>
    </MobileAuthProvider>
  );
}
