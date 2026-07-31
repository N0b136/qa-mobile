// Who is in the park right now — parties and lone guests alike, each with where
// they are, what they are walking, and how far through it they are.
//
// This is NOT the account directory. A guest appears here once they have been
// checked in at the main gate and drops off when they leave the board; the full
// list of everyone who ever made an account gets its own tab later, because it
// grows without limit and answers a different question.

import { useEffect, useState } from 'react'
import type { Audience } from '../../services/cloudSync'
import { occupants } from '../../services/presenceService'
import type { Occupant } from '../../services/presenceService'
import type { BadgeProps } from '../../ui'
import { Badge, Card, Icon, IconButton } from '../../ui'
import { romanNumeral } from '../questIcons'

interface Props {
  onSend: (audience: Audience) => void
}

function orgTone(orgId?: string): NonNullable<BadgeProps['tone']> | null {
  if (orgId === 'rangers') return 'valor'
  if (orgId === 'alehiim') return 'wilds'
  if (orgId === 'elm') return 'lore'
  return null
}

export function statusLine(o: Occupant, now: number): { icon: string; text: string } {
  if (o.status === 'village') return { icon: 'castle', text: 'In the Village of Queston' }
  if (o.status === 'en-route') {
    const mins = Math.max(1, Math.floor((now - o.since) / 60000))
    return { icon: 'footprints', text: `En route — left ${o.placeName} ${mins} min ago` }
  }
  return { icon: 'map-pin', text: `At ${o.placeName}` }
}

/** "Rangers of Questia · Episode III · 4 of 7" — the walk, in one line. */
export function questLine(o: Occupant): string | null {
  if (!o.orgName) return null
  const parts = [o.orgName]
  if (o.episodeNumber) parts.push(`Episode ${romanNumeral(o.episodeNumber)}`)
  if (typeof o.stationsDone === 'number' && o.stationsTotal) {
    parts.push(`${o.stationsDone} of ${o.stationsTotal}`)
  }
  return parts.join(' · ')
}

export default function GuestsAfield({ onSend }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10000)
    return () => window.clearInterval(t)
  }, [])

  const afield = occupants(now)
  const heads = afield.reduce((n, o) => n + Math.max(1, o.memberNames.length), 0)

  return (
    <Card eyebrow="In the park" title="Guests Afield">
      {afield.length === 0 ? (
        <p className="muted">Nobody has checked in at the gate yet.</p>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
            {/* The group count already turns; the head count did not, so a lone
                walker read "1 groups · 1 travellers" on the first arrival of
                the morning — the one moment a Warden is most likely looking. */}
            {afield.length} {afield.length === 1 ? 'group' : 'groups'} · {heads}{' '}
            {heads === 1 ? 'traveller' : 'travellers'}
          </p>
          <div className="stack" style={{ gap: 0 }}>
            {afield.map((o, i) => {
              const status = statusLine(o, now)
              const quest = questLine(o)
              const tone = orgTone(o.orgId)
              return (
                <div
                  key={o.key}
                  className="row row--between"
                  style={{
                    padding: '12px 0',
                    gap: 10,
                    alignItems: 'flex-start',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Icon name={o.kind === 'party' ? 'users' : 'user'} size={15} />
                      <strong style={{ color: 'var(--text-heading)' }}>{o.name}</strong>
                      {tone && o.orgName ? <Badge tone={tone}>{o.orgName}</Badge> : null}
                    </div>

                    <div className="row muted" style={{ gap: 6, marginTop: 5, fontSize: 13 }}>
                      <Icon name={status.icon} size={13} />
                      {status.text}
                    </div>

                    {quest ? (
                      <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>
                        {quest}
                        {o.episodeTitle ? ` — ${o.episodeTitle}` : ''}
                      </div>
                    ) : null}

                    {o.nextStationName ? (
                      <div className="row muted" style={{ gap: 6, marginTop: 3, fontSize: 12 }}>
                        <Icon name="arrow-right" size={12} />
                        Next: {o.nextStationName}
                      </div>
                    ) : null}

                    {/* The standard they are carrying. Staff copy names it as
                        the pole is printed — the guest's app calls it "your
                        standard", but a Warden on the radio says FLAG-07. */}
                    {o.flagLabel ? (
                      <div className="row muted" style={{ gap: 6, marginTop: 3, fontSize: 12 }}>
                        <Icon name="flag" size={12} />
                        {o.flagLabel}
                      </div>
                    ) : null}

                    {/* The passage that paid for this walk — what a Warden asks
                        to see when a party is where it should not be. */}
                    {o.passCode ? (
                      <div className="row muted" style={{ gap: 6, marginTop: 3, fontSize: 12 }}>
                        <Icon name="ticket-check" size={12} />
                        {o.passName ?? 'Passage'} · {o.passCode}
                      </div>
                    ) : null}

                    {o.kind === 'party' ? (
                      <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>
                        {o.memberNames.join(', ')}
                      </div>
                    ) : null}
                  </div>

                  <IconButton
                    icon="send"
                    label={`Send word to ${o.name}`}
                    size="sm"
                    onClick={() =>
                      onSend(
                        o.kind === 'party'
                          ? { kind: 'party', id: o.key.replace(/^party:/, '') }
                          : { kind: 'guest', id: o.key.replace(/^solo:/, '') }
                      )
                    }
                  />
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}
