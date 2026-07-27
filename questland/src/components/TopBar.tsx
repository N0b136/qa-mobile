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
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        height: 'calc(var(--topbar-height) + var(--chrome-safe-top))',
        padding: '0 14px',
        paddingTop: 'var(--chrome-safe-top)',
        background: 'var(--surface-overlay)',
        backdropFilter: 'var(--blur-veil)',
        borderBottom: '1px solid var(--border-hairline)',
        zIndex: 50,
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
