import { useEffect, useState } from 'react'
import { useAppTick } from '../../hooks/useAppTick'
import { startConsoleSync } from '../../services/cloudSync'
import type { Audience } from '../../services/cloudSync'
import type { StaffDoc } from '../../services/cloudAuth'
import {
  currentStaff,
  revalidateStaff,
  signOutStaff,
  fireDueSchedules,
} from '../../services/consoleService'
import { personaFromStaff } from '../../content/staff'
import ConsoleHeader from './ConsoleHeader'
import StaffGate from './StaffGate'
import CallsBoard from './CallsBoard'
import SendWord from './SendWord'
import GuestRoster from './GuestRoster'
import './console.css'

// The desktop Back Office console. It lives OUTSIDE the guest Shell (no TopBar /
// BottomNav, no RequireAuth) and talks to the phone app over Firestore via the
// cloud bridge. Every screen reads the local mirrors that cloudSync keeps warm.
export default function ConsoleScreen() {
  useAppTick()
  const [staff, setStaff] = useState<StaffDoc | null>(() => currentStaff())
  const [prefillAudience, setPrefillAudience] = useState<Audience | null>(null)

  useEffect(() => {
    document.body.classList.add('console-mode')
    // A cached staff session is only good while Firebase still vouches for it.
    void revalidateStaff().then(() => setStaff(currentStaff()))
    const stopSync = startConsoleSync()
    // Fire anything already overdue the moment the console opens, then poll.
    void fireDueSchedules()
    const interval = window.setInterval(() => {
      void fireDueSchedules()
    }, 15000)
    return () => {
      document.body.classList.remove('console-mode')
      stopSync()
      window.clearInterval(interval)
    }
  }, [])

  if (!staff) {
    return <StaffGate onSignedIn={setStaff} />
  }

  const persona = personaFromStaff(staff)

  return (
    <div className="console-root">
      <ConsoleHeader
        persona={persona}
        onSignOut={() => {
          void signOutStaff().then(() => setStaff(null))
        }}
      />
      <div className="console-grid">
        <CallsBoard persona={persona} />
        <SendWord persona={persona} prefillAudience={prefillAudience} />
        <GuestRoster onSend={setPrefillAudience} />
      </div>
    </div>
  )
}
