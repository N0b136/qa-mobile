// A hub made of nothing, speaking exactly like the real one.
//
// The whole chain — tap to check-in to Firestore to a guest's phone — has to be
// drivable with zero hardware: while the boards are being built, in a headless
// browser during QA, and in front of a boardroom where nobody can carry a
// twenty-one-station park onto a stage. So this is a full `HubTransport` that
// emits BYTE-IDENTICAL NDJSON: every frame it produces goes out through
// `encodeLine` and comes back in through the same `decodeLine` a real hub's
// bytes would, including the `raw()` injector, which exists precisely so
// malformed input can be tested against the real parser rather than a lenient
// stand-in. If the simulator can be made to lie about the wire, it is worthless
// as a test of the wire.
//
// It also behaves like a station, not just a pipe. It caches the flag table the
// console pushes at it, and a tapped uid it holds a row for resolves LOCALLY —
// `res: 'L'`, with the order and episode filled in, exactly as a plinth in the
// woods would from its NVS copy. A uid it does not hold resolves to nothing:
// `res: 'U'`, org 0, ep 0, followed by a `query` frame. That is the user's hard
// rule made testable — an unresolved tag plays NO clip and keeps asking. There
// is no fallback here because there is no fallback there.
//
// Exposed on `window.__questlandHub` so the whole thing can be driven from a
// devtools console, a QA harness or the presenter's demo remote.

import type { HubFrame, HubHeartbeatFrame, HubInboundFrame, HubTableRow } from '../types'
import { decodeLine, encodeLine, normalizeWireUid } from './hubProtocol'
import * as hubLink from './hubLink'
import type { HubTransport, HubTransportHandlers } from './hubLink'

const SIM_FW = 1
const FRAME_LOG_CAP = 500

/**
 * A demo tag uid that a real reader could actually have produced.
 *
 * A uid is a FACTORY number, and the allowlist that guards it is pure hex —
 * `/^[0-9A-F]{8,20}$/`, rejected not repaired. So a memorable-looking
 * `SIM0000001` is not a uid at all (S, I and M are not hex digits) and the
 * parser refuses it, correctly. These are shaped like the real thing instead:
 * 14 hex characters — a 7-byte NTAG213 uid — opening with NXP's `04`
 * manufacturer byte, exactly like the tags in the BOM.
 *
 *   simUid(1) === '04D000000000 01'  (without the space)
 */
export function simUid(n: number): string {
  const tail = Math.max(0, Math.floor(n)).toString(16).toUpperCase().padStart(10, '0').slice(-10)
  return `04D0${tail}`
}

/** One line as it crossed the wire. `in` is hub→console, `out` is console→hub. */
export interface SimFrameRecord {
  dir: 'in' | 'out'
  line: string
  at: number
}

/** Everything `heartbeat()` will make up for you unless you say otherwise. */
export interface SimHeartbeatOptions {
  ups?: number
  /** Leave unset for "current". Set it BEHIND the park's version to make a station read stale. */
  tblver?: number
  /** Seconds since this station last committed a table. The staleness window, made visible. */
  tblage?: number
  qd?: number
  sd?: 0 | 1
  df?: 0 | 1
  err?: number
  rssi?: number
  vol?: number
  fw?: number
}

/**
 * The transport. Implements `HubTransport` and nothing more — `hubLink` still
 * owns the state machine, the line assembler and the write queue, so the
 * simulated path exercises every one of them.
 */
export class SimulatedTransport implements HubTransport {
  readonly kind = 'sim' as const
  readonly label = 'Simulated hub'

  private handlers: HubTransportHandlers | null = null
  private down = false
  private bootedAt = Date.now()

  /** The flag table as a station holds it, keyed by uid. */
  private table = new Map<string, HubTableRow>()
  private tableVersion = 0
  private tableCommittedAt = Date.now()
  /** Chunks of a table push waiting for their siblings, keyed by version. */
  private staging = new Map<number, { of: number; parts: Map<number, HubTableRow[]> }>()

  private seqByStation = new Map<number, number>()
  private lastTapLine = new Map<number, string>()
  private frameLog: SimFrameRecord[] = []

  // ── HubTransport ──────────────────────────────────────────────────────────

  supported(): boolean {
    return true
  }

  async open(handlers: HubTransportHandlers): Promise<void> {
    if (this.down) {
      throw new hubLink.HubOpenError('error', 'The simulated hub is unplugged. Call restore().')
    }
    this.handlers = handlers
    this.bootedAt = Date.now()
    // A real hub introduces itself the moment the port opens, which is how the
    // console learns which table version the park is actually broadcasting.
    queueMicrotask(() => this.emitStatus())
  }

  async close(): Promise<void> {
    this.handlers = null
  }

  async write(text: string): Promise<void> {
    if (this.down) throw new Error('simulated hub is unplugged')
    // Straight through the real decoder. A frame this refuses is a frame a real
    // hub would refuse, and we would rather find that out here.
    const line = text.endsWith('\n') ? text.slice(0, -1) : text
    this.log('out', line)
    const result = decodeLine(line)
    if (!result.ok) {
      console.error('[hubSim] refused a console frame', result.reason, result.field)
      return
    }
    this.apply(result.frame)
  }

  // ── Behaving like a park ──────────────────────────────────────────────────

  private apply(frame: HubFrame): void {
    switch (frame.t) {
      case 'table': {
        // Stage, then commit only once every chunk of that version is in hand —
        // the firmware does the same, and a half-applied table is the one thing
        // worse than a stale one.
        let pending = this.staging.get(frame.ver)
        if (!pending || pending.of !== frame.of) {
          pending = { of: frame.of, parts: new Map() }
          this.staging.set(frame.ver, pending)
        }
        pending.parts.set(frame.idx, frame.rows)
        if (pending.parts.size < frame.of) return
        const rows: HubTableRow[] = []
        for (let i = 0; i < frame.of; i++) rows.push(...(pending.parts.get(i) ?? []))
        this.staging.delete(frame.ver)
        this.table = new Map(rows.map((r) => [r.uid, r]))
        this.commitTable(frame.ver)
        break
      }
      case 'row': {
        this.table.set(frame.row.uid, frame.row)
        this.commitTable(frame.ver)
        break
      }
      case 'resolve': {
        // The answer to a query. The station caches it and the next tap on that
        // uid resolves locally.
        this.table.set(frame.uid, {
          uid: frame.uid,
          org: frame.org,
          ep: frame.ep,
          state: frame.state,
          partySize: 1,
        })
        break
      }
      case 'cmd':
        // Acknowledged by doing nothing. VOL/PLAY/PING have no audible effect
        // in a simulator, and SYNC is already satisfied.
        break
      default:
        break
    }
  }

  private commitTable(version: number): void {
    this.tableVersion = Math.max(this.tableVersion, version)
    this.tableCommittedAt = Date.now()
    this.emitStatus()
  }

  private nextSeq(stationNo: number): number {
    const next = (this.seqByStation.get(stationNo) ?? 0) + 1
    this.seqByStation.set(stationNo, next)
    return next
  }

  private log(dir: 'in' | 'out', line: string): void {
    this.frameLog.push({ dir, line, at: Date.now() })
    if (this.frameLog.length > FRAME_LOG_CAP) this.frameLog.splice(0, this.frameLog.length - FRAME_LOG_CAP)
  }

  /** Put a frame on the wire, through the same encoder a real hub's firmware mirrors. */
  private emit(frame: HubInboundFrame): string | null {
    let line: string
    try {
      line = encodeLine(frame)
    } catch (err) {
      console.error('[hubSim] refused to encode', err)
      return null
    }
    this.log('in', line.slice(0, -1))
    this.push(line)
    return line
  }

  /** The one place bytes enter the console. Everything else routes through here. */
  private push(text: string): void {
    if (this.down) return
    if (!this.handlers) {
      console.warn('[hubSim] nothing is listening — connect the hub first')
      return
    }
    this.handlers.onChunk(text)
  }

  private emitStatus(): void {
    this.emit({
      t: 'hub',
      fw: SIM_FW,
      tblver: this.tableVersion,
      stations: this.seqByStation.size,
      up: Math.floor((Date.now() - this.bootedAt) / 1000),
    })
  }

  // ── The driving surface ───────────────────────────────────────────────────

  /**
   * A guest holds a standard against a station's reader.
   *
   * Resolution happens HERE, in the station, off its cached table — which is the
   * whole point of the UID-only tag decision. A uid the station holds plays its
   * order and episode (`res: 'L'`). A uid it does not hold plays NOTHING: the
   * frame carries org 0, ep 0, `res: 'U'`, and a `query` follows asking the hub
   * who that was. No guess, no generic clip, no "please wait" — the ambience
   * loop simply continues, because a wrong story is worse than a pause.
   */
  tap(stationNo: number, uid: string): string | null {
    const tag = String(uid ?? '').toUpperCase()
    const seq = this.nextSeq(stationNo)

    // A reader can hand up bytes that are not a uid, and when it does we want
    // the console's parser to be the thing that says so. Push the line raw
    // rather than swallowing it at the encoder, so the rejection is real.
    if (normalizeWireUid(tag) === null) {
      console.warn(
        `[hubSim] "${tag}" is not a tag uid — it must be 8-20 hex characters. Sending it anyway so decodeLine refuses it. Try simUid(1).`,
      )
      this.raw(
        JSON.stringify({ t: 'tap', st: stationNo, uid: tag, seq, ts: Math.floor(Date.now() / 1000), org: 0, ep: 0, res: 'U' }),
      )
      return null
    }

    const row = this.table.get(tag)
    const line = this.emit({
      t: 'tap',
      st: stationNo,
      uid: tag,
      seq,
      ts: Math.floor(Date.now() / 1000),
      org: row ? row.org : 0,
      ep: row ? row.ep : 0,
      res: row ? 'L' : 'U',
    })
    if (line) this.lastTapLine.set(stationNo, line)
    // Emitted immediately rather than after a retry window, so a headless test
    // is deterministic. On real hardware the query only goes out if the ACK
    // landed and no RESOLVE followed.
    if (!row) {
      this.emit({ t: 'query', st: stationNo, uid: tag, seq })
    }
    return line
  }

  /** A tag on the booth pad at the gate — bind at one end of a walk, check out at the other. */
  booth(uid: string): string | null {
    const tag = String(uid ?? '').toUpperCase()
    if (normalizeWireUid(tag) === null) {
      console.warn(`[hubSim] "${tag}" is not a tag uid — 8-20 hex characters only. Try simUid(1).`)
      this.raw(JSON.stringify({ t: 'booth', uid: tag, ts: Math.floor(Date.now() / 1000) }))
      return null
    }
    return this.emit({ t: 'booth', uid: tag, ts: Math.floor(Date.now() / 1000) })
  }

  /**
   * Send the last tap from a station again, byte for byte — same seq, same
   * timestamp. This is a LoRa retry, and the L1 dedupe ring is what must make it
   * silent. If a replay produces a second leg, the ring is broken.
   */
  replay(stationNo: number, n = 1): number {
    const line = this.lastTapLine.get(stationNo)
    if (!line) {
      console.warn(`[hubSim] station ${stationNo} has no tap to replay`)
      return 0
    }
    let sent = 0
    for (let i = 0; i < Math.max(1, n); i++) {
      this.log('in', line.slice(0, -1))
      this.push(line)
      sent++
    }
    return sent
  }

  /**
   * A station reporting in. Everything defaults to healthy and current; override
   * to reach the conditions staff must be able to see BEFORE a group walks
   * twenty minutes to a dead plinth:
   *
   *   stale  → `{ tblver: <behind the park>, tblage: 900 }`
   *   fault  → `{ sd: 0 }` or `{ df: 0 }`
   *   silent → send nothing at all and let it age out
   */
  heartbeat(stationNo: number, opts: SimHeartbeatOptions = {}): string | null {
    const frame: HubHeartbeatFrame = {
      t: 'hb',
      st: stationNo,
      ups: opts.ups ?? Math.floor((Date.now() - this.bootedAt) / 1000),
      tblver: opts.tblver ?? this.tableVersion,
      tblage: opts.tblage ?? Math.floor((Date.now() - this.tableCommittedAt) / 1000),
      qd: opts.qd ?? 0,
      sd: opts.sd ?? 1,
      df: opts.df ?? 1,
      err: opts.err ?? 0,
      rssi: opts.rssi ?? -92,
      vol: opts.vol ?? 22,
      fw: opts.fw ?? SIM_FW,
    }
    return this.emit(frame)
  }

  /** Pull the cable. The link should go to `reconnecting`, not `error`, and keep its write queue. */
  drop(): void {
    if (this.down) return
    this.down = true
    const handlers = this.handlers
    this.handlers = null
    handlers?.onClosed(false, 'simulated link loss')
  }

  /** Plug it back in and reconnect immediately, rather than waiting out the backoff. */
  restore(): void {
    this.down = false
    void hubLink.retryNow()
  }

  /**
   * Inject a line verbatim. This is the malformed-input harness: an embedded
   * pipe, a smuggled newline, a frame short a field, a station number of 99, a
   * hundred kilobytes with no newline at all. Every one of them meets the same
   * `decodeLine` a real hub's bytes meet, and each should be dropped with the
   * malformed counter going up and nothing reaching Firestore.
   *
   * Pass `{ newline: false }` to send a fragment and leave the line unterminated
   * — that is how the buffer-growth defence is tested.
   */
  raw(line: string, opts: { newline?: boolean } = {}): void {
    const text = String(line ?? '')
    const withNewline = opts.newline === false ? text : text.endsWith('\n') ? text : `${text}\n`
    this.log('in', text.length > 200 ? `${text.slice(0, 200)}… (${text.length} chars)` : text)
    this.push(withNewline)
  }

  /** Everything that crossed the wire, newest last. Capped, and copied so callers cannot edit history. */
  frames(): SimFrameRecord[] {
    return this.frameLog.map((f) => ({ ...f }))
  }

  /** The uids this park's stations can resolve — i.e. what is tappable right now. */
  uids(): string[] {
    return [...this.table.keys()].sort()
  }

  /** The cached flag table, as a station holds it. */
  rows(): HubTableRow[] {
    return [...this.table.values()].map((r) => ({ ...r }))
  }

  /** The table version the simulated park has COMMITTED. */
  version(): number {
    return this.tableVersion
  }

  /** Link state, counters and the malformed tally — the same numbers the status chip shows. */
  status(): hubLink.HubSnapshot & { simDown: boolean; tableVersion: number; knownUids: number } {
    return {
      ...hubLink.getSnapshot(),
      simDown: this.down,
      tableVersion: this.tableVersion,
      knownUids: this.table.size,
    }
  }
}

// ── Installation ────────────────────────────────────────────────────────────

/** The surface `window.__questlandHub` exposes. */
export interface HubSimApi {
  tap(stationNo: number, uid: string): string | null
  booth(uid: string): string | null
  replay(stationNo: number, n?: number): number
  heartbeat(stationNo: number, opts?: SimHeartbeatOptions): string | null
  drop(): void
  restore(): void
  raw(line: string, opts?: { newline?: boolean }): void
  frames(): SimFrameRecord[]
  uids(): string[]
  rows(): HubTableRow[]
  version(): number
  status(): ReturnType<SimulatedTransport['status']>
}

declare global {
  interface Window {
    __questlandHub?: HubSimApi
  }
}

let installed: SimulatedTransport | null = null

/**
 * Build the simulated hub and hang it on `window.__questlandHub`. Idempotent —
 * a second call returns the same transport, so a StrictMode remount cannot end
 * up with two parks.
 *
 * The caller connects it: `hubLink.connect(installHubSim())`. Keeping that step
 * outside means the simulator is only ever reached through the same
 * `HubTransport` seam a real serial port will use.
 */
export function installHubSim(): SimulatedTransport {
  if (installed) return installed
  const sim = new SimulatedTransport()
  installed = sim
  if (typeof window !== 'undefined') {
    window.__questlandHub = {
      tap: (stationNo, uid) => sim.tap(stationNo, uid),
      booth: (uid) => sim.booth(uid),
      replay: (stationNo, n) => sim.replay(stationNo, n),
      heartbeat: (stationNo, opts) => sim.heartbeat(stationNo, opts),
      drop: () => sim.drop(),
      restore: () => sim.restore(),
      raw: (line, opts) => sim.raw(line, opts),
      frames: () => sim.frames(),
      uids: () => sim.uids(),
      rows: () => sim.rows(),
      version: () => sim.version(),
      status: () => sim.status(),
    }
  }
  return sim
}

/** The installed simulator, if there is one. Null on a console driven by a real hub. */
export function hubSim(): SimulatedTransport | null {
  return installed
}

/**
 * `?hub=sim` on the console URL. The console shows a permanent SIMULATED HUB
 * badge when this is true — a presenter's park and a real one must never be
 * mistakable for one another.
 */
export function isSimRequested(search?: string): boolean {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '')
  try {
    return new URLSearchParams(query).get('hub') === 'sim'
  } catch {
    return false
  }
}
