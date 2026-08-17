import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { InstallStepsDialog } from '../components/InstallBanner'
import { currentUser, signOut } from '../services/authService'
import { levelFor, totalXp } from '../services/progressService'
import { Badge, Button, Card, Icon } from '../ui'

const MENU = [
  { to: '/leaderboard', label: 'Standings', icon: 'trophy' },
  { to: '/bookings', label: 'My bookings', icon: 'ticket' },
  { to: '/party', label: 'My party', icon: 'users' },
  { to: '/help', label: 'Help & SOS', icon: 'shield' },
  { to: '/notifications', label: 'Notifications', icon: 'bell' },
]

export default function MoreScreen() {
  useAppTick()
  const navigate = useNavigate()
  const user = currentUser()
  const { canInstall, platform, promptInstall } = useInstallPrompt()
  const [showIosSteps, setShowIosSteps] = useState(false)
  if (!user) return null

  const level = levelFor(totalXp(user.id))

  function handleSignOut() {
    signOut()
    navigate('/welcome')
  }

  function handleInstallTap() {
    if (platform === 'ios') setShowIosSteps(true)
    else promptInstall()
  }

  return (
    <div className="screen">
      <Card>
        <div className="row" style={{ gap: 14 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--gold-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-gold)',
              flexShrink: 0,
            }}
          >
            <Icon name={user.avatar || 'shield'} size={28} />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{user.name}</div>
            <div className="muted">{user.email}</div>
            <Badge tone="gold" style={{ marginTop: 6 }}>
              Lv {level}
            </Badge>
          </div>
        </div>
      </Card>

      <div className="stack" style={{ marginTop: 18 }}>
        {MENU.map((item) => (
          <Link key={item.to} to={item.to} style={{ display: 'block' }}>
            <Card interactive>
              <div className="row row--between">
                <span className="row" style={{ gap: 10 }}>
                  <Icon name={item.icon} size={20} style={{ color: 'var(--text-gold)' }} />
                  <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700 }}>{item.label}</span>
                </span>
                <Icon name="chevron-right" size={18} style={{ color: 'var(--text-muted)' }} />
              </div>
            </Card>
          </Link>
        ))}
        {canInstall ? (
          <Card interactive onClick={handleInstallTap} role="button" tabIndex={0}>
            <div className="row row--between">
              <span className="row" style={{ gap: 10 }}>
                <Icon name="download" size={20} style={{ color: 'var(--text-gold)' }} />
                <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700 }}>Install Questland</span>
              </span>
              <Icon name="chevron-right" size={18} style={{ color: 'var(--text-muted)' }} />
            </div>
          </Card>
        ) : null}
        {/* SPIKE-TEMPORARY: disposable lock-screen audio spike (src/screens/RadioSpikeScreen.tsx).
            Remove this row when Questland Radio proper lands. */}
        <Link to="/radio-test" style={{ display: 'block' }}>
          <Card interactive>
            <div className="row row--between">
              <span className="row" style={{ gap: 10 }}>
                <Icon name="radio-tower" size={20} style={{ color: 'var(--text-muted)' }} />
                <span>
                  <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, display: 'block' }}>Radio Spike</span>
                  <span className="muted" style={{ fontSize: 12 }}>A sound trial for the coming Questland Radio.</span>
                </span>
              </span>
              <Icon name="chevron-right" size={18} style={{ color: 'var(--text-muted)' }} />
            </div>
          </Card>
        </Link>
      </div>

      <Button
        variant="ghost"
        fullWidth
        icon="log-out"
        style={{ marginTop: 22, color: 'var(--status-danger)', borderColor: 'var(--status-danger)' }}
        onClick={handleSignOut}
      >
        Sign out
      </Button>

      <p className="muted" style={{ textAlign: 'center', marginTop: 24 }}>
        Questland Adventures — pitch demo
      </p>

      {showIosSteps ? <InstallStepsDialog onClose={() => setShowIosSteps(false)} /> : null}
    </div>
  )
}
