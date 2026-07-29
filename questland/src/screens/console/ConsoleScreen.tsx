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
import * as hubLink from '../../services/hubLink'
import { installHubSim, isSimRequested } from '../../services/hubSim'
import { broadcastTable, startTapPipeline } from '../../services/tapService'
import ConsoleHeader from './ConsoleHeader'
import StaffGate from './StaffGate'
import CallsBoard from './CallsBoard'
import SendWord from './SendWord'
import GuestsAfield from './GuestsAfield'
import StationsBoard from './StationsBoard'
import StationRecords from './StationRecords'
import BoothPanel from './BoothPanel'
import NoticeBoard from './NoticeBoard'
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
    return () => {
      document.body.classList.remove('console-mode')
    }
  }, [])

  // Everything here is a staff power, so none of it may start before sign-in.
  // Reading the calls board or the schedule queue as the anonymous bootstrap
  // session is refused outright, and a refused listener never recovers.
  useEffect(() => {
    if (!staff) return
    const stopSync = startConsoleSync()
    // Fire anything already overdue the moment the console opens, then poll.
    void fireDueSchedules()
    const interval = window.setInterval(() => {
      void fireDueSchedules()
    }, 15000)

    // The hub lives on this effect too, for the same reason the listeners do:
    // a tap becomes a staff-authenticated Firestore write, so the port must not
    // be open one moment longer than the staff session behind it. Signing out
    // closes the cable with the listeners.
    //
    // `hubLink.connect()` is a reference-counted module singleton, not effect
    // state — under StrictMode this effect mounts, tears down and mounts again,
    // and a per-effect connection would open the same port twice and report its
    // own second failure as 'held'.
    const stopTaps = startTapPipeline()
    // Only the SIMULATOR attaches itself. A real serial port needs a user
    // gesture to open (Slice 7), so it can never be connected from an effect.
    const simulated = isSimRequested()
    if (simulated) {
      void hubLink.connect(installHubSim()).then(() => {
        // Hand the simulated park the rack as it stands, so a tag tapped
        // straight after opening resolves locally instead of querying.
        broadcastTable()
      })
    }

    return () => {
      stopSync()
      stopTaps()
      if (simulated) hubLink.disconnect()
      window.clearInterval(interval)
    }
  }, [staff?.uid])

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
        <StationsBoard />
        {/* BELOW the chart, never above it: MapCanvas re-clamps its pan on every
            ancestor resize, and the booth stage changes height on every scan. */}
        <BoothPanel staffUid={staff.uid} />
        <SendWord persona={persona} prefillAudience={prefillAudience} />
        <CallsBoard persona={persona} />
        <GuestsAfield onSend={setPrefillAudience} />
        <NoticeBoard persona={persona} />
        <StationRecords />
      </div>
    </div>
  )
}
