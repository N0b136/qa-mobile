// What the park's plinths are reporting about themselves.
//
// The tags carry a factory uid and NOTHING else — no order, no episode, no
// name — so every station answers a tap out of a CACHED COPY of the flag table.
// That is only a safe design while the staleness window is VISIBLE: a station
// holding yesterday's table will meet a flag bound this morning with silence,
// and the guest will have walked twenty minutes to be told nothing. So the
// heartbeat is not telemetry decoration, it is the thing that makes the cache
// defensible. Staff must be able to see a stale or dead plinth BEFORE a group
// sets off for it.
//
// Three readings carry that weight, and the frame already carries all three:
// is it alive (`ups`, and the fact the frame arrived at all), when did it last
// take a table (`tblage`), and which version is it holding (`tblver`).
//
// LOCAL ONLY, never synced. The hub is a cable into one PC, so this is one
// console's view of one park, and it is operational — the record of what
// happened is the quest log, not this. Nothing here needs a Firestore rule.

import type { HubHeartbeatFrame } from '../types'
import { load, save } from './store'
import { placeIdForStation } from './hubProtocol'

const KEY = 'ql:stationHealth'

/** The firmware's heartbeat period. Everything about liveness is counted in these. */
export const HEARTBEAT_PERIOD_MS = 120_000

/**
 * Two missed frames before we call a station silent.
 *
 * One is not enough — a single LoRa frame lost to a passing tractor is normal
 * and a board that cries wolf every few minutes is a board nobody reads.
 */
export const SILENT_AFTER_MS = 2 * HEARTBEAT_PERIOD_MS

export interface StationHealth {
  /** LoRa address: 1..21 stations, 22 the chief's house, 23 the gate. */
  stationNo: number
  /** 'st-08' | 'st-chief' | 'village' — the id every other service knows the place by. */
  placeId: string
  lastHeartbeatAt: number
  /**
   * When this station last COMMITTED a flag table, derived from `tblage` at the
   * moment the frame landed. Reported by the station, not measured here: the
   * console cannot know whether a table it pushed was ever written to NVS.
   *
   * UNDEFINED when the station has never committed one, or when `tblage` is too
   * large to be a reading — see `tableSyncedAt`. Absent is a fact staff can act
   * on; a fabricated clock time is not.
   */
  lastTableSyncAt?: number
  /** The version the station HOLDS. Compare against `flagService.tableVersion()` — never the other way round. */
  tableVersion: number
  uptimeS: number
  /** Taps sitting in its NVS ring, unsent. Non-zero means the radio is not getting through. */
  queueDepth: number
  sdOk: boolean
  playerOk: boolean
  rssi: number
  volume: number
  fwBuild: number
  /**
   * Set from a non-zero `err` code; cleared when the station reports clean again.
   *
   * CURRENT STATE, not history — it is rewritten from every frame, so its
   * presence means the LAST thing this plinth said was that it is erroring.
   * That is what makes it safe for `conditionOf` to read it as a fault.
   */
  lastError?: string
}

/**
 * `unknown` and `silent` are DIFFERENT and must never be merged. A station we
 * have not heard from since the console opened has told us nothing — we have
 * no grounds to say it is dead, only that we cannot say. A station that was
 * reporting and stopped is a claim, and it is the claim a Warden acts on.
 */
export type StationCondition = 'live' | 'stale' | 'silent' | 'fault' | 'unknown'

// ── State ───────────────────────────────────────────────────────────────────
//
// Module memory is the truth; `ql:stationHealth` is a lagging mirror of it.
// That inversion is deliberate. A `store.save()` notifies EVERY `useAppTick`
// consumer synchronously, and the park sends roughly one heartbeat every six
// seconds across twenty-one stations — writing each frame through would repaint
// the whole console ten times a minute to move a number nobody is watching that
// closely. So frames land in memory immediately and are flushed on a coalesced
// timer (see `schedulePersist`).

const state = new Map<number, StationHealth>()
let hydrated = false
let flushTimer: number | null = null

/**
 * How long the mirror may lag. Long, because the only thing it buys is a warm
 * board after a console reload mid-shift; a hard close costing the last half
 * minute of telemetry costs nothing at all.
 */
const PERSIST_MS = 30_000

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  const rows = load<StationHealth[]>(KEY, [])
  if (!Array.isArray(rows)) return
  const valid = rows.filter(
    (row) => row && typeof row.stationNo === 'number' && typeof row.placeId === 'string' && typeof row.lastHeartbeatAt === 'number'
  )
  const now = Date.now()

  // The newest frame in the mirror is the last moment we can prove this console
  // was listening. That single number separates the two cases the age of a row
  // cannot separate on its own:
  //
  //   - a row already older than the silence window WHEN WE WERE STILL LISTENING
  //     is a silence we WITNESSED. Restoring it restores an alarm we raised, and
  //     it has to be restored, because a dead plinth can never send the
  //     heartbeat that would rebuild its row — drop it and the board reads "no
  //     report" for the rest of the shift, which is the one merge this service
  //     exists to prevent. A false one costs nothing: if somebody fixed the
  //     plinth meanwhile it clears itself on the next heartbeat, inside two
  //     minutes.
  //   - a row that was healthy at close and is merely old NOW is the console
  //     having been shut. Restoring that would turn "nobody was watching" into
  //     "these stations died", a claim we did not witness, so it is dropped and
  //     the station reads unknown until it speaks again.
  const listeningUntil = valid.reduce((max, row) => Math.max(max, row.lastHeartbeatAt), 0)

  for (const row of valid) {
    const witnessedSilent = listeningUntil - row.lastHeartbeatAt > SILENT_AFTER_MS
    if (!witnessedSilent && now - row.lastHeartbeatAt > SILENT_AFTER_MS) continue
    state.set(row.stationNo, row)
  }
}

/**
 * Another tab wrote the mirror while we were open — in practice the presenter's
 * /demo remote, which runs in the GUEST app and seeds a board for the pitch.
 *
 * Adopted rather than dropped, and WITHOUT the age rule `hydrate` applies: at
 * open we cannot vouch for an old reading because we were not listening for it,
 * but a mirror written a moment ago by a tab that IS this console's sibling is a
 * live act, and a deliberately aged row in it (the staged silent station) is the
 * point of the exercise, not staleness to be discarded.
 *
 * Newest-per-station wins, the same LWW rule presence uses, so a real heartbeat
 * is never overwritten by a staged one. An EMPTY mirror is the one exception: it
 * is only ever written by `clearHealth`, so it means the park was reset.
 */
function adoptMirror(): void {
  const rows = load<StationHealth[]>(KEY, [])
  if (!Array.isArray(rows)) return
  if (rows.length === 0) {
    state.clear()
    return
  }
  for (const row of rows) {
    if (!row || typeof row.stationNo !== 'number' || typeof row.placeId !== 'string') continue
    const held = state.get(row.stationNo)
    if (held && held.lastHeartbeatAt >= row.lastHeartbeatAt) continue
    state.set(row.stationNo, row)
  }
}

if (typeof window !== 'undefined') {
  // `store` raises its own notify off the same event, so the repaint is already
  // coming; this only makes sure the map it repaints from is the adopted one.
  // A same-tab write does not fire this — the storage event is for OTHER
  // documents — so our own coalesced flush cannot come back at us.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) adoptMirror()
  })
}

function persist(): void {
  flushTimer = null
  save(KEY, [...state.values()].sort((a, b) => a.stationNo - b.stationNo))
}

function schedulePersist(): void {
  if (flushTimer !== null) return
  if (typeof window === 'undefined') {
    persist()
    return
  }
  flushTimer = window.setTimeout(persist, PERSIST_MS)
}

// ── Recording ───────────────────────────────────────────────────────────────

/**
 * `tblage` is bounded only to U32 on the wire, and U32 seconds is a hundred and
 * thirty-six years — a counter that has gone wrong would put a station's last
 * sync in the nineteenth century and the dialog would read it out as fact. A
 * year is already far past anything a plinth in this park could truthfully
 * claim, so past it we say nothing rather than something wrong.
 */
const TBLAGE_MAX_S = 365 * 24 * 3600

/**
 * When this station committed the table it is holding, or undefined.
 *
 * `tblver` 0 means it holds NO table, and the wire has no sentinel for "never"
 * on `tblage` — a freshly flashed or factory-reset plinth reports 0/0, which
 * taken at face value prints "synced just now" directly above "None held". The
 * two lines would contradict each other on precisely the station somebody has
 * to go and fix. Absent is the only honest reading.
 */
function tableSyncedAt(frame: HubHeartbeatFrame, now: number): number | undefined {
  if (frame.tblver <= 0) return undefined
  if (!Number.isFinite(frame.tblage) || frame.tblage < 0 || frame.tblage > TBLAGE_MAX_S) return undefined
  return now - frame.tblage * 1000
}

/**
 * A station reporting in. The frame reached here through `decodeLine`, so every
 * field is already inside its range — this only has to translate it.
 */
export function recordHeartbeat(frame: HubHeartbeatFrame, now: number = Date.now()): StationHealth | null {
  hydrate()
  const placeId = placeIdForStation(frame.st)
  if (!placeId) return null

  const health: StationHealth = {
    stationNo: frame.st,
    placeId,
    lastHeartbeatAt: now,
    // The station counts its own staleness; we only put a clock on it — and
    // only when the count means anything.
    lastTableSyncAt: tableSyncedAt(frame, now),
    tableVersion: frame.tblver,
    uptimeS: frame.ups,
    queueDepth: frame.qd,
    sdOk: frame.sd === 1,
    playerOk: frame.df === 1,
    rssi: frame.rssi,
    volume: frame.vol,
    fwBuild: frame.fw,
    lastError: frame.err ? `Error ${frame.err}` : undefined,
  }
  state.set(frame.st, health)
  schedulePersist()
  return health
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** Every station we have heard from, in station-number order. */
export function listHealth(): StationHealth[] {
  hydrate()
  return [...state.values()].sort((a, b) => a.stationNo - b.stationNo)
}

/**
 * The reading for one place, or undefined if it has never reported.
 *
 * Note the gate: station 23's place id is `village`, because a guest who taps
 * in there IS in the Village of Queston. That conflation is right for presence
 * and wrong for hardware — the box stands at the entrance, a walk from the
 * square — so anything drawing a reader on a chart keys by `stationNo`.
 */
export function healthFor(placeId: string): StationHealth | undefined {
  hydrate()
  for (const h of state.values()) if (h.placeId === placeId) return h
  return undefined
}

/**
 * PRECEDENCE — a station can be silent AND stale AND faulted at once, and the
 * ring can only say one thing, so it says the one a Warden acts on first:
 *
 *   1. unknown — nothing has arrived since the console opened. Every other
 *      verdict would be invented. Not an alarm; an absence of evidence.
 *   2. silent  — it was reporting and stopped. It outranks the rest because the
 *      rest are memories of a frame that may be minutes old: a station that is
 *      gone cannot be commanded, cannot be re-synced, and cannot be trusted to
 *      still be faulted or still be behind. Somebody has to walk out to it.
 *   3. fault   — alive, but not well: the SD card or the DFPlayer is bad, OR
 *      the station is reporting a non-zero `err`. It talks and it will not
 *      play; the guest gets a dead plinth. Also needs a person, this time
 *      carrying a part, so it ranks above the condition that does not. A
 *      station that is erroring AND behind reads fault, not stale, for the same
 *      reason: the walk out to it is the urgent fact, and the table push that
 *      would fix the staleness is going out park-wide anyway.
 *   4. stale   — alive and whole, holding a table older than the park's. This is
 *      the dangerous one precisely because it is invisible without this board,
 *      but it is LAST of the alarms because it is the only one fixable from the
 *      desk: push the table and it clears without anybody leaving the room.
 *   5. live.
 *
 * `parkTableVersion` is `flagService.tableVersion()` — max(flag.tableAt), an
 * epoch in milliseconds. A station is stale when it HOLDS a version BELOW the
 * park's. An empty rack makes both sides 0, so a park with no flags registered
 * reads current rather than universally stale, which is correct: there is
 * nothing yet for a station to be behind on.
 */
export function conditionOf(
  h: StationHealth | undefined,
  parkTableVersion: number,
  now: number = Date.now()
): StationCondition {
  if (!h) return 'unknown'
  if (now - h.lastHeartbeatAt > SILENT_AFTER_MS) return 'silent'
  // `lastError` counts as a fault even with the card and the player both
  // answering. Drop it and a plinth failing every play — a clip index that
  // points past the end of the folder, an amp that will not come up, a card
  // that mounts and reads nothing — wears a live gold ring while the guests
  // it is turning away report it as broken, and the Warden has twenty-three
  // green rings and no idea which one to walk to. Nothing else on this board
  // ever surfaces `err`.
  if (!h.sdOk || !h.playerOk || h.lastError) return 'fault'
  if (h.tableVersion < parkTableVersion) return 'stale'
  return 'live'
}

/**
 * Alive, but behind the park's table — the ones a table push would fix.
 *
 * A station that is behind AND faulted is deliberately NOT here: `conditionOf`
 * calls it a fault, and this list follows the ring rather than second-guessing
 * it, so the count under the push button can never disagree with the chips
 * above it. Nothing is lost by that — `broadcastTable()` is park-wide, so a
 * faulted plinth takes the table whenever anybody pushes for the others, and it
 * reappears here on the first heartbeat after its fault clears. If it is the
 * only station behind, the push control is hidden, which is right: somebody is
 * already walking out to that plinth.
 */
export function staleStations(parkTableVersion: number, now: number = Date.now()): StationHealth[] {
  return listHealth().filter((h) => conditionOf(h, parkTableVersion, now) === 'stale')
}

/**
 * Heard from, then stopped. Takes no park version because silence outranks
 * staleness — a version comparison against a station that is gone is noise.
 */
export function silentStations(now: number = Date.now()): StationHealth[] {
  return listHealth().filter((h) => now - h.lastHeartbeatAt > SILENT_AFTER_MS)
}

// ── Demo / reset ────────────────────────────────────────────────────────────

export function clearHealth(): void {
  hydrate()
  state.clear()
  if (flushTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  persist()
}

/**
 * Stage a board for the pitch. Rows are patches over a healthy station, so a
 * silent one is `{ stationNo, lastHeartbeatAt: <older than SILENT_AFTER_MS> }`.
 *
 * `tableVersion` defaults to 0 and the caller is expected to pass the park's own
 * — this service will not reach into the rack to guess it, and a row left at 0
 * against a stocked rack reads stale, correctly.
 *
 * Persisted immediately: seeding is a deliberate act, not a frame.
 */
export function seedHealth(
  rows: Array<{ stationNo: number } & Partial<StationHealth>>,
  now: number = Date.now()
): void {
  hydrate()
  state.clear()
  for (const row of rows) {
    const placeId = row.placeId ?? placeIdForStation(row.stationNo)
    if (!placeId) continue
    const healthy: StationHealth = {
      stationNo: row.stationNo,
      placeId,
      lastHeartbeatAt: now,
      // No table held, so no sync time — the same pairing a real frame obeys.
      // Seeds that want a synced station pass both fields.
      tableVersion: 0,
      uptimeS: 6 * 3600,
      queueDepth: 0,
      sdOk: true,
      playerOk: true,
      rssi: -92,
      volume: 22,
      fwBuild: 1,
    }
    // The patch wins, except on the two fields that address the row — a seed
    // that let those drift would put a station on the board twice.
    state.set(row.stationNo, { ...healthy, ...row, stationNo: row.stationNo, placeId })
  }
  persist()
}
