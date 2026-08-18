// The gate. Where a Passage is spent.
//
// A guest may stand in the Village of Queston all day without paying for
// anything; TAKING UP A QUEST is the paid act, and this is where it happens.
// The flow is the exact mirror of a Guide at the ticket booth binding a party:
// name the questline, read back the episode it opens, take the passage, hand
// the quest over.
//
// Only one of those steps is a real choice. All three questlines stay open
// whatever order the guest was sworn into, so they pick. The episode is not a
// choice — it is wherever their progress stands, shown so they can see what
// they are paying for before they pay for it.

import { useState } from 'react'
import { ORGS, getOrg } from '../content/orgs'
import { stationsFor } from '../content/stations'
import { completedCount, currentEpisode, rankFor, stationsDone } from '../services/progressService'
import { getUser } from '../services/authService'
import { questTaken, takeUpQuest } from '../services/presenceService'
import type { CheckInOutcome } from '../services/presenceService'
import { getUserParty } from '../services/partyService'
import PassagePicker from './PassagePicker'
import { Badge, Button, Card, Dialog, Icon } from '../ui'
import { ORG_ICON, romanNumeral } from '../screens/questIcons'

interface Props {
  userId: string
  /** The questline the screen already has in hand — opens straight on the readback. */
  orgId?: string
  onClose: () => void
  /** The quest is in hand and the guest has read it back. */
  onTaken?: (orgId: string) => void
}

const muted = { font: 'var(--body-sm)', color: 'var(--text-muted)' }

export default function GateArrival({ userId, orgId, onClose, onTaken }: Props) {
  const [picked, setPicked] = useState<string | null>(orgId ?? null)
  const [taken, setTaken] = useState<{ orgId: string; outcome: CheckInOutcome } | null>(null)
  const [passOpen, setPassOpen] = useState(false)
  const [passError, setPassError] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const guests = getUserParty(userId)?.memberIds.length ?? 1

  /**
   * Tried without a passage first: an episode already paid for goes straight
   * through, and anything else comes back asking — which is the picker's cue.
   */
  function attempt(takeOrgId: string, passBookingId?: string) {
    const result = takeUpQuest(userId, takeOrgId, { passBookingId })
    if (!result.ok) {
      if (result.needPass) {
        setPassError(passBookingId ? result.error : undefined)
        setPassOpen(true)
        return
      }
      setError(result.error)
      return
    }
    setPassOpen(false)
    setPassError(undefined)
    setError(undefined)
    setTaken({ orgId: takeOrgId, outcome: result })
  }

  // ── The quest is theirs ─────────────────────────────────────────────────────

  if (taken) {
    const org = getOrg(taken.orgId)
    const { walk, pass, carried, partyName } = taken.outcome
    return (
      <Dialog
        ceremonial
        eyebrow="Village of Queston"
        title="The quest is yours"
        onClose={() => (onTaken ? onTaken(taken.orgId) : onClose())}
        footer={
          <Button icon="footprints" onClick={() => (onTaken ? onTaken(taken.orgId) : onClose())}>
            To the trail
          </Button>
        }
      >
        <p style={{ font: 'var(--body-base)', color: 'var(--text-body)' }}>
          {org?.name} — Episode {walk.episodeNumber}, {walk.episodeTitle}.
        </p>
        {pass ? (
          <p className="row" style={{ gap: 6, marginTop: 8, ...muted }}>
            <Icon name="ticket" size={14} />
            Presented — {pass.passName} · {pass.code}
          </p>
        ) : null}
        {carried.length ? (
          <p style={{ marginTop: 6, ...muted }}>{partyName} takes it up with you.</p>
        ) : null}
        <p className="row" style={{ gap: 6, marginTop: 6, ...muted }}>
          <Icon name="house" size={14} />
          Call on the Chief for the brief, then walk to{' '}
          {walk.nextStationName ?? 'the first station'}.
        </p>
      </Dialog>
    )
  }

  // ── Present a passage ───────────────────────────────────────────────────────

  if (passOpen && picked) {
    const org = getOrg(picked)
    const episode = currentEpisode(userId, picked)
    return (
      <PassagePicker
        userId={userId}
        guests={guests}
        subtitle={
          org && episode ? `${org.name} — Episode ${episode.number}, ${episode.title}.` : undefined
        }
        error={passError}
        onPick={(bookingId) => attempt(picked, bookingId)}
        onClose={() => {
          setPassOpen(false)
          setPassError(undefined)
          onClose()
        }}
      />
    )
  }

  // ── Which questline ─────────────────────────────────────────────────────────

  if (!picked) {
    // Their own order first; the other two are just as open to them.
    const own = getUser(userId)?.orgId
    const orgs = own
      ? [...ORGS].sort((a, b) => (a.id === own ? -1 : b.id === own ? 1 : 0))
      : ORGS
    return (
      <Dialog
        eyebrow="At the gate"
        title="Take up a quest"
        onClose={onClose}
        footer={
          <Button variant="ghost" onClick={onClose}>
            Not yet
          </Button>
        }
      >
        <p style={muted}>
          One Quest Experience off your passage opens one episode. Choose the order you walk for
          today — all three stay open to you.
        </p>
        <div className="stack" style={{ marginTop: 'var(--space-md)' }}>
          {orgs.map((org) => {
            const episode = currentEpisode(userId, org.id)
            const count = completedCount(userId, org.id)
            const line = (
              <>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: org.color, display: 'inline-flex', flexShrink: 0 }}>
                    <Icon name={ORG_ICON[org.id] ?? 'compass'} size={22} />
                  </span>
                  {/* A basis rather than flex:1 — an order's name in Cinzel caps
                      needs about this much room, and below it the badge drops to
                      its own line instead of crushing "Rangers of the Kingdom" into
                      three stacked words. */}
                  <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                      {org.name}
                    </div>
                    <div style={{ marginTop: 2, ...muted }}>
                      {count} / 10 episodes · {rankFor(org.id, count).name}
                    </div>
                  </div>
                  {episode ? (
                    questTaken(userId, org.id) ? (
                      <Badge tone="forge" icon="footprints">
                        Under way
                      </Badge>
                    ) : (
                      <Badge tone={org.track}>Episode {episode.number}</Badge>
                    )
                  ) : (
                    <Badge tone="gold" icon="stamp">
                      All ten sealed
                    </Badge>
                  )}
                </div>
                {episode ? (
                  <p style={{ marginTop: 8, ...muted }}>{episode.title}</p>
                ) : (
                  <p style={{ marginTop: 8, ...muted }}>
                    Every seal on this questline is claimed.
                  </p>
                )}
              </>
            )

            // A finished questline has nothing left to sell; it keeps its shape
            // and its place on the list, and simply cannot be chosen.
            return episode ? (
              <button
                key={org.id}
                onClick={() => setPicked(org.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: 0,
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <Card interactive style={{ borderLeft: `3px solid ${org.color}` }}>{line}</Card>
              </button>
            ) : (
              <Card
                key={org.id}
                style={{ borderStyle: 'dashed', borderLeft: `3px solid ${org.color}` }}
              >
                {line}
              </Card>
            )
          })}
        </div>
      </Dialog>
    )
  }

  // ── The episode it opens ────────────────────────────────────────────────────

  const org = getOrg(picked)
  const episode = currentEpisode(userId, picked)
  if (!org || !episode) return null
  const rotation = stationsFor(episode.id)
  const done = stationsDone(userId, episode.id)
  const next = rotation.find((s) => !done.includes(s.id)) ?? rotation[0]

  return (
    <Dialog
      eyebrow={`${org.name} — Episode ${episode.number}`}
      title={episode.title}
      onClose={onClose}
      footer={
        <>
          {orgId ? null : (
            <Button variant="ghost" onClick={() => setPicked(null)}>
              Back
            </Button>
          )}
          <Button icon="scroll-text" onClick={() => attempt(picked)}>
            Take up the quest
          </Button>
        </>
      }
    >
      <div
        style={{
          font: '900 var(--text-3xl)/1 var(--font-display-ornate)',
          color: 'var(--gold-300)',
        }}
      >
        {romanNumeral(episode.number)}
      </div>
      <p style={{ marginTop: 8, font: 'var(--body-base)', color: 'var(--text-body)' }}>
        {episode.tagline}
      </p>
      {error ? <Refusal error={error} /> : null}
      <p className="row" style={{ gap: 6, marginTop: 10, ...muted }}>
        <Icon name="map-pin" size={14} />
        {rotation.length} stations{next ? `, beginning at ${next.name}` : ''}.
      </p>
      <p className="row" style={{ gap: 6, marginTop: 6, ...muted }}>
        <Icon name="ticket" size={14} />
        One Quest Experience off your passage
        {guests > 1 ? `, for the ${guests} of you` : ''}.
      </p>
    </Dialog>
  )
}

function Refusal({ error }: { error: string }) {
  return (
    <p
      className="row"
      style={{ gap: 6, marginTop: 10, font: 'var(--body-sm)', color: 'var(--status-danger)' }}
    >
      <Icon name="triangle-alert" size={15} />
      {error}
    </p>
  )
}
