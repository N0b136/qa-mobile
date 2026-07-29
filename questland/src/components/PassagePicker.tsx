// "Show me your passage."
//
// No quest is handed out at the gate on a promise, so this is where the guest
// presents one. Every passage they hold is listed — the ones good today are
// tappable, the rest stay on the list with the reason they are not, because
// "you have no passage" and "your passage is for Saturday" are different
// problems and the guest should be able to tell which one they have.
//
// Tapping a passage IS presenting it: one tap, the quest is taken, a Quest
// Experience is spent. The rules behind each line live in passService.

import { useNavigate } from 'react-router-dom'
import { passStates } from '../services/passService'
import type { PassState } from '../services/passService'
import { Badge, Button, Dialog, Icon, Tag } from '../ui'

interface Props {
  userId: string
  /** Guests walking in on this passage — the party standing at the gate. */
  guests?: number
  /** What the passage is being presented for, e.g. "Episode IV — Aldric's Key". */
  subtitle?: string
  /** A refusal from the last attempt, shown above the list. */
  error?: string
  onPick: (bookingId: string) => void
  onClose: () => void
}

function allowanceBadge(state: PassState) {
  if (state.remaining === null) return <Badge tone="gold" icon="infinity">Unlimited</Badge>
  return (
    <Badge tone="gold" icon="scroll-text">
      {state.remaining} of {state.allowance}
    </Badge>
  )
}

export default function PassagePicker({ userId, guests = 1, subtitle, error, onPick, onClose }: Props) {
  const navigate = useNavigate()
  const states = passStates(userId)
  const valid = states.filter((s) => s.status === 'valid')
  const rest = states.filter((s) => s.status !== 'valid')

  return (
    <Dialog
      eyebrow="At the gate"
      title="Present a passage"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Not yet
          </Button>
          <Button icon="ticket" onClick={() => navigate('/book')}>
            Book a passage
          </Button>
        </>
      }
    >
      {subtitle ? (
        <p style={{ font: 'var(--body-sm)', color: 'var(--text-muted)' }}>{subtitle}</p>
      ) : null}

      {error ? (
        <p
          className="row"
          style={{ gap: 6, marginTop: 10, font: 'var(--body-sm)', color: 'var(--status-danger)' }}
        >
          <Icon name="triangle-alert" size={15} />
          {error}
        </p>
      ) : null}

      {states.length === 0 ? (
        <p style={{ marginTop: 12, font: 'var(--body-base)', color: 'var(--text-muted)' }}>
          You hold no passage. One Quest Experience opens one episode — book one and the quest is
          yours to take up at the gate.
        </p>
      ) : (
        <>
          <p style={{ marginTop: 12, font: 'var(--body-sm)', color: 'var(--text-muted)' }}>
            {valid.length === 0
              ? 'None of your passages is good for today.'
              : guests > 1
                ? `A passage covers the guests it was booked for — the rest of your ${guests} present their own.`
                : 'Choose the passage to spend a Quest Experience from.'}
          </p>

          <div className="stack" style={{ gap: 0, marginTop: 8 }}>
            {[...valid, ...rest].map((state, i) => {
              const good = state.status === 'valid'
              const row = (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        font: '700 var(--text-md)/1.2 var(--font-display)',
                        textTransform: 'uppercase',
                        letterSpacing: 'var(--tracking-display-tight)',
                        color: good ? 'var(--text-heading)' : 'var(--text-muted)',
                      }}
                    >
                      {state.tier.name}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        font: '700 var(--text-xs)/1 var(--font-ui)',
                        letterSpacing: '.1em',
                        color: good ? 'var(--text-gold)' : 'var(--text-muted)',
                      }}
                    >
                      {state.booking.code}
                    </div>
                    <div style={{ marginTop: 4, font: 'var(--body-sm)', color: 'var(--text-muted)' }}>
                      {state.note}
                      {good && guests > 1
                        ? ` Covers ${Math.min(state.guests, guests)} of your ${guests}.`
                        : ''}
                    </div>
                  </div>
                  {good ? allowanceBadge(state) : <Tag icon="lock">{state.status}</Tag>}
                </>
              )

              const frame = {
                display: 'flex',
                width: '100%',
                // A flex item will not shrink below its min-content unless told
                // to; without this the row set the dialog's width instead of
                // the other way round.
                minWidth: 0,
                gap: 'var(--space-sm)',
                alignItems: 'flex-start',
                textAlign: 'left' as const,
                padding: '12px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                background: 'none',
                border: i === 0 ? 'none' : undefined,
              }

              return good ? (
                <button
                  key={state.booking.id}
                  onClick={() => onPick(state.booking.id)}
                  style={{ ...frame, cursor: 'pointer', borderLeft: 'none', borderRight: 'none', borderBottom: 'none' }}
                >
                  {row}
                </button>
              ) : (
                <div key={state.booking.id} style={{ ...frame, opacity: 0.65 }}>
                  {row}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Dialog>
  )
}
