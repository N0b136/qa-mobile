// A standard tapped against a plinth, turned into a check-in.
//
// This is the SECOND input path into the park, not a second pipeline. A guest
// tapping a station in the phone app and a party pressing a flagpole against a
// reader in the woods both land on exactly one function — `presenceService`'s
// `checkIn` — which is why nothing downstream of it had to be rewritten to light
// up. Everything in this file is the work of getting from a validated wire frame
// to that call, and refusing the ones that should not make it.
//
// ── The layering, and why it is two layers ─────────────────────────────────
//
// L1 (here): transport dedupe. `${stationNo}:${seq}` in a 512-entry ring. A LoRa
//    retry — the station never heard its ACK and sent the tap again — is
//    byte-identical, so the ring makes it SILENT.
//
// L2 (already exists, untouched): domain dedupe. Station credit is set
//    membership, presence is last-write-wins on `at`, a leg dedupes on group +
//    place + run. This is what makes correctness NOT DEPEND on L1: if the ring
//    is cleared, if a seq counter rolls, if a frame arrives twice through two
//    different paths, the worst outcome is a redundant write of the same fact.
//
// L1 is an optimisation with a nice property; L2 is the guarantee. Do not
// collapse them into one.
//
// ── The sanity checks are a mitigation, and every one of them is LOGGED ────
//
// The plan accepts a real risk here: a MIFARE UID is clonable for about five
// dollars, and the LoRa crypto (Slice 7) does not reach the tag layer. It also
// accepts that a forged frame which survives that crypto becomes a
// STAFF-AUTHENTICATED Firestore write, because the console is signed in as
// staff. So this layer sanity-checks INDEPENDENTLY OF THE RADIO:
//
//   • an unknown uid is refused outright — and a station holding no row for it
//     is already sitting on its ambience loop, playing nothing, by design;
//   • a per-flag rate limit catches a tag being waved at a reader;
//   • impossible travel catches the same uid appearing on two sides of the park.
//
// None of them drop anything silently. Every refusal is appended to `ql:tapLog`
// with its reason, because a mitigation nobody can see is a mitigation nobody
// can trust — the same reasoning that puts the malformed-frame counter on the
// hub status chip instead of swallowing bad lines.

import type { Flag, HubQueryFrame, HubTapFrame } from '../types'
import { load, save } from './store'
import { getUser } from './authService'
import { MAP_META, QUEST_START, STATION_COORDS, VILLAGE_PLACE, DEFAULT_POSITION } from '../content/stationMap'
import { placeIdForStation, stationNoForPlace } from './hubProtocol'
import * as hubLink from './hubLink'
import {
  assignmentTable,
  flagByUid,
  markSealed,
  noteTap,
  resolveTap,
  tableVersion,
} from './flagService'
import type { TapResolution } from './flagService'
import { checkIn, checkInAtGate } from './presenceService'
import type { CheckInOutcome } from './presenceService'

const SEEN_KEY = 'ql:tapSeen'
const LOG_KEY = 'ql:tapLog'

/** Frames remembered for L1 dedupe. A station heartbeats twice a minute; this is hours of taps. */
const SEEN_CAP = 512

/** Refusals and check-ins kept for the console. Long enough to explain a shift, short enough to read. */
const LOG_CAP = 200

/**
 * The same pole cannot be tapped twice inside this window.
 *
 * A party walks nine to twenty minutes between stations, so this never fires on
 * real play; what it catches is a tag being held against a reader repeatedly, or
 * a clone being waved at the plinth next to the one it just answered.
 */
export const TAP_RATE_LIMIT_MS = 20_000

// ── Impossible travel ───────────────────────────────────────────────────────
//
// Distances are measured on the park chart, in MAP WIDTHS: `STATION_COORDS` is
// 0..1 fractions of park-map.webp, and its y fractions are of the image HEIGHT,
// so y is scaled by the aspect ratio before the two are combined. Anything else
// would stretch the park north-south and flag honest walks.

const MAP_ASPECT = MAP_META.height / MAP_META.width

/**
 * Below this the two places are near neighbours and the check does not apply.
 * Adjacent stations must never trip it — the point is to catch a uid appearing
 * on the far side of the park, not to police a brisk walk.
 */
const MIN_TRAVEL_SEPARATION = 0.15

/**
 * Map widths per minute above which nobody is walking.
 *
 * Calibrated against the park itself rather than a guessed scale: the widest
 * legitimate hop on the chart — Songhollow Cave to Realmhold, about 0.55 widths —
 * takes a party roughly twenty minutes, which is 0.028 widths a minute. This
 * ceiling is eighteen times that. At any plausible size for the site it is a
 * vehicle, not a guest, so a tap that requires it is not the party the pole is
 * bound to.
 */
const MAX_PACE_PER_MIN = 0.5

function placeCoord(placeId: string): { x: number; y: number } | null {
  if (placeId === VILLAGE_PLACE.id) return DEFAULT_POSITION
  if (placeId === QUEST_START.id) return { x: QUEST_START.x, y: QUEST_START.y }
  return STATION_COORDS[placeId] ?? null
}

/** Straight-line distance across the chart, in map widths. Null when either place is off it. */
export function separation(fromPlaceId: string, toPlaceId: string): number | null {
  const a = placeCoord(fromPlaceId)
  const b = placeCoord(toPlaceId)
  if (!a || !b) return null
  const dx = b.x - a.x
  const dy = (b.y - a.y) * MAP_ASPECT
  return Math.sqrt(dx * dx + dy * dy)
}

interface TravelVerdict {
  ok: boolean
  /** Map widths a minute the hop would have required. */
  pace?: number
  distance?: number
  minutes?: number
}

function travelCheck(flag: Flag, toPlaceId: string, now: number): TravelVerdict {
  const from = flag.lastPlaceId
  const since = flag.lastSeenAt
  if (!from || !since || from === toPlaceId) return { ok: true }
  const distance = separation(from, toPlaceId)
  if (distance === null || distance < MIN_TRAVEL_SEPARATION) return { ok: true }
  const minutes = Math.max(0, now - since) / 60_000
  // A tap at the same instant as the last one is infinitely fast; guard the
  // division rather than letting the answer be Infinity or NaN.
  if (minutes <= 0) return { ok: false, distance, minutes: 0, pace: Number.POSITIVE_INFINITY }
  const pace = distance / minutes
  return { ok: pace <= MAX_PACE_PER_MIN, pace, distance, minutes }
}

// ── Outcomes ────────────────────────────────────────────────────────────────

export type TapRefusal =
  /** A LoRa retry. The only refusal that is not a fault — it means L1 did its job. */
  | 'duplicate'
  | 'unknown-place'
  | 'unknown-tag'
  | 'unbound'
  | 'sealed'
  | 'lost'
  | 'rate-limited'
  | 'impossible-travel'
  /** The pole names a guest the roll has never heard of. */
  | 'no-holder'
  /** The check-in pipeline itself turned it away. Its own words are in `detail`. */
  | 'refused'

export type TapOutcome =
  | {
      ok: true
      flag: Flag
      placeId: string
      placeName: string
      /** False when the station was not on this episode's rotation — a visit that earned nothing. */
      credited: boolean
      /** True when this tap walked the last station of the episode. */
      sealed: boolean
      outcome: CheckInOutcome
    }
  | { ok: false; reason: TapRefusal; detail?: string; flag?: Flag; placeId?: string }

/** One line of the day's tap log — accepted and refused alike. */
export interface TapLogEntry {
  at: number
  stationNo: number
  placeId?: string
  placeName?: string
  uid: string
  flagLabel?: string
  groupName?: string
  /** 'accepted', or the refusal reason. */
  outcome: 'accepted' | TapRefusal
  detail?: string
}

export function tapLog(): TapLogEntry[] {
  return load<TapLogEntry[]>(LOG_KEY, [])
}

function log(entry: TapLogEntry): void {
  save(LOG_KEY, [entry, ...tapLog()].slice(0, LOG_CAP))
  if (entry.outcome !== 'accepted' && entry.outcome !== 'duplicate') {
    // Refusals go to the browser console too. A sanity check that only ever
    // writes to a mirror is invisible to whoever is debugging a plinth at
    // eight in the morning with a phone in one hand.
    console.warn(
      `[tap] refused ${entry.outcome} — station ${entry.stationNo}, tag ${entry.uid}` +
        (entry.detail ? ` (${entry.detail})` : '')
    )
  }
}

// ── L1: the transport dedupe ring ───────────────────────────────────────────

/**
 * How long a frame stays remembered.
 *
 * The ring alone is not enough, because `${station}:${seq}` has no time in it. A
 * board swapped out or reflashed restarts its NVS counter near zero, and its
 * first real taps of the morning would collide with keys the ring is still
 * holding from yesterday's board — dropped BEFORE `checkIn` is ever attempted,
 * where L2's domain guarantees cannot recover them: no presence, no progress, no
 * leg. A retry arrives within seconds, so the window only has to outlast a radio
 * backoff; a shift is generous.
 */
const SEEN_TTL_MS = 6 * 60 * 60 * 1000

/** One remembered frame: its key, and when it was accepted. */
interface SeenFrame {
  k: string
  at: number
}

function seenKey(frame: HubTapFrame): string {
  return `${frame.st}:${frame.seq}`
}

function seenRing(now: number): SeenFrame[] {
  return load<SeenFrame[]>(SEEN_KEY, []).filter((e) => !!e?.k && now - e.at < SEEN_TTL_MS)
}

/**
 * True if this exact frame has already been handled, recently.
 *
 * Keyed on the station's own NVS sequence counter, which the firmware reserves
 * 64 ahead so a brownout cannot roll it backwards and turn a real tap into a
 * duplicate. Recording happens only once a frame has been ACCEPTED — a frame
 * refused for a transient reason (the rate limit, an unreachable holder) should
 * be reconsidered if the station sends it again, not buried by its own key.
 */
function alreadySeen(frame: HubTapFrame, now: number): boolean {
  const key = seenKey(frame)
  return seenRing(now).some((e) => e.k === key)
}

function remember(frame: HubTapFrame, now: number): void {
  const key = seenKey(frame)
  const ring = seenRing(now).filter((e) => e.k !== key)
  save(SEEN_KEY, [{ k: key, at: now }, ...ring].slice(0, SEEN_CAP))
}

/** Demo reset — forgets the ring and the log. */
export function clearTapMemory(): void {
  save(SEEN_KEY, [])
  save(LOG_KEY, [])
}

// ── The pipeline ────────────────────────────────────────────────────────────

function refusalDetail(res: Extract<TapResolution, { ok: false }>): string {
  switch (res.reason) {
    case 'unknown-tag':
      return 'The park has never seen that tag. The station stays on its ambience loop.'
    case 'unbound':
      return 'That standard is on the rack — no party, no quest.'
    case 'sealed':
      return 'That episode is already sealed. The party must return to the booth.'
    case 'lost':
      return 'That standard is marked lost.'
    case 'unknown-place':
      return 'That place is not on the chart.'
  }
}

/**
 * A tap, end to end: resolve the station, resolve the standard, sanity-check,
 * check the party in, and put the changed row back on the wire.
 *
 * The timestamp is the CONSOLE's clock, not the frame's `ts`. A station gets its
 * clock from the hub's beacon and may have been powered up before it heard one;
 * presence, leg ids and the whole ordering of the day are already keyed to this
 * device's clock, and letting a plinth in the woods write a check-in into next
 * Tuesday would be a much worse failure than a few seconds of skew.
 */
export function handleTap(frame: HubTapFrame, now: number = Date.now()): TapOutcome {
  const base = { at: now, stationNo: frame.st, uid: frame.uid }

  // L1. A retry is not an event.
  if (alreadySeen(frame, now)) {
    log({ ...base, outcome: 'duplicate', detail: `seq ${frame.seq}` })
    return { ok: false, reason: 'duplicate' }
  }

  const placeId = placeIdForStation(frame.st)
  if (!placeId) {
    log({ ...base, outcome: 'unknown-place', detail: `station ${frame.st}` })
    return { ok: false, reason: 'unknown-place' }
  }

  const resolution = resolveTap(frame.uid, placeId)
  if (!resolution.ok) {
    const flag = flagByUid(frame.uid)
    log({
      ...base,
      placeId,
      flagLabel: flag?.label,
      groupName: flag?.groupName,
      outcome: resolution.reason,
      detail: refusalDetail(resolution),
    })
    return { ok: false, reason: resolution.reason, detail: refusalDetail(resolution), flag: flag ?? undefined, placeId }
  }

  const { flag, placeName } = resolution
  const entry = { ...base, placeId, placeName, flagLabel: flag.label, groupName: flag.groupName }

  // Rate limit. Deliberately checked against the pole's own last sighting rather
  // than the station's, because the thing being rate-limited is the TAG.
  if (flag.lastSeenAt !== undefined && now - flag.lastSeenAt < TAP_RATE_LIMIT_MS) {
    const secs = Math.max(0, Math.round((now - flag.lastSeenAt) / 1000))
    const detail = `${flag.label} was tapped ${secs}s ago; the limit is ${TAP_RATE_LIMIT_MS / 1000}s.`
    log({ ...entry, outcome: 'rate-limited', detail })
    return { ok: false, reason: 'rate-limited', detail, flag, placeId }
  }

  const travel = travelCheck(flag, placeId, now)
  if (!travel.ok) {
    const detail =
      `${flag.label} was at ${flag.lastPlaceId} ${Math.round((travel.minutes ?? 0) * 60)}s ago — ` +
      `${(travel.distance ?? 0).toFixed(2)} of the chart away. Nobody walks that.`
    log({ ...entry, outcome: 'impossible-travel', detail })
    return { ok: false, reason: 'impossible-travel', detail, flag, placeId }
  }

  const holderId = flag.holderId
  if (!holderId || !getUser(holderId)) {
    const detail = `${flag.label} is bound to a guest who is not on the roll.`
    log({ ...entry, outcome: 'no-holder', detail })
    return { ok: false, reason: 'no-holder', detail, flag, placeId }
  }

  // The gate is an arrival, not a station on any rotation, so it takes its own
  // entry point — the same one the app's "We have arrived" walks through.
  const result =
    placeId === VILLAGE_PLACE.id
      ? checkInAtGate(holderId, now, { flagLabel: flag.label, orgId: flag.orgId })
      : checkIn(holderId, placeId, { at: now, orgId: flag.orgId, flagLabel: flag.label })

  if (!result.ok) {
    log({ ...entry, outcome: 'refused', detail: result.error })
    return { ok: false, reason: 'refused', detail: result.error, flag, placeId }
  }

  // Accepted. Only now does the frame go in the ring: a frame turned away for a
  // transient reason deserves a second hearing if the station sends it again.
  remember(frame, now)

  // The sighting. `updatedAt` moves, `tableAt` does NOT — a tap changes nothing
  // the stations broadcast, and bumping it here would mark all twenty-one of
  // them stale every time anybody walked anywhere.
  const seen = noteTap(flag.uid, placeId, now) ?? flag

  const credited = result.credit !== null
  const sealed = !!result.credit?.completion

  // A sealed episode DOES change the broadcast: `state` goes to 1, which is what
  // stops a Hero party that just finished rg-01 hearing rg-01's clips at the
  // next plinth. Push that one row rather than the whole table.
  if (sealed) {
    markSealed(flag.uid, now)
    broadcastRow(flag.uid)
  }

  log({ ...entry, outcome: 'accepted', detail: credited ? undefined : 'Off this episode’s rotation — nothing earned.' })

  return { ok: true, flag: seen, placeId, placeName, credited, sealed, outcome: result }
}

// ── Talking back to the park ────────────────────────────────────────────────

/** Put one changed binding on the wire. Cheaper than a table and the common case. */
export function broadcastRow(rfidUid: string): boolean {
  const table = assignmentTable()
  const row = table.rows.find((r) => r.uid === rfidUid)
  if (!row) return false
  return hubLink.pushFlagRow(table.version, row)
}

/** Broadcast the whole rack. Chunked by hubLink so one line can never overrun. */
export function broadcastTable(): number {
  return hubLink.pushFlagTable(assignmentTable())
}

/**
 * Answer a station that holds no row for a uid somebody just tapped.
 *
 * A tag we know gets its order and episode and the station resolves the next tap
 * locally. A tag we do NOT know gets NOTHING — no guess, no generic clip, no
 * "please wait" hold. The station keeps its ambience loop running and keeps
 * asking, which is the user's hard rule: a wrong story is worse than a pause.
 */
export function answerQuery(frame: HubQueryFrame): boolean {
  const table = assignmentTable()
  const row = table.rows.find((r) => r.uid === frame.uid)
  if (!row) {
    console.info(`[tap] station ${frame.st} asked about an unknown tag ${frame.uid} — left unanswered, by design`)
    return false
  }
  return hubLink.answerQuery(frame.st, row.uid, { org: row.org, ep: row.ep, state: row.state })
}

/**
 * Wires the hub's frames to the pipeline. Returns a disposer.
 *
 * The hub-status handler is what keeps the park current, and it is guarded on
 * the version rather than firing unconditionally: a table push makes the hub
 * commit, a commit makes it announce itself, and an unguarded broadcast on that
 * announcement would be an infinite round trip. Comparing versions terminates
 * on the first commit — and is the right behaviour anyway, since a hub already
 * holding the current table needs nothing from us.
 */
export function startTapPipeline(): () => void {
  const offs = [
    hubLink.onTap((frame) => {
      handleTap(frame)
    }),
    hubLink.onQuery((frame) => {
      answerQuery(frame)
    }),
    hubLink.onHubStatus((frame) => {
      if (frame.tblver < tableVersion()) broadcastTable()
    }),
  ]
  return () => offs.forEach((off) => off())
}

/** 'st-08' → 8. Re-exported so the demo remote can name a station by its wire address. */
export { stationNoForPlace }
