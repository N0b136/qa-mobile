import { useEffect, useState } from 'react'
import { useAppTick } from '../../hooks/useAppTick'
import { startConsoleSync } from '../../services/cloudSync'
import type { Audience } from '../../services/cloudSync'
import {
  getStaffPersonaId,
  clearStaffPersonaId,
  fireDueSchedules,
} from '../../services/consoleService'
import { getPersona } from '../../content/staff'
import ConsoleHeader from './ConsoleHeader'
import PersonaGate from './PersonaGate'
import CallsBoard from './CallsBoard'
import SendWord from './SendWord'
import GuestRoster from './GuestRoster'
import './console.css'

// The desktop Back Office console. It lives OUTSIDE the guest Shell (no TopBar /
// BottomNav, no RequireAuth) and talks to the phone app over Firestore via the
// cloud bridge. Every screen reads the local mirrors that cloudSync keeps warm.
export default function ConsoleScreen() {
  useAppTick()
  const [personaId, setPersonaId] = useState<string | null>(() => getStaffPersonaId())
  const [prefillAudience, setPrefillAudience] = useState<Audience | null>(null)

  useEffect(() => {
    document.body.classList.add('console-mode')
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

  const persona = personaId ? getPersona(personaId) : undefined

  if (!persona) {
    return <PersonaGate onPick={setPersonaId} />
  }

  return (
    <div className="console-root">
      <ConsoleHeader
        persona={persona}
        onSwitch={() => {
          clearStaffPersonaId()
          setPersonaId(null)
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
