import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'
import BottomNav from './BottomNav'
import GateIntro from './GateIntro'
import { currentUser } from '../services/authService'
import { syncBookingReminders } from '../services/bookingService'
import { startGuestSync } from '../services/cloudSync'

// Chrome that fades in as the gate intro ends. TopBar/BottomNav are
// `position: fixed` internally — their reveal wrapper must only ever set
// opacity (a transform here would re-parent their fixed positioning and
// break the layout). The Outlet wrapper is the one place a translateY rise
// is safe, since its content is in-flow.
// Fallback 4.55s = INTRO_SECONDS(5) - 0.45, matching the README offset.
// NOTE: an animated `opacity` (with `fill: both` keeping it applied after
// the animation ends) makes the wrapper form its own stacking context, so
// TopBar/BottomNav's own `z-index: 50` resolves *inside* this wrapper rather
// than against the root. Without an explicit z-index here the wrapper is a
// static ~0-stacking context, which sits BELOW the Outlet wrapper's z-index
// 10 — content would then paint over the fixed bars. `position: relative` +
// `zIndex: 50` puts the wrapper's stacking context back above the Outlet's.
// `position: relative` is safe (doesn't re-parent the fixed child) — only
// transform/filter/perspective/contain/will-change do that.
const fadeInStyle = {
  position: 'relative',
  zIndex: 50,
  opacity: 0,
  animation: 'qa-fade-in var(--dur-reveal) var(--ease-out-door) var(--intro-ui-delay, 4.55s) both',
} as const

export default function Shell() {
  const user = currentUser()

  useEffect(() => {
    if (!user) return
    syncBookingReminders(user.id)
    const stop = startGuestSync(user.id)
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return (
    <>
      <GateIntro />
      <div style={fadeInStyle}>
        <TopBar />
      </div>
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          opacity: 0,
          // Fallback 4.55s = INTRO_SECONDS(5) - 0.45, matching the README offset.
          animation: 'qa-ui-rise var(--dur-reveal) var(--ease-out-door) var(--intro-ui-delay, 4.55s) both',
        }}
      >
        <Outlet />
      </div>
      <div style={fadeInStyle}>
        <BottomNav />
      </div>
    </>
  )
}
