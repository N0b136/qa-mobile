import { Navigate, useNavigate } from 'react-router-dom'
import { currentUser } from '../services/authService'
import { Button } from '../ui'

export default function WelcomeScreen() {
  const navigate = useNavigate()
  if (currentUser()) return <Navigate to="/" replace />

  return (
    <div
      className="screen--bare"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        textAlign: 'center',
      }}
    >
      {/* TODO: gate hero photo when img-gate-* assets land */}
      <img
        src={`${import.meta.env.BASE_URL}assets/logo-questland-primary.png`}
        alt="Questland Adventures"
        style={{ width: '65%', maxWidth: 240, marginBottom: 'var(--space-xl)' }}
      />
      <h1
        style={{
          fontSize: 'var(--text-3xl)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-display)',
        }}
      >
        Questland Adventures
      </h1>
      <p className="muted" style={{ fontSize: 16, margin: '10px 0 32px' }}>
        The Guild has been expecting you.
      </p>
      <div className="stack" style={{ width: '100%' }}>
        <Button size="lg" fullWidth onClick={() => navigate('/auth?mode=signup')}>
          Create account
        </Button>
        <Button variant="ghost" size="lg" fullWidth onClick={() => navigate('/auth')}>
          Sign in
        </Button>
      </div>
    </div>
  )
}
