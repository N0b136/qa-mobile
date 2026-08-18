import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'
import BottomNav from './BottomNav'
import GateIntro from './GateIntro'
import MiniPlayer from './MiniPlayer'
import { currentUser } from '../services/authService'
import { syncBookingReminders } from '../services/bookingService'
import { startGuestSync } from '../services/cloudSync'
import { enablePush, pushState } from '../services/pushService'

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
    // Re-mint the push token on every start. This prompts NOBODY — enablePush
    // returns early unless permission was already granted — but it is the only
    // thing that catches a token Google has rotated: the v9+ SDK dropped
    // onTokenRefresh, so a device that is never re-registered silently stops
    // receiving, with no error on either side.
    if (pushState() === 'on') void enablePush(user.id)
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
          // qa-ui-rise animates `top` (not `transform`) for exactly the reason
          // in the note above the header/nav wrappers, generalized: some
          // screens (e.g. MapScreen) root themselves with `position: fixed`,
          // and ANY transformed ancestor — even only transiently, mid-
          // animation, `fill: both` or not — becomes their containing block
          // and collapses them against this wrapper's near-zero intrinsic
          // height instead of the viewport. `top` never does that, so it's
          // safe for the Outlet wrapper at every point in the animation.
          animation: 'qa-ui-rise var(--dur-reveal) var(--ease-out-door) var(--intro-ui-delay, 4.55s) both',
        }}
      >
        <Outlet />
      </div>
      <div style={fadeInStyle}>
        {/* Fixed like the nav and stacked in the same z-50 band, so it lives in
            this wrapper's stacking context alongside it. */}
        <MiniPlayer />
        <BottomNav />
      </div>
    </>
  )
}
