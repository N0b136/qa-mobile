import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { ToastProvider } from './components/Toast'
import Shell from './components/Shell'

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
import BookScreen from './screens/BookScreen'
import BookingsScreen from './screens/BookingsScreen'
import PartyScreen from './screens/PartyScreen'
import LeaderboardScreen from './screens/LeaderboardScreen'
import HelpScreen from './screens/HelpScreen'
import DemoConsoleScreen from './screens/DemoConsoleScreen'

import { currentUser } from './services/authService'
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
  return (
    <ToastProvider>
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
          <Route path="book" element={<BookScreen />} />
          <Route path="party" element={<PartyScreen />} />
          <Route path="leaderboard" element={<LeaderboardScreen />} />
          <Route path="help" element={<HelpScreen />} />
          <Route path="demo" element={<DemoConsoleScreen />} />
          <Route path="bookings" element={<BookingsScreen />} />
          <Route path="notifications" element={<NotificationsScreen />} />
          <Route path="more" element={<MoreScreen />} />
        </Route>
        <Route path="*" element={<NotFoundRedirect />} />
      </Routes>
    </ToastProvider>
  )
}
