import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { ToastProvider } from './components/Toast'
import Shell from './components/Shell'
import InstallBanner from './components/InstallBanner'

import WelcomeScreen from './screens/WelcomeScreen'
import AuthScreen from './screens/AuthScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import HomeScreen from './screens/HomeScreen'
import MapScreen from './screens/MapScreen'
import NotificationsScreen from './screens/NotificationsScreen'
import MoreScreen from './screens/MoreScreen'
import QuestsScreen from './screens/QuestsScreen'
import QuestlineScreen from './screens/QuestlineScreen'
import CheckInScreen from './screens/CheckInScreen'
import GateScreen from './screens/GateScreen'
import BookScreen from './screens/BookScreen'
import BookingsScreen from './screens/BookingsScreen'
import PartyScreen from './screens/PartyScreen'
import LeaderboardScreen from './screens/LeaderboardScreen'
import HelpScreen from './screens/HelpScreen'
import DemoConsoleScreen from './screens/DemoConsoleScreen'
/**
 * /console is kept for old bookmarks, but it hands over to console.html — the
 * separate document that carries the Back Office manifest. Installing from
 * inside the guest app would install the GUEST app, since the manifest a
 * document links is what decides the app's identity.
 */
function ConsoleDoor() {
  window.location.replace(`${import.meta.env.BASE_URL}console.html`)
  return null
}

import { currentUser, reconcileSession } from './services/authService'
import { useAppTick } from './hooks/useAppTick'

function RequireAuth({ children }: { children: ReactElement }): ReactElement {
  useAppTick()
  if (!currentUser()) return <Navigate to="/welcome" replace />
  return children
}

function NotFoundRedirect(): ReactElement {
  useAppTick()
  return <Navigate to={currentUser() ? '/' : '/welcome'} replace />
}

export default function App() {
  // A cloud account only stays signed in while Firebase agrees. Local-only
  // accounts and an unreachable cloud are both left alone.
  useEffect(() => {
    void reconcileSession()
  }, [])

  return (
    <ToastProvider>
      <InstallBanner />
      <Routes>
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/auth" element={<AuthScreen />} />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <OnboardingScreen />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route index element={<HomeScreen />} />
          <Route path="map" element={<MapScreen />} />
          <Route path="quests" element={<QuestsScreen />} />
          <Route path="quests/:orgId" element={<QuestlineScreen />} />
          <Route path="quests/:orgId/check-in" element={<CheckInScreen />} />
          {/* The Gate absorbed the Book tab. /book and /bookings are still their
              own routes — they are simply reached from inside the Gate now. */}
          <Route path="gate" element={<GateScreen />} />
          <Route path="book" element={<BookScreen />} />
          <Route path="party" element={<PartyScreen />} />
          <Route path="leaderboard" element={<LeaderboardScreen />} />
          <Route path="help" element={<HelpScreen />} />
          <Route path="demo" element={<DemoConsoleScreen />} />
          <Route path="bookings" element={<BookingsScreen />} />
          <Route path="notifications" element={<NotificationsScreen />} />
          <Route path="more" element={<MoreScreen />} />
        </Route>
        <Route path="/console" element={<ConsoleDoor />} />
        <Route path="*" element={<NotFoundRedirect />} />
      </Routes>
    </ToastProvider>
  )
}
