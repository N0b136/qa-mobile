// Today's calls for aid, counted. Pure read-side derivation over the sos mirror
// the console already holds — no writes, no fetches, nothing async.
//
// ── IT MUST NOT FETCH, AND THAT IS THE WHOLE COST MODEL ─────────────────────
//
// Every figure below comes out of `listSos()`, which is the same local mirror
// CallsBoard and CallsCard read. There is no `getDocs`, no `collectionGroup`,
// no per-thread message listener, and none may ever be added here. types.ts
// names a listener over threads' messages as THE way to make this feature
// expensive — readers x messages x threads, forever — and a manager's tally is
// the softest possible reason to pay it. That is precisely why the counters
// (`messageCount`, `wardenReplies`, `replyBy`) are carried on the PARENT call
// document: the board writes them in updates it was already making, and this
// file only adds them up.
//
// If a question arises here that the parent documents cannot answer, the answer
// is that the question is not asked on this surface — not that the surface goes
// and fetches.
//
// ── AN ABSENT COUNTER IS UNKNOWN, NEVER ZERO ────────────────────────────────
//
// The five manager fields are optional and every call raised before they
// shipped has none of them. This file therefore NEVER writes `?? 0` against
// one. A call with no `acknowledgedAt` was not answered instantly; a call with
// no `messageCount` did not have an empty thread. Each measure keeps its own
// `unmeasured` count so the card can say how much of the day it cannot see,
// and the unmeasured calls stay out of every median, worst and average. Fold
// them in as zeros and the whole pre-launch back catalogue reads as a perfect
// day — which, since this ships mid-season, is the FIRST thing the user would
// see.
//
// ── THE DAY IS SCOPED BY `createdAt`, ONCE ──────────────────────────────────
//
// A call belongs to today if it was RAISED today, and that one test scopes
// every figure on the card, including the resolve times and `closedWithNoReply`.
// Scoping resolves by `resolvedAt` instead would be defensible on its own and
// wrong next to the others: the resolve count would then be drawn from a
// different population than the call count above it, and a card whose
// denominators disagree teaches its reader to trust none of them. The cost is
// stated rather than hidden — a call raised at 11pm and closed after midnight
// lands in yesterday's figures, where it was raised.

import type { SosKind, SosRequest } from '../types'
import { listSos } from './sosService'
import { currentStaff } from './consoleService'
import { getPersona } from '../content/staff'
import { getZone } from '../content/zones'

/** How many zone rows the card is willing to print. Four fits a phone. */
const TOP_ZONES = 4

/**
 * One elapsed-time measure over the day — first answer, or resolve.
 *
 * `count` is how many of today's calls CARRIED the stamp; `unmeasured` is how
 * many did not. They are two separate numbers on purpose: `count` is the
 * denominator of the median and the worst, and `unmeasured` is the part of the
 * day those two say nothing about. `median` and `worst` are null, not 0, when
 * nothing was measured — there is no such thing as a median of no samples, and
 * a printed 0 would read as instant.
 */
export interface AidSpan {
  /** Calls that carried the stamp and so are inside the median. */
  count: number
  /** Milliseconds. Null when `count` is 0. */
  median: number | null
  /** Milliseconds — the longest of them. Null when `count` is 0. */
  worst: number | null
  /** Today's calls with no stamp at all. Unknown, never zero. */
  unmeasured: number
}

/**
 * One person's day. `claimed` and `replies` are DIFFERENT MEASURES and the
 * shape keeps them apart deliberately: claiming a call is walking out to it,
 * carrying the thread is answering it, and one Warden may well do a great deal
 * of one and none of the other. Summing them into a single "handled" figure
 * would erase exactly the distinction a manager reads this table for.
 */
export interface AidStaffRow {
  /** Stable render key. Not a uid — see `unrecognised`. */
  key: string
  /** The Warden's name, or a short form of the uid when it resolves to none. */
  name: string
  /**
   * True when the tally came off a `replyBy` uid this device cannot name. The
   * row is still printed and still counted — dropping it would quietly lose
   * replies from the total, and a blank name would look like a rendering
   * fault rather than the account-directory gap it is.
   */
  unrecognised: boolean
  /** Today's calls whose `responder` is this person. */
  claimed: number
  /** Warden lines this person sent across today's calls, from `replyBy`. */
  replies: number
}

/** Where today's calls came from, most-called first. */
export interface AidZoneRow {
  zoneId: string
  /** The zone's canon name, or the raw id if content does not know it. */
  name: string
  calls: number
}

export interface AidDay {
  /** Calls raised today, all kinds. */
  calls: number
  byKind: Record<SosKind, number>
  open: number
  acknowledged: number
  resolved: number
  /** `acknowledgedAt - createdAt` — how long somebody waited for a first claim. */
  firstAnswer: AidSpan
  /** `resolvedAt - createdAt` — how long the whole call ran. */
  resolve: AidSpan
  /** One row per person, busiest first. */
  staff: AidStaffRow[]
  conversations: {
    /** Today's calls that had at least one line in them. */
    count: number
    /** Warden lines across those calls. */
    replies: number
    /**
     * `replies / count`, or NULL when nothing was said today. The denominator
     * is conversations, NOT calls: a dispatched emergency that nobody typed in
     * is not a conversation with zero replies, and letting it into the divisor
     * would drag the average down every time the park handled something well
     * by walking to it. Null rather than 0 so the card can say "no
     * conversations yet" instead of printing a confident 0.0.
     */
    averageReplies: number | null
  }
  /**
   * Resolved today, the guest spoke (`messageCount > 0`), and no Warden line
   * went back. Counts ONLY calls carrying the counters — a call from before
   * they shipped has nothing to say here and must not be accused.
   */
  closedWithNoReply: number
  /** 24 slots, calls by the local hour of `createdAt`. */
  byHour: number[]
  /** At most `TOP_ZONES` rows, descending. Calls with no zone are left out. */
  topZones: AidZoneRow[]
  /**
   * How many of today's calls carry ANY of the manager counters.
   *
   * This is the card's own instrumentation check and it exists because zero is
   * ambiguous on every other figure here. A day whose calls all predate the
   * counters and a day that genuinely went perfectly produce the same medians
   * and the same averages; only this number tells them apart. Zero with calls
   * above it means the figures are not being kept yet — say that, rather than
   * printing a flawless day.
   */
  measured: number
}

/**
 * The local-day test, copied from CallsBoard rather than imported so a
 * read-only service does not pull a live board — ChatThread, the toast
 * provider, the push prompt — in behind it. Same discipline CallsCard follows
 * against CallsBoard's vocabulary: if one changes, the other changes with it.
 *
 * Local calendar day, not a 24-hour window: a manager reading this at 9pm means
 * "since this morning", and a rolling window would silently carry half of
 * yesterday's night shift into it.
 */
function isToday(ms: number, now: number): boolean {
  const d = new Date(ms)
  const today = new Date(now)
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  )
}

/**
 * An elapsed pair, or null if it cannot honestly be one.
 *
 * Clamped at zero rather than dropped: a stamp that lands a few milliseconds
 * before the call it belongs to is clock skew between two devices, and the
 * measure did happen — the call really was claimed. That is a different fact
 * from a MISSING stamp, which is the case this whole file refuses to call zero.
 */
function span(from: number, to: number | undefined): number | null {
  if (typeof to !== 'number' || !Number.isFinite(to)) return null
  return Math.max(0, to - from)
}

/**
 * Median of a sample, in the sample's own units.
 *
 * Even counts average the two middle values, which is the conventional reading
 * and the one a manager comparing two days would expect. Null on an empty
 * sample — see AidSpan.
 */
function measure(samples: number[]): AidSpan['median'] {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function spanOf(samples: number[], unmeasured: number): AidSpan {
  return {
    count: samples.length,
    median: measure(samples),
    worst: samples.length === 0 ? null : Math.max(...samples),
    unmeasured,
  }
}

/**
 * A uid's display name, or null when nothing on this device knows it.
 *
 * ── THE DIRECTORY GAP, STATED PLAINLY ───────────────────────────────────────
 *
 * `responder` is a persona NAME ("Warden Aldous" — CallsBoard writes
 * `persona.name`), while `replyBy` is keyed by STAFF UID. There is no roster
 * mirror on this device that maps every uid to a name: `staff/{uid}` is
 * readable one document at a time and only over the network, which this file
 * may not do. So the two sources are reconciled with what IS local:
 *
 * · the signed-in staff doc, which names the person reading the card, and
 * · STAFF_PERSONAS, which catches a `replyBy` keyed by a persona slug rather
 *   than a uid — the shape seeded demo data takes.
 *
 * Everything else is named by its last six characters and flagged. That is a
 * real limitation and it is rendered as one rather than papered over: an
 * unnamed row is honest, a dropped row loses replies out of the total, and a
 * blank row looks like a bug. When a staff roster mirror lands, this is the one
 * function that has to learn about it.
 */
function nameForUid(uid: string): string | null {
  const staff = currentStaff()
  if (staff && staff.uid === uid) return staff.name
  return getPersona(uid)?.name ?? null
}

/** "…4f9c21" — enough to match against the Firebase console, short enough to read. */
function shortUid(uid: string): string {
  return uid.length <= 6 ? uid : `…${uid.slice(-6)}`
}

/**
 * Everything the Manager's tab prints about today's calls for aid.
 *
 * `now` is handed in rather than sampled, so this card's "today" and the rest
 * of the tab's ages are readings of one instant — ManagerScreen owns the clock
 * for the whole surface and its comment explains why the timer exists at all.
 */
export function aidDay(now: number): AidDay {
  const today = listSos().filter((c) => isToday(c.createdAt, now))

  const byKind: Record<SosKind, number> = { emergency: 0, 'quest-help': 0, chat: 0 }
  const byHour = new Array<number>(24).fill(0)
  const zoneCalls = new Map<string, number>()

  let open = 0
  let acknowledged = 0
  let resolved = 0
  let measured = 0

  const answerSamples: number[] = []
  let answerUnmeasured = 0
  const resolveSamples: number[] = []
  let resolveUnmeasured = 0

  let conversations = 0
  let conversationReplies = 0
  let closedWithNoReply = 0

  // Claims are keyed by the responder NAME the board wrote; replies by whatever
  // `replyBy` is keyed on. They are merged below, once both are known.
  const claims = new Map<string, number>()
  const replies = new Map<string, number>()

  for (const call of today) {
    byKind[call.kind] += 1
    byHour[new Date(call.createdAt).getHours()] += 1

    if (call.status === 'open') open += 1
    else if (call.status === 'acknowledged') acknowledged += 1
    else resolved += 1

    if (call.zoneId) zoneCalls.set(call.zoneId, (zoneCalls.get(call.zoneId) ?? 0) + 1)

    // Does this call carry ANY of the counters — the instrumentation check.
    // Tested field by field rather than on one of them, because a call may be
    // acknowledged and never spoken in, or spoken in and never claimed.
    if (
      call.acknowledgedAt !== undefined ||
      call.resolvedAt !== undefined ||
      call.messageCount !== undefined ||
      call.wardenReplies !== undefined ||
      call.replyBy !== undefined
    ) {
      measured += 1
    }

    const answer = span(call.createdAt, call.acknowledgedAt)
    if (answer === null) answerUnmeasured += 1
    else answerSamples.push(answer)

    const closed = span(call.createdAt, call.resolvedAt)
    if (closed === null) resolveUnmeasured += 1
    else resolveSamples.push(closed)

    // A conversation is a thread somebody said something in. `messageCount` is
    // the test rather than `lastMessageAt`, because the stamp is written by the
    // live board and the count is the tallied record; mixing the two would
    // count a call under one rule and divide it under another.
    if (call.messageCount !== undefined && call.messageCount > 0) {
      conversations += 1
      conversationReplies += call.wardenReplies ?? 0
      // The guest spoke, nobody answered, and it was closed anyway. Guarded on
      // `messageCount` being present at all — a pre-counter call has no thread
      // record here and must not be read as an unanswered one.
      if (call.status === 'resolved' && !call.wardenReplies) closedWithNoReply += 1
    }

    if (call.responder) claims.set(call.responder, (claims.get(call.responder) ?? 0) + 1)

    for (const [uid, n] of Object.entries(call.replyBy ?? {})) {
      if (!Number.isFinite(n) || n <= 0) continue
      replies.set(uid, (replies.get(uid) ?? 0) + n)
    }
  }

  // ── Merge the two tallies into one row per person ────────────────────────
  //
  // A uid we can name shares a row with the claims written under that same
  // name, which is the common case and the one the table is for. A uid we
  // cannot name gets its own row, short-formed and flagged — never merged into
  // somebody else's on a guess, and never dropped.
  const rows = new Map<string, AidStaffRow>()
  const rowFor = (key: string, name: string, unrecognised: boolean): AidStaffRow => {
    const existing = rows.get(key)
    if (existing) return existing
    const created: AidStaffRow = { key, name, unrecognised, claimed: 0, replies: 0 }
    rows.set(key, created)
    return created
  }

  for (const [name, n] of claims) rowFor(`name:${name}`, name, false).claimed += n
  for (const [uid, n] of replies) {
    const name = nameForUid(uid)
    const row = name ? rowFor(`name:${name}`, name, false) : rowFor(`uid:${uid}`, shortUid(uid), true)
    row.replies += n
  }

  const staff = [...rows.values()].sort(
    (a, b) => b.claimed - a.claimed || b.replies - a.replies || a.name.localeCompare(b.name)
  )

  const topZones: AidZoneRow[] = [...zoneCalls.entries()]
    .map(([zoneId, calls]) => ({ zoneId, name: getZone(zoneId)?.name ?? zoneId, calls }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    .slice(0, TOP_ZONES)

  return {
    calls: today.length,
    byKind,
    open,
    acknowledged,
    resolved,
    firstAnswer: spanOf(answerSamples, answerUnmeasured),
    resolve: spanOf(resolveSamples, resolveUnmeasured),
    staff,
    conversations: {
      count: conversations,
      replies: conversationReplies,
      averageReplies: conversations === 0 ? null : conversationReplies / conversations,
    },
    closedWithNoReply,
    byHour,
    topZones,
    measured,
  }
}
