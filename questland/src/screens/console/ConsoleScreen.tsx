import { useEffect, useState } from 'react'
import { useAppTick } from '../../hooks/useAppTick'
import { startConsoleSync } from '../../services/cloudSync'
import { enablePush, pushState } from '../../services/pushService'
import type { Audience } from '../../services/cloudSync'
import type { StaffDoc } from '../../services/cloudAuth'
import {
  currentStaff,
  revalidateStaff,
  signOutStaff,
  fireDueSchedules,
} from '../../services/consoleService'
import type { ManagerDoc } from '../../services/managerAuth'
import { clearManager, currentManager, revalidateManager } from '../../services/managerAuth'
import { startParkStatusWriter } from '../../services/parkStatusService'
import { personaFromStaff } from '../../content/staff'
import * as hubLink from '../../services/hubLink'
import { installHubSim, isSimRequested } from '../../services/hubSim'
import { broadcastTable, startTapPipeline } from '../../services/tapService'
import { recordHeartbeat } from '../../services/stationHealthService'
import ConsoleHeader from './ConsoleHeader'
import type { ConsoleView } from './ConsoleHeader'
import ManagerScreen from './manager/ManagerScreen'
import StaffGate from './StaffGate'
import QaiosPanel from './QaiosPanel'
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
  const [view, setView] = useState<ConsoleView>('console')
  // The cached grant, so the tab is on the first paint for a manager who has
  // been here before. It is re-checked against Firestore below and it decides
  // nothing on the server — see managerAuth.
  const [manager, setManager] = useState<ManagerDoc | null>(() => currentManager())

  // A grant can be taken away mid-session: revalidateManager resolving to null
  // hides the whole tab strip, and `view` would keep pointing at a surface the
  // person can no longer navigate away from — stranded on a tab with no nav.
  // Sign-out already resets the view below; this is the same care for the case
  // where the session survives but the grant does not. Pre-existing for the
  // Manager tab, and adding a second tab behind the same grant doubles the ways
  // in, so it is fixed here rather than left to be found twice.
  useEffect(() => {
    if (!manager && view !== 'console') setView('console')
  }, [manager, view])

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
    if (!staff) {
      // No session, no manager surface. Resetting the view as well as the grant
      // matters because this component is not remounted on sign-out: leaving
      // `view` on 'manager' would drop the NEXT person to sign in straight onto
      // the takings, and for a Guide with no grant onto a tab with no nav.
      setManager(null)
      setView('console')
      return
    }
    // Same re-mint-on-start contract as the guest Shell — prompts nobody, and is
    // the only thing that notices a rotated token. Filed with staff: true so the
    // sender can find this desk without scanning every guest's row; the claim is
    // re-checked against the roster before anything is delivered to it.
    if (pushState() === 'on') void enablePush(staff.uid, { staff: true })
    const stopSync = startConsoleSync()
    // The manager roll, re-read on every session. Same posture as the staff
    // revalidation above: only a definitive 'not-manager' takes the tab away, so
    // a park with a flat connection does not demote its own manager.
    //
    // `live` because the lookup runs on a 10s deadline and the session can end
    // inside it: cleanup runs, this effect re-runs on the !staff branch and
    // resets the grant to null, and then the in-flight promise resolves and puts
    // the previous account's doc straight back over that reset.
    let live = true
    void revalidateManager(staff.uid).then((next) => {
      if (live) setManager(next)
    })
    // The park reporting on itself, for readers with no cable of their own.
    // Unconditional on purpose: the writer self-gates on `isLive() &&
    // !isSimulated()`, so this console publishes only while it holds a real hub.
    // A manager's phone — which can never be live — sits silent and reads, and a
    // simulated hub stays silent too: pushParkStatus is a whole-document setDoc,
    // so a demo would REPLACE the booth's real report rather than sit beside it.
    const stopParkStatus = startParkStatusWriter(staff.uid)
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
    // The park reporting on itself. Kept out of the tap pipeline on purpose: a
    // tap is a Firestore write and a heartbeat never leaves this machine, so
    // they are two subscriptions with two lifetimes that happen to share a
    // cable. Recording a frame only touches module memory (stationHealthService
    // flushes to the mirror on its own coalesced timer), so twenty-one stations
    // reporting cannot turn into twenty-one console repaints.
    const stopHeartbeats = hubLink.onHeartbeat((frame) => {
      recordHeartbeat(frame)
    })
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
      live = false
      stopSync()
      stopTaps()
      stopHeartbeats()
      stopParkStatus()
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
          // The grant does not outlive the session that carried it. Cleared
          // before the sign-out resolves so the tab cannot be drawn for the
          // moment in between.
          clearManager()
          void signOutStaff().then(() => setStaff(null))
        }}
        view={view}
        onView={setView}
        canManage={!!manager}
      />
      {/* UNMOUNTED, not hidden. StationsBoard sizes MapCanvas from a
          ResizeObserver on its viewport element, and a `display: none` element
          measures 0 — hiding the grid would clamp the park chart to nothing and
          it would come back a sliver wide. Unmounting costs a re-measure on
          return, which is the cheap failure. */}
      {view === 'manager' ? (
        <ManagerScreen staffUid={staff.uid} />
      ) : view === 'qaios' ? (
        <QaiosPanel />
      ) : (
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
      )}
    </div>
  )
}
