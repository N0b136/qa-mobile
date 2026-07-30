// The console's end of the hub cable.
//
// One hub, one USB port, one connection — so this module is a MODULE-LEVEL
// SINGLETON, deliberately, and not state scoped to a React effect. Under React
// 19 StrictMode an effect mounts, tears down and mounts again; a per-effect
// connection would call `open()` twice on the same port, the second call would
// fail with "the port is already open", and the link would report `held` — the
// state that means "another tab has the hub" — for a fault we caused ourselves.
// `connect()` is therefore idempotent: it hands back the in-flight `opening`
// promise, holds a reference count, and defers closing by a short grace period
// so a StrictMode remount reattaches to the same live port instead of flapping
// it.
//
// This layer owns four things and nothing else:
//
//   1. The LINE ASSEMBLER. Transports hand over raw text chunks, never lines,
//      so one hardened splitter serves both the simulator and the real serial
//      port. It splits on '\n' and it will NOT let the pending buffer grow past
//      MAX_LINE — a device that opens the port and then never sends a newline
//      would otherwise grow that string until the tab runs out of memory.
//   2. The STATE MACHINE, and reconnection with backoff.
//   3. The WRITE QUEUE. Writes are serialised and survive a reconnect, because
//      the thing we mostly write is the flag table, and a station that never
//      gets it stays silent by design.
//   4. FAN-OUT to onTap / onBoothTag / onHeartbeat / onQuery.
//
// It owns no domain logic at all. A tap arrives here as a validated frame and
// leaves as a callback; deciding what it MEANS — which flag, which party, is it
// a duplicate, is it impossible travel — belongs to tapService, above.
//
// `SerialTransport` (Slice 7) drops in behind `HubTransport` with nothing in
// this file or above it changing. That is the point of the interface: the
// simulator and a real hub speak byte-identical NDJSON, so everything from here
// up is exercised for real long before any hardware exists.

import type {
  HubBoothFrame,
  HubCommand,
  HubHeartbeatFrame,
  HubInboundFrame,
  HubOutboundFrame,
  HubQueryFrame,
  HubStatusFrame,
  HubTableRow,
  HubTapFrame,
} from '../types'
import { MAX_LINE, TABLE_CHUNK_ROWS, decodeLine, decodeStats, encodeLine, noteRefusal } from './hubProtocol'

// ── The transport seam ──────────────────────────────────────────────────────

export type HubTransportKind = 'serial' | 'sim'

export interface HubTransportHandlers {
  /** Raw text off the wire. Chunks, not lines — this layer does the splitting. */
  onChunk(text: string): void
  /** The far end went away. `expected` is true only for a close we asked for. */
  onClosed(expected: boolean, detail?: string): void
}

/**
 * What a hub looks like from here. Dumb on purpose: bytes in, bytes out, and a
 * note when it dies. Everything else is this module's job.
 */
export interface HubTransport {
  readonly kind: HubTransportKind
  /** Shown on the status chip. 'Simulated hub' · 'USB serial'. */
  readonly label: string
  /** False when the browser cannot do this at all — `navigator.serial` absent. */
  supported(): boolean
  /** Resolves once the far end is readable. Rejects with a HubOpenError. */
  open(handlers: HubTransportHandlers): Promise<void>
  close(): Promise<void>
  /** One complete line, newline included. */
  write(text: string): Promise<void>
}

export type HubOpenFailure =
  | 'unsupported'
  /** The guest closed the browser's port picker. Not an error — nothing was chosen. */
  | 'cancelled'
  /** Another tab or process holds the port. */
  | 'held'
  /** Permission refused. */
  | 'denied'
  | 'error'

/** Why a transport could not open, in terms this module can turn into a state. */
export class HubOpenError extends Error {
  readonly failure: HubOpenFailure
  constructor(failure: HubOpenFailure, message: string) {
    super(message)
    this.name = 'HubOpenError'
    this.failure = failure
  }
}

// ── State ───────────────────────────────────────────────────────────────────

export type HubState =
  /** This browser has no Web Serial. Nothing to offer; show the simulator instead. */
  | 'unsupported'
  /** Nothing connected, nothing wrong. The resting state. */
  | 'idle'
  | 'connecting'
  /** The hub is on the wire and talking. */
  | 'live'
  /** It went away mid-walk and we are trying to get it back. Writes keep queueing. */
  | 'reconnecting'
  /** Another tab or process holds the port — the one state a human must act on. */
  | 'held'
  | 'error'

export interface HubSnapshot {
  state: HubState
  kind: HubTransportKind | null
  label: string
  /** Set on 'held' and 'error'. Short enough to sit in a chip's tooltip. */
  error?: string
  framesIn: number
  framesOut: number
  /** Refused lines — malformed frames are counted and shown, never swallowed. */
  malformed: number
  /** Inbound frames dropped by the rate cap. A flood is a fault, not traffic. */
  rateLimited: number
  /** Lines queued for the hub, waiting on a live port. */
  queued: number
  /** Queued lines discarded because the queue was full. */
  droppedWrites: number
  /** ms of the last frame off the wire — the console's "is it alive" clock. */
  lastFrameAt: number
  reconnectAttempt: number
}

const MAX_QUEUE = 500
const MAX_FRAMES_PER_SEC = 120
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000]
/**
 * How long a released connection stays open. Long enough that StrictMode's
 * unmount/remount reuses the port, short enough that a real sign-out closes it
 * promptly.
 */
const CLOSE_GRACE_MS = 250

let transport: HubTransport | null = null
let state: HubState = 'idle'
let errorText: string | undefined
let holds = 0
let opening: Promise<HubState> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0

let framesIn = 0
let framesOut = 0
let rateLimited = 0
let droppedWrites = 0
let lastFrameAt = 0

/**
 * Lines waiting for a live port. Declared up here with the rest of the module
 * state, not down beside `pump()`, because `buildSnapshot()` reads its length
 * during module initialisation — a `const` further down the file is still in
 * its temporal dead zone at that point.
 */
const queue: string[] = []

// ── Listeners ───────────────────────────────────────────────────────────────

type TapListener = (frame: HubTapFrame) => void
type BoothListener = (frame: HubBoothFrame) => void
type HeartbeatListener = (frame: HubHeartbeatFrame) => void
type QueryListener = (frame: HubQueryFrame) => void
type StatusListener = (frame: HubStatusFrame) => void

const tapListeners = new Set<TapListener>()
const boothListeners = new Set<BoothListener>()
const heartbeatListeners = new Set<HeartbeatListener>()
const queryListeners = new Set<QueryListener>()
const statusListeners = new Set<StatusListener>()
const snapshotListeners = new Set<() => void>()

/**
 * A tapped standard. The frame is already validated — `st` is a real place and
 * `uid` passed the allowlist — but it has NOT been interpreted: whether that
 * uid is a flag we know, whether the tap is a duplicate or a physical
 * impossibility is tapService's to decide.
 */
export function onTap(fn: TapListener): () => void {
  tapListeners.add(fn)
  return () => tapListeners.delete(fn)
}

/** A tag on the booth pad. Binding and checking out are the same gesture — the flag's status decides which. */
export function onBoothTag(fn: BoothListener): () => void {
  boothListeners.add(fn)
  return () => boothListeners.delete(fn)
}

/** A station reporting in. Feeds the station-health map (Slice 6). */
export function onHeartbeat(fn: HeartbeatListener): () => void {
  heartbeatListeners.add(fn)
  return () => heartbeatListeners.delete(fn)
}

/**
 * A station holding no row for a uid somebody just tapped. It is sitting on its
 * ambience loop and will keep asking. Answer with `answerQuery`, or do not
 * answer — but never let it guess.
 */
export function onQuery(fn: QueryListener): () => void {
  queryListeners.add(fn)
  return () => queryListeners.delete(fn)
}

/** The hub's own status frame — its firmware, the table version it is broadcasting. */
export function onHubStatus(fn: StatusListener): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

// ── Snapshot ────────────────────────────────────────────────────────────────

let snapshot: HubSnapshot = buildSnapshot()
let notifyScheduled = false

function buildSnapshot(): HubSnapshot {
  const s = decodeStats()
  return {
    state,
    kind: transport ? transport.kind : null,
    label: transport ? transport.label : 'No hub',
    error: errorText,
    framesIn,
    framesOut,
    malformed: s.malformed,
    rateLimited,
    queued: queue.length,
    droppedWrites,
    lastFrameAt,
    reconnectAttempt,
  }
}

/**
 * Rebuild and publish. Counter-only changes are coalesced to one notification
 * per frame of animation: a hub under load pushes a couple of hundred frames a
 * second and the status chip does not need to re-render for each one. A STATE
 * change always publishes immediately — that one a human is waiting on.
 */
function bump(immediate = false): void {
  if (immediate) {
    notifyScheduled = false
    snapshot = buildSnapshot()
    snapshotListeners.forEach((fn) => fn())
    return
  }
  if (notifyScheduled) return
  notifyScheduled = true
  setTimeout(() => {
    if (!notifyScheduled) return
    notifyScheduled = false
    snapshot = buildSnapshot()
    snapshotListeners.forEach((fn) => fn())
  }, 250)
}

function setState(next: HubState, error?: string): void {
  if (state === next && errorText === error) return
  state = next
  errorText = error
  bump(true)
}

/** For `useSyncExternalStore`. Stable reference until something actually changes. */
export function getSnapshot(): HubSnapshot {
  return snapshot
}

export function subscribe(fn: () => void): () => void {
  snapshotListeners.add(fn)
  return () => {
    snapshotListeners.delete(fn)
  }
}

export function getState(): HubState {
  return state
}

export function isLive(): boolean {
  return state === 'live'
}

export function transportKind(): HubTransportKind | null {
  return transport ? transport.kind : null
}

/** True when the console is being driven by the simulator — the SIMULATED HUB badge. */
export function isSimulated(): boolean {
  return transport?.kind === 'sim'
}

// ── Line assembly ───────────────────────────────────────────────────────────

let buffer = ''
/** Discarding the tail of a line we already refused for length. */
let skipping = false

let windowStartedAt = 0
let framesThisWindow = 0

function ingest(chunk: string): void {
  if (typeof chunk !== 'string' || chunk === '') return
  buffer += chunk

  for (;;) {
    const nl = buffer.indexOf('\n')
    if (nl === -1) break
    const line = buffer.slice(0, nl)
    buffer = buffer.slice(nl + 1)
    if (skipping) {
      // The remains of an overlong line. Already counted when we dropped it.
      skipping = false
      continue
    }
    handleLine(line)
  }

  // A device that never sends '\n'. Drop what we hold and everything up to the
  // next newline, so the buffer cannot grow without bound. Counted, not
  // swallowed — a hub doing this is broken or hostile and staff should see it.
  if (buffer.length > MAX_LINE) {
    buffer = ''
    skipping = true
    noteRefusal('overlong')
    bump()
  }
}

function handleLine(line: string): void {
  if (line.trim() === '') return

  // Rate cap. A hub cannot legitimately send this fast — 21 stations heartbeat
  // twice a minute and taps come at walking pace — so a flood is a fault, and
  // absorbing it would just move the failure to Firestore.
  const now = Date.now()
  if (now - windowStartedAt >= 1000) {
    windowStartedAt = now
    framesThisWindow = 0
  }
  framesThisWindow++
  if (framesThisWindow > MAX_FRAMES_PER_SEC) {
    rateLimited++
    bump()
    return
  }

  const result = decodeLine(line)
  if (!result.ok) {
    bump()
    return
  }

  framesIn++
  lastFrameAt = now
  dispatch(result.frame as HubInboundFrame)
  bump()
}

function dispatch(frame: HubInboundFrame): void {
  // A listener that throws must not take the reader down with it — the next
  // frame is somebody else's check-in.
  const guard = (fn: () => void) => {
    try {
      fn()
    } catch (err) {
      console.error('[hub] listener threw', err)
    }
  }

  switch (frame.t) {
    case 'tap':
      tapListeners.forEach((fn) => guard(() => fn(frame)))
      break
    case 'booth':
      boothListeners.forEach((fn) => guard(() => fn(frame)))
      break
    case 'hb':
      heartbeatListeners.forEach((fn) => guard(() => fn(frame)))
      break
    case 'query':
      queryListeners.forEach((fn) => guard(() => fn(frame)))
      break
    case 'hub':
      statusListeners.forEach((fn) => guard(() => fn(frame)))
      break
    case 'log':
      // Numeric level, numeric code, numeric args — never free text, by wire
      // invariant. Kept out of the console UI until Slice 6 gives it a home.
      break
  }
}

// ── Write queue ─────────────────────────────────────────────────────────────

let pumping = false

function enqueue(line: string): boolean {
  if (queue.length >= MAX_QUEUE) {
    // Drop the OLDEST. What is waiting is mostly flag-table state, and the
    // newest version of that is the only one worth sending.
    queue.shift()
    droppedWrites++
  }
  queue.push(line)
  bump()
  void pump()
  return true
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (queue.length > 0 && state === 'live' && transport) {
      const line = queue[0]
      try {
        await transport.write(line)
      } catch (err) {
        // Put it back — the reconnect will drain it. A flag table that never
        // reached the park is exactly the failure this queue exists to survive.
        console.warn('[hub] write failed', err)
        onTransportClosed(false, 'write failed')
        break
      }
      queue.shift()
      framesOut++
    }
  } finally {
    pumping = false
    bump()
  }
}

function send(frame: HubOutboundFrame): boolean {
  let line: string
  try {
    line = encodeLine(frame)
  } catch (err) {
    // Our own bug, not wire input. Count it as a dropped write and say so
    // loudly rather than putting a half-formed line on the port.
    console.error('[hub] refused to encode a frame', err)
    droppedWrites++
    bump()
    return false
  }
  return enqueue(line)
}

// ── Push API ────────────────────────────────────────────────────────────────

/**
 * Broadcast the whole flag table. Sent as `TABLE_CHUNK_ROWS`-row chunks with an
 * idx/of pair, mirroring the LoRa `U` CHUNK frame, so one line can never grow
 * past MAX_LINE however many poles the park owns. An empty table still sends
 * one chunk — "the park holds no bindings at version v" is information.
 *
 * Returns the number of chunks queued.
 */
export function pushFlagTable(table: { version: number; rows: readonly HubTableRow[] }): number {
  const rows = table.rows ?? []
  const chunks: HubTableRow[][] = []
  for (let i = 0; i < rows.length; i += TABLE_CHUNK_ROWS) {
    chunks.push(rows.slice(i, i + TABLE_CHUNK_ROWS))
  }
  if (chunks.length === 0) chunks.push([])

  let queuedChunks = 0
  chunks.forEach((chunkRows, idx) => {
    const ok = send({ t: 'table', ver: table.version, idx, of: chunks.length, rows: chunkRows })
    if (ok) queuedChunks++
  })
  return queuedChunks
}

/**
 * One binding changed. Cheaper than a whole table and the common case: a Guide
 * binds a party at the booth and the park needs to know about that pole only.
 */
export function pushFlagRow(version: number, row: HubTableRow): boolean {
  return send({ t: 'row', ver: version, row })
}

/**
 * Answer a station's query. Until this lands, that station is sitting on its
 * ambience loop with a guest in front of it — which is the correct behaviour
 * and the reason there is no fallback clip to play instead.
 */
export function answerQuery(
  stationNo: number,
  uid: string,
  answer: { org: number; ep: number; state: number; ttl?: number },
): boolean {
  return send({
    t: 'resolve',
    st: stationNo,
    uid,
    org: answer.org,
    ep: answer.ep,
    state: answer.state,
    ttl: answer.ttl ?? 3600,
  })
}

/** Volume, a test clip, a forced resync, a ping. No REBOOT and no queue-wipe in v1. */
export function sendCommand(stationNo: number, cmd: HubCommand, arg = 0): boolean {
  return send({ t: 'cmd', st: stationNo, cmd, arg })
}

/** Queued lines, for a "3 waiting" note on the status chip. */
export function pendingWrites(): number {
  return queue.length
}

// ── Connection lifecycle ────────────────────────────────────────────────────

function onTransportChunk(text: string): void {
  ingest(text)
}

function onTransportClosed(expected: boolean, detail?: string): void {
  buffer = ''
  skipping = false
  if (expected || holds === 0) {
    setState('idle')
    return
  }
  scheduleReconnect(detail)
}

function scheduleReconnect(detail?: string): void {
  if (reconnectTimer !== null) return
  if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
    setState('error', detail ?? 'The hub stopped answering.')
    return
  }
  const delay = RECONNECT_DELAYS_MS[reconnectAttempt]
  reconnectAttempt++
  setState('reconnecting', detail)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (holds === 0 || !transport) {
      setState('idle')
      return
    }
    void openTransport(true)
  }, delay)
}

/**
 * `auto` is true only when the reconnect timer called this, never when a person
 * pressed the button. The `held` branch below is the only thing that reads it,
 * and it is the difference between a ladder that keeps climbing and one that
 * stops — see the note there before removing the argument.
 */
async function openTransport(auto = false): Promise<HubState> {
  const t = transport
  if (!t) {
    setState('idle')
    return state
  }
  if (!t.supported()) {
    setState('unsupported', 'This browser cannot talk to a serial device.')
    return state
  }

  setState('connecting')
  try {
    await t.open({ onChunk: onTransportChunk, onClosed: onTransportClosed })
  } catch (err) {
    const failure = err instanceof HubOpenError ? err.failure : 'error'
    const message = err instanceof Error ? err.message : 'The hub would not open.'
    switch (failure) {
      case 'unsupported':
        setState('unsupported', message)
        break
      case 'cancelled':
        // Nothing was chosen. Not a fault — back to resting.
        setState('idle')
        break
      case 'held':
        // `held` is terminal when a PERSON just asked for the port: another tab
        // or a serial monitor holding it will not let go on a timer, and saying
        // so is the whole point of the state.
        //
        // It must NOT be terminal when the ladder asked. Chrome raises the same
        // `NetworkError` whether another window holds the port or the device is
        // simply no longer on the bus (see openFailure in hubSerial.ts), and on
        // rung 1 of a reconnect the second reading is the likely one — we held
        // that port open a second ago. WHAT BREAKS IF THIS RE-ARMS NOTHING: a
        // Warden knocks the cable out, the read loop faults, rung 1 tries to
        // reopen a port whose device is gone, and this branch parks the link in
        // `held` with no timer armed. Pushing the cable back in then does
        // nothing at all — the board tells the Warden to close a window they
        // never opened, every tap in the park queues behind it, and the flag
        // table cannot go out either because the push needs `live`. Keeping the
        // port object across closes exists precisely so that cable comes back
        // on its own; this is the branch that lets it.
        if (auto) scheduleReconnect(message)
        else setState('held', message)
        break
      default:
        // A hub that vanished mid-shift is worth retrying; one that refused
        // permission is not going to change its mind on a timer.
        if (failure === 'denied') setState('error', message)
        else scheduleReconnect(message)
        break
    }
    return state
  }

  reconnectAttempt = 0
  setState('live')
  void pump()
  return state
}

/**
 * Attach to a hub. IDEMPOTENT and reference-counted — call it from an effect
 * without fear: a second call while the first is in flight returns the same
 * promise, and a call while already live is a no-op that simply takes another
 * hold. This is what keeps React 19 StrictMode from double-opening the port and
 * misreporting its own second failure as `held`.
 */
export function connect(next?: HubTransport): Promise<HubState> {
  if (closeTimer !== null) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  holds++

  if (next && next !== transport) {
    // A different hub — swap it in. Anything queued is still worth sending.
    if (transport) void transport.close().catch(() => {})
    transport = next
    opening = null
    reconnectAttempt = 0
    setState('idle')
  }

  if (!transport) {
    setState('idle')
    return Promise.resolve(state)
  }
  if (state === 'live') return Promise.resolve(state)
  if (opening) return opening

  const run = openTransport().finally(() => {
    opening = null
  })
  opening = run
  return run
}

/**
 * Try again NOW, without taking a hold. For the status chip's Reconnect action
 * and for the simulator's `restore()` — a presenter should not stand in front
 * of a boardroom waiting out a thirty-second backoff.
 */
export function retryNow(): Promise<HubState> {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempt = 0
  if (holds === 0 || !transport) return Promise.resolve(state)
  if (state === 'live') return Promise.resolve(state)
  if (opening) return opening
  const run = openTransport().finally(() => {
    opening = null
  })
  opening = run
  return run
}

/**
 * Release a hold. The port only actually closes once every holder has let go,
 * and then only after a short grace — a StrictMode remount reattaches inside
 * that window rather than flapping the connection.
 */
export function disconnect(): void {
  holds = Math.max(0, holds - 1)
  if (holds > 0) return
  if (closeTimer !== null) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    closeTimer = null
    if (holds > 0) return
    void closeNow()
  }, CLOSE_GRACE_MS)
}

async function closeNow(): Promise<void> {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempt = 0
  buffer = ''
  skipping = false
  const t = transport
  if (t) {
    try {
      await t.close()
    } catch {
      // Already gone. Nothing to do — the state below is the truth either way.
    }
  }
  if (holds === 0) setState('idle')
}

/**
 * Tear everything down and forget the transport. For sign-out and for tests —
 * `connect()` is the normal way back.
 */
export async function reset(): Promise<void> {
  holds = 0
  if (closeTimer !== null) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  await closeNow()
  transport = null
  opening = null
  queue.length = 0
  framesIn = 0
  framesOut = 0
  rateLimited = 0
  droppedWrites = 0
  lastFrameAt = 0
  setState('idle')
  bump(true)
}
