import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser, getUser } from '../services/authService'
import { seedDemoWorld, resetDemoData } from '../services/demoService'
import * as notificationService from '../services/notificationService'
import { listSos, acknowledgeSos, resolveSos } from '../services/sosService'
import { getZone } from '../content/zones'
import type { NotificationType, SosRequest } from '../types'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, Dialog, Icon } from '../ui'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

const NOTIFY_ACTIONS: Array<{ type: NotificationType; icon: string; label: string; title: string; body: string }> = [
  {
    type: 'event',
    icon: 'sparkles',
    label: 'Event',
    title: 'Lantern Rite tonight',
    body: 'Gather at dusk at Lake Lumen for the floating of the lanterns.',
  },
  {
    type: 'booking',
    icon: 'ticket',
    label: 'Booking',
    title: 'Your visit is tomorrow',
    body: 'Arrive by your chosen hour; the gates open at nine.',
  },
  {
    type: 'lore',
    icon: 'scroll-text',
    label: 'Lore',
    title: 'A whisper from the Elderwood',
    body: 'The oldest tree stirs — a new chapter opens to those who listen.',
  },
  {
    type: 'system',
    icon: 'users',
    label: 'System',
    title: 'A traveller joined your party',
    body: 'Sable now travels with the Ashen Vanguard.',
  },
  {
    type: 'sos',
    icon: 'shield',
    label: 'SOS broadcast',
    title: 'Warden broadcast',
    body: 'All Wardens to the Proving Grounds — a hero needs aid.',
  },
]

export default function DemoConsoleScreen() {
  useAppTick()
  const toast = useToast()
  const [, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const user = currentUser()
  if (!user) return null

  const calls = listSos().filter((s) => s.status !== 'resolved')

  async function handleSeed() {
    await seedDemoWorld(user!.id)
    refresh()
    toast.show({ title: 'Demo world seeded', icon: 'wand-sparkles' })
  }

  function handleReset() {
    resetDemoData(user!.id)
    setConfirmingReset(false)
    refresh()
    toast.show({ title: 'Demo data reset', icon: 'rotate-ccw' })
  }

  function handleNotify(action: (typeof NOTIFY_ACTIONS)[number]) {
    notificationService.add(user!.id, {
      type: action.type,
      title: action.title,
      body: action.body,
      icon: action.icon,
    })
    toast.show({ title: action.title, icon: action.icon })
    refresh()
  }

  function handleDispatch(call: SosRequest) {
    acknowledgeSos(call.id, call.kind === 'emergency' ? 'Warden Aldous' : 'Guide Wren')
    refresh()
    toast.show({ title: 'Dispatched', icon: 'send' })
  }

  function handleResolve(callId: string) {
    resolveSos(callId)
    refresh()
    toast.show({ title: 'Call for aid resolved', icon: 'check' })
  }

  return (
    <div className="screen">
      <h1 className="section-title" style={{ ...capsHeadingStyle, margin: 0 }}>
        <Icon name="settings-2" size={20} />
        Demo Console
      </h1>
      <p className="muted" style={{ marginTop: 6 }}>
        The presenter&apos;s remote — hidden from guests.
      </p>

      <div className="stack" style={{ marginTop: 18, gap: 16 }}>
        <Card eyebrow="Presenter tools" title="Demo data">
          <div className="stack" style={{ gap: 12 }}>
            <p className="muted">
              Seed a cast of travelers, a lived-in party, a booked passage, and a call for aid — ready for a
              walkthrough. Reset clears the demo without touching your own account.
            </p>
            <Button icon="wand-sparkles" onClick={handleSeed}>
              Seed demo world
            </Button>
            <Button
              variant="ghost"
              icon="rotate-ccw"
              style={{ color: 'var(--status-danger)' }}
              onClick={() => setConfirmingReset(true)}
            >
              Reset demo data
            </Button>
          </div>
        </Card>

        <Card eyebrow="Notify" title="Fire a notification">
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {NOTIFY_ACTIONS.map((action) => (
              <Button
                key={action.type}
                variant="secondary"
                size="sm"
                icon={action.icon}
                onClick={() => handleNotify(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </Card>

        <Card eyebrow="Live" title="Calls for aid">
          {calls.length === 0 ? (
            <p className="muted">No active calls for aid.</p>
          ) : (
            <div className="stack" style={{ gap: 0 }}>
              {calls.map((call, i) => {
                const guest = getUser(call.userId)?.name ?? 'A guest'
                const zoneName = call.zoneId ? getZone(call.zoneId)?.name : undefined
                return (
                  <div
                    key={call.id}
                    style={{
                      padding: '14px 0',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                    }}
                  >
                    <div className="row row--between">
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{guest}</strong>
                        <Badge tone={call.kind === 'emergency' ? 'valor' : 'gold'}>
                          {call.kind === 'emergency' ? 'Emergency' : 'Quest help'}
                        </Badge>
                      </div>
                      <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                        {call.status}
                      </span>
                    </div>
                    {zoneName ? (
                      <div className="muted row" style={{ gap: 6, marginTop: 6, fontSize: 13 }}>
                        <Icon name="map-pin" size={14} />
                        {zoneName}
                      </div>
                    ) : null}
                    {call.message ? (
                      <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                        &ldquo;{call.message}&rdquo;
                      </p>
                    ) : null}
                    <div className="row" style={{ gap: 10, marginTop: 10 }}>
                      {call.status === 'open' ? (
                        <Button size="sm" icon="send" onClick={() => handleDispatch(call)}>
                          Dispatch
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => handleResolve(call.id)}>
                        Resolve
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {confirmingReset ? (
        <Dialog
          title="Reset demo data?"
          onClose={() => setConfirmingReset(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmingReset(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleReset}>
                Reset demo data
              </Button>
            </>
          }
        >
          <p>This clears the seeded cast, party, booking, and calls for aid. Your own account stays intact.</p>
        </Dialog>
      ) : null}
    </div>
  )
}
