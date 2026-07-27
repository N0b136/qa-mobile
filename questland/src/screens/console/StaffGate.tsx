import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { StaffDoc } from '../../services/cloudAuth'
import { signInStaff } from '../../services/consoleService'
import { Button, Card, Icon, Input } from '../../ui'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

interface Props {
  onSignedIn: (staff: StaffDoc) => void
}

/**
 * The console's front door. Nothing here decides whether you are staff — the
 * Firestore rules do, off the staff/{uid} allowlist. A guest account signs in
 * fine and still gets turned away at this gate with nothing granted.
 */
export default function StaffGate({ onSignedIn }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !password) {
      setError('Enter your guild email and password.')
      return
    }
    setError('')
    setBusy(true)
    try {
      const result = await signInStaff(email, password)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSignedIn(result.staff)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="console-gate">
      <div>
        <h1
          className="section-title"
          style={{ ...capsHeadingStyle, justifyContent: 'center', margin: 0 }}
        >
          The Guild Roll
        </h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Sign in with your guild account. Only Wardens and Guides on the roll may open the Back
          Office.
        </p>
      </div>

      <div style={{ maxWidth: 380, width: '100%' }}>
        <Card>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <Input
                label="Guild email"
                id="staff-email"
                type="email"
                icon="mail"
                value={email}
                autoComplete="email"
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (error) setError('')
                }}
              />
            </div>
            <Input
              label="Password"
              id="staff-password"
              type="password"
              icon="key-round"
              value={password}
              autoComplete="current-password"
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError('')
              }}
            />

            {error ? (
              <p style={{ color: 'var(--status-danger)', marginTop: 'var(--space-md)', fontSize: 14 }}>
                {error}
              </p>
            ) : null}

            <Button type="submit" fullWidth disabled={busy} style={{ marginTop: 'var(--space-lg)' }}>
              {busy ? 'Checking the roll…' : 'Open the Back Office'}
            </Button>
          </form>
        </Card>

        <p
          className="muted"
          style={{ marginTop: 'var(--space-md)', fontSize: 12, display: 'flex', gap: 6 }}
        >
          <Icon name="shield" size={14} />
          Staff accounts are issued from the Firebase console. They are not created here.
        </p>
      </div>
    </div>
  )
}
