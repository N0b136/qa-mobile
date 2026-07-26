import { useLocation, useNavigate } from 'react-router-dom'
import { TabBar } from '../ui'
import type { TabBarItem } from '../ui'

const ITEMS: TabBarItem[] = [
  { id: '/', label: 'Home', icon: 'castle' },
  { id: '/map', label: 'Map', icon: 'map' },
  { id: '/quests', label: 'Quests', icon: 'route' },
  { id: '/book', label: 'Book', icon: 'ticket' },
  { id: '/more', label: 'More', icon: 'menu' },
]

// Mirrors the old NavLink (non-`end`) matching: exact for "/", prefix-by-segment
// for the rest, so a sub-route like /quests/rangers still lights up "Quests".
function matchesTab(pathname: string, id: string) {
  return id === '/' ? pathname === '/' : pathname === id || pathname.startsWith(`${id}/`)
}

export default function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const activeId = ITEMS.find((item) => matchesTab(pathname, item.id))?.id ?? '/'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        paddingBottom: 'var(--safe-bottom)',
        background: 'var(--stone-950)',
        zIndex: 50,
      }}
    >
      <TabBar items={ITEMS} value={activeId} onChange={navigate} />
    </div>
  )
}
