// "Is anything broken?" — answered off the booth PC.
//
// stationHealthService says at the top of itself that it is LOCAL ONLY, and it
// is right to: the LoRa hub is a USB cable into one machine, so only the console
// holding that cable ever sees a heartbeat. The cost of that is the one question
// a manager most wants answered from a car park or a kitchen table — is anything
// broken right now — being answerable nowhere except standing at the booth.
//
// This service closes that gap WITHOUT moving station health into the cloud. It
// publishes a SUMMARY, one document (`parkStatus/current`), written whole by the
// console with the cable: how many stations are in each condition, and a row for
// each one that is not live. Nothing here re-derives a condition — `conditionOf`
// is the single source of that truth and this file only counts what it says.
//
// The read side is deliberately paranoid about age. See PARK_STATUS_STALE_MS.

import type { ParkStationStatus, ParkStatus } from '../types'
import { load, save, remove } from './store'
import type { StationCondition, StationHealth } from './stationHealthService'
import { conditionOf, listHealth } from './stationHealthService'
import { tableVersion } from './flagService'
import { isLive, isSimulated, subscribe as subscribeHub } from './hubLink'
import { GATE_STATION_NO } from './hubProtocol'
import { getStation } from '../content/stations'
import { QUEST_START, VILLAGE_PLACE } from '../content/stationMap'
// Namespace import, the same posture flagService and progressService take: this
// module and cloudSync import each other, and only the live binding on a
// namespace object survives that cleanly.
import * as cloudSync from './cloudSync'

const KEY = 'ql:parkStatus'

// ── Cadence ─────────────────────────────────────────────────────────────────

/**
 * The unconditional write, whether or not anything changed.
 *
 * NOT redundant with the change-driven write, and this is the whole reason the
 * timer exists: `writtenAt` is the ONLY evidence that the booth console is still
 * open. A writer that only speaks when a condition changes is bit-for-bit
 * indistinguishable from a tab that was closed hours ago — both produce a
 * document that simply stops moving. The heartbeat is what makes the difference
 * legible, and what lets the read side below call the silence.
 */
const HEARTBEAT_MS = 5 * 60 * 1000

/**
 * How long a condition change is allowed to settle before it is published.
 *
 * A single act moves many stations at once — a table push puts twenty-one
 * plinths from `stale` to `live` over a few seconds, a hub reconnect brings a
 * whole park back — and the manager wants the settled answer, not each frame of
 * the transition.
 */
const CHANGE_DEBOUNCE_MS = 10_000

/**
 * How often the conditions are re-read looking for a change.
 *
 * A clock, not an event, because SILENCE IS THE ABSENCE OF FRAMES. `silent` is
 * the condition a Warden acts on first and it is reached by nothing happening:
 * a writer wired only to incoming heartbeats would publish every recovery and
 * never a single death, which is precisely backwards.
 */
const CHECK_MS = 15_000

/**
 * Past this, the document is not reporting and its contents must not be read as
 * the present. Two heartbeats plus slack — the same shape of rule (and the same
 * reasoning) as `SILENT_AFTER_MS` uses for a plinth: one missed write is a
 * console mid-reload or a phone that slept, two is a console that has stopped.
 */
export const PARK_STATUS_STALE_MS = 12 * 60 * 1000

// ── Building the report ─────────────────────────────────────────────────────

/** The `gate` landmark's own name in stationMap — station 23 is the box at the entrance. */
const GATE_LABEL = 'Entrance'

/**
 * What to call a station on a screen that has never seen the park.
 *
 * The gate is special-cased on the STATION NUMBER, not the place id. Station 23
 * reports `placeId: 'village'` because a guest who taps there is in the Village
 * of Queston — a conflation that is right for presence and wrong for hardware,
 * as stationHealthService says. A manager reading "Village of Queston — silent"
 * would go looking in the square for a box that stands at the entrance.
 */
function labelFor(h: StationHealth): string {
  if (h.stationNo === GATE_STATION_NO) return GATE_LABEL
  if (h.placeId === VILLAGE_PLACE.id) return VILLAGE_PLACE.name
  if (h.placeId === QUEST_START.id) return QUEST_START.name
  return getStation(h.placeId)?.name ?? h.placeId
}

/**
 * Every condition at zero.
 *
 * The `Record<StationCondition, number>` annotation is load-bearing: it is the
 * compile-time tie between this file's five keys and the union stationHealthService
 * actually returns. Add a sixth condition there and this object stops compiling
 * here, rather than quietly reporting a park whose counts no longer add up.
 */
function zeroCounts(): Record<StationCondition, number> {
  return { live: 0, stale: 0, silent: 0, fault: 0, unknown: 0 }
}

/**
 * The report as of `now`. Exported for tests; pure apart from reading the two
 * local mirrors it summarises (health and the flag rack).
 *
 * `counts` carries all five conditions including the zeros, so a consumer can
 * render a fixed set of chips without inventing keys. Note what it counts: the
 * stations THIS CONSOLE HAS HEARD FROM. `unknown` is therefore nearly always 0 —
 * a plinth that has never spoken has no health row at all — so a reader wanting
 * "3 of 23 never reported" gets it by subtracting from the park's own roster,
 * not from here. Fabricating twenty-three unknown rows at console open would put
 * a park-wide alarm on the manager's phone every morning.
 *
 * `exceptions` carries only the rows that are not live, which is what keeps a
 * well park's document near-empty: nobody needs twenty-one identical green rows
 * synced every five minutes to be told nothing is wrong.
 */
export function buildParkStatus(staffUid: string, now: number = Date.now()): ParkStatus {
  const version = tableVersion()
  const counts = zeroCounts()
  const exceptions: ParkStationStatus[] = []

  for (const h of listHealth()) {
    // `conditionOf` is the ONLY thing allowed to decide this. Precedence between
    // silent/fault/stale lives there and is documented there; re-deriving any of
    // it from raw fields here would let the manager's phone and the console's own
    // board disagree about the same plinth.
    const condition = conditionOf(h, version, now)
    counts[condition] += 1
    if (condition === 'live') continue
    exceptions.push({
      stationNo: h.stationNo,
      placeId: h.placeId,
      name: labelFor(h),
      condition,
      lastHeartbeatAt: h.lastHeartbeatAt,
      // Spread rather than `lastError: h.lastError` — cloudSync's `clean()` is
      // shallow, so an `undefined` nested inside this array would survive it and
      // Firestore would refuse the whole write.
      ...(h.lastError ? { lastError: h.lastError } : {}),
    })
  }

  return {
    id: 'current',
    writtenAt: now,
    writtenBy: staffUid,
    tableVersion: version,
    counts,
    exceptions,
  }
}

/** What changed, for the purposes of "worth publishing". Conditions only — never a clock. */
function signatureOf(status: ParkStatus): string {
  return status.exceptions.map((e) => `${e.stationNo}:${e.condition}:${e.lastError ?? ''}`).join('|')
    + `#${status.counts.live}/${status.counts.unknown}`
}

// ── Write side (the booth console only) ─────────────────────────────────────

/**
 * May this console publish? A REAL CABLE, and nothing that merely looks like one.
 *
 * `isLive()` alone is not the test. `openTransport()` sets the state to 'live'
 * for ANY transport, and the simulator is a transport — so a presenter opening
 * `console.html?hub=sim` signed in as staff would become a park-status writer
 * within ten seconds, and `pushParkStatus` is a whole-document `setDoc` with no
 * merge. The demo tab's invented report would REPLACE the booth's true one
 * outright: counts all zero, exceptions empty, `writtenAt` fresh — a park with
 * no live stations and no alarms, which `parkStatusFreshness` would then
 * certify as perfectly current, because by its own rule it is.
 *
 * A SIMULATOR IS NOT A HUB. It has no readings; it has a script.
 */
function canPublish(): boolean {
  return isLive() && !isSimulated()
}

/**
 * Publish this console's view of the park for as long as it holds the hub.
 *
 * THE HUB IS THE ELECTION. There is no leader election here and there must not
 * be one: station health COMES FROM hub heartbeats, so a console without the
 * cable has no readings of its own and every write it made would be a guess
 * overwriting the readings of the console that does have them. `canPublish()` is
 * checked at every write, not once at start, because the cable is pulled, the
 * dongle is re-seated, and the tab is left open across all of it.
 *
 * This is also why the same console app opened on a manager's phone can never
 * corrupt the document: the phone has no serial port, `isLive()` is false there
 * forever, and this writer sits silent while the read side below works normally.
 *
 * The local `applyParkStatus()` is deliberately NOT gated the same way. A
 * presenter running the simulator should still see a populated Manager tab —
 * it is the Firestore publish, and only that, which must never leave a demo tab.
 *
 * Returns a stop function that clears every timer and drops every subscription.
 */
export function startParkStatusWriter(staffUid: string): () => void {
  let stopped = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let checkTimer: ReturnType<typeof setInterval> | null = null
  let lastSignature: string | null = null
  let wasPublishing = false

  const write = (): void => {
    if (stopped) return
    // Re-checked here rather than trusted from whenever this write was armed: a
    // debounced write can fire ten seconds after the cable came out.
    if (!isLive()) return
    const status = buildParkStatus(staffUid)
    lastSignature = signatureOf(status)
    // Applied locally as well as pushed so the booth's own screens read the same
    // document the rest of the park reads, with or without Firestore. The echo
    // of our own write arriving back through the listener is a no-op — see
    // applyParkStatus.
    //
    // This much a simulated hub may do: it is this tab's own mirror, and a
    // presenter demonstrating the Manager tab needs something on it.
    applyParkStatus(status)
    // AND NO FURTHER WITHOUT A CABLE. See canPublish().
    if (!canPublish()) return
    cloudSync.pushParkStatus(status)
  }

  const armDebounce = (): void => {
    if (stopped || debounceTimer !== null) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      write()
    }, CHANGE_DEBOUNCE_MS)
  }

  /**
   * Deliberately NOT wired to `onHeartbeat`. Twenty-three plinths on a 120s frame
   * is roughly sixteen thousand writes a day to carry information nobody reads at
   * that resolution, and it would make `parkStatus/current` a hot document — the
   * same mistake `tableAt` avoids by never being bumped on a tap.
   */
  const check = (): void => {
    if (stopped || !canPublish()) return
    if (signatureOf(buildParkStatus(staffUid)) !== lastSignature) armDebounce()
  }

  const stopHub = subscribeHub(() => {
    if (stopped) return
    const publishing = canPublish()
    // A console that has just taken the cable is the newly authoritative one and
    // should say so promptly rather than at the next five-minute mark. Attaching
    // the SIMULATOR is not taking the cable, so it arms nothing.
    if (publishing && !wasPublishing) armDebounce()
    wasPublishing = publishing
  })

  wasPublishing = canPublish()
  // First write immediately: the document may be carrying a closed console's
  // last word, and until this one lands the manager's view is suppressed.
  write()

  checkTimer = setInterval(check, CHECK_MS)
  heartbeatTimer = setInterval(write, HEARTBEAT_MS)

  return () => {
    stopped = true
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    if (checkTimer !== null) clearInterval(checkTimer)
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    debounceTimer = checkTimer = heartbeatTimer = null
    stopHub()
  }
}

// ── Read side (anywhere, including a phone with no hub) ─────────────────────

/** The local mirror of `parkStatus/current`, or null if the park has never reported. */
export function currentParkStatus(): ParkStatus | null {
  const held = load<ParkStatus | null>(KEY, null)
  if (!held || typeof held !== 'object') return null
  if (typeof held.writtenAt !== 'number' || !Array.isArray(held.exceptions)) return null
  return held
}

/**
 * What cloudSync's listener calls. Terminates in the mirror and calls nothing
 * back into any service — a console that writes this document also receives its
 * own write, and anything reactive here would be a write loop.
 *
 * No last-write-wins merge, unlike most mirrors in this app: this is one
 * document with one writer and Firestore delivers its snapshots in order, so
 * whatever arrived last IS the truth. The only thing filtered out is the echo of
 * our own write, to spare every subscribed screen a repaint that changes nothing.
 */
export function applyParkStatus(status: ParkStatus | null): void {
  const held = currentParkStatus()
  if (!status) {
    // The document is gone (or never existed). Absent is a real state — the read
    // side reports it as not reporting — so the stale copy must not be kept.
    if (held) remove(KEY)
    return
  }
  if (held && held.writtenAt === status.writtenAt && held.writtenBy === status.writtenBy) return
  save(KEY, status)
}

export interface ParkStatusFreshness {
  status: ParkStatus | null
  /** false when absent OR older than PARK_STATUS_STALE_MS. */
  reporting: boolean
  ageMs: number | null
}

/**
 * THE MOST IMPORTANT RULE IN THIS FILE.
 *
 * `reporting: false` means THE CONSUMER MUST SUPPRESS THE COUNTS ENTIRELY. Not
 * grey them out, not caption them "may be out of date" — remove them, and say
 * instead that the park is not reporting and when it last did.
 *
 * The failure this prevents, concretely: a manager glances at their phone at
 * nine in the evening, reads "23 live", and goes to bed. The console that wrote
 * those twenty-three was closed at five. Four hours of a plinth being dead were
 * rendered as a healthy park, by a screen doing exactly what it was told.
 *
 * A surface that quietly ages into a lie is worse than no surface at all. Not
 * because of the one bad night — because of what it does afterwards: staff stop
 * trusting the board, and a board nobody trusts is a board nobody opens, which
 * costs the park the honest readings too. That is why the age test lives here,
 * beside the data, rather than being left to each screen to remember.
 *
 * `status` is still returned when `reporting` is false, and it should still be
 * rendered — `writtenAt` is exactly the fact the manager needs ("last reported
 * 5:02pm"). It is `counts` and `exceptions` that must go.
 *
 * `ageMs` can come back NEGATIVE where the reader's clock is behind the booth
 * PC's. That reads as fresh, and the opposite skew reads as stale and suppresses
 * — which is the direction to fail in.
 */
export function parkStatusFreshness(now: number = Date.now()): ParkStatusFreshness {
  const status = currentParkStatus()
  if (!status) return { status: null, reporting: false, ageMs: null }
  const ageMs = now - status.writtenAt
  return { status, reporting: ageMs <= PARK_STATUS_STALE_MS, ageMs }
}
