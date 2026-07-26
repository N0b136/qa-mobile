import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { activeSosFor, createSos, resolveSos } from '../services/sosService'
import { ZONES, getZone } from '../content/zones'
import { Badge, Button, Card, Icon, Input, Select } from '../ui'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

// Secondary-Button look, hand-rolled on a real <a href="tel:..."> so the
// device actually dials (Button's `as="a"` variant has no href in its prop
// type — see task notes). +1-555-0100 is a fictional demo number.
const callLineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-xs)',
  height: 44,
  padding: '0 var(--space-lg)',
  marginTop: 12,
  font: 'var(--button-ui)',
  letterSpacing: 'var(--tracking-label)',
  textTransform: 'uppercase',
  textDecoration: 'none',
  color: 'var(--text-gold)',
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
}

export default function HelpScreen() {
  useAppTick()
  const user = currentUser()
  const [, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)

  const [zoneId, setZoneId] = useState(ZONES[0].id)
  const [message, setMessage] = useState('')

  if (!user) return null

  const activeEmergency = activeSosFor(user.id, 'emergency')
  const activeHint = activeSosFor(user.id, 'quest-help')

  function handleSendSos() {
    createSos(user!.id, 'emergency', { zoneId, message: message.trim() || undefined })
    setMessage('')
    refresh()
  }

  function handleStandDown() {
    if (!activeEmergency) return
    resolveSos(activeEmergency.id)
    refresh()
  }

  function handleAskHint() {
    createSos(user!.id, 'quest-help', { zoneId })
    refresh()
  }

  function handleNeverMind() {
    if (!activeHint) return
    resolveSos(activeHint.id)
    refresh()
  }

  return (
    <div className="screen">
      <h1 className="section-title" style={{ ...capsHeadingStyle, margin: 0 }}>
        <Icon name="shield" size={20} />
        Call for Aid
      </h1>
      <p className="muted" style={{ marginTop: 6 }}>
        A Warden is never far when you travel Questia.
      </p>

      <div className="stack" style={{ marginTop: 18, gap: 16 }}>
        <Card eyebrow="Emergency" title="Summon a Warden">
          <div className="stack" style={{ gap: 12 }}>
            {!activeEmergency ? (
              <>
                <Select
                  label="Where are you?"
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  options={ZONES.map((z) => ({ value: z.id, label: z.name }))}
                />
                <Input
                  label="What's happening? (optional)"
                  placeholder="A few words for the Warden"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <Button variant="danger" fullWidth icon="siren" onClick={handleSendSos}>
                  Send SOS
                </Button>
              </>
            ) : (
              <>
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ color: 'var(--status-danger)', display: 'inline-flex', flexShrink: 0 }}>
                    <Icon name={activeEmergency.status === 'acknowledged' ? 'shield' : 'siren'} size={22} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>
                      {activeEmergency.status === 'acknowledged'
                        ? `${activeEmergency.responder} is on the way`
                        : 'Alerting the Wardens…'}
                    </div>
                    <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
                      {activeEmergency.status === 'acknowledged'
                        ? 'Stay where you are.'
                        : 'Reaching the nearest Warden now.'}
                    </p>
                  </div>
                  <Badge tone="valor">{activeEmergency.status}</Badge>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Icon name={activeEmergency.zoneId ? getZone(activeEmergency.zoneId)?.icon ?? 'map-pin' : 'map-pin'} size={14} />
                    {activeEmergency.zoneId ? getZone(activeEmergency.zoneId)?.name : 'Location unknown'}
                  </div>
                  {activeEmergency.message ? <div style={{ marginTop: 4 }}>&ldquo;{activeEmergency.message}&rdquo;</div> : null}
                </div>
                <Button variant="ghost" onClick={handleStandDown}>
                  Stand down (I&apos;m safe)
                </Button>
              </>
            )}

            <a href="tel:+15550100" style={callLineStyle}>
              <Icon name="phone" size={18} />
              Call the Warden&apos;s line
            </a>
          </div>
        </Card>

        <Card eyebrow="On a quest" title="Ask a Guide for a hint">
          <div className="stack" style={{ gap: 12 }}>
            {!activeHint ? (
              <>
                <p className="muted">Stuck at a Station? A roving Guide can point the way.</p>
                <Button variant="secondary" icon="life-buoy" onClick={handleAskHint}>
                  Ask for a hint
                </Button>
              </>
            ) : (
              <>
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ color: 'var(--text-gold)', display: 'inline-flex', flexShrink: 0 }}>
                    <Icon name={activeHint.status === 'acknowledged' ? 'life-buoy' : 'hand'} size={22} />
                  </span>
                  <div style={{ flex: 1 }}>
                    {activeHint.status === 'acknowledged'
                      ? `${activeHint.responder} is bringing a hint`
                      : 'A Guide has your request…'}
                  </div>
                </div>
                <Button variant="ghost" onClick={handleNeverMind}>
                  Never mind
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
