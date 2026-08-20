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

// THE FIXED CHROME HANGS OFF THE ROOT, BARE. TopBar, MiniPlayer and BottomNav
// are each `position: fixed` with `z-index: 50`, and they are rendered here as
// direct children on purpose: no wrapper, no transform, no animated ancestor.
//
// These used to share one `<div>` carrying the gate-intro fade. Per spec that
// is harmless — only transform/filter/perspective/contain/will-change make an
// ancestor the containing block for a fixed child — but WebKit only composites
// a fixed element as VIEWPORT-CONSTRAINED (i.e. genuinely pinned, repainted
// independently of the scroll) while it can hoist it out of the scrolled
// content layer. An ancestor carrying an animation — including one that has
// already finished but is held by `fill: both` — gets its own accelerated
// layer, the fixed bars get painted into it, and on an iPhone they then ride
// the scroll and only snap back to the viewport when it comes to rest. On a
// short screen nobody notices; on the Radio list (43 songs) the nav bar walks
// up into the middle of the screen. Reported from real hardware 2026-08-20.
//
// So the reveal animation lives on each bar itself, keyed off the same
// `--intro-ui-delay` GateIntro publishes. A bar animating its own opacity is
// still viewport-constrained — it is the ANCESTOR that must stay plain.
// Without the wrapper their `z-index: 50` also resolves against the root
// stacking context, which is where the documented chain (video 0 < scrim 1 <
// Outlet 10 < bars 50 < shield 70 < toast 90) always meant it to resolve.

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
      <TopBar />
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
      {/* Fixed and stacked in the same z-50 band as the nav, and — like it —
          a bare child of the root. See the note above. */}
      <MiniPlayer />
      <BottomNav />
    </>
  )
}
