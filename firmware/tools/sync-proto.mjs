#!/usr/bin/env node
// sync-proto.mjs — the drift guard between the firmware and the console codec.
//
// Run it with:  node firmware/tools/sync-proto.mjs
//               node firmware/tools/sync-proto.mjs --verbose
//
// It parses firmware/ql_proto.h and questland/src/services/hubProtocol.ts and
// asserts they still describe the same wire: the same NDJSON frame types, the
// same field names in the same order, and the same numeric bounds on every one
// of them. It exits non-zero on any disagreement, with a diff a person can act
// on. IT ONLY EVER READS. Nothing under questland/ is written, ever.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The console's codec is the authority on what is legal on the USB wire, and
// the firmware carries its own copy of every bound because a $66 board cannot
// import TypeScript. Two copies of one rule is a thing that drifts, and this
// particular drift is close to undetectable in the field:
//
//   decodeLine does not complain loudly. It refuses the frame, increments
//   `range`, and returns. On a plinth that presents as "the audio just stopped
//   working at station 14" with nothing in any log tying it to the header edit
//   made six months earlier, and the person debugging it is standing in a wood
//   with a laptop.
//
// So the failure output below is written for that person, not for CI: every
// mismatch says which file said what, and what breaks in the park if it is left
// alone. If you are tempted to make this guard quieter, make the firmware agree
// instead — when this tool and hubProtocol.ts disagree, hubProtocol.ts is right
// by construction, because it is the code that actually refuses the frame.
//
// ── WHAT IT CANNOT CHECK ────────────────────────────────────────────────────
//
// It compares declarations, not behaviour. Two things are deliberately outside
// its reach and are called out in the report rather than silently skipped:
//
//   * `idx` is bounded by the sibling field `of` on the TS side and by a
//     compile-time chunk ceiling on the firmware side, with a separate
//     `idx >= of` refusal. That relationship is asserted structurally (the
//     refusal must exist) but the numbers are not comparable.
//   * the LoRa "Q1" half of ql_proto.h has no counterpart in hubProtocol.ts at
//     all — a station never emits JSON. PROTOCOL.md is the authority there.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIRMWARE = resolve(HERE, '..')
const ROOT = resolve(FIRMWARE, '..')
const APP = join(ROOT, 'questland', 'src')

const PROTO_H = join(FIRMWARE, 'ql_proto.h')
const CODEC_TS = join(APP, 'services', 'hubProtocol.ts')
const LINK_TS = join(APP, 'services', 'hubLink.ts')
const MAP_TS = join(APP, 'content', 'stationMap.ts')

const VERBOSE = process.argv.includes('--verbose')

const failures = []
const notes = []

function fail(what, firmwareSays, consoleSays, why) {
  failures.push({ what, firmwareSays, consoleSays, why })
}

function read(path) {
  if (!existsSync(path)) {
    process.stderr.write(`sync-proto: cannot find ${path}\n`)
    process.exit(2)
  }
  return readFileSync(path, 'utf8')
}

function rel(path) {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path
}

// ════════════════════════════════════════════════════════════════════════════
// Reading ql_proto.h
// ════════════════════════════════════════════════════════════════════════════

const protoSrc = read(PROTO_H)

/** `#define NAME <integer>`. Understands the suffixes and parenthesisation this header uses. */
function cInts(src) {
  const out = new Map()
  const re = /^#define\s+([A-Z][A-Z0-9_]*)\s+(.+?)\s*$/gm
  let m
  while ((m = re.exec(src)) !== null) {
    const raw = m[2].replace(/\/\*[\s\S]*$/, '').replace(/\/\/.*$/, '').trim()
    const lit = raw.replace(/^\((.*)\)$/, '$1').trim().replace(/(u|ul|ull|l|ll)$/i, '')
    if (/^-?0[xX][0-9a-fA-F]+$/.test(lit) || /^-?\d+$/.test(lit)) out.set(m[1], Number(lit))
  }
  return out
}

/** `#define NAME 'C'` — the single-letter enums that ride the wire. */
function cChars(src) {
  const out = new Map()
  const re = /^#define\s+([A-Z][A-Z0-9_]*)\s+'(.)'/gm
  let m
  while ((m = re.exec(src)) !== null) out.set(m[1], m[2])
  return out
}

/** `#define NAME "STRING"` — the command verbs. */
function cStrings(src) {
  const out = new Map()
  const re = /^#define\s+([A-Z][A-Z0-9_]*)\s+"([^"]*)"/gm
  let m
  while ((m = re.exec(src)) !== null) out.set(m[1], m[2])
  return out
}

const D = cInts(protoSrc)
const DC = cChars(protoSrc)
const DS = cStrings(protoSrc)

function macro(name) {
  if (!D.has(name)) {
    fail(
      `ql_proto.h no longer defines ${name}`,
      'absent (or no longer a plain integer)',
      'still expected by this guard',
      'The guard cannot compare a bound it cannot read. Either restore the macro or teach ' +
        'this tool the new name — do not delete the check.',
    )
    return null
  }
  return D.get(name)
}

/**
 * The hub's NDJSON emitters, in the order they write their keys.
 *
 * Derived from the emitter bodies rather than from a list, so a key added to
 * ql_ndjson_hb() shows up here without anybody remembering to update a table.
 * The frame's `t` value comes from its own first emitted pair, so the mapping
 * from C function to wire type is self-describing too.
 */
function firmwareEmitters(src) {
  const out = new Map()
  const fnRe = /static inline size_t (ql_ndjson_\w+)\s*\([^)]*\)\s*\{/g
  let m
  while ((m = fnRe.exec(src)) !== null) {
    const body = braceBody(src, fnRe.lastIndex - 1)
    if (body === null) continue
    const keys = []
    let type = null
    // Key names contain digits (`a1`, `a2`). An `[A-Za-z]+` class here silently
    // drops them from the emitted key list, and the guard then "finds" a drift
    // in the log frame that does not exist — a false alarm in a drift guard is
    // as expensive as a missed one, because the next person learns to ignore it.
    const kvRe = /ql_json_kv_[usi]\s*\(\s*&b\s*,\s*"([A-Za-z][A-Za-z0-9]*)"\s*,\s*(?:"([A-Za-z][A-Za-z0-9]*)"\s*,\s*)?/g
    let k
    while ((k = kvRe.exec(body)) !== null) {
      keys.push(k[1])
      if (k[1] === 't' && k[2]) type = k[2]
    }
    if (type) out.set(type, { fn: m[1], keys })
  }
  return out
}

/** Text between the brace at `openIdx` and its match. Depth counting only — no strings in these bodies. */
function braceBody(src, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(openIdx + 1, i)
    }
  }
  return null
}

/**
 * The console -> hub half: which keys each inbound type requires, and the
 * numeric bound the firmware applies to each key.
 *
 * The K_* bit names are mapped to wire keys by reading the parse chain, so the
 * `want = K_VER | K_IDX | ...` masks resolve to real field names without this
 * tool restating either list.
 */
function firmwareInbound(src) {
  const parse = /static inline bool ql_ndjson_parse\s*\([^)]*\)\s*\{/.exec(src)
  if (!parse) {
    fail('ql_proto.h has no ql_ndjson_parse()', 'absent', 'expected', 'The inbound half cannot be checked.')
    return { types: new Map(), bounds: new Map() }
  }
  const body = braceBody(src, parse.index + parse[0].length - 1) ?? ''

  // key name -> K_ bit name, and key name -> [lo, hi] where ql_j_int applies one.
  const bitOfKey = new Map()
  const bounds = new Map()
  const chainRe =
    /strcmp\(key,\s*"(\w+)"\)\s*==\s*0\)\s*\{\s*bit\s*=\s*(K_\w+);([\s\S]*?)(?=\}\s*else if \(strcmp\(key|\}\s*else\s*\{)/g
  let m
  while ((m = chainRe.exec(body)) !== null) {
    bitOfKey.set(m[1], m[2])
    const int = /ql_j_int\(&p,\s*([^,]+),\s*([^,]+),\s*&v\)/.exec(m[3])
    if (int) bounds.set(m[1], [cExpr(int[1]), cExpr(int[2])])
  }

  const types = new Map()
  const typeRe = /strcmp\(type,\s*"(\w+)"\)\s*==\s*0\)\s*\{[^}]*want\s*=\s*([^;]+);/g
  while ((m = typeRe.exec(body)) !== null) {
    const bits = m[2].split('|').map((s) => s.trim())
    const keys = []
    for (const bit of bits) {
      const key = [...bitOfKey.entries()].find(([, b]) => b === bit)?.[0]
      if (!key) {
        fail(
          `ql_proto.h: inbound type "${m[1]}" wants bit ${bit}, which no key sets`,
          bit,
          'no matching strcmp(key, ...) branch',
          'A bit nothing sets can never be seen, so the exact-key-set check can never pass and ' +
            'the hub silently ignores every frame of this type.',
        )
        continue
      }
      keys.push(key)
    }
    types.set(m[1], keys)
  }

  // `t` is consumed before the loop, so it is never in a `want` mask. It is
  // still a key on the wire, and the console counts it in the exact key set.
  for (const [type, keys] of types) types.set(type, ['t', ...keys])

  const rowFn = /static inline bool ql_j_row\s*\([^)]*\)\s*\{/.exec(src)
  const rowBody = rowFn ? braceBody(src, rowFn.index + rowFn[0].length - 1) ?? '' : ''
  const rowKeys = []
  const rowBounds = new Map()
  const rowRe = /strcmp\(key,\s*"(\w+)"\)\s*==\s*0\)\s*\{([\s\S]*?)(?=\}\s*else if \(strcmp|\}\s*else\s*\{)/g
  while ((m = rowRe.exec(rowBody)) !== null) {
    rowKeys.push(m[1])
    const int = /ql_j_int\(p,\s*([^,]+),\s*([^,]+),\s*&v\)/.exec(m[2])
    if (int) rowBounds.set(m[1], [cExpr(int[1]), cExpr(int[2])])
  }

  return { types, bounds, rowKeys, rowBounds, body }
}

/** A C bound expression: a macro name, an integer literal, or `MACRO - 1`. */
function cExpr(text) {
  const s = text.trim().replace(/^\((.*)\)$/, '$1').trim()
  const arith = /^([A-Z][A-Z0-9_]*)\s*-\s*(\d+)$/.exec(s)
  if (arith) {
    const base = D.get(arith[1])
    return base === undefined ? { unknown: s } : base - Number(arith[2])
  }
  if (/^-?\d+$/.test(s)) return Number(s)
  const lit = s.replace(/(u|ul|ull|l|ll)$/i, '')
  if (/^-?\d+$/.test(lit)) return Number(lit)
  if (D.has(s)) return D.get(s)
  return { unknown: s }
}

const emitters = firmwareEmitters(protoSrc)
const inbound = firmwareInbound(protoSrc)

// ════════════════════════════════════════════════════════════════════════════
// Reading hubProtocol.ts
// ════════════════════════════════════════════════════════════════════════════

const codecSrc = read(CODEC_TS)

/** `const NAME = <integer>` at module scope, plus the two Number.MAX_SAFE_INTEGER aliases. */
function tsInts(src) {
  const out = new Map()
  const re = /^(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[^=]+)?=\s*([^\n]+)$/gm
  let m
  while ((m = re.exec(src)) !== null) {
    const raw = m[2].replace(/\/\/.*$/, '').trim().replace(/,$/, '')
    if (/^-?\d[\d_]*$/.test(raw)) out.set(m[1], Number(raw.replace(/_/g, '')))
    else if (raw === 'Number.MAX_SAFE_INTEGER') out.set(m[1], Number.MAX_SAFE_INTEGER)
  }
  return out
}

const T = tsInts(codecSrc)

function tsConst(name) {
  if (!T.has(name)) {
    fail(
      `hubProtocol.ts no longer declares ${name} as a plain number`,
      'still expected by this guard',
      'absent or changed shape',
      'The guard cannot compare a bound it cannot read.',
    )
    return null
  }
  return T.get(name)
}

/** The FIELDS record: type -> ordered key list. The console\'s exact key set, per frame. */
function tsFields(src) {
  const m = /const FIELDS:\s*Record<HubFrameType,\s*readonly string\[\]>\s*=\s*\{([\s\S]*?)\n\}/.exec(src)
  if (!m) {
    fail(
      'hubProtocol.ts FIELDS could not be parsed',
      'n/a',
      'the declaration changed shape',
      'FIELDS is the exact key set the console enforces; without it nothing structural can be compared.',
    )
    return new Map()
  }
  const out = new Map()
  const re = /(\w+):\s*\[([^\]]*)\]/g
  let e
  while ((e = re.exec(m[1])) !== null) {
    out.set(e[1], [...e[2].matchAll(/'([^']+)'/g)].map((x) => x[1]))
  }
  return out
}

function tsRowFields(src) {
  const m = /const ROW_FIELDS:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/.exec(src)
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []
}

/**
 * Every numeric bound decodeLine applies, keyed `type.field`.
 *
 * Read out of the `case 'x': {` blocks so a bound the console tightens is
 * picked up here without a second list. Symbolic bounds (U8/U16/U32/VER_MAX,
 * the station-number constants) resolve through the module constants; `of - 1`
 * is left symbolic on purpose and reported as uncomparable.
 */
function tsBounds(src) {
  const out = new Map()
  const caseRe = /case '(\w+)':\s*\{/g
  let m
  const marks = []
  while ((m = caseRe.exec(src)) !== null) marks.push({ type: m[1], at: m.index })
  for (let i = 0; i < marks.length; i++) {
    const body = src.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : src.length)
    const intRe = /intField\(src,\s*'(\w+)',\s*([^,]+),\s*([^)]+)\)/g
    let f
    while ((f = intRe.exec(body)) !== null) {
      out.set(`${marks[i].type}.${f[1]}`, [tsExpr(f[2]), tsExpr(f[3])])
    }
  }
  const rowFn = /function decodeRow\([\s\S]*?\n\}/.exec(src)
  if (rowFn) {
    const intRe = /intField\(src,\s*'(\w+)',\s*([^,]+),\s*([^)]+)\)/g
    let f
    while ((f = intRe.exec(rowFn[0])) !== null) {
      out.set(`row.${f[1]}`, [tsExpr(f[2]), tsExpr(f[3])])
    }
  }
  return out
}

function tsExpr(text) {
  const s = text.trim()
  if (/^-?\d[\d_]*$/.test(s)) return Number(s.replace(/_/g, ''))
  if (/^-\s*[A-Za-z_]\w*$/.test(s)) {
    const v = T.get(s.replace(/^-\s*/, ''))
    return v === undefined ? { unknown: s } : -v
  }
  if (T.has(s)) return T.get(s)
  return { unknown: s }
}

// The addressable places, derived exactly the way hubProtocol.ts derives them:
// the canon station coordinates, then the chief's house, then the gate.
function tsPlaceCount() {
  const src = read(MAP_TS)
  const block = /export const STATION_COORDS[\s\S]*?\n\}/.exec(src)
  if (!block) return null
  const ids = new Set([...block[0].matchAll(/'(st-\d\d)':/g)].map((x) => x[1]))
  let n = 0
  while (ids.has(`st-${String(n + 1).padStart(2, '0')}`)) n++
  return n
}

const PLINTHS = tsPlaceCount()

/**
 * hubProtocol.ts computes its station-number bounds off the length of a table it
 * builds at module load, so they are not literals this tool can read. Resolve
 * them the same way it does — after asserting the derivation still has the shape
 * assumed here, because if that changes the numbers below are a guess.
 *
 * Doing this rather than skipping `st` matters more than any other bound in the
 * file: `st` is the one field used as an INDEX into the park's places.
 */
if (PLINTHS !== null) {
  const shapes = [
    [/export const STATION_NO_MIN = 1\b/, 'STATION_NO_MIN = 1', 1],
    [/export const STATION_NO_MAX = PLACE_BY_STATION_NO\.length - 1\b/, 'STATION_NO_MAX', PLINTHS + 2],
    [/export const CHIEF_STATION_NO = PLACE_BY_STATION_NO\.length - 2\b/, 'CHIEF_STATION_NO', PLINTHS + 1],
    [/export const GATE_STATION_NO = STATION_NO_MAX\b/, 'GATE_STATION_NO', PLINTHS + 2],
  ]
  for (const [re, name, value] of shapes) {
    if (!re.test(codecSrc)) {
      fail(
        `hubProtocol.ts ${name} derivation changed`,
        'this guard resolves the console bound by re-deriving it',
        'the declaration no longer has the shape assumed here',
        'Until this tool is taught the new derivation it cannot compare the station-number bounds, ' +
          'and `st` is the one field the console uses to index the park. Do not leave it uncompared.',
      )
    } else {
      T.set(name, value)
    }
  }
} else {
  // A MISS HERE IS A FAILURE, NOT A SKIP. It is the only unreadable input in
  // this file that could ever have been silent — macro(), tsConst(), tsFields()
  // and tsUidBounds() all push a failure — and it is the most expensive one to
  // lose: with PLINTHS null nothing calls T.set('STATION_NO_MAX', ...), so
  // every `st` bound resolves to {unknown} and the six frames carrying `st` are
  // demoted to notes that only print under --verbose. The run still says
  // "OK ... agree." and exits 0 while comparing 33 of 43 bounds instead of 39.
  //
  // WHAT BREAKS IF THIS ELSE GOES AWAY: a later, unrelated edit adds a 22nd
  // plinth without touching QL_ADDR_PLINTH_MAX, this guard is the only thing
  // that would have caught it, and it says nothing — the hub accepts an `st`
  // the firmware resolves to a different plinth, which is a guest hearing
  // another station's audio with nothing in any log to say why.
  fail(
    'stationMap.ts STATION_COORDS could not be read',
    'this guard derives the addressable places from that block',
    'the `export const STATION_COORDS ... \\n}` shape no longer matches',
    'Until this tool can count the plinths it cannot compare any station-number bound, and `st` ' +
      'is the one field the console uses to index the park. Do not leave it uncompared.',
  )
}

const FIELDS = tsFields(codecSrc)
const ROW_FIELDS = tsRowFields(codecSrc)
const BOUNDS = tsBounds(codecSrc)

function tsEnum(name) {
  const m = new RegExp(`const ${name}:\\s*readonly [\\w<>]+\\[\\]\\s*=\\s*\\[([^\\]]*)\\]`).exec(codecSrc)
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
}

// The uid allowlist. Only the length bounds are comparable; the charset is
// asserted by shape below.
function tsUidBounds() {
  const m = /export const UID_RE = \/\^\[0-9A-F\]\{(\d+),(\d+)\}\$\//.exec(codecSrc)
  if (!m) {
    fail(
      'hubProtocol.ts UID_RE is no longer /^[0-9A-F]{lo,hi}$/',
      'ql_uid_valid() is uppercase hex, QL_UID_MIN..QL_UID_MAX',
      'the regex changed shape',
      'The uid charset is the only thing standing between attacker-supplied tag bytes and the ' +
        "parser's field boundaries. If the console widened it, the firmware's hex-only encoder " +
        'is now the tighter of the two and legal uids will be refused at the hub.',
    )
    return null
  }
  return [Number(m[1]), Number(m[2])]
}

// ════════════════════════════════════════════════════════════════════════════
// The comparisons
// ════════════════════════════════════════════════════════════════════════════

// ── 1. Frame types ──────────────────────────────────────────────────────────

const firmwareTypes = new Set([...emitters.keys(), ...inbound.types.keys()])
const consoleTypes = new Set(FIELDS.keys())

for (const t of consoleTypes) {
  if (!firmwareTypes.has(t)) {
    fail(
      `NDJSON frame type "${t}"`,
      'not emitted and not parsed',
      'declared in FIELDS',
      t === 'booth'
        ? 'The hub is the only thing that can produce this frame; if it cannot, the booth pad is dead.'
        : 'A type the console understands and the firmware never produces or accepts is either dead ' +
          'weight in the codec or a feature the hub silently drops on the floor.',
    )
  }
}
for (const t of firmwareTypes) {
  if (!consoleTypes.has(t)) {
    fail(
      `NDJSON frame type "${t}"`,
      'emitted or parsed by ql_proto.h',
      'not in FIELDS — decodeLine refuses it as unknown-type',
      'Every line of this type is refused by the console and counted as malformed. The hub thinks ' +
        'it is talking; nothing is listening.',
    )
  }
}

// ── 2. Field names and order ────────────────────────────────────────────────
//
// Order matters for the EMITTED half and only for that half: decodeLine does
// not care what order the keys arrive in, but byte-identity between a real hub
// and hubSim does, and byte-identity is the whole reason the simulator is worth
// trusting. Inbound frames are compared as sets, because the firmware's parser
// is genuinely order-free.

for (const [type, emitter] of emitters) {
  const expected = FIELDS.get(type)
  if (!expected) continue
  if (emitter.keys.join(',') !== expected.join(',')) {
    fail(
      `${type} field list / order`,
      `${emitter.fn}() writes: ${emitter.keys.join(', ')}`,
      `FIELDS.${type} is: ${expected.join(', ')}`,
      'The console enforces an EXACT key set — a missing, extra or misspelled key refuses the whole ' +
        'line as field-count. Order does not affect decoding but does affect byte-identity with ' +
        'hubSim, which is the only reason a simulated hub proves anything about a real one.',
    )
  }
}

for (const [type, keys] of inbound.types) {
  const expected = FIELDS.get(type)
  if (!expected) continue
  const a = [...keys].sort().join(',')
  const b = [...expected].sort().join(',')
  if (a !== b) {
    fail(
      `${type} inbound key set`,
      `ql_ndjson_parse() requires: ${[...keys].sort().join(', ')}`,
      `the console sends: ${[...expected].sort().join(', ')}`,
      'The hub refuses any frame whose key set is not exactly what it wants, so a mismatch here means ' +
        'the console pushes and the hub silently discards. For "table" that is the flag table itself: ' +
        'every station in the park sits on ambience.',
    )
  }
}

const rowA = [...(inbound.rowKeys ?? [])].sort().join(',')
const rowB = [...ROW_FIELDS].sort().join(',')
if (rowA !== rowB) {
  fail(
    'flag-table row key set',
    `ql_j_row() accepts: ${rowA || '(nothing parsed)'}`,
    `ROW_FIELDS is: ${rowB}`,
    'A row is the binding between a pole and a story. A key set mismatch rejects the whole table ' +
      'chunk it appears in, and a station that never commits a table never plays anything.',
  )
}

// ── 3. Named constants ──────────────────────────────────────────────────────
//
// The one place this tool holds a table of its own: which C macro corresponds
// to which TS constant. It says nothing about their VALUES — both sides are read
// out of the files — so the table is a naming map, not a third copy of the wire.

const CONSTANTS = [
  ['line ceiling', 'QL_NDJSON_MAX', 'MAX_LINE',
    'A hub that emits a longer line has it refused as overlong; the console also caps its own ' +
    'assembler buffer with this number, so a device that never sends a newline is dropped rather ' +
    'than accumulated until the tab runs out of memory.'],
  ['rows per table chunk', 'QL_NDJSON_TABLE_CHUNK_ROWS', 'TABLE_CHUNK_ROWS',
    'The console splits the flag table into chunks of this size. A hub that accepts fewer refuses ' +
    'every chunk and never learns the table.'],
]

for (const [what, cName, tsName, why] of CONSTANTS) {
  const c = macro(cName)
  const t = tsConst(tsName)
  if (c === null || t === null) continue
  if (c !== t) fail(what, `${cName} = ${c}`, `${tsName} = ${t}`, why)
}

// uid length
const uid = tsUidBounds()
if (uid) {
  const lo = macro('QL_UID_MIN')
  const hi = macro('QL_UID_MAX')
  if (lo !== null && lo !== uid[0]) {
    fail('uid minimum length', `QL_UID_MIN = ${lo}`, `UID_RE = {${uid[0]},${uid[1]}}`,
      'A 4-byte MIFARE Classic uid is 8 hex characters. Raise the firmware minimum and those tags ' +
      'stop being readable; raise the console one and the hub reports taps the console throws away.')
  }
  if (hi !== null && hi !== uid[1]) {
    fail('uid maximum length', `QL_UID_MAX = ${hi}`, `UID_RE = {${uid[0]},${uid[1]}}`,
      'QL_UID_MAX also sizes every char[] on the firmware side and feeds the chunk-entry arithmetic ' +
      'that keeps a sealed Q1 line inside one SX1276 packet. Changing it moves both.')
  }
}

// Places / addressing. Derived on both sides, never typed in.
const plinths = PLINTHS
if (plinths !== null) {
  const cPlinth = macro('QL_ADDR_PLINTH_MAX')
  const cChief = macro('QL_ADDR_CHIEF')
  const cGate = macro('QL_ADDR_GATE')
  const cMax = macro('QL_ADDR_ST_MAX')
  const why =
    'Station numbers ARE LoRa addresses. hubProtocol.ts derives them from the canon STATION_COORDS ' +
    'order; if the firmware keeps a different count, a frame is either refused as out of range or — ' +
    'worse — accepted and resolved to the wrong plinth, which is a guest hearing another station\'s ' +
    'audio with nothing in any log to say why.'
  if (cPlinth !== null && cPlinth !== plinths) {
    fail('canon plinth count', `QL_ADDR_PLINTH_MAX = ${cPlinth}`, `STATION_COORDS holds ${plinths} stations`, why)
  }
  if (cChief !== null && cChief !== plinths + 1) {
    fail("chief's house address", `QL_ADDR_CHIEF = ${cChief}`, `derives to ${plinths + 1}`, why)
  }
  if (cGate !== null && cGate !== plinths + 2) {
    fail('gate address', `QL_ADDR_GATE = ${cGate}`, `derives to ${plinths + 2}`, why)
  }
  if (cMax !== null && cMax !== plinths + 2) {
    fail('highest addressable place', `QL_ADDR_ST_MAX = ${cMax}`, `derives to ${plinths + 2}`, why)
  }
}

// The console's own rate limit, which the hub must throttle its NVS drain below.
{
  const linkSrc = read(LINK_TS)
  const m = /const MAX_FRAMES_PER_SEC\s*=\s*(\d+)/.exec(linkSrc)
  const c = macro('QL_NDJSON_MAX_FRAMES_PER_SEC')
  if (!m) {
    fail('console frame rate limit', `QL_NDJSON_MAX_FRAMES_PER_SEC = ${c}`,
      'hubLink.ts no longer declares MAX_FRAMES_PER_SEC',
      'The hub throttles its backlog drain below this number. Without it, draining a large NVS tap ' +
      'queue at full tilt LOSES taps — the console drops the excess, it does not queue it.')
  } else if (c !== null && Number(m[1]) !== c) {
    fail('console frame rate limit', `QL_NDJSON_MAX_FRAMES_PER_SEC = ${c}`, `MAX_FRAMES_PER_SEC = ${m[1]}`,
      'The hub throttles its backlog drain below this number. Set it too high and a station that ' +
      'queued taps through a closed console tab loses them the moment the tab reopens — which is ' +
      'exactly the case the queue existed for.')
  }
}

// ── 4. Enumerations ─────────────────────────────────────────────────────────

{
  const res = tsEnum('RES_VALUES')
  const firmwareRes = ['QL_RES_LOCAL', 'QL_RES_QUERY', 'QL_RES_UNRESOLVED']
    .map((n) => DC.get(n))
    .filter((v) => v !== undefined)
  if (res && res.join('') !== firmwareRes.join('')) {
    fail('tap RES enum', `ql_proto.h: ${firmwareRes.join(' ')}`, `RES_VALUES: ${res.join(' ')}`,
      'RES is how the console knows whether a station resolved a pole from a committed table, from a ' +
      'cached hub answer, or not at all. "U" in particular is what puts a station on the unresolved ' +
      'list; lose it and a silent plinth looks healthy.')
  }
  const cmd = tsEnum('CMD_VALUES')
  const firmwareCmd = [...DS.entries()]
    .filter(([n]) => n.startsWith('QL_CMD_'))
    .map(([, v]) => v)
  if (cmd && [...cmd].sort().join(',') !== [...firmwareCmd].sort().join(',')) {
    fail('command verbs', `ql_proto.h: ${firmwareCmd.sort().join(' ')}`, `CMD_VALUES: ${[...cmd].sort().join(' ')}`,
      'A verb the console can send and the firmware does not know is refused at the station; a verb ' +
      'the firmware knows and the console cannot send is unreachable. v1 deliberately has no REBOOT ' +
      'and no queue-wipe — if one appeared here, that decision was reversed by accident.')
  }
}

// ── 5. Per-field numeric bounds ─────────────────────────────────────────────
//
// Where the firmware states a bound for the same key (its inbound parser, its
// row parser), the comparison is fully derived from both files. Where the field
// only ever travels hub -> console, the firmware's bound lives in a macro and
// the map below says WHICH macro — a naming map again, never a value.
//
// Anything in BOUNDS that neither path covers is reported as UNMAPPED and fails
// the run. That is the property that makes this guard survive: a new field added
// to hubProtocol.ts cannot quietly pass.

const FIELD_MACROS = {
  st: ['QL_ADDR_ST_MIN', 'QL_ADDR_ST_MAX'],
  org: ['QL_ORG_MIN', 'QL_ORG_MAX'],
  ep: ['QL_EP_MIN', 'QL_EP_MAX'],
  state: ['QL_STATE_MIN', 'QL_STATE_MAX'],
  partySize: ['QL_PARTY_MIN', 'QL_PARTY_MAX'],
  ttl: [0, 'QL_TTL_MAX'],
  rssi: ['QL_RSSI_MIN', 'QL_RSSI_MAX'],
  vol: [0, 'QL_VOL_MAX'],
  lvl: [0, 'QL_LVL_MAX'],
  tblver: [0, 'QL_TBLVER_MAX'],
  ver: [0, 'QL_TBLVER_MAX'],
  seq: [0, 'QL_U32_MAX'],
  ts: [0, 'QL_U32_MAX'],
  ups: [0, 'QL_U32_MAX'],
  tblage: [0, 'QL_U32_MAX'],
  up: [0, 'QL_U32_MAX'],
  qd: [0, 'QL_U16_MAX'],
  err: [0, 'QL_U16_MAX'],
  fw: [0, 'QL_U16_MAX'],
  code: [0, 'QL_U16_MAX'],
  arg: [0, 'QL_U16_MAX'],
  a1: ['QL_LOG_ARG_MIN', 'QL_LOG_ARG_MAX'],
  a2: ['QL_LOG_ARG_MIN', 'QL_LOG_ARG_MAX'],
}

/**
 * Fields whose bound is a shape rather than a number, and why each is exempt.
 * An exemption is a decision that has to be written down; a silent skip is a
 * hole.
 */
const UNCOMPARABLE = {
  'table.idx': 'bounded by the sibling field `of` on the TS side and by QL_CHUNK_MAX on the ' +
    'firmware side, with a separate idx >= of refusal. Structural check below.',
  'hb.sd': 'a boolean carried as 0/1; the firmware types it uint8_t and range-checks at the emitter.',
  'hb.df': 'a boolean carried as 0/1; same.',
  'hub.stations': 'bounded by the u8 the emitter checks, not by a shared macro.',
}

const WHY_BOUND =
  'A bound that drifts is a frame the console silently drops as `range`. Nothing throws, nothing ' +
  'is logged with a cause, and on a plinth it reads as "the audio just stopped working".'

const unmapped = []
let compared = 0
for (const [key, [lo, hi]] of BOUNDS) {
  const field = key.split('.')[1]
  if (UNCOMPARABLE[key]) {
    notes.push(`${key}: not compared — ${UNCOMPARABLE[key]}`)
    continue
  }
  if (typeof lo !== 'number' || typeof hi !== 'number') {
    notes.push(`${key}: not compared — the console bound is symbolic (${JSON.stringify([lo, hi])})`)
    continue
  }

  // Prefer the firmware's own parser bound for the same key when it has one.
  const derived =
    (key.startsWith('row.') ? inbound.rowBounds?.get(field) : null) ??
    (['table', 'row', 'resolve', 'cmd'].includes(key.split('.')[0]) ? inbound.bounds.get(field) : null)

  let cLo
  let cHi
  let source
  if (derived && typeof derived[0] === 'number' && typeof derived[1] === 'number') {
    ;[cLo, cHi] = derived
    source = 'ql_ndjson_parse()'
  } else if (FIELD_MACROS[field]) {
    const [loName, hiName] = FIELD_MACROS[field]
    cLo = typeof loName === 'number' ? loName : macro(loName)
    cHi = typeof hiName === 'number' ? hiName : macro(hiName)
    source = `${typeof loName === 'number' ? loName : loName}..${typeof hiName === 'number' ? hiName : hiName}`
    if (cLo === null || cHi === null) continue
  } else {
    unmapped.push(key)
    continue
  }

  compared++
  if (cLo !== lo || cHi !== hi) {
    fail(
      `bound on \`${field}\` (${key})`,
      `${source} = ${cLo}..${cHi}`,
      `decodeLine = ${lo}..${hi}`,
      WHY_BOUND,
    )
  }
}

if (unmapped.length) {
  fail(
    'unmapped fields',
    'ql_proto.h has no bound this guard knows how to find for them',
    `decodeLine bounds: ${unmapped.join(', ')}`,
    'A field the console range-checks and this tool cannot pair with a firmware bound is exactly the ' +
      'drift this file exists to catch. Add it to FIELD_MACROS (or to UNCOMPARABLE with a reason) and ' +
      'make sure the firmware really does enforce it.',
  )
}

// The one relational rule, asserted structurally because the numbers are not
// comparable: a chunk claiming idx 200 of 1 is a table that can never complete,
// and a station staging it waits forever.
if (!/out->type == QL_IN_TABLE && out->idx >= out->of/.test(protoSrc)) {
  fail(
    'table idx < of refusal',
    'ql_ndjson_parse() no longer refuses idx >= of',
    'decodeLine bounds idx to 0..of-1',
    'Without it the hub accepts a chunk index that can never be completed and stages a table forever, ' +
      'while the console would have refused the same line outright.',
  )
}

// ── 6. Shape assertions that are not comparisons ────────────────────────────

if (!/partySize/.test(protoSrc) || !/never leaves USB|never crosses LoRa/.test(protoSrc)) {
  notes.push('ql_proto.h no longer marks partySize as USB-only — check the LoRa row struct has not grown it.')
}

// ════════════════════════════════════════════════════════════════════════════
// Report
// ════════════════════════════════════════════════════════════════════════════

if (VERBOSE) {
  process.stdout.write(`sync-proto: ${rel(PROTO_H)} vs ${rel(CODEC_TS)}\n\n`)
  process.stdout.write(`  frame types      ${[...consoleTypes].sort().join(' ')}\n`)
  process.stdout.write(`  emitted by hub   ${[...emitters.keys()].sort().join(' ')}\n`)
  process.stdout.write(`  parsed by hub    ${[...inbound.types.keys()].sort().join(' ')}\n`)
  process.stdout.write(`  bounds compared  ${compared} of ${BOUNDS.size}\n`)
  if (notes.length) {
    process.stdout.write('\n  notes:\n')
    for (const n of notes) process.stdout.write(`    - ${n}\n`)
  }
  process.stdout.write('\n')
}

if (failures.length === 0) {
  process.stdout.write(
    `sync-proto: OK — ${consoleTypes.size} frame types, ${BOUNDS.size} bounds, ` +
      `${ROW_FIELDS.length}-field rows. ql_proto.h and hubProtocol.ts agree.\n`,
  )
  process.exit(0)
}

process.stderr.write('\nsync-proto: THE FIRMWARE AND THE CONSOLE CODEC HAVE DRIFTED.\n')
process.stderr.write(`  firmware: ${rel(PROTO_H)}\n`)
process.stderr.write(`  console:  ${rel(CODEC_TS)}   <- this one is right by construction\n\n`)

for (const f of failures) {
  process.stderr.write(`  ${f.what}\n`)
  process.stderr.write(`      ql_proto.h      ${f.firmwareSays}\n`)
  process.stderr.write(`      hubProtocol.ts  ${f.consoleSays}\n`)
  process.stderr.write(`      what breaks     ${wrap(f.why, 22)}\n\n`)
}

process.stderr.write(
  `${failures.length} disagreement${failures.length === 1 ? '' : 's'}. hubProtocol.ts is the authority on\n` +
    'what is legal on the USB wire, because it is the code that actually refuses the frame.\n' +
    'Change ql_proto.h to match it, not the other way round.\n',
)
process.exit(1)

function wrap(text, indent) {
  const width = 78 - indent
  const pad = ' '.repeat(indent)
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    if (line && line.length + w.length + 1 > width) {
      lines.push(line)
      line = w
    } else {
      line = line ? `${line} ${w}` : w
    }
  }
  if (line) lines.push(line)
  return lines.join(`\n${pad}`)
}
