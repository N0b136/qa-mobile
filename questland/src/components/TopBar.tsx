import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { unreadCount } from '../services/notificationService'
import { Icon } from '../ui'

const TAP_WINDOW_MS = 3000
const TAP_TARGET = 7

export default function TopBar() {
  useAppTick()
  const navigate = useNavigate()
  const tapTimes = useRef<number[]>([])
  const user = currentUser()
  const unread = user ? unreadCount(user.id) : 0

  function handleCrestTap() {
    const now = Date.now()
    tapTimes.current = [...tapTimes.current, now].filter((t) => now - t <= TAP_WINDOW_MS)
    if (tapTimes.current.length >= TAP_TARGET) {
      tapTimes.current = []
      navigate('/demo')
    }
  }

  return (
    <header
      className="row row--between"
      style={{
        position: 'fixed',
        top: 'var(--install-banner-height)',
        // Centred on inset + auto margins, NEVER translateX, and the intro
        // reveal is animated HERE rather than on a wrapper. See the
        // fixed-chrome note in Shell.tsx: on iOS both a transform and an
        // animated ancestor cost this bar its viewport-fixed compositing, and
        // it then scrolls away with the page.
        left: 0,
        right: 0,
        marginInline: 'auto',
        width: '100%',
        maxWidth: 480,
        height: 'calc(var(--topbar-height) + var(--chrome-safe-top))',
        padding: '0 14px',
        paddingTop: 'var(--chrome-safe-top)',
        background: 'var(--surface-overlay)',
        backdropFilter: 'var(--blur-veil)',
        borderBottom: '1px solid var(--border-hairline)',
        zIndex: 50,
        // Fallback 4.55s = INTRO_SECONDS(5) - 0.45; GateIntro drops it to 0s
        // once the reveal has run, so nothing mounting later waits it out.
        animation: 'qa-fade-in var(--dur-reveal) var(--ease-out-door) var(--intro-ui-delay, 4.55s) both',
      }}
    >
      <button
        onClick={handleCrestTap}
        style={{
          minHeight: 44,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <img
          src={`${import.meta.env.BASE_URL}assets/logo-questland-primary.png`}
          alt="Questland Adventures"
          style={{ height: 36, width: 'auto', objectFit: 'contain', display: 'block' }}
        />
      </button>
      <Link
        to="/notifications"
        aria-label="Notifications"
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          color: 'var(--text-muted)',
        }}
      >
        <Icon name="bell" size={22} />
        {unread > 0 && (
          <span
            className="pop-bounce"
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              minWidth: 18,
              height: 18,
              borderRadius: 999,
              background: 'var(--danger)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>
    </header>
  )
}
