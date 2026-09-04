import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { StaffDoc } from '../../services/cloudAuth'
import { completeGoogleSignIn, signInStaff, signInStaffWithGoogle } from '../../services/consoleService'
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
 *
 * TWO DOORS, ONE GATE. Google sits above the password form because it is where
 * this console is going: the QAios vault keys its roster by a Google uid, and a
 * person holding one account for the console and another for the vault is two
 * identities that neither app can match up. But the password form stays, and
 * that is the safety of the change rather than an oversight — a Google account
 * that is not yet on the roll is refused exactly like any stranger, so nobody
 * can lock themselves out by trying it before a Warden has moved them across.
 * The form comes out on the day every staff account has been.
 */
export default function StaffGate({ onSignedIn }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [strandedUid, setStrandedUid] = useState('')
  const [busy, setBusy] = useState(false)

  // A Google sign-in on a phone goes by redirect, so the answer arrives on THIS
  // load rather than as the return value of the click that started it. Without
  // this the person comes back from Google to a gate that has forgotten it ever
  // asked, which reads as the sign-in having silently failed.
  useEffect(() => {
    let live = true
    void completeGoogleSignIn().then((result) => {
      if (!live || !result) return
      if (result.ok) {
        onSignedIn(result.staff)
        return
      }
      setError(result.error)
      setStrandedUid(result.uid ?? '')
    })
    return () => {
      live = false
    }
  }, [onSignedIn])

  function apply(result: Awaited<ReturnType<typeof signInStaff>>) {
    if (result.ok) {
      onSignedIn(result.staff)
      return
    }
    setError(result.error)
    setStrandedUid(result.uid ?? '')
  }

  async function handleGoogle() {
    if (busy) return
    setError('')
    setStrandedUid('')
    setBusy(true)
    try {
      apply(await signInStaffWithGoogle())
    } finally {
      // On the redirect path the page is already navigating away and this never
      // runs; on the popup path it must, or a cancelled chooser leaves the gate
      // stuck busy with no way to try again.
      setBusy(false)
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !password) {
      setError('Enter your guild email and password.')
      return
    }
    setError('')
    setStrandedUid('')
    setBusy(true)
    try {
      apply(await signInStaff(email, password))
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
          <Button
            type="button"
            variant="secondary"
            fullWidth
            icon="log-in"
            disabled={busy}
            onClick={() => void handleGoogle()}
          >
            Sign in with Google
          </Button>

          <div className="console-gate__or" role="separator">
            <span>or</span>
          </div>

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
                  if (strandedUid) setStrandedUid('')
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
                if (strandedUid) setStrandedUid('')
              }}
            />

            {error ? (
              <p style={{ color: 'var(--status-danger)', marginTop: 'var(--space-md)', fontSize: 14 }}>
                {error}
              </p>
            ) : null}

            {/* Shown only when Firebase knows this person but the roll does not.
                It is their own identifier handed back to them, and it is exactly
                what a Warden needs to add them: without it, moving an account to
                Google means hunting a uid in the Firebase console that the app
                which just refused you could have simply told you. */}
            {strandedUid ? (
              <p className="console-gate__uid">
                For the Warden adding this account to the roll:
                <code>{strandedUid}</code>
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
