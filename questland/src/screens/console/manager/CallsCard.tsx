// What nobody has picked up yet — the first thing on the Manager's tab because
// it is the first thing to act on.
//
// THREE KINDS, NOT TWO. A 'chat' is a question that needs an answer, not a body
// walking out to a Station, and this card is the surface where confusing the two
// costs the most: it is read off a lock screen at eleven at night. A board that
// lights up ember because a guest asked where the toilets are is a board its
// owner learns to ignore, and the call it then fails to raise is a real one. So
// the ember treatment is earned per-card (see `urgent` below) and every row
// names its own kind in the Back Office board's words.
//
// READ-ONLY, and the missing Dispatch button is the point rather than an
// omission. Acknowledging a call is a park-wide claim: it writes a responder
// onto the row and every other screen in the park then reads that somebody is
// walking. A manager tapping it from a sofa — or from a car park, which is
// where this surface will mostly be read — makes that claim on behalf of staff
// who are three minutes away and now believe the call is handled. The only
// honest thing this card can do is show the call and let whoever is nearest
// take it from the Back Office board.
//
// The chat lane makes that tempting in a second way and the answer is the same:
// a reply typed from here IS an acknowledgement (the board acknowledges on the
// first word sent, deliberately, so two Wardens do not answer one guest), so a
// manager who taps out "on my way" from off-site has claimed a call nobody in
// the park is walking to. No reply control here. Answering happens where the
// Wardens are.

import type { SosRequest } from '../../../types'
import { listSos } from '../../../services/sosService'
import { sosMeta } from '../../../services/consoleService'
import { getZone } from '../../../content/zones'
import { Badge, Card, Icon } from '../../../ui'

// ── THE BACK OFFICE BOARD'S VOCABULARY, KEPT WORD FOR WORD ──────────────────
//
// CallsBoard holds the canonical copies of `urgency`, these labels, these
// glyphs and these tones; they are duplicated rather than imported because
// importing from CallsBoard would drag the whole live board — ChatThread, the
// toast provider, the push prompt — into a read-only card. Two screens naming
// the same call differently is how a manager and a Warden end up describing two
// different incidents on the radio, so if CallsBoard's wording changes, this
// changes with it. Same discipline PlinthsCard follows against StationsBoard.
const LABEL: Record<SosRequest['kind'], string> = {
  emergency: 'Emergency',
  'quest-help': 'Quest help',
  chat: 'Question',
}

const GLYPH: Record<SosRequest['kind'], string> = {
  emergency: 'shield',
  'quest-help': 'life-buoy',
  chat: 'message-circle',
}

const TONE: Record<SosRequest['kind'], 'valor' | 'gold'> = {
  emergency: 'valor',
  'quest-help': 'gold',
  chat: 'gold',
}

/** Canonical copy in CallsBoard. Kind outranks age, and nothing reorders that. */
function urgency(call: SosRequest): number {
  return call.kind === 'emergency' ? 0 : call.kind === 'quest-help' ? 1 : 2
}

/** A call that puts somebody on their feet, as against a question. */
function isUrgent(call: SosRequest): boolean {
  return call.kind === 'emergency' || call.kind === 'quest-help'
}

/**
 * The heading has to count what the rows actually are, in all three states —
 * "2 calls for aid" over one emergency and one question is the same lie the
 * ember border was telling, just in words.
 */
function heading(urgent: number, questions: number): string {
  if (urgent === 0) return questions === 1 ? 'A question' : `${questions} questions`
  const aid = urgent === 1 ? 'A call for aid' : `${urgent} calls for aid`
  if (questions === 0) return aid
  return `${aid}, ${questions === 1 ? 'a question' : `${questions} questions`}`
}

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

/** "A Warden has answered, 4m ago" — `elapsed` already says "just now" on its
    own, so the age is only appended when it is an age. */
function answeredLine(call: SosRequest, now: number): string {
  if (!call.lastMessageAt) return 'A Warden has answered'
  const age = elapsed(now - call.lastMessageAt)
  return age === 'just now' ? 'A Warden has answered just now' : `A Warden has answered, ${age} ago`
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
  // OPEN only. An acknowledged call already has somebody walking to it — or, in
  // the chat lane, a Warden already typing, since the board acknowledges on the
  // first word sent — and putting either here would ask a manager to act on
  // something that is in hand.
  //
  // Kind outranks age, longest-waiting first within a kind: CallsBoard's
  // precedence exactly, so the top row of this card is the top row of the board.
  const open = listSos()
    .filter((c) => c.status === 'open')
    .sort((a, b) => urgency(a) - urgency(b) || a.createdAt - b.createdAt)

  if (open.length === 0) {
    // One quiet line. A card with a heading and nothing under it is a box
    // asking to be read every time, to say the same nothing.
    return <p className="muted">No calls for aid, and no questions waiting.</p>
  }

  const urgentCount = open.filter(isUrgent).length
  const questionCount = open.length - urgentCount
  // Ember is the park's reserved live/now colour, and it is spent only on
  // something somebody has to get up for. A card holding nothing but questions
  // keeps the ordinary stone hairline: still legible, still counted, still at
  // the top of the tab — just not an alarm. The moment one real call lands, the
  // whole card takes the border, because the alarm belongs to the card and the
  // per-row badges say which row raised it.
  const urgent = urgentCount > 0

  return (
    <Card
      eyebrow={urgent ? 'Now' : 'Waiting'}
      title={heading(urgentCount, questionCount)}
      // The border carries the ember rather than a fill: gold is the only metal
      // here and a flat ember card would read as a button.
      style={urgent ? { borderColor: 'var(--ember-700)' } : undefined}
    >
      <div className="manager-rows">
        {open.map((call: SosRequest) => {
          const guest = meta[call.id]?.guestName ?? 'A traveller'
          const zoneName =
            meta[call.id]?.zoneName ?? (call.zoneId ? getZone(call.zoneId)?.name : undefined)
          // Read off the parent call's stamps and NOTHING else. Subscribing to a
          // thread's messages to learn the same thing is readers x messages x
          // threads, forever, on a surface that only ever prints the last line —
          // types.ts names it as the one way to make this feature expensive.
          const answered = call.lastMessageFrom === 'warden'
          return (
            <div key={call.id} style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text-heading)' }}>{guest}</strong>
                <Badge tone={TONE[call.kind]} icon={GLYPH[call.kind]}>
                  {LABEL[call.kind]}
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

              {/* Has anybody picked it up — the question a manager opens this tab
                  to answer. On an open row it reads "waiting" almost always, and
                  that is the honest reading: a Warden's reply acknowledges the
                  call, so a row still open has had no word back. It is derived
                  from the stamp rather than asserted from the status so that the
                  rare row where the two disagree — a reply whose acknowledgement
                  did not land — tells the truth instead of the tidier story. */}
              <div className="row muted" style={{ gap: 6, marginTop: 5, fontSize: 12 }}>
                <Icon name={answered ? 'corner-up-left' : 'clock'} size={12} />
                {answered ? answeredLine(call, now) : 'Waiting on a Warden'}
              </div>

              {/* The last line of the thread, off the parent call's preview
                  field. A preview, never the record. */}
              {call.lastMessagePreview ? (
                <p className="muted" style={{ marginTop: 3, fontSize: 13 }}>
                  {call.lastMessagePreview}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="muted" style={{ marginTop: 'var(--space-md)', fontSize: 12 }}>
        Dispatch, answers and resolve stay on the Back Office board, where whoever is nearest is
        reading.
      </p>
    </Card>
  )
}
