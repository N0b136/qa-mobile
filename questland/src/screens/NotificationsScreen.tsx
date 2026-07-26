import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { listFor, markAllRead, markRead, permissionState, requestPermission } from '../services/notificationService'
import type { NotificationType } from '../types'
import EmptyState from '../components/EmptyState'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, Icon } from '../ui'

const TYPE_ICON: Record<NotificationType, string> = {
  event: 'flame',
  booking: 'calendar',
  lore: 'scroll-text',
  system: 'settings',
  sos: 'shield',
}

// A handful of notifications still carry an emoji in their data-level `icon`
// field (e.g. progressService's lore-complete notice uses a scroll emoji) —
// map those to Lucide glyphs here at render time; the data-level purge is a
// separate later pass (same approach as HomeScreen's ORG_ICON and
// EmptyState/Toast's legacy-literal fallback). Keys are unicode escapes, not
// literal glyphs, so this file itself stays emoji-free.
const EMOJI_ICON: Record<string, string> = {
  '\u{1F4DC}': 'scroll-text', // scroll
  '\u{1F514}': 'bell', // bell
  '\u{1F515}': 'bell-off', // bell with slash
}
const LUCIDE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

function iconFor(n: { type: NotificationType; icon?: string }): string {
  if (n.icon) {
    if (LUCIDE_NAME.test(n.icon)) return n.icon
    if (EMOJI_ICON[n.icon]) return EMOJI_ICON[n.icon]
  }
  return TYPE_ICON[n.type]
}

const sectionTitleStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

const ROUTE_FOR: Record<NotificationType, string> = {
  booking: '/bookings',
  lore: '/quests',
  sos: '/help',
  system: '/party',
  event: '/',
}

function routeFor(type: NotificationType): string {
  return ROUTE_FOR[type]
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return 'just now'
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  return `${Math.floor(diff / day)}d ago`
}

export default function NotificationsScreen() {
  useAppTick()
  const { show } = useToast()
  const navigate = useNavigate()
  const user = currentUser()
  if (!user) return null

  const notifications = listFor(user.id)
  const showPermissionCta = permissionState() === 'default'

  async function handleEnable() {
    const result = await requestPermission()
    show(
      result === 'granted'
        ? { title: 'Notifications enabled', icon: 'bell' }
        : { title: 'Notifications not enabled', icon: 'bell-off' }
    )
  }

  return (
    <div className="screen">
      <div className="row row--between">
        <h1 className="section-title" style={{ ...sectionTitleStyle, margin: 0 }}>
          <Icon name="bell" size={20} />
          Notifications
        </h1>
        {notifications.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => markAllRead(user.id)}>
            Mark all read
          </Button>
        )}
      </div>

      {showPermissionCta && (
        <Card style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--text-gold)', marginTop: 2, display: 'inline-flex' }}>
              <Icon name="bell" size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>Never miss a happening</p>
              <p className="muted" style={{ marginBottom: 12 }}>
                Turn on notifications for quest updates, bookings, and park events.
              </p>
              <Button size="sm" onClick={handleEnable}>
                Enable notifications
              </Button>
            </div>
          </div>
        </Card>
      )}

      {notifications.length === 0 ? (
        <EmptyState icon="bell-off" title="No tidings yet." />
      ) : (
        <div className="stack">
          {notifications.map((n) => (
            <Card
              key={n.id}
              interactive
              role="button"
              tabIndex={0}
              onClick={() => {
                markRead(user.id, n.id)
                navigate(routeFor(n.type))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  markRead(user.id, n.id)
                  navigate(routeFor(n.type))
                }
              }}
            >
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--text-gold)', flexShrink: 0, marginTop: 2, display: 'inline-flex' }}>
                  <Icon name={iconFor(n)} size={22} />
                </span>
                <div style={{ flex: 1 }}>
                  <div className="row row--between">
                    <strong style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{n.title}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {relativeTime(n.createdAt)}
                    </span>
                  </div>
                  <p className="muted" style={{ marginTop: 2 }}>
                    {n.body}
                  </p>
                </div>
                {!n.read && <Badge tone="gold" dot style={{ flexShrink: 0 }} />}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
