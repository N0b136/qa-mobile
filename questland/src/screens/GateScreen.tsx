// The Gate — arrival, in one place.
//
// A guest's day starts at the same spot every time: they walk up to the gate,
// present or buy a passage, are put on the roll, and take up a quest. Those are
// one moment, not four screens, so they are one screen. Taking up a quest is
// also the ONLY paid act in the park, which makes this the one place a Passage
// is spent — see presenceService and passService for the rules; nothing here
// re-implements them.
//
// The arrival card reads exactly two questions and shows one of three faces:
//
//   hasArrived()   — are they through the gate and on the day's roll?
//   activeQuest()  — is there an episode taken and not yet sealed?
//
// Arrival is the outer question. A guest half-way through an episode who has
// gone home still has an active quest, but the only thing this screen can
// honestly offer them is the gate.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import {
  activeQuest,
  checkInAtGate,
  hasArrived,
  placeNameFor,
  presenceFor,
  statusOf,
} from '../services/presenceService'
import { passStates, passStatusLabel } from '../services/passService'
import type { PassState } from '../services/passService'
import { getOrg } from '../content/orgs'
import { VILLAGE_PLACE } from '../content/stationMap'
import GateArrival from '../components/GateArrival'
import FlagStandard from '../components/FlagStandard'
import { Badge, Button, Card, Icon, Ornament, Tag } from '../ui'
import { ORG_ICON } from './questIcons'

const capsHeading = {
  textTransform: 'uppercase' as const,
  letterSpacing: 'var(--tracking-display)',
}

const muted = { font: 'var(--body-sm)', color: 'var(--text-muted)' }

function questExperiences(state: PassState): string {
  return state.remaining === null ? 'Unlimited' : `${state.remaining} of ${state.allowance} left`
}

export default function GateScreen() {
  useAppTick()
  const navigate = useNavigate()
  const user = currentUser()
  const [gateOpen, setGateOpen] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  if (!user) return null

  const arrived = hasArrived(user.id)
  // Only ever read once they are through the gate — see the note at the top.
  const quest = arrived ? activeQuest(user.id) : null
  const org = quest?.orgId ? getOrg(quest.orgId) : undefined
  const passes = passStates(user.id)
  const goodPasses = passes.filter((p) => p.status === 'valid')

  // Arrival says they are somewhere in the park; it does not say where. A guest
  // who sealed an episode keeps their station record for the whole fifteen
  // minutes while their quest is already over, so the "no quest" face must read
  // the record rather than assume the village.
  const here = arrived ? presenceFor(user.id) : null
  const where = here ? statusOf(here) : 'village'
  const placeName = here ? placeNameFor(here) : VILLAGE_PLACE.name
  const sealed = here?.final ? here : null

  function handleArrive() {
    const result = checkInAtGate(user!.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    // The card re-renders into its next face off the store tick.
    setError(undefined)
  }

  return (
    <div className="screen">
      <h1 className="section-title" style={{ ...capsHeading, margin: '0 0 14px' }}>
        <Icon name="door-open" size={20} />
        The Gate
      </h1>

      {/* ── Where you stand ─────────────────────────────────────────────── */}

      {!arrived ? (
        <Card eyebrow="Arrival" title="Step through the gate">
          <p style={{ font: 'var(--body-base)', color: 'var(--text-body)' }}>
            Checking in costs nothing. It puts you and your whole party on the roll for the day, so
            the Wardens know you are in the Wilds of Questia and can reach you.
          </p>
          {error ? (
            <p
              className="row"
              style={{ gap: 6, marginTop: 10, font: 'var(--body-sm)', color: 'var(--status-danger)' }}
            >
              <Icon name="triangle-alert" size={15} />
              {error}
            </p>
          ) : null}
          <Button fullWidth size="lg" icon="door-open" style={{ marginTop: 14 }} onClick={handleArrive}>
            We have arrived
          </Button>
        </Card>
      ) : !quest ? (
        <Card
          eyebrow={where === 'en-route' ? 'On the paths' : placeName}
          title={where === 'village' ? 'You are in the village' : 'No quest in hand'}
        >
          {/* Unnamed on purpose: the walk package on a record is read AFTER the
              episode is credited, so its title is the episode that comes next,
              not the one this check-in sealed. Only `final` is trustworthy. */}
          {sealed ? (
            <p className="row" style={{ gap: 6, marginBottom: 8, ...muted }}>
              <Icon name="stamp" size={14} />
              The episode you walked is sealed.
            </p>
          ) : null}
          <p style={{ font: 'var(--body-base)', color: 'var(--text-body)' }}>
            {where === 'village'
              ? 'You stand in the Village of Queston, and standing here costs nothing.'
              : where === 'at-station'
                ? `You are at ${placeName}, and standing there costs nothing.`
                : `You are on the paths, last seen at ${placeName}.`}{' '}
            Taking up a quest is the one act that spends a Quest Experience off a passage — one
            Quest Experience opens one episode, for your whole party.
          </p>
          <Button
            fullWidth
            size="lg"
            icon="scroll-text"
            style={{ marginTop: 14 }}
            onClick={() => setGateOpen(true)}
          >
            Take up a quest
          </Button>
        </Card>
      ) : (
        <Card
          eyebrow="Under way"
          title={quest.orgName ?? 'Your quest'}
          style={org ? { borderLeft: `3px solid ${org.color}` } : undefined}
        >
          <div className="row" style={{ gap: 8 }}>
            {org ? (
              <span style={{ color: org.color, display: 'inline-flex', flexShrink: 0 }}>
                <Icon name={ORG_ICON[org.id] ?? 'compass'} size={20} />
              </span>
            ) : null}
            <span style={{ flex: 1, minWidth: 0, font: 'var(--body-base)', color: 'var(--text-body)' }}>
              {quest.episodeNumber
                ? `Episode ${quest.episodeNumber}, ${quest.episodeTitle}`
                : (quest.episodeTitle ?? 'Your quest')}
            </span>
          </div>

          {quest.stationsTotal ? (
            <p className="row" style={{ gap: 6, marginTop: 10, ...muted }}>
              <Icon name="map-pin" size={14} />
              {quest.stationsDone ?? 0} of {quest.stationsTotal} stations
            </p>
          ) : null}
          {quest.nextStationName ? (
            <p className="row" style={{ gap: 6, marginTop: 6, ...muted }}>
              <Icon name="footprints" size={14} />
              Next: {quest.nextStationName}
            </p>
          ) : null}

          <Button
            fullWidth
            size="lg"
            icon="footprints"
            style={{ marginTop: 14 }}
            onClick={() => navigate(`/quests/${quest.orgId}/check-in`)}
          >
            Continue quest
          </Button>
          {/* A Hero Pass keeps all three questlines open, so a second quest on
              the same day is an ordinary thing to want — just never the loudest
              thing on the screen. */}
          <Button
            fullWidth
            variant="ghost"
            icon="plus"
            style={{ marginTop: 4 }}
            onClick={() => setGateOpen(true)}
          >
            Take up another quest
          </Button>
        </Card>
      )}

      {/* Your standard. The gate is where a pole is collected and handed back,
          which makes this the one screen where an unbound standard is worth
          saying out loud — it sits directly under the act it belongs to. */}
      <FlagStandard userId={user.id} style={{ marginTop: 12 }} />

      <Ornament style={{ margin: '20px 0' }} />

      {/* ── Your passages ───────────────────────────────────────────────── */}

      <div className="row row--between" style={{ alignItems: 'baseline' }}>
        <h2 className="section-title" style={{ ...capsHeading, margin: 0 }}>
          Your passages
        </h2>
        {/* What the guest wants counted is what they can present — a dead
            passage stays on the list, but it is not one of these. */}
        {passes.length ? (
          <span style={{ ...muted, whiteSpace: 'nowrap' }}>
            {goodPasses.length ? `${goodPasses.length} good today` : 'None good today'}
          </span>
        ) : null}
      </div>

      {passes.length === 0 ? (
        <p style={{ marginTop: 10, font: 'var(--body-base)', color: 'var(--text-muted)' }}>
          You hold no passage. Book one and the quest is yours to take up here at the gate.
        </p>
      ) : (
        <div className="stack" style={{ marginTop: 10 }}>
          {passes.map((state) => {
            // Same reading as the picker at the gate: a passage that cannot be
            // presented stays on the list, locked, carrying the reason — "you
            // hold none" and "yours is for Saturday" are different problems and
            // the guest should be able to tell which one they have.
            const good = state.status === 'valid'
            return (
              // A locked passage keeps its shape and its hairline, dashed — it
              // is not faded out. See the design system on locked states.
              <Card key={state.booking.id} style={good ? undefined : { borderStyle: 'dashed' }}>
                <div className="row row--between" style={{ gap: 8, alignItems: 'flex-start' }}>
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
                  </div>
                  {good ? (
                    <Badge tone="gold" icon={state.remaining === null ? 'infinity' : 'scroll-text'}>
                      {state.remaining === null ? 'Unlimited' : `${state.remaining} of ${state.allowance}`}
                    </Badge>
                  ) : (
                    <Tag icon="lock">{passStatusLabel(state.status)}</Tag>
                  )}
                </div>

                {/* Only a passage that can be presented has Quest Experiences
                    to advertise. `remaining` is counted against the CURRENT
                    period whatever the status, so a cancelled Adventurer Pass
                    would otherwise offer a walk it will refuse at the gate. */}
                {good ? (
                  <div className="row row--between" style={{ marginTop: 10 }}>
                    <span className="muted">Quest Experiences</span>
                    <span style={{ color: 'var(--text-gold)', textAlign: 'right' }}>
                      {questExperiences(state)}
                    </span>
                  </div>
                ) : null}

                <p className="row" style={{ gap: 6, marginTop: 8, ...muted }}>
                  <Icon name={good ? 'ticket-check' : 'clock'} size={13} />
                  {state.note}
                </p>
              </Card>
            )
          })}
        </div>
      )}

      {/* Gold is the metal of the one primary act on a view, and on this screen
          that act is arrival — so the booth keeps the outline rather than the
          fill, and managing passages is quieter still. */}
      <Button
        fullWidth
        size="lg"
        variant="secondary"
        icon="ticket"
        style={{ marginTop: 16 }}
        onClick={() => navigate('/book')}
      >
        Book a passage
      </Button>
      <Button fullWidth variant="ghost" style={{ marginTop: 4 }} onClick={() => navigate('/bookings')}>
        Manage passages
      </Button>

      {gateOpen ? (
        <GateArrival
          userId={user.id}
          onClose={() => setGateOpen(false)}
          onTaken={(takenOrgId) => {
            setGateOpen(false)
            navigate(`/quests/${takenOrgId}/check-in`)
          }}
        />
      ) : null}
    </div>
  )
}
