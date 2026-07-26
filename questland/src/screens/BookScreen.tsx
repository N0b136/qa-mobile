import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { createBooking, priceBooking } from '../services/bookingService'
import { TIERS, ADD_ONS, ARRIVAL_SLOTS } from '../content/bookingTiers'
import type { BookingTier, TicketCategory } from '../content/types'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, Icon, IconButton, Ornament, Switch, Tag } from '../ui'
import ProgressBar from '../components/ProgressBar'

type Step = 'passage' | 'details' | 'addons' | 'review' | 'done'

const STEP_ORDER: Exclude<Step, 'done'>[] = ['passage', 'details', 'addons', 'review']

const CATEGORY_ORDER: TicketCategory[] = ['day', 'day-group', 'membership', 'birthday']
const CATEGORY_LABEL: Record<TicketCategory, string> = {
  day: 'Single-Day',
  'day-group': 'Group Day',
  membership: 'Membership',
  birthday: 'Birthday',
}

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

const categoryLabelStyle: CSSProperties = {
  font: 'var(--label-ui)',
  letterSpacing: 'var(--tracking-label)',
  textTransform: 'uppercase',
  color: 'var(--text-gold)',
  margin: '18px 0 8px',
}

const stepIndicatorStyle: CSSProperties = {
  font: 'var(--label-ui)',
  letterSpacing: 'var(--tracking-label)',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function partyLine(adults: number, children: number): string {
  const a = `${adults} adult${adults === 1 ? '' : 's'}`
  if (children <= 0) return a
  return `${a}, ${children} ${children === 1 ? 'child' : 'children'}`
}

export default function BookScreen() {
  useAppTick()
  const navigate = useNavigate()
  const { show } = useToast()
  const user = currentUser()

  const [step, setStep] = useState<Step>('passage')
  const [tierId, setTierId] = useState<string | null>(null)
  const [date, setDate] = useState(todayIso())
  const [slot, setSlot] = useState<string>(ARRIVAL_SLOTS[0])
  const [adults, setAdults] = useState(1)
  const [children, setChildren] = useState(0)
  const [addOnIds, setAddOnIds] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState<{ code: string; tierName: string } | null>(null)

  if (!user) return null

  const tier = tierId ? TIERS.find((t) => t.id === tierId) : undefined

  function selectTier(t: BookingTier) {
    setTierId(t.id)
    setSlot(t.monthly ? 'Monthly' : ARRIVAL_SLOTS[0])
    setStep('details')
  }

  function toggleAddOn(id: string) {
    setAddOnIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleConfirm() {
    if (!tier) return
    const booking = createBooking(user!.id, { tierId: tier.id, date, slot, adults, children, addOnIds })
    setConfirmation({ code: booking.code, tierName: tier.name })
    show({ title: 'Passage confirmed', body: `Confirmation ${booking.code}`, icon: 'ticket' })
    setStep('done')
  }

  function StepHeader({ title, onBack }: { title: string; onBack: () => void }) {
    const idx = STEP_ORDER.indexOf(step as Exclude<Step, 'done'>) + 1
    return (
      <>
        <div className="row row--between" style={{ marginBottom: 10 }}>
          <IconButton icon="arrow-left" label="Back" onClick={onBack} />
          <span style={stepIndicatorStyle}>
            Step {idx} of {STEP_ORDER.length}
          </span>
        </div>
        <ProgressBar value={idx} max={STEP_ORDER.length} />
        {tier ? (
          <Tag icon={tier.icon} style={{ marginTop: 14 }}>
            {tier.name}
          </Tag>
        ) : null}
        <h1 className="section-title" style={capsHeadingStyle}>
          {title}
        </h1>
      </>
    )
  }

  function renderPassage() {
    return (
      <div className="screen">
        <h1 className="section-title" style={capsHeadingStyle}>
          <Icon name="ticket" size={20} />
          Choose your passage
        </h1>
        {CATEGORY_ORDER.map((cat) => {
          const tiers = TIERS.filter((t) => t.category === cat)
          if (tiers.length === 0) return null
          return (
            <div key={cat}>
              <h2 style={categoryLabelStyle}>{CATEGORY_LABEL[cat]}</h2>
              <div className="stack">
                {tiers.map((t) => (
                  <Card
                    key={t.id}
                    interactive
                    role="button"
                    tabIndex={0}
                    onClick={() => selectTier(t)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectTier(t)
                      }
                    }}
                  >
                    <div className="row row--between">
                      <div className="row" style={{ gap: 10 }}>
                        <Icon name={t.icon} size={22} style={{ color: 'var(--text-gold)' }} />
                        <div>
                          <div
                            style={{
                              fontFamily: 'var(--font-display)',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: 'var(--tracking-display-tight)',
                            }}
                          >
                            {t.name}
                          </div>
                          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                            {t.tagline}
                          </div>
                        </div>
                      </div>
                      {t.featured ? <Badge tone="gold">Most popular</Badge> : null}
                    </div>
                    <div style={{ marginTop: 10, fontWeight: 800, fontSize: 19, color: 'var(--text-gold)' }}>
                      {t.category === 'day' ? `$${t.priceAdult}` : `$${t.flatPrice}${t.monthly ? '/mo' : ''}`}
                    </div>
                    <div className="stack" style={{ gap: 4, marginTop: 10 }}>
                      {t.perks.map((perk) => (
                        <div key={perk} className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                          <Icon
                            name="check"
                            size={13}
                            style={{ color: 'var(--text-gold)', marginTop: 3, flexShrink: 0 }}
                          />
                          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{perk}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function renderDetails() {
    if (!tier) return null
    const breakdown = priceBooking(tier, adults, children, [])
    const showSurcharge = breakdown.overCount > 0 && !!tier.perPersonOver
    return (
      <div className="screen">
        <StepHeader title="Plan your visit" onBack={() => setStep('passage')} />

        <div className="field">
          <label htmlFor="book-date">{tier.monthly ? 'Start date' : 'Choose your day'}</label>
          <input
            id="book-date"
            type="date"
            min={todayIso()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {!tier.monthly ? (
          <div className="field">
            <label>Arrival time</label>
            <div className="row" style={{ gap: 8 }}>
              {ARRIVAL_SLOTS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={slot === s ? 'primary' : 'secondary'}
                  onClick={() => setSlot(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {tier.category === 'birthday' ? (
          <div className="field">
            <label>Party size</label>
            <p className="muted" style={{ margin: 0 }}>
              Up to 15 children, plus adults — one flat package price either way.
            </p>
          </div>
        ) : (
          <>
            <div className="field">
              <label>Adults</label>
              <div className="row" style={{ gap: 14 }}>
                <IconButton
                  icon="minus"
                  label="Fewer adults"
                  size="sm"
                  disabled={adults <= 1}
                  onClick={() => setAdults((a) => Math.max(1, a - 1))}
                />
                <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{adults}</span>
                <IconButton icon="plus" label="More adults" size="sm" onClick={() => setAdults((a) => a + 1)} />
              </div>
            </div>
            <div className="field">
              <label>Children</label>
              <div className="row" style={{ gap: 14 }}>
                <IconButton
                  icon="minus"
                  label="Fewer children"
                  size="sm"
                  disabled={children <= 0}
                  onClick={() => setChildren((c) => Math.max(0, c - 1))}
                />
                <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{children}</span>
                <IconButton icon="plus" label="More children" size="sm" onClick={() => setChildren((c) => c + 1)} />
              </div>
            </div>
          </>
        )}

        <Card style={{ marginTop: 4 }}>
          <div className="row row--between">
            <span className="muted">Subtotal</span>
            <strong>${breakdown.total}</strong>
          </div>
          {showSurcharge && tier.perPersonOver ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              +${tier.perPersonOver.price} per guest over {tier.perPersonOver.included} ({breakdown.overCount} extra)
            </p>
          ) : null}
        </Card>

        <Button fullWidth size="lg" style={{ marginTop: 16 }} onClick={() => setStep('addons')}>
          Continue
        </Button>
      </div>
    )
  }

  function renderAddons() {
    if (!tier) return null
    return (
      <div className="screen">
        <StepHeader title="Add to your quest" onBack={() => setStep('details')} />

        <div className="stack">
          {ADD_ONS.map((addOn) => (
            <Card key={addOn.id}>
              <div className="row row--between" style={{ gap: 12 }}>
                <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <Icon name={addOn.icon} size={20} style={{ color: 'var(--text-gold)', marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{addOn.name}</div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                      {addOn.blurb}
                    </div>
                    <div style={{ fontWeight: 700, marginTop: 6, color: 'var(--text-gold)' }}>+${addOn.price}</div>
                  </div>
                </div>
                <Switch checked={addOnIds.includes(addOn.id)} onChange={() => toggleAddOn(addOn.id)} />
              </div>
            </Card>
          ))}
        </div>

        <Button fullWidth size="lg" style={{ marginTop: 16 }} onClick={() => setStep('review')}>
          Continue
        </Button>
      </div>
    )
  }

  function renderReview() {
    if (!tier) return null
    const breakdown = priceBooking(tier, adults, children, addOnIds)
    const surcharge = breakdown.overCount > 0 && tier.perPersonOver ? breakdown.overCount * tier.perPersonOver.price : 0
    const baseOnly = breakdown.base - surcharge
    const selectedAddOns = ADD_ONS.filter((a) => addOnIds.includes(a.id))

    return (
      <div className="screen">
        <StepHeader title="Review & confirm" onBack={() => setStep('addons')} />

        <Card>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-display-tight)',
            }}
          >
            {tier.name}
          </div>
          <div className="stack" style={{ gap: 6, marginTop: 10 }}>
            <div className="row row--between">
              <span className="muted">{tier.monthly ? 'Start date' : 'Date'}</span>
              <span>{date}</span>
            </div>
            <div className="row row--between">
              <span className="muted">Arrival</span>
              <span>{slot}</span>
            </div>
            <div className="row row--between">
              <span className="muted">Party</span>
              <span>{partyLine(adults, children)}</span>
            </div>
            {selectedAddOns.map((a) => (
              <div key={a.id} className="row row--between">
                <span className="muted">{a.name}</span>
                <span>+${a.price}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <div className="row row--between">
            <span className="muted">Base</span>
            <span>${baseOnly}</span>
          </div>
          {surcharge > 0 ? (
            <div className="row row--between" style={{ marginTop: 6 }}>
              <span className="muted">Extra guests ({breakdown.overCount})</span>
              <span>${surcharge}</span>
            </div>
          ) : null}
          {breakdown.addOns > 0 ? (
            <div className="row row--between" style={{ marginTop: 6 }}>
              <span className="muted">Add-ons</span>
              <span>${breakdown.addOns}</span>
            </div>
          ) : null}
          <Ornament style={{ margin: '12px 0' }} />
          <div className="row row--between" style={{ fontWeight: 800, fontSize: 19 }}>
            <span>Total</span>
            <span style={{ color: 'var(--text-gold)' }}>${breakdown.total}</span>
          </div>
        </Card>

        <Button fullWidth size="lg" icon="lock" style={{ marginTop: 16 }} onClick={handleConfirm}>
          Confirm &amp; pay ${breakdown.total}
        </Button>
        <p className="muted" style={{ textAlign: 'center', marginTop: 10, fontSize: 12 }}>
          This is a simulated payment for the demo.
        </p>
      </div>
    )
  }

  function renderDone() {
    return (
      <div className="screen" style={{ textAlign: 'center' }}>
        <Ornament />
        <h1 className="section-title" style={{ ...capsHeadingStyle, justifyContent: 'center', marginTop: 18 }}>
          Passage confirmed
        </h1>
        <div
          style={{
            marginTop: 12,
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: 'var(--text-gold)',
          }}
        >
          {confirmation?.code}
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          {confirmation?.tierName} · {date} · {slot}
        </p>
        <div className="stack" style={{ marginTop: 24, gap: 10 }}>
          <Button fullWidth size="lg" onClick={() => navigate('/bookings')}>
            View my Passages
          </Button>
          <Button fullWidth variant="ghost" onClick={() => navigate('/')}>
            Back to Queston
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'passage') return renderPassage()
  if (step === 'details') return renderDetails()
  if (step === 'addons') return renderAddons()
  if (step === 'review') return renderReview()
  return renderDone()
}
