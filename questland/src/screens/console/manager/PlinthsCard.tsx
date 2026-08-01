// Station health, read by somebody who is not holding the cable.
//
// THE FRESHNESS RULE IS THE WHOLE CARD. `parkStatusFreshness()` decides whether
// the counts may be shown at all, and when it says no they are not dimmed or
// captioned — they are gone, replaced by the fact that the booth console has
// stopped reporting and when it last did. parkStatusService documents the
// failure this prevents: a manager reading "23 live" at nine in the evening off
// a console that was closed at five, and going to bed.
//
// Nothing here classifies a station. `condition` arrives already decided by
// conditionOf(), the single source of that truth, and the rows below only put a
// name and a clock on it.
//
// THE DENOMINATOR IS PART OF THE READING. `buildParkStatus` counts only the
// stations the booth console has HEARD FROM — a plinth that never reported has
// no health row, so it produces no count and no exception, and that is the
// right call on the write side (twenty-three fabricated `unknown` rows at every
// console open would put a park-wide alarm on this phone every morning). It
// makes a bare "All 21 reporting" a lie by omission: two plinths powered off
// overnight are simply absent from it, while the Back Office board — which maps
// every one of the 23 LoRa addresses — correctly shows "21 live · 2 no report".
// Two screens answering the same question differently is the exact hazard this
// card's vocabulary is copied word for word to avoid. So the roster comes from
// the address table (no hub required) and the shortfall is counted here, on the
// read side, as the `no report` StationsBoard already calls it.

import { parkStatusFreshness } from '../../../services/parkStatusService'
import { allStationNos } from '../../../services/hubProtocol'
import type { ParkStationCondition, ParkStationStatus } from '../../../types'
import { Badge, Card, Icon } from '../../../ui'

/**
 * 23 — every addressable place that sends a heartbeat: the 21 canon stations,
 * the chief's house and the gate box. The same set StationsBoard builds its
 * reader roster from, taken from the same table, so the two screens can never
 * disagree about how many plinths the park has.
 */
const ROSTER = allStationNos().length

// The Back Office board's vocabulary, kept word for word. Two screens naming the
// same condition differently is how a manager and a Warden end up describing two
// different faults on the radio; StationsBoard holds the originals.
const LABEL: Record<ParkStationCondition, string> = {
  live: 'live',
  stale: 'stale',
  fault: 'fault',
  silent: 'silent',
  unknown: 'no report',
}

const TONE: Record<ParkStationCondition, 'gold' | 'forge' | 'locked' | 'neutral'> = {
  live: 'gold',
  stale: 'forge',
  fault: 'forge',
  // The DS locked treatment — dashed hairline, shape kept. A station we have
  // lost is absent, not dimmed.
  silent: 'locked',
  unknown: 'neutral',
}

const GLYPH: Record<ParkStationCondition, string> = {
  live: 'signal',
  stale: 'refresh-cw',
  fault: 'triangle-alert',
  silent: 'wifi-off',
  unknown: 'circle-dashed',
}

const NOTE: Record<ParkStationCondition, string> = {
  live: 'Reporting, and holding the current flag table.',
  stale: 'Holding an older flag table. A table push from the Back Office clears it.',
  fault: 'Reporting, but not well — an error code, or its SD card or audio player not answering.',
  silent: 'Was reporting and stopped. Somebody has to walk out to it.',
  unknown: 'Nothing heard since the console opened.',
}

/** Live first, then the alarms in the order somebody would work them. */
const ORDER: ParkStationCondition[] = ['live', 'stale', 'fault', 'silent', 'unknown']

function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "4 min ago" / "2h 10m ago" — how long the silence has run. */
function since(at: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - at) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`
}

/**
 * `now` comes from ManagerScreen's clock, and it has to come from somewhere with
 * a timer behind it. Sampling `Date.now()` here would freeze at first render —
 * nothing on this tab writes to the store, so nothing would ever re-render this
 * card — and the freshness rule below would then be evaluated once, at open, and
 * never again. See ManagerScreen for the nine-in-the-evening failure that is.
 */
export default function PlinthsCard({ now }: { now: number }) {
  const { status, reporting } = parkStatusFreshness(now)

  if (!reporting) {
    // Counts SUPPRESSED. `status` is still rendered when it exists, because
    // `writtenAt` is exactly the fact worth having: not "23 live" but "last
    // reported 5:02pm", which is a question somebody can go and answer.
    return (
      <Card eyebrow="Stations" title="Not Reporting">
        <p style={{ color: 'var(--text-heading)' }}>The booth console is not reporting.</p>
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          {status
            ? `Last reported ${clockOf(status.writtenAt)}, ${since(status.writtenAt, now)}.`
            : 'It has not reported at all on this device.'}
        </p>
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Station health comes from the hub cable at the booth, so no console open there means no
          reading. Counts are withheld rather than shown out of date.
        </p>
      </Card>
    )
  }

  // `reporting` true implies a status document — the null case returns false
  // above — but the compiler does not know that, and a non-null assertion here
  // would be a claim rather than a check.
  if (!status) return null

  // How many plinths the booth has heard from at all, and how many of the park's
  // 23 it has not. `missing` is folded into the `unknown` count rather than given
  // a condition of its own: "nothing heard since the console opened" is exactly
  // what it is, and it is the condition StationsBoard already prints as `no
  // report` for the same stations.
  const reported = Object.values(status.counts).reduce((sum, n) => sum + n, 0)
  const missing = Math.max(0, ROSTER - reported)
  const counts = ORDER.map((c) => ({
    condition: c,
    n: (status.counts[c] ?? 0) + (c === 'unknown' ? missing : 0),
  })).filter((c) => c.n > 0)
  const exceptions: ParkStationStatus[] = status.exceptions
  // Well means every plinth on the roster accounted for AND none of them in an
  // alarm. A silent station and an absent one are both "not well" here.
  const wellPark = exceptions.length === 0 && missing === 0

  return (
    <Card eyebrow="Stations" title="Plinths">
      {reported === 0 ? (
        // Usually the boot window, and that one is real: the writer publishes as
        // soon as the console opens, before any heartbeat has landed. "All 0
        // reporting" and "0 of 23 reporting · 23 no report" are both wrong here —
        // the first is not a sentence and the second is a park-wide alarm raised
        // by a console that has simply not been listening for two minutes yet.
        //
        // But USUALLY is the whole of what we know. ParkStatus records neither
        // when the console opened nor how long the hub has been live, so a dead
        // radio or a knocked-off antenna lands on this exact branch and stays
        // there: the writer keeps refreshing `writtenAt` every five minutes, the
        // freshness rule never trips, and not one plinth is heard. The copy
        // therefore states the reading and names both causes; it must not read as
        // reassurance, because the second one is walked out to and looked at.
        <>
          <p style={{ color: 'var(--text-heading)' }}>No station has reported.</p>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            Plinths report every two minutes: either this console has just opened, or the hub is
            live and hearing none of the {ROSTER}. Past a few minutes, go and look at the hub.
          </p>
        </>
      ) : wellPark ? (
        <p style={{ color: 'var(--text-heading)' }}>
          {reported} of {ROSTER} reporting, holding the current table.
        </p>
      ) : (
        <>
          <p style={{ color: 'var(--text-heading)' }}>
            {reported} of {ROSTER} reporting.
          </p>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {counts.map(({ condition, n }) => (
              <Badge key={condition} tone={TONE[condition]} icon={GLYPH[condition]}>
                {n} {LABEL[condition]}
              </Badge>
            ))}
          </div>

          {/* An absent plinth has no name to put in a row — the console has
              never heard from it, so it has no health record and no place id.
              The chip and this line are the whole of what can honestly be said,
              and they are enough to send somebody to the Back Office board,
              which knows which addresses they are. */}
          {missing > 0 ? (
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              {NOTE.unknown}
            </p>
          ) : null}

          {/* Guarded: a park whose only trouble is an absent plinth has chips
              and no rows, and an empty rows container would leave a gap under
              them that reads as something failing to load. */}
          {exceptions.length === 0 ? null : (
          <div className="manager-rows" style={{ marginTop: 'var(--space-md)' }}>
            {exceptions.map((e) => (
              <div key={e.stationNo} style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ color: 'var(--text-heading)' }}>
                    {e.stationNo}. {e.name}
                  </strong>
                  <Badge tone={TONE[e.condition]} icon={GLYPH[e.condition]}>
                    {LABEL[e.condition]}
                  </Badge>
                </div>
                <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                  {NOTE[e.condition]}
                </p>
                {/* The error code the plinth actually sent, printed as sent —
                    it is what names the fault when somebody walks out to it. */}
                {e.lastError ? (
                  <p className="muted" style={{ marginTop: 3, fontSize: 12 }}>
                    {e.lastError}
                  </p>
                ) : null}
                <div className="row muted" style={{ gap: 6, marginTop: 3, fontSize: 12 }}>
                  <Icon name="clock" size={12} />
                  Last heard {since(e.lastHeartbeatAt, now)}
                </div>
              </div>
            ))}
          </div>
          )}
        </>
      )}

      <p className="muted" style={{ marginTop: 'var(--space-md)', fontSize: 12 }}>
        Booth console reported {clockOf(status.writtenAt)}.
      </p>
    </Card>
  )
}
