import { useLocation, useNavigate } from 'react-router-dom'
import { TabBar } from '../ui'
import type { TabBarItem } from '../ui'

/**
 * A tab, plus any other routes it owns.
 *
 * `owns` is data rather than a special case inside the matcher because a tab
 * that absorbed another feature is a thing that happens more than once: the
 * Gate took in the old Book tab, since booking a passage, presenting one and
 * taking up a quest are all the same moment of a guest's day. /book and
 * /bookings are still their own routes, reached from inside the Gate — so the
 * Gate has to stay lit while the guest is on them, or tapping "Book a passage"
 * would visibly deselect the tab they are standing in.
 */
interface NavTab extends TabBarItem {
  owns?: string[]
}

const ITEMS: NavTab[] = [
  { id: '/', label: 'Home', icon: 'castle' },
  { id: '/map', label: 'Map', icon: 'map' },
  { id: '/quests', label: 'Quests', icon: 'route' },
  { id: '/gate', label: 'Gate', icon: 'door-open', owns: ['/book', '/bookings'] },
  { id: '/more', label: 'More', icon: 'menu' },
]

// Mirrors the old NavLink (non-`end`) matching: exact for "/", prefix-by-segment
// for the rest, so a sub-route like /quests/rangers still lights up "Quests".
function matchesPath(pathname: string, base: string) {
  return base === '/' ? pathname === '/' : pathname === base || pathname.startsWith(`${base}/`)
}

function matchesTab(pathname: string, tab: NavTab) {
  return [tab.id, ...(tab.owns ?? [])].some((base) => matchesPath(pathname, base))
}

export default function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const activeId = ITEMS.find((item) => matchesTab(pathname, item))?.id ?? '/'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        // Centred on inset + auto margins, NEVER translateX, and the intro
        // reveal is animated HERE rather than on a wrapper — see the
        // fixed-chrome note in Shell.tsx. A transform on this bar, or an
        // animation on anything above it, costs it viewport-fixed compositing
        // on iOS and it rides the scroll instead of holding the bottom.
        left: 0,
        right: 0,
        marginInline: 'auto',
        width: '100%',
        maxWidth: 480,
        paddingBottom: 'var(--safe-bottom)',
        background: 'var(--stone-950)',
        zIndex: 50,
        // Fallback 4.55s = INTRO_SECONDS(5) - 0.45; GateIntro drops it to 0s
        // once the reveal has run, so nothing mounting later waits it out.
        animation: 'qa-fade-in var(--dur-reveal) var(--ease-out-door) var(--intro-ui-delay, 4.55s) both',
      }}
    >
      <TabBar items={ITEMS} value={activeId} onChange={navigate} />
    </div>
  )
}
