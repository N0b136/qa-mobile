import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { cancelBooking, getTier, listBookings } from '../services/bookingService'
import { passStateFor } from '../services/passService'
import type { Booking } from '../types'
import EmptyState from '../components/EmptyState'
import { Badge, Button, Card, Dialog, Icon, Tag } from '../ui'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function partyLine(adults: number, children: number): string {
  const a = `${adults} adult${adults === 1 ? '' : 's'}`
  if (children <= 0) return a
  return `${a}, ${children} ${children === 1 ? 'child' : 'children'}`
}

export default function BookingsScreen() {
  useAppTick()
  const navigate = useNavigate()
  const user = currentUser()
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  if (!user) return null

  const today = todayIso()
  const all = listBookings(user.id)
  const isUpcoming = (b: Booking) => b.status === 'confirmed' && b.date >= today
  const upcoming = [...all]
    .filter(isUpcoming)
    .sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)))
  const others = [...all].filter((b) => !isUpcoming(b)).sort((a, b) => b.date.localeCompare(a.date))
  const ordered = [...upcoming, ...others]

  const cancelingBooking = ordered.find((b) => b.id === cancelingId) ?? null

  function confirmCancel() {
    if (!cancelingBooking) return
    cancelBooking(user!.id, cancelingBooking.id)
    setCancelingId(null)
  }

  return (
    <div className="screen">
      <div className="row row--between" style={{ marginBottom: 4 }}>
        <h1 className="section-title" style={{ ...capsHeadingStyle, margin: 0 }}>
          <Icon name="ticket" size={20} />
          My Passages
        </h1>
        <Button size="sm" icon="plus" onClick={() => navigate('/book')}>
          Book a visit
        </Button>
      </div>

      {ordered.length === 0 ? (
        <div style={{ marginTop: 18 }}>
          <EmptyState
            icon="ticket"
            title="No passages booked yet"
            body="Plan your first visit to the Kingdom and a confirmation will land right here."
          />
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 18 }}>
          {ordered.map((b) => {
            const tier = getTier(b.tierId)
            const cancellable = isUpcoming(b)
            // What the passage still buys in the park — the same reading the
            // chief's door uses when it asks to see one.
            const pass = passStateFor(user.id, b)
            return (
              <Card key={b.id}>
                <div className="row row--between">
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase' }}>
                    {tier?.name ?? 'Passage'}
                  </div>
                  {b.status === 'confirmed' ? <Badge tone="gold">Confirmed</Badge> : <Tag>Cancelled</Tag>}
                </div>
                <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                  <div className="row row--between">
                    <span className="muted">{tier?.monthly ? 'Start date' : 'Date'}</span>
                    <span>
                      {b.date} · {b.slot}
                    </span>
                  </div>
                  <div className="row row--between">
                    <span className="muted">Party</span>
                    <span>{partyLine(b.adults, b.children)}</span>
                  </div>
                  <div className="row row--between">
                    <span className="muted">Total</span>
                    <span>${b.total}</span>
                  </div>
                  <div className="row row--between">
                    <span className="muted">Confirmation</span>
                    <span style={{ fontWeight: 700, letterSpacing: '0.04em' }}>{b.code}</span>
                  </div>
                  {pass && b.status === 'confirmed' ? (
                    <div className="row row--between">
                      <span className="muted">Quest Experiences</span>
                      <span
                        style={{
                          color: pass.status === 'valid' ? 'var(--text-gold)' : 'var(--text-muted)',
                          textAlign: 'right',
                        }}
                      >
                        {pass.remaining === null
                          ? 'Unlimited'
                          : `${pass.remaining} of ${pass.allowance} left`}
                      </span>
                    </div>
                  ) : null}
                </div>
                {pass && b.status === 'confirmed' ? (
                  <p className="row muted" style={{ gap: 6, marginTop: 10, fontSize: 12 }}>
                    <Icon name={pass.status === 'valid' ? 'ticket-check' : 'clock'} size={13} />
                    {pass.note}
                  </p>
                ) : null}
                {cancellable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    style={{ marginTop: 12, color: 'var(--status-danger)' }}
                    onClick={() => setCancelingId(b.id)}
                  >
                    Cancel Passage
                  </Button>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}

      {cancelingBooking ? (
        <Dialog
          title="Cancel this passage?"
          onClose={() => setCancelingId(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCancelingId(null)}>
                Keep passage
              </Button>
              <Button variant="danger" onClick={confirmCancel}>
                Cancel passage
              </Button>
            </>
          }
        >
          <p>
            {getTier(cancelingBooking.tierId)?.name ?? 'Passage'} · {cancelingBooking.date} · {cancelingBooking.slot}
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            This cannot be undone in the demo.
          </p>
        </Dialog>
      ) : null}
    </div>
  )
}
