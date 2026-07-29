// The hub's tongue — the whole codec, and nothing else.
//
// A station in the woods talks to the hub over LoRa; the hub is on the console
// PC's USB port and relays the park as newline-delimited JSON. This file turns
// a typed frame into one of those lines (`encodeLine`) and a line back into a
// typed frame, or refuses it (`decodeLine`). Pure: no I/O, no imports from
// services, no knowledge of who is listening. The only state it keeps is a
// tally of what it refused, because a parser that silently swallows bad input
// is a parser nobody can debug.
//
// ── decodeLine is a SECURITY BOUNDARY ──────────────────────────────────────
//
// Everything arriving here is attacker-supplied bytes: an RFID uid is whatever
// was held against a reader, and a station is a $66 board in a public wood that
// can be opened with a screwdriver. So this parser VALIDATES AND REJECTS. It
// never repairs, never coerces, and never throws — a malformed frame is a
// first-class outcome (`{ ok: false, reason }`), counted and shown on the hub
// status chip, exactly like an unknown tag is a first-class outcome that leaves
// a station silent.
//
// Five rules, in this order, for every frame:
//   1. a MAX LINE LENGTH — a device that never sends a newline otherwise grows
//      the assembler's buffer until the tab runs out of memory;
//   2. a printable-ASCII charset gate on the whole line — the wire invariant is
//      that nothing on it is free text, so a control character or a smuggled
//      newline is by definition not ours;
//   3. an EXACT field set per frame type — not "at least these"; an unexpected
//      key is a refusal, which is also what closes `__proto__` and friends;
//   4. a per-field charset allowlist and length bound — uid is
//      /^[0-9A-F]{8,20}$/ after uppercasing and nothing else, ever;
//   5. numeric RANGE checks BEFORE any value is used as an index — `st` indexes
//      the park's places, so it is 1..23 or the frame is dropped.
//
// CRYPTO DOES NOT REPLACE ANY OF THIS. Slice 7 adds a truncated HMAC to the
// LoRa frames, which authenticates WHO sent a frame; it says nothing about
// whether the content is well-formed, and a station that is buggy or physically
// opened holds the park PSK. Authentication and validation are orthogonal — do
// not let the arrival of the MAC justify a permissive parser here.

import { QUEST_START, STATION_COORDS, VILLAGE_PLACE } from '../content/stationMap'
import type {
  HubBoothFrame,
  HubCmdFrame,
  HubCommand,
  HubFrame,
  HubFrameType,
  HubHeartbeatFrame,
  HubLogFrame,
  HubQueryFrame,
  HubResolveFrame,
  HubRowFrame,
  HubStatusFrame,
  HubTableFrame,
  HubTableRow,
  HubTapFrame,
  HubTapResult,
} from '../types'

// ── Bounds ──────────────────────────────────────────────────────────────────

/**
 * Longest line we will look at, in characters. A real frame is well under a
 * kilobyte; the headroom is for a full table chunk. The line assembler in
 * hubLink uses the same constant to cap its pending buffer, so a device that
 * never sends `\n` is dropped rather than accumulated.
 */
export const MAX_LINE = 16384

/**
 * Rows per `table` frame. Chosen so an encoded chunk is ~4 kB — comfortably
 * inside MAX_LINE, with room for the longest legal uid in every row.
 */
export const TABLE_CHUNK_ROWS = 64

/** Uid allowlist. Applied AFTER uppercasing, and it is the only thing that makes a uid a uid. */
export const UID_RE = /^[0-9A-F]{8,20}$/

/** The whole line must be printable ASCII. No control characters, no smuggled newline, no unicode. */
const ASCII_RE = /^[\x20-\x7E]*$/

const RES_VALUES: readonly HubTapResult[] = ['L', 'Q', 'U']
const CMD_VALUES: readonly HubCommand[] = ['VOL', 'QVOL', 'PLAY', 'SYNC', 'PING']

const U8 = 255
const U16 = 65535
const U32 = 4294967295
/** Table versions are `max(flag.tableAt)` — a millisecond epoch, so they need more than 32 bits. */
const VER_MAX = Number.MAX_SAFE_INTEGER

// ── Places ──────────────────────────────────────────────────────────────────
//
// Station numbers are the LoRa addresses: 0 is the hub, 1..21 are the canon
// stations in `STATION_COORDS` order, 22 is the chief's house, 23 is the gate,
// 255 is broadcast (radio-only — it never reaches this wire). Built from the
// real coordinate table rather than hard-coded, so the range check and the
// thing it guards can never drift apart.

const PLACE_BY_STATION_NO: readonly string[] = (() => {
  const ids: string[] = ['']
  for (let n = 1; n <= 99; n++) {
    const id = `st-${String(n).padStart(2, '0')}`
    if (!Object.prototype.hasOwnProperty.call(STATION_COORDS, id)) break
    ids.push(id)
  }
  ids.push(QUEST_START.id)
  ids.push(VILLAGE_PLACE.id)
  return Object.freeze(ids)
})()

export const STATION_NO_MIN = 1
/** 23 — the last addressable place. A frame claiming anything else is dropped. */
export const STATION_NO_MAX = PLACE_BY_STATION_NO.length - 1
/** 22 — the chief's house. */
export const CHIEF_STATION_NO = PLACE_BY_STATION_NO.length - 2
/** 23 — the gate; a guest checked in there is in the Village of Queston. */
export const GATE_STATION_NO = STATION_NO_MAX

/**
 * Station number to the place id the rest of the app knows it by. Returns null
 * rather than throwing or returning undefined-shaped junk: a caller that skips
 * the range check still cannot index anything with a bad number.
 */
export function placeIdForStation(stationNo: number): string | null {
  if (!Number.isInteger(stationNo)) return null
  if (stationNo < STATION_NO_MIN || stationNo > STATION_NO_MAX) return null
  return PLACE_BY_STATION_NO[stationNo] || null
}

/** The inverse — 'st-08' → 8, 'st-chief' → 22, 'village' → 23. Null for anywhere else. */
export function stationNoForPlace(placeId: string): number | null {
  if (typeof placeId !== 'string') return null
  const n = PLACE_BY_STATION_NO.indexOf(placeId)
  return n >= STATION_NO_MIN ? n : null
}

/** Every addressable place, in station-number order. For pickers and health maps. */
export function allStationNos(): number[] {
  const out: number[] = []
  for (let n = STATION_NO_MIN; n <= STATION_NO_MAX; n++) out.push(n)
  return out
}

/**
 * Reject, do not repair. A uid we cannot vouch for is an unknown tag, and an
 * unknown tag is already a first-class outcome that leaves the station silent.
 *
 * (`flagService` owns the app-side `normalizeUid`; this is the wire's copy of
 * the same rule, kept here so the codec has no service imports.)
 */
export function normalizeWireUid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length > 20) return null
  const up = raw.trim().toUpperCase()
  return UID_RE.test(up) ? up : null
}

// ── Decode result ───────────────────────────────────────────────────────────

export type HubDecodeReason =
  | 'empty'
  | 'overlong'
  | 'non-ascii'
  | 'bad-json'
  | 'not-an-object'
  | 'unknown-type'
  | 'field-count'
  | 'bad-field'
  | 'bad-uid'
  | 'range'

export type HubDecodeResult =
  | { ok: true; frame: HubFrame }
  | { ok: false; reason: HubDecodeReason; field?: string; detail?: string }

export interface HubDecodeStats {
  /** Lines fed to decodeLine. */
  total: number
  /** Lines that produced a frame. */
  ok: number
  /** Lines refused. This is the number the hub status chip shows. */
  malformed: number
  byReason: Record<HubDecodeReason, number>
  /** The last refusal, for the console's tooltip. Truncated — never render raw wire text at length. */
  last?: { reason: HubDecodeReason; field?: string; at: number }
}

function emptyByReason(): Record<HubDecodeReason, number> {
  return {
    empty: 0,
    overlong: 0,
    'non-ascii': 0,
    'bad-json': 0,
    'not-an-object': 0,
    'unknown-type': 0,
    'field-count': 0,
    'bad-field': 0,
    'bad-uid': 0,
    range: 0,
  }
}

let stats: HubDecodeStats = { total: 0, ok: 0, malformed: 0, byReason: emptyByReason() }

/** A snapshot of what the codec has seen. Copied, so a caller cannot mutate the tally. */
export function decodeStats(): HubDecodeStats {
  return { ...stats, byReason: { ...stats.byReason }, last: stats.last ? { ...stats.last } : undefined }
}

/** How many lines were refused. The one number the UI shows. */
export function malformedCount(): number {
  return stats.malformed
}

export function resetDecodeStats(): void {
  stats = { total: 0, ok: 0, malformed: 0, byReason: emptyByReason() }
}

/**
 * Register a refusal the line assembler made before a line ever reached
 * `decodeLine` — the overlong-buffer case, where the whole point is that we
 * DISCARD the bytes rather than hold them long enough to parse. One tally, so
 * the number on the hub status chip means "frames the hub sent that we refused"
 * whichever layer did the refusing.
 */
export function noteRefusal(reason: HubDecodeReason): void {
  stats.total++
  stats.malformed++
  stats.byReason[reason]++
  stats.last = { reason, at: Date.now() }
}

function fail(reason: HubDecodeReason, field?: string, detail?: string): HubDecodeResult {
  stats.malformed++
  stats.byReason[reason]++
  stats.last = { reason, field, at: Date.now() }
  return { ok: false, reason, field, detail }
}

function pass(frame: HubFrame): HubDecodeResult {
  stats.ok++
  return { ok: true, frame }
}

// ── Field readers ───────────────────────────────────────────────────────────
//
// Each returns null on refusal. Strict on type: a numeric-looking STRING is not
// a number here. The wire is ours on both ends, so there is nothing to be
// lenient for, and leniency is how a parser grows a second interpretation.

type Rec = Record<string, unknown>

function intField(src: Rec, key: string, lo: number, hi: number): number | null {
  const v = src[key]
  if (typeof v !== 'number' || !Number.isInteger(v)) return null
  if (v < lo || v > hi) return null
  return v
}

function enumField<T extends string>(src: Rec, key: string, allowed: readonly T[]): T | null {
  const v = src[key]
  if (typeof v !== 'string') return null
  return (allowed as readonly string[]).includes(v) ? (v as T) : null
}

function uidField(src: Rec, key: string): string | null {
  return normalizeWireUid(src[key])
}

/**
 * The exact key set for every frame type. Not a minimum — a frame with a key
 * that is not on its list is refused, which is what makes `field-count` a real
 * check and what keeps `__proto__` (an own property after JSON.parse) out.
 */
const FIELDS: Record<HubFrameType, readonly string[]> = {
  tap: ['t', 'st', 'uid', 'seq', 'ts', 'org', 'ep', 'res'],
  booth: ['t', 'uid', 'ts'],
  hb: ['t', 'st', 'ups', 'tblver', 'tblage', 'qd', 'sd', 'df', 'err', 'rssi', 'vol', 'fw'],
  query: ['t', 'st', 'uid', 'seq'],
  log: ['t', 'st', 'lvl', 'code', 'a1', 'a2'],
  hub: ['t', 'fw', 'tblver', 'stations', 'up'],
  table: ['t', 'ver', 'idx', 'of', 'rows'],
  row: ['t', 'ver', 'row'],
  resolve: ['t', 'st', 'uid', 'org', 'ep', 'state', 'ttl'],
  cmd: ['t', 'st', 'cmd', 'arg'],
}

const ROW_FIELDS: readonly string[] = ['uid', 'org', 'ep', 'state', 'partySize']

function keysMatch(src: Rec, expected: readonly string[]): boolean {
  const keys = Object.keys(src)
  if (keys.length !== expected.length) return false
  for (const k of expected) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) return false
  }
  return true
}

/** One flag-table row, validated to the same standard as a whole frame. */
function decodeRow(raw: unknown): HubTableRow | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const src = raw as Rec
  if (!keysMatch(src, ROW_FIELDS)) return null
  const uid = uidField(src, 'uid')
  if (uid === null) return null
  const org = intField(src, 'org', 0, 4)
  const ep = intField(src, 'ep', 0, 10)
  const state = intField(src, 'state', 0, 2)
  const partySize = intField(src, 'partySize', 0, 99)
  if (org === null || ep === null || state === null || partySize === null) return null
  return { uid, org, ep, state, partySize }
}

// ── decodeLine ──────────────────────────────────────────────────────────────

/**
 * One line in, one result out. Never throws — every failure path returns
 * `{ ok: false, reason }` and increments the malformed tally.
 *
 * The line must NOT contain its own newline: hubLink's assembler splits on `\n`
 * before calling here, and a literal control character in whatever it does hand
 * over is refused by the ASCII gate below rather than being treated as JSON
 * whitespace.
 */
export function decodeLine(line: string): HubDecodeResult {
  stats.total++

  // 1. Length, before anything else touches it.
  if (typeof line !== 'string') return fail('bad-json', undefined, 'not a string')
  if (line.length > MAX_LINE) return fail('overlong', undefined, `${line.length} chars`)

  // A trailing CR is the only whitespace we forgive — CRLF devices are real.
  const text = line.endsWith('\r') ? line.slice(0, -1) : line
  if (text.trim() === '') return fail('empty')

  // 2. Charset gate on the WHOLE line. Nothing on this wire is free text, so a
  //    control character, an embedded newline or any non-ASCII byte is not ours.
  if (!ASCII_RE.test(text)) return fail('non-ascii')

  // 3. Structure.
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail('bad-json')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('not-an-object')
  }
  const src = parsed as Rec

  const type = src.t
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(FIELDS, type)) {
    return fail('unknown-type')
  }
  const t = type as HubFrameType

  // 4. Exact field set. Missing, extra or duplicated-by-shape — all refused.
  if (!keysMatch(src, FIELDS[t])) return fail('field-count', t)

  // 5. Per-field charset, length and RANGE. `st` is range-checked here, before
  //    any caller can use it to index the park's places.
  switch (t) {
    case 'tap': {
      const st = intField(src, 'st', STATION_NO_MIN, STATION_NO_MAX)
      if (st === null) return fail('range', 'st')
      const uid = uidField(src, 'uid')
      if (uid === null) return fail('bad-uid', 'uid')
      const seq = intField(src, 'seq', 0, U32)
      if (seq === null) return fail('range', 'seq')
      const ts = intField(src, 'ts', 0, U32)
      if (ts === null) return fail('range', 'ts')
      const org = intField(src, 'org', 0, 4)
      if (org === null) return fail('range', 'org')
      const ep = intField(src, 'ep', 0, 10)
      if (ep === null) return fail('range', 'ep')
      const res = enumField(src, 'res', RES_VALUES)
      if (res === null) return fail('bad-field', 'res')
      const frame: HubTapFrame = { t: 'tap', st, uid, seq, ts, org, ep, res }
      return pass(frame)
    }

    case 'booth': {
      const uid = uidField(src, 'uid')
      if (uid === null) return fail('bad-uid', 'uid')
      const ts = intField(src, 'ts', 0, U32)
      if (ts === null) return fail('range', 'ts')
      const frame: HubBoothFrame = { t: 'booth', uid, ts }
      return pass(frame)
    }

    case 'hb': {
      const st = intField(src, 'st', STATION_NO_MIN, STATION_NO_MAX)
      if (st === null) return fail('range', 'st')
      const ups = intField(src, 'ups', 0, U32)
      if (ups === null) return fail('range', 'ups')
      const tblver = intField(src, 'tblver', 0, VER_MAX)
      if (tblver === null) return fail('range', 'tblver')
      const tblage = intField(src, 'tblage', 0, U32)
      if (tblage === null) return fail('range', 'tblage')
      const qd = intField(src, 'qd', 0, U16)
      if (qd === null) return fail('range', 'qd')
      const sd = intField(src, 'sd', 0, 1)
      if (sd === null) return fail('range', 'sd')
      const df = intField(src, 'df', 0, 1)
      if (df === null) return fail('range', 'df')
      const err = intField(src, 'err', 0, U16)
      if (err === null) return fail('range', 'err')
      const rssi = intField(src, 'rssi', -200, 20)
      if (rssi === null) return fail('range', 'rssi')
      const vol = intField(src, 'vol', 0, 30)
      if (vol === null) return fail('range', 'vol')
      const fw = intField(src, 'fw', 0, U16)
      if (fw === null) return fail('range', 'fw')
      const frame: HubHeartbeatFrame = {
        t: 'hb',
        st,
        ups,
        tblver,
        tblage,
        qd,
        sd: sd as 0 | 1,
        df: df as 0 | 1,
        err,
        rssi,
        vol,
        fw,
      }
      return pass(frame)
    }

    case 'query': {
      const st = intField(src, 'st', STATION_NO_MIN, STATION_NO_MAX)
      if (st === null) return fail('range', 'st')
      const uid = uidField(src, 'uid')
      if (uid === null) return fail('bad-uid', 'uid')
      const seq = intField(src, 'seq', 0, U32)
      if (seq === null) return fail('range', 'seq')
      const frame: HubQueryFrame = { t: 'query', st, uid, seq }
      return pass(frame)
    }

    case 'log': {
      const st = intField(src, 'st', STATION_NO_MIN, STATION_NO_MAX)
      if (st === null) return fail('range', 'st')
      const lvl = intField(src, 'lvl', 0, 7)
      if (lvl === null) return fail('range', 'lvl')
      const code = intField(src, 'code', 0, U16)
      if (code === null) return fail('range', 'code')
      const a1 = intField(src, 'a1', -U32, U32)
      if (a1 === null) return fail('range', 'a1')
      const a2 = intField(src, 'a2', -U32, U32)
      if (a2 === null) return fail('range', 'a2')
      const frame: HubLogFrame = { t: 'log', st, lvl, code, a1, a2 }
      return pass(frame)
    }

    case 'hub': {
      const fw = intField(src, 'fw', 0, U16)
      if (fw === null) return fail('range', 'fw')
      const tblver = intField(src, 'tblver', 0, VER_MAX)
      if (tblver === null) return fail('range', 'tblver')
      const stations = intField(src, 'stations', 0, U8)
      if (stations === null) return fail('range', 'stations')
      const up = intField(src, 'up', 0, U32)
      if (up === null) return fail('range', 'up')
      const frame: HubStatusFrame = { t: 'hub', fw, tblver, stations, up }
      return pass(frame)
    }

    case 'table': {
      const ver = intField(src, 'ver', 0, VER_MAX)
      if (ver === null) return fail('range', 'ver')
      const of = intField(src, 'of', 1, U8)
      if (of === null) return fail('range', 'of')
      const idx = intField(src, 'idx', 0, of - 1)
      if (idx === null) return fail('range', 'idx')
      const rawRows = src.rows
      if (!Array.isArray(rawRows) || rawRows.length > TABLE_CHUNK_ROWS) return fail('range', 'rows')
      const rows: HubTableRow[] = []
      for (const raw of rawRows) {
        const row = decodeRow(raw)
        if (row === null) return fail('bad-field', 'rows')
        rows.push(row)
      }
      const frame: HubTableFrame = { t: 'table', ver, idx, of, rows }
      return pass(frame)
    }

    case 'row': {
      const ver = intField(src, 'ver', 0, VER_MAX)
      if (ver === null) return fail('range', 'ver')
      const row = decodeRow(src.row)
      if (row === null) return fail('bad-field', 'row')
      const frame: HubRowFrame = { t: 'row', ver, row }
      return pass(frame)
    }

    case 'resolve': {
      const st = intField(src, 'st', STATION_NO_MIN, STATION_NO_MAX)
      if (st === null) return fail('range', 'st')
      const uid = uidField(src, 'uid')
      if (uid === null) return fail('bad-uid', 'uid')
      const org = intField(src, 'org', 0, 4)
      if (org === null) return fail('range', 'org')
      const ep = intField(src, 'ep', 0, 10)
      if (ep === null) return fail('range', 'ep')
      const state = intField(src, 'state', 0, 2)
      if (state === null) return fail('range', 'state')
      const ttl = intField(src, 'ttl', 0, 86400)
      if (ttl === null) return fail('range', 'ttl')
      const frame: HubResolveFrame = { t: 'resolve', st, uid, org, ep, state, ttl }
      return pass(frame)
    }

    case 'cmd': {
      const st = intField(src, 'st', STATION_NO_MIN, STATION_NO_MAX)
      if (st === null) return fail('range', 'st')
      const cmd = enumField(src, 'cmd', CMD_VALUES)
      if (cmd === null) return fail('bad-field', 'cmd')
      const arg = intField(src, 'arg', 0, U16)
      if (arg === null) return fail('range', 'arg')
      const frame: HubCmdFrame = { t: 'cmd', st, cmd, arg }
      return pass(frame)
    }
  }
}

// ── encodeLine ──────────────────────────────────────────────────────────────

/** A frame we refused to serialise. A programming error on our side, not wire input. */
export class HubEncodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HubEncodeError'
  }
}

function encodeRow(row: HubTableRow): HubTableRow {
  const clean = decodeRow(row)
  if (clean === null) throw new HubEncodeError('invalid flag-table row')
  return clean
}

/**
 * A typed frame to the exact bytes that cross the wire, newline included.
 *
 * Keys are written in the canonical order declared in `types.ts`, so a
 * simulated hub and a real one produce byte-identical lines — which is the
 * whole reason `hubSim` is worth trusting.
 *
 * Unlike `decodeLine` this DOES throw: its input is ours, so a bad frame is a
 * bug to surface, not hostile input to absorb. `hubLink` catches it and counts
 * the write as dropped rather than letting it reach the port half-formed.
 */
export function encodeLine(frame: HubFrame): string {
  let out: unknown
  switch (frame.t) {
    case 'tap':
      out = {
        t: 'tap',
        st: frame.st,
        uid: frame.uid,
        seq: frame.seq,
        ts: frame.ts,
        org: frame.org,
        ep: frame.ep,
        res: frame.res,
      }
      break
    case 'booth':
      out = { t: 'booth', uid: frame.uid, ts: frame.ts }
      break
    case 'hb':
      out = {
        t: 'hb',
        st: frame.st,
        ups: frame.ups,
        tblver: frame.tblver,
        tblage: frame.tblage,
        qd: frame.qd,
        sd: frame.sd,
        df: frame.df,
        err: frame.err,
        rssi: frame.rssi,
        vol: frame.vol,
        fw: frame.fw,
      }
      break
    case 'query':
      out = { t: 'query', st: frame.st, uid: frame.uid, seq: frame.seq }
      break
    case 'log':
      out = { t: 'log', st: frame.st, lvl: frame.lvl, code: frame.code, a1: frame.a1, a2: frame.a2 }
      break
    case 'hub':
      out = { t: 'hub', fw: frame.fw, tblver: frame.tblver, stations: frame.stations, up: frame.up }
      break
    case 'table':
      out = { t: 'table', ver: frame.ver, idx: frame.idx, of: frame.of, rows: frame.rows.map(encodeRow) }
      break
    case 'row':
      out = { t: 'row', ver: frame.ver, row: encodeRow(frame.row) }
      break
    case 'resolve':
      out = {
        t: 'resolve',
        st: frame.st,
        uid: frame.uid,
        org: frame.org,
        ep: frame.ep,
        state: frame.state,
        ttl: frame.ttl,
      }
      break
    case 'cmd':
      out = { t: 'cmd', st: frame.st, cmd: frame.cmd, arg: frame.arg }
      break
    default:
      throw new HubEncodeError('unknown frame type')
  }

  const line = JSON.stringify(out)
  // The bytes we are about to put on the wire must satisfy the same gates we
  // would apply to bytes coming off it. Cheap, and it catches a bad uid or an
  // out-of-range station at the point the bug was written.
  if (line.length + 1 > MAX_LINE) throw new HubEncodeError('frame exceeds MAX_LINE')
  if (!ASCII_RE.test(line)) throw new HubEncodeError('frame contains non-ASCII')
  return `${line}\n`
}

/**
 * Encode-then-decode, used by tests and by the simulator's self-check. Returns
 * the frame as it would arrive at the far end, or null if it would be refused.
 */
export function roundTrip(frame: HubFrame): HubFrame | null {
  let line: string
  try {
    line = encodeLine(frame)
  } catch {
    return null
  }
  const res = decodeLine(line.slice(0, -1))
  return res.ok ? res.frame : null
}
