// How the day's calls for aid actually went — the retrospective that sits
// directly under the card of what is still waiting.
//
// READ-ONLY, for the reasons CallsCard sets out at length and does not need
// repeating: dispatch, answers and resolve are park-wide claims made on behalf
// of staff who are three minutes away, and a manager making them from a car
// park tells the park a call is handled when nobody has moved. Nothing here
// writes, and nothing here should grow a button.
//
// ── THE STATE THAT SHIPS FIRST IS THE UNMEASURED ONE ────────────────────────
//
// The counters this card reads are new, so on the day it lands every call in
// the park predates them. That state is not an edge case to tidy away — it is
// what the user sees FIRST, and it has exactly two wrong renderings:
//
// · zeros everywhere, which reads as a flawless day nobody worked, and
// · an empty card, which reads as broken.
//
// So the unmeasured day gets its own words. It prints what it honestly knows
// off every call ever written — how many, of what kind, at what hours, from
// where — and says plainly that the timings are not being kept yet. Same rule
// one measure at a time: a median stands next to the number of calls it could
// not see.
//
// ── COLOUR ─────────────────────────────────────────────────────────────────
//
// This is a tally, not a now-state, so it takes the ordinary stone hairline and
// no ember. Ember/forge is the park's reserved live/now colour and CallsCard
// above spends it on calls somebody has to get up for; a retrospective card
// borrowing it would put a second alarm on the phone for something that already
// happened. The one exception earned here is `closedWithNoReply`, which is not
// history — it is a guest who spoke today and was never answered.

import { Fragment } from 'react'
import { aidDay } from '../../../services/aidStatsService'
import type { AidDay, AidSpan } from '../../../services/aidStatsService'
import { Badge, Card, Icon } from '../../../ui'

/**
 * "under a minute" / "12m" / "1h 12m".
 *
 * Coarser than the Back Office board's second-by-second timer, and the same
 * grain CallsCard prints: nobody reads a manager's phone to compare seconds,
 * and a median quoted to the second claims a precision a handful of samples
 * does not have. Sub-minute says so in words rather than printing "0m", which
 * is the same lie in miniature that this whole card is built to avoid.
 */
function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000))
  if (total === 0) return 'under a minute'
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * A median-and-worst line, with its blind spot stated beside it.
 *
 * The unmeasured count is printed IN THE SAME SENTENCE rather than in a
 * footnote, because the two numbers only mean anything together: "12m across 4
 * calls" is a fact, and "12m" over a day of nine calls where five were never
 * stamped is a number that invites a decision it cannot support.
 */
function Span({ label, span, verb }: { label: string; span: AidSpan; verb: string }) {
  if (span.count === 0) {
    // Nothing measured at all — which happens one measure at a time long after
    // the whole-day case above stops applying: a day whose calls are all still
    // open has answer times and no resolve times. The count of what could not
    // be seen is the whole of what can be said here, and it is worth saying,
    // being the difference between "nobody was kept waiting" and "we did not
    // look". `unmeasured` is necessarily non-zero on this branch: every call in
    // the day is in one bucket or the other, and this component is only drawn
    // when the day has calls.
    return (
      <div className="manager-line muted" style={{ marginTop: 4, fontSize: 13 }}>
        <span>{label}</span>
        <span className="manager-line__value">
          not recorded on {plural(span.unmeasured, 'call', 'calls')}
        </span>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 6 }}>
      <div className="manager-line">
        <span style={{ color: 'var(--text-heading)' }}>{label}</span>
        <strong className="manager-line__value" style={{ color: 'var(--text-heading)' }}>
          {duration(span.median ?? 0)}
        </strong>
      </div>
      <p className="muted" style={{ marginTop: 3, fontSize: 12 }}>
        Longest {duration(span.worst ?? 0)}, across {plural(span.count, 'call', 'calls')} {verb}.
        {span.unmeasured > 0
          ? ` ${plural(span.unmeasured, 'call carries', 'calls carry')} no stamp and ${
              span.unmeasured === 1 ? 'is' : 'are'
            } left out.`
          : ''}
      </p>
    </div>
  )
}

/**
 * Twenty-four plain divs. No chart library on a surface read from a car park —
 * the shape of the day is the whole signal, and a library would be a payload
 * and a dependency for a row of rectangles.
 *
 * Heights are a share of the busiest hour, not of a fixed ceiling, so a quiet
 * day still reads as a shape rather than as twenty-four empty slots. Gold,
 * because it is the only metal here; the bars are a figure, not a track colour,
 * and ruby/sapphire belong to the questlines.
 */
function Hours({ byHour }: { byHour: number[] }) {
  const peak = byHour.reduce((max, n) => Math.max(max, n), 0)
  if (peak === 0) return null

  return (
    <div style={{ marginTop: 'var(--space-md)' }}>
      <div className="qa-label" style={{ marginBottom: 'var(--space-xs)' }}>
        Through the day
      </div>
      {/* aria-hidden and captioned in words below: a screen reader walking
          twenty-four unlabelled bars learns nothing the caption does not say
          in one line. */}
      <div className="manager-hours" aria-hidden="true">
        {byHour.map((n, hour) => (
          <span key={hour} className="manager-hours__slot">
            <span
              className="manager-hours__bar"
              style={{ height: n === 0 ? 0 : `${Math.max(8, Math.round((n / peak) * 100))}%` }}
            />
          </span>
        ))}
      </div>
      <div className="manager-hours__axis muted" style={{ fontSize: 11 }}>
        <span>12am</span>
        <span>6am</span>
        <span>noon</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
    </div>
  )
}

/**
 * `now` is handed down rather than read here: ManagerScreen owns one clock for
 * the whole surface, so this card's "today" and CallsCard's "12m" are two
 * readings of the same instant. Starting a second timer would let the two cards
 * disagree about which day it is for a few hundred milliseconds around
 * midnight, which is a small window and a real one on a console that stays open
 * overnight.
 */
export default function AidCard({ now }: { now: number }) {
  const day: AidDay = aidDay(now)

  if (day.calls === 0) {
    // One quiet line, the same shape CallsCard's empty state takes. A heading
    // over an empty box is a thing a manager reads every morning to be told
    // nothing.
    return (
      <Card eyebrow="Today" title="Calls Answered">
        <p className="muted">No calls for aid today, and no questions asked.</p>
      </Card>
    )
  }

  const { emergency, chat } = day.byKind
  const questHelp = day.byKind['quest-help']
  // The whole day's figures are unrecorded. Not a broken card and not a perfect
  // day — see the note at the top of this file.
  const unrecorded = day.measured === 0

  return (
    <Card eyebrow="Today" title="Calls Answered">
      <p style={{ color: 'var(--text-heading)' }}>
        {plural(day.calls, 'call', 'calls')} raised today.
      </p>

      {/* The kinds, in the Back Office board's words. A chat is a question that
          needs an answer, not a body walking out to a Station, and a card that
          adds the three into one figure without splitting them tells a manager
          the park had a hard day when it had a curious one. */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {emergency > 0 ? (
          <Badge tone="valor" icon="shield">
            {emergency} emergency
          </Badge>
        ) : null}
        {questHelp > 0 ? (
          <Badge tone="gold" icon="life-buoy">
            {questHelp} quest help
          </Badge>
        ) : null}
        {chat > 0 ? (
          <Badge tone="gold" icon="message-circle">
            {chat} {chat === 1 ? 'question' : 'questions'}
          </Badge>
        ) : null}
      </div>

      <div className="manager-line muted" style={{ marginTop: 10, fontSize: 13 }}>
        <span>Where they stand</span>
        <span className="manager-line__value">
          {day.resolved} closed · {day.acknowledged} claimed · {day.open} waiting
        </span>
      </div>

      {unrecorded ? (
        // The figures are not being kept for these calls, and that sentence is
        // the card. Everything above it — the count, the kinds, the standings —
        // comes off fields every call has carried since the first day, so it is
        // printed as usual; everything below would be a median over nothing.
        <p className="muted" style={{ marginTop: 'var(--space-md)', fontSize: 13 }}>
          Answer and resolve times are not yet being kept for these calls — they were raised before
          the console began stamping them. The figures fill in from the next call onward.
        </p>
      ) : (
        <>
          <div style={{ marginTop: 'var(--space-md)' }}>
            <div className="qa-label" style={{ marginBottom: 'var(--space-xs)' }}>
              How long they waited
            </div>
            <Span label="First answer, typical" span={day.firstAnswer} verb="claimed" />
            <Span label="Closed, typical" span={day.resolve} verb="closed" />
          </div>

          {/* Two columns of figures, and they are two different measures: who
              walked out to the call, and who carried the conversation. One
              Warden may do a great deal of one and none of the other, so they
              are never added together into a "handled" column. */}
          {day.staff.length > 0 ? (
            <div style={{ marginTop: 'var(--space-md)' }}>
              <div className="qa-label" style={{ marginBottom: 'var(--space-xs)' }}>
                Who answered
              </div>
              <div className="manager-tally">
                <span className="muted" style={{ fontSize: 11 }}>
                  Guide
                </span>
                <span className="muted manager-tally__figure" style={{ fontSize: 11 }}>
                  Taken
                </span>
                <span className="muted manager-tally__figure" style={{ fontSize: 11 }}>
                  Replies
                </span>
                {day.staff.map((row) => (
                  // A row whose uid this device cannot name is still printed and
                  // still counted. Dropping it would lose its replies out of the
                  // total below; blanking the name would look like a rendering
                  // fault rather than the directory gap it is.
                  <Fragment key={row.key}>
                    <span
                      style={{ color: 'var(--text-heading)', fontSize: 13, minWidth: 0 }}
                      title={row.unrecognised ? 'An account this console cannot name' : undefined}
                    >
                      {row.name}
                      {row.unrecognised ? (
                        <span className="muted" style={{ fontSize: 11 }}>
                          {' '}
                          · account not on this console
                        </span>
                      ) : null}
                    </span>
                    <span className="manager-tally__figure" style={{ fontSize: 13 }}>
                      {row.claimed}
                    </span>
                    <span className="manager-tally__figure" style={{ fontSize: 13 }}>
                      {row.replies}
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>
          ) : null}

          {/* The denominator is printed with the average, always. "3.4" alone
              invites reading as a park-wide figure; "3.4 across 12
              conversations" cannot be. Null means nobody typed anything today,
              which is a sentence rather than a 0.0. */}
          <div className="manager-line muted" style={{ marginTop: 'var(--space-md)', fontSize: 13 }}>
            <span>Replies per conversation</span>
            <span className="manager-line__value">
              {day.conversations.averageReplies === null
                ? 'no conversations yet'
                : `${day.conversations.averageReplies.toFixed(1)} across ${plural(
                    day.conversations.count,
                    'conversation',
                    'conversations'
                  )}`}
            </span>
          </div>

          {/* Only when it is not zero. A permanent "0 closed unanswered" line is
              a row a manager learns to skip, and then misses on the day it is
              not zero. Forge is spent here and nowhere else on this card: a
              guest who spoke today and was never answered is not history yet. */}
          {day.closedWithNoReply > 0 ? (
            <div
              className="row"
              style={{
                gap: 8,
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid var(--border-hairline)',
              }}
            >
              <Icon name="message-circle-off" size={14} />
              <span style={{ fontSize: 13, color: 'var(--ember-300)' }}>
                {plural(day.closedWithNoReply, 'thread', 'threads')} closed with the guest&rsquo;s
                words unanswered.
              </span>
            </div>
          ) : null}
        </>
      )}

      <Hours byHour={day.byHour} />

      {/* Not a leaderboard of places — an operational reading. Several calls off
          one Station is nearly always the Station's clue, not the guests, and
          it is the one thing on this card somebody can go and fix tomorrow
          morning. */}
      {day.topZones.length > 0 ? (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <div className="qa-label" style={{ marginBottom: 'var(--space-xs)' }}>
            Where they came from
          </div>
          {day.topZones.map((zone) => (
            <div key={zone.zoneId} className="manager-line muted" style={{ marginTop: 4, fontSize: 13 }}>
              <span className="row" style={{ gap: 6, minWidth: 0 }}>
                <Icon name="map-pin" size={13} />
                {zone.name}
              </span>
              <span className="manager-line__value">{plural(zone.calls, 'call', 'calls')}</span>
            </div>
          ))}
          <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            Several calls off one Station usually means that Station&rsquo;s clue is unclear, not
            that the party was.
          </p>
        </div>
      ) : null}

      {/* The clock caveat, stated once at the foot rather than hung off every
          time on the card. `acknowledgedAt` is written by whichever console
          claimed the call, and write-once is enforced on THAT DEVICE — a second
          console that has not yet merged the first one's snapshot stamps its own
          clock and last-write-wins takes it. The spread is seconds, which is
          nothing against a median printed to the minute and everything against
          somebody quoting one of these figures at a person. So: good enough to
          run a park by, not good enough to hold a Warden to. */}
      <p className="muted" style={{ marginTop: 'var(--space-md)', fontSize: 12 }}>
        Today only, counted from the calls themselves. Times are taken from the console that
        answered, so treat them as close rather than exact. Dispatch, answers and resolve stay on
        the Back Office board.
      </p>
    </Card>
  )
}
