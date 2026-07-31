// Calls for aid that nobody has picked up yet — the first thing on the
// Manager's tab because it is the first thing to act on.
//
// READ-ONLY, and the missing Dispatch button is the point rather than an
// omission. Acknowledging a call is a park-wide claim: it writes a responder
// onto the row and every other screen in the park then reads that somebody is
// walking. A manager tapping it from a sofa — or from a car park, which is
// where this surface will mostly be read — makes that claim on behalf of staff
// who are three minutes away and now believe the call is handled. The only
// honest thing this card can do is show the call and let whoever is nearest
// take it from the Back Office board.

import type { SosRequest } from '../../../types'
import { listSos } from '../../../services/sosService'
import { sosMeta } from '../../../services/consoleService'
import { getZone } from '../../../content/zones'
import { Badge, Card, Icon } from '../../../ui'

/** "4m" / "1h 12m". Coarser than the board's live second-by-second timer:
    nobody reads a manager's phone to watch a clock advance. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return 'just now'
}

/**
 * `now` is handed down rather than read here: ManagerScreen owns one clock for
 * the whole surface, so this card's "12m" and the Plinths card's "last reported
 * 5:02pm" are two readings of the same instant. Its comment explains why the
 * timer exists at all.
 */
export default function CallsCard({ now }: { now: number }) {
  // The same data path CallsBoard reads: the sos mirror for the calls, the meta
  // mirror for the guest's name and zone. Deliberately not a second source —
  // two screens deriving "who is calling" differently is how a manager and a
  // Warden end up looking for two different people.
  const meta = sosMeta()
  // OPEN only. An acknowledged call already has somebody walking to it, and
  // putting it here would ask a manager to act on a call that is in hand.
  const open = listSos().filter((c) => c.status === 'open')

  if (open.length === 0) {
    // One quiet line. A card with a heading and nothing under it is a box
    // asking to be read every time, to say the same nothing.
    return <p className="muted">No calls for aid waiting.</p>
  }

  return (
    <Card
      eyebrow="Now"
      title={open.length === 1 ? 'A call for aid' : `${open.length} calls for aid`}
      // Ember is the park's live/now colour and this is the most now thing on
      // the surface. The border carries it rather than a fill: gold is the only
      // metal here and a flat ember card would read as a button.
      style={{ borderColor: 'var(--ember-700)' }}
    >
      <div className="manager-rows">
        {open.map((call: SosRequest) => {
          const guest = meta[call.id]?.guestName ?? 'A traveller'
          const zoneName =
            meta[call.id]?.zoneName ?? (call.zoneId ? getZone(call.zoneId)?.name : undefined)
          const emergency = call.kind === 'emergency'
          return (
            <div key={call.id} style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text-heading)' }}>{guest}</strong>
                <Badge tone={emergency ? 'valor' : 'gold'} icon={emergency ? 'shield' : 'life-buoy'}>
                  {emergency ? 'Emergency' : 'Quest help'}
                </Badge>
                <span className="muted row" style={{ gap: 5, fontSize: 12 }}>
                  <Icon name="clock" size={13} />
                  {elapsed(now - call.createdAt)}
                </span>
              </div>

              {zoneName ? (
                <div className="row muted" style={{ gap: 6, marginTop: 5, fontSize: 13 }}>
                  <Icon name="map-pin" size={13} />
                  {zoneName}
                </div>
              ) : null}

              {call.message ? (
                <p className="muted" style={{ marginTop: 5, fontSize: 13 }}>
                  &ldquo;{call.message}&rdquo;
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="muted" style={{ marginTop: 'var(--space-md)', fontSize: 12 }}>
        Dispatch and resolve stay on the Back Office board, where whoever is nearest is reading.
      </p>
    </Card>
  )
}
