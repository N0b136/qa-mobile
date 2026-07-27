import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signIn, signUp } from '../services/authService'
import { MIN_PASSWORD_LENGTH } from '../services/cloudAuth'
import { Button, Card, Input } from '../ui'

type Tab = 'signin' | 'signup'

export default function AuthScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function switchTab(next: Tab) {
    setTab(next)
    setError('')
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password) {
      setError('Please fill in every field.')
      return
    }
    if (tab === 'signup') {
      if (password !== confirm) {
        setError('Those passwords do not match.')
        return
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`)
        return
      }
    }

    setBusy(true)
    try {
      if (tab === 'signup') {
        const defaultName = email.split('@')[0]?.trim() || 'Adventurer'
        await signUp(email, password, defaultName, 'shield')
        navigate('/onboarding')
      } else {
        await signIn(email, password)
        navigate('/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen--bare">
      <h1
        style={{
          textAlign: 'center',
          marginBottom: 'var(--space-xl)',
          fontSize: 'var(--text-2xl)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-display)',
        }}
      >
        Questland
      </h1>

      <div className="row" style={{ marginBottom: 'var(--space-lg)', gap: 'var(--space-2xs)' }}>
        <div style={{ flex: 1 }}>
          <Button type="button" variant={tab === 'signin' ? 'primary' : 'ghost'} fullWidth onClick={() => switchTab('signin')}>
            Sign in
          </Button>
        </div>
        <div style={{ flex: 1 }}>
          <Button type="button" variant={tab === 'signup' ? 'primary' : 'ghost'} fullWidth onClick={() => switchTab('signup')}>
            Create account
          </Button>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <Input
              label="Email"
              id="email"
              type="email"
              icon="mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div style={{ marginBottom: tab === 'signup' ? 'var(--space-md)' : 0 }}>
            <Input
              label="Password"
              id="password"
              type="password"
              icon="key-round"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>
          {tab === 'signup' && (
            <Input
              label="Confirm password"
              id="confirm"
              type="password"
              icon="key-round"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          )}

          {error && <p style={{ color: 'var(--status-danger)', marginTop: 'var(--space-md)', fontSize: 14 }}>{error}</p>}

          <Button type="submit" fullWidth disabled={busy} style={{ marginTop: 'var(--space-lg)' }}>
            {busy ? 'One moment…' : tab === 'signup' ? 'Create account' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
