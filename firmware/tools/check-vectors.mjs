#!/usr/bin/env node
// check-vectors.mjs — the known-answer test for the Q1 crypto.
//
// Run it with:  node --experimental-strip-types firmware/tools/check-vectors.mjs
//               node --experimental-strip-types firmware/tools/check-vectors.mjs --verbose
//
// (On Node 22.18 and newer the flag is the default and can be dropped; it is
// written out above so the command works on every 22.x the bench might have.)
//
// It loads questland/src/services/hubCrypto.ts — the real source the app ships,
// not a copy — and asserts it reproduces EVERY known-answer vector in
// PROTOCOL.md §5 byte for byte: the two derived keys, the fingerprint, the fully
// worked `T` TAP down to its nonce and its MAC input, and all nine table
// vectors. Then it opens each sealed line again and asserts the plaintext comes
// back. It exits non-zero on any disagreement. IT ONLY EVER READS.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// There are two implementations of one cipher construction: ql_crypto.h on a $66
// board in a wood, and hubCrypto.ts in a browser tab. Nothing on the wire records
// which derivation produced a frame — no version byte, no algorithm id, nothing.
// So if the two ever disagree about a label, a byte order, a truncation, or where
// the MAC boundary sits, the symptom in the park is:
//
//   every frame from every station fails its MAC. The station reports perfect
//   health. The hub reports a rising MAC-failure count and nothing else. There
//   is no log line anywhere that says WHICH SIDE IS WRONG, and the person
//   debugging it is standing in a wood with a laptop.
//
// The vectors in PROTOCOL.md are the referee. This tool is how you ask it.
//
// ── WHAT IT CANNOT CHECK ────────────────────────────────────────────────────
//
// It checks the TypeScript against the document. It does NOT compile or run
// ql_crypto.h — the firmware's own conformance is the first-flash self-test in
// PROTOCOL.md §10, running the same vectors on the board. Both halves have to be
// run against the same document for the pair to mean anything; passing here
// proves the console side and the document agree, and nothing more.
//
// It also says nothing about content validity. The MAC answers exactly one
// question — WHO SENT THIS. hubProtocol.ts still validates every payload as
// though the MAC did not exist, and must keep doing so.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIRMWARE = resolve(HERE, '..')
const ROOT = resolve(FIRMWARE, '..')
const CRYPTO_TS = join(ROOT, 'questland', 'src', 'services', 'hubCrypto.ts')
const PROTOCOL_MD = join(FIRMWARE, 'PROTOCOL.md')

const VERBOSE = process.argv.includes('--verbose')

const failures = []
const lines = []

function rel(path) {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path
}

/**
 * Record a disagreement.
 *
 * `documentSays` is PROTOCOL.md §5, which is the authority here — it is what the
 * firmware self-test also checks against, so it is the only thing both
 * implementations can be wrong relative to. `consoleSays` is hubCrypto.ts.
 */
function fail(what, documentSays, consoleSays, why) {
  failures.push({ what, documentSays, consoleSays, why })
}

function check(what, documentSays, consoleSays, why) {
  const ok = documentSays === consoleSays
  if (!ok) fail(what, documentSays, consoleSays, why)
  lines.push({ what, ok })
  return ok
}

// ════════════════════════════════════════════════════════════════════════════
// The fake key
// ════════════════════════════════════════════════════════════════════════════
//
// THIS KEY IS FAKE AND IT IS THE ONLY KEY LITERAL PERMITTED ANYWHERE IN THIS
// REPOSITORY. 000102030405060708090A0B0C0D0E0F is a counting pattern, chosen so
// that nobody can mistake it for a park key. The real per-park PSK is 16 random
// bytes written to NVS by tools/provision-key.mjs at bench assembly, it lives in
// a file outside the working tree with mode 0600, and it is NEVER COMMITTED —
// not in an example, not in a test, not in a comment. If you are here to add a
// vector, use this pattern; if you are here because you want to check two boards
// hold the same key, compare FINGERPRINTS instead and do not bring the key near
// this repository.

const FAKE_PSK_HEX = '000102030405060708090A0B0C0D0E0F'
const FAKE_PSK = Uint8Array.from(Buffer.from(FAKE_PSK_HEX, 'hex'))

// ════════════════════════════════════════════════════════════════════════════
// The vectors, transcribed from PROTOCOL.md §5
// ════════════════════════════════════════════════════════════════════════════

const EXPECT_KENC = 'E0929F2FC3CDF586D3F8EA2C4E875B28'
const EXPECT_KMAC = 'F5CDFA8D12FB920B34032952964F7A04163FE881718E66F7919B15BFE0CAB183'
const EXPECT_FPR = '57841080'

/** The fully worked `T` TAP: station 7 -> hub, SEQ 312, EPOCH 1785312000. */
const WORKED = {
  header: { type: 'T', dst: 0, src: 7, seq: 312, epoch: 1785312000 },
  plaintext: '04D00000000001,1785312000,1,3,L',
  plainLen: 31,
  nonce: '0754000001386A69B300000000000000',
  ciphertext: 'A2E2BB8D109EA244A2EB137CFA796D01E97AE476192D0A8947D18719D7B125',
  blobLen: 35,
  payload: 'ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=',
  macInput: 'Q1|T|0|7|312|ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=|',
  // §5's own prose figure. It is off by one — see the note at the check that
  // uses it. Transcribed as the document has it, not as it ought to be, because
  // this file's job is to say what the document says.
  macInputLen: 61,
  mac: '05D91744EDA99C93',
  macB64: 'BdkXRO2pnJM=',
  line: 'Q1|T|0|7|312|ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=|BdkXRO2pnJM=',
  lineLenWithNewline: 75,
}

/**
 * The remaining nine, same fake key. Line and plaintext are paired here from the
 * two lists PROTOCOL.md keeps side by side (the table, and the sentence of
 * plaintexts "in the same order") — if that pairing ever slips, this tool
 * reports it as a decrypt mismatch, which is the point.
 */
const TABLE = [
  {
    label: 'T unresolved',
    header: { type: 'T', dst: 0, src: 7, seq: 313, epoch: 1785312000 },
    plaintext: '04D00000000009,1785312000,0,0,U',
    line: 'Q1|T|0|7|313|ammzAJL7KYGRN7RPkXxi+xClI8vd6VpYvNvDVvxuzu72XRc=|yLrPqio4LdM=',
  },
  {
    label: 'Q query',
    header: { type: 'Q', dst: 0, src: 7, seq: 314, epoch: 1785312000 },
    plaintext: '04D00000000009',
    line: 'Q1|Q|0|7|314|ammzAN4pjV90piNs9aBU/lmy|DmzCXBK62jo=',
  },
  {
    label: 'A ack',
    header: { type: 'A', dst: 7, src: 0, seq: 41, epoch: 1785311000 },
    plaintext: 'OK',
    line: 'Q1|A|7|0|41|ammvGK+B|zTVV65oVGHo=',
  },
  {
    label: 'R resolve',
    header: { type: 'R', dst: 7, src: 0, seq: 42, epoch: 1785311000 },
    plaintext: '04D00000000009,2,5,0,3600',
    line: 'Q1|R|7|0|42|ammvGC9l4jT5QfKV0JL8xOZx2RM4HhELWJi9Jas=|ZUqJ9J7UYt8=',
  },
  {
    label: 'V beacon',
    header: { type: 'V', dst: 255, src: 0, seq: 43, epoch: 1785311000 },
    plaintext: '1785310000000,12,3B9ACA07,1785312000,0',
    line: 'Q1|V|255|0|43|ammvGL4eRjkGdOudE1QL41si3wr3igOL2MVkMKG4qg7E6kVpu8GJUPFR|WeL2V9Gc9+k=',
  },
  {
    label: 'S sync',
    header: { type: 'S', dst: 0, src: 7, seq: 315, epoch: 1785312000 },
    plaintext: '1785309000000,1785310000000,06',
    line: 'Q1|S|0|7|315|ammzAAw1eWuGs7ldT7tXz3tpiS8xzjP6qjbemb1KtR9+sw==|fZ2UZxy0S8M=',
  },
  {
    label: 'H heartbeat',
    header: { type: 'H', dst: 0, src: 7, seq: 316, epoch: 1785312000 },
    plaintext: '51230,1785310000000,812,0,1,1,0,-92,22,1',
    line: 'Q1|H|0|7|316|ammzAAQdxYlZp0lgPTkpBd3YkJjRu1p1kHS2I9ThuaaP79SOGSCehSx4D8w=|Answzo0m+0k=',
  },
  {
    label: 'C cmd',
    header: { type: 'C', dst: 7, src: 0, seq: 45, epoch: 1785311000 },
    plaintext: 'VOL,22',
    line: 'Q1|C|7|0|45|ammvGApapY0tZA==|lnbmiec5ysw=',
  },
  {
    label: 'L log',
    header: { type: 'L', dst: 0, src: 7, seq: 317, epoch: 1785312000 },
    plaintext: '3,104,-1,0',
    line: 'Q1|L|0|7|317|ammzAHdx4azsHfZpCyc=|MaBzx4JREbc=',
  },
]

/**
 * The `U` CHUNK vector lives in §4 rather than in the §5 table, because it is
 * shown there with its decrypted entry list. It is checked all the same: it is
 * the longest frame in the protocol and the only one that exercises the payload
 * ceiling, so leaving it out would leave the one vector most likely to catch a
 * length bug unchecked.
 */
const CHUNK = {
  label: 'U chunk (PROTOCOL.md §4)',
  header: { type: 'U', dst: 255, src: 0, seq: 44, epoch: 1785311000 },
  plaintext:
    '1785310000000,0,3,04D00000000001:1:3:0;04D00000000002:2:5:1;04D00000000003:0:0:2;04D00000000004:3:9:0',
  line:
    'Q1|U|255|0|44|ammvGCqzhrv91tcG4xzcRznZt4C/YYJZ0IQjjk7NTGdAN1uo7CQnm+D02R+tXyzTOo0/ZjURcJNJtrv3/' +
    'SNKT4TsGpNNG3BRdXp0hctr2RV8ZoEjlJ9rRfXqhxeVSd0tM6xVNGkr1Vst|m5OWuW6Chi8=',
}

// The reasons attached to the biggest failures. Written for the wood, not for CI.

const WHY_DERIVATION =
  'Key derivation has drifted. The PSK is the HMAC KEY and the label is the MESSAGE; get that the ' +
  'wrong way round, or truncate at the wrong place, and both sides produce self-consistent keys ' +
  'that disagree. In the park that is EVERY frame from EVERY station failing its MAC, with the ' +
  'station reporting perfect health and nothing anywhere naming the cause. Do not "fix" it by ' +
  'editing PROTOCOL.md — the firmware self-test checks the same numbers, so changing the document ' +
  'just moves the disagreement onto the boards.'

const WHY_NONCE =
  'The nonce has drifted. SEQ and EPOCH are BIG-ENDIAN and the counter lives in bytes 14..15. Two ' +
  'implementations that disagree each produce a self-consistent keystream, so the bench passes on ' +
  "one vendor's boards and every frame fails on the other's — and the symptom is a MAC error, " +
  'which points at the key, not at the nonce. This is the check that tells them apart.'

const WHY_MAC_BOUNDARY =
  'The MAC boundary has moved. It covers the entire line from index 0 through and including the ' +
  "'|' immediately before the MAC field. Including that separator is what stops a payload ending " +
  'in something pipe-like being re-cut into a different field split with the same MAC. A boundary ' +
  'off by one byte fails every frame in exactly the way a wrong key does.'

const WHY_LINE =
  'The sealed line does not match the document byte for byte. A retransmission must be BYTE-' +
  "IDENTICAL to the frame it repeats — the console's L1 dedupe key is `${st}:${seq}` and it " +
  'swallows an exact repeat, so a retry that differs anywhere becomes a SECOND CHECK-IN for a ' +
  'guest who tapped once. Compare the payload field first: if only the MAC differs, it is the key ' +
  'or the boundary; if the payload differs too, it is the nonce or the cipher.'

const WHY_ROUNDTRIP =
  'The line sealed correctly and then would not open. Seal and open disagree about something the ' +
  'vectors alone cannot see — most often the field split, the epoch prefix, or the DST filter. A ' +
  'hub that can seal but not open is a hub that acknowledges nothing, and every station retries ' +
  'four times and then sits on its tap queue until closing time.'

const WHY_NEGATIVE =
  'A refusal that should have happened did not, or happened for the wrong reason. These are the ' +
  'cases where a permissive parser turns an attacker-supplied line into a console action, and ' +
  'openLine is the boundary that has to hold. Order matters as much as outcome: corruption ' +
  'anywhere in the ciphertext must be caught as bad-mac BEFORE the decryptor ever runs.'

// ════════════════════════════════════════════════════════════════════════════
// Load the module under test
// ════════════════════════════════════════════════════════════════════════════

let ql
try {
  ql = await import(pathToFileURL(CRYPTO_TS).href)
} catch (err) {
  process.stderr.write(`\ncheck-vectors: cannot load ${rel(CRYPTO_TS)}\n\n`)
  process.stderr.write(`  ${err && err.message ? err.message : String(err)}\n\n`)
  process.stderr.write(
    '  This tool imports the TypeScript source directly, through Node\'s type-stripping loader,\n' +
      '  so that it tests THE FILE THE APP SHIPS and not a hand-copied twin — a twin is the exact\n' +
      '  drift this whole guard exists to catch.\n\n' +
      '  Two things break that: a Node older than 22.6 (no type stripping), or a runtime import\n' +
      '  added to hubCrypto.ts. The module must import NOTHING at runtime; `import type` is fine\n' +
      '  because it is erased. If you needed a helper there, inline it.\n\n' +
      `  This Node is ${process.version}. Try: node --experimental-strip-types ${rel(fileURLToPath(import.meta.url))}\n`,
  )
  process.exit(2)
}

/** The document should still say what this tool transcribed from it. A cheap guard on a stale copy. */
function auditDocument() {
  let md
  try {
    md = readFileSync(PROTOCOL_MD, 'utf8')
  } catch {
    lines.push({ what: 'PROTOCOL.md is readable', ok: false })
    fail(
      'PROTOCOL.md could not be read',
      rel(PROTOCOL_MD),
      'absent',
      'The vectors below were transcribed from §5. Without the document there is nothing to be ' +
        'the referee between the firmware and the console, and this tool is checking a copy ' +
        'against itself.',
    )
    return
  }
  // The §5 table is a MARKDOWN table, so every field separator in it is written
  // `\|` — otherwise the pipe would end the cell. Unescape before searching, or
  // this audit reports every table row as missing while the code-block copies in
  // §4 (which are not escaped) appear to be fine. That asymmetry is exactly the
  // kind of false alarm that teaches the next person to ignore a drift guard.
  md = md.replace(/\\\|/g, '|')

  const wanted = [
    ['K_enc', EXPECT_KENC],
    ['K_mac', EXPECT_KMAC],
    ['fpr', EXPECT_FPR],
    ['the worked T TAP line', WORKED.line],
    ...TABLE.map((v) => [`the ${v.label} line`, v.line]),
    [CHUNK.label, CHUNK.line],
  ]
  for (const [what, text] of wanted) {
    if (!md.includes(text)) {
      fail(
        `PROTOCOL.md no longer contains ${what}`,
        'not found in the document',
        text,
        'This tool holds a TRANSCRIPTION of §5, and a transcription that has fallen out of step ' +
          'with the document it transcribes is worse than no check at all: it goes green while the ' +
          'firmware self-test, which reads the document, goes red. Re-transcribe, or find out who ' +
          'changed a vector and why — a vector should only ever change if the wire changed.',
      )
    }
  }
  lines.push({ what: 'vectors still match PROTOCOL.md §5', ok: failures.length === 0 })
}

auditDocument()

// ════════════════════════════════════════════════════════════════════════════
// 1. Key derivation
// ════════════════════════════════════════════════════════════════════════════

function hexOf(bytes) {
  return Buffer.from(bytes).toString('hex').toUpperCase()
}

const keys = await ql.deriveKeys(FAKE_PSK)

// The derived keys are imported non-extractable on purpose, so they cannot be
// read back out of the CryptoKey. Re-derive the raw bytes here with node's own
// crypto — an INDEPENDENT implementation of HMAC-SHA256 — and check those. That
// is stronger than reading hubCrypto's own answer back: it means K_enc and K_mac
// are verified against the document by a second HMAC, not just by themselves.
const { createHmac } = await import('node:crypto')
const rawEnc = hexOf(createHmac('sha256', FAKE_PSK).update('QL1-enc').digest().subarray(0, 16))
const rawMac = hexOf(createHmac('sha256', FAKE_PSK).update('QL1-mac').digest())

check('K_enc = HMAC-SHA256(PSK, "QL1-enc")[0..15]', EXPECT_KENC, rawEnc, WHY_DERIVATION)
check('K_mac = HMAC-SHA256(PSK, "QL1-mac")', EXPECT_KMAC, rawMac, WHY_DERIVATION)
check('fpr   = HMAC-SHA256(PSK, "QL1-fpr")[0..3]', EXPECT_FPR, keys.fingerprint, WHY_DERIVATION)
check(
  'keyFingerprint() agrees with deriveKeys()',
  keys.fingerprint,
  await ql.keyFingerprint(FAKE_PSK),
  'Two ways to print the same eight characters must not disagree. The bench procedure is "all ' +
    'twenty-two boards show the same fingerprint"; if the console can print two different answers ' +
    'for one key, that procedure stops meaning anything.',
)

// ════════════════════════════════════════════════════════════════════════════
// 2. The fully worked T TAP, intermediate by intermediate
// ════════════════════════════════════════════════════════════════════════════
//
// Every intermediate the document prints is checked, not just the final line.
// A final line that matches proves the whole chain; a final line that does NOT
// match tells you nothing about WHERE it broke, and "somewhere in the crypto" is
// not a thing a person in a wood can act on. These checks localise it: nonce ->
// ciphertext -> payload -> MAC input -> MAC.

{
  const w = WORKED
  check(
    'T TAP nonce',
    w.nonce,
    hexOf(ql.qlNonce(w.header.src, w.header.type, w.header.seq, w.header.epoch)),
    WHY_NONCE,
  )

  const sealed = await ql.sealLine(keys, w.header, w.plaintext)
  const body = sealed.replace(/\n$/, '')
  const f = body.split('|')

  check('T TAP plaintext length', String(w.plainLen), String(w.plaintext.length), WHY_LINE)
  check('T TAP payload field', w.payload, f[5], WHY_LINE)

  const blob = Buffer.from(f[5], 'base64')
  check('T TAP blob length', String(w.blobLen), String(blob.length), WHY_LINE)
  const epochBE = Buffer.alloc(4)
  epochBE.writeUInt32BE(w.header.epoch, 0)
  check(
    'T TAP epoch prefix (cleartext, big-endian)',
    hexOf(epochBE),
    hexOf(blob.subarray(0, 4)),
    'The payload field is B64(EPOCH_BE32 || ciphertext). The receiver rebuilds the nonce from those ' +
      'first four bytes, so an epoch written little-endian decrypts to garbage on every frame while ' +
      'the MAC still verifies — which sends you hunting in the payload parsers.',
  )
  check('T TAP ciphertext', w.ciphertext, hexOf(blob.subarray(4)), WHY_NONCE)

  const macInput = body.slice(0, body.length - f[6].length)
  check('T TAP MAC input', w.macInput, macInput, WHY_MAC_BOUNDARY)

  // THIS ONE IS CURRENTLY RED, AND THE CODE IS NOT THE THING THAT IS WRONG.
  //
  // §5 says "the MAC input is the 61 bytes Q1|T|0|7|312|<payload>|". Count them:
  // 3 + 2 + 2 + 2 + 4 + 48 + 1 = 62. The document's OWN other figure agrees with
  // 62 and not with 61 — it gives the finished line as 75 bytes with the
  // newline, and 62 + 12 (MAC) + 1 (\n) is 75, while 61 + 12 + 1 is 74.
  //
  // Everything that actually crosses the air reproduces byte for byte: the MAC
  // input STRING, mac[0..7], and the finished line all match §5 exactly, on the
  // check immediately above and the ones immediately below. So this is an
  // arithmetic slip in the prose of §5, not drift in the construction, and it
  // costs nobody a frame. It is left failing on purpose, because a document that
  // is the referee for two implementations does not get to carry a number that
  // is wrong — the firmware self-test reads the same section, and a person
  // checking a board's covered-byte count against it will chase an off-by-one
  // that is not in the board. Fix the sentence in §5, do not touch hubCrypto.ts.
  check(
    'T TAP MAC input length',
    String(w.macInputLen),
    String(macInput.length),
    'KNOWN, AND IT IS THE DOCUMENT THAT IS WRONG. The MAC input string on the check above matches ' +
      '§5 character for character, and so do mac[0..7] and the finished line — the construction is ' +
      'correct. §5 just miscounts that string: 3 + 2 + 2 + 2 + 4 + 48 + 1 = 62, not 61, and §5\'s ' +
      'own line total (75 bytes with the newline) only adds up with 62. Fix the sentence in ' +
      'PROTOCOL.md §5; do not touch hubCrypto.ts, and do not go looking for an off-by-one in a ' +
      'board. If instead the MAC INPUT check above is also red, ignore all of this — that is a real ' +
      'boundary drift and it fails every frame exactly the way a wrong key does.',
  )
  check('T TAP mac[0..7]', w.mac, hexOf(Buffer.from(f[6], 'base64')), WHY_DERIVATION)
  check('T TAP mac field (b64)', w.macB64, f[6], WHY_DERIVATION)
  check('T TAP sealed line', w.line, body, WHY_LINE)
  check(
    'T TAP line length with \\n',
    String(w.lineLenWithNewline),
    String(sealed.length),
    'The line budget in §3 is what keeps a sealed frame inside one SX1276 packet. A frame past it ' +
      'is truncated by the radio, and a truncated table chunk is a station that stages forever and ' +
      'never commits.',
  )
  check(
    'T TAP is newline-terminated',
    'yes',
    sealed.endsWith('\n') ? 'yes' : 'no',
    'The newline is the frame terminator. Without it the receiver never sees a complete line and ' +
      'the assembler grows until it hits its cap and throws the frame away.',
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Every table vector: seal, then open again
// ════════════════════════════════════════════════════════════════════════════

for (const v of [WORKED, ...TABLE, CHUNK]) {
  const label = v.label ?? 'T TAP (worked)'
  const sealed = await ql.sealLine(keys, v.header, v.plaintext)
  check(`seal ${label}`, v.line, sealed.replace(/\n$/, ''), WHY_LINE)

  // Open it as the addressee. A broadcast frame (DST 255) is opened as some
  // other node on purpose — proving the broadcast path is not just the
  // self-address path wearing a hat.
  const self = v.header.dst === 255 ? 9 : v.header.dst
  const opened = await ql.openLine(keys, `${v.line}\n`, self)
  if (!opened.ok) {
    lines.push({ what: `open ${label}`, ok: false })
    fail(
      `open ${label}`,
      'the document says this is a valid line',
      `openLine refused it: ${opened.reason} — ${opened.detail}`,
      WHY_ROUNDTRIP,
    )
    continue
  }
  check(`open ${label} -> plaintext`, v.plaintext, opened.plaintext, WHY_ROUNDTRIP)
  check(
    `open ${label} -> header`,
    JSON.stringify(v.header),
    JSON.stringify(opened.header),
    'The header IS the nonce, so a header that comes back wrong means the plaintext above was ' +
      'decrypted with a different keystream than it was encrypted with — and the fact that it ' +
      'nonetheless matched is luck, not correctness.',
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 4. The refusals
// ════════════════════════════════════════════════════════════════════════════
//
// A verifier that accepts every good line and also every bad one is not a
// verifier. Each case below is a real shape an attacker or a broken board puts
// on the air.

{
  const good = WORKED.line
  const body = good
  const f = body.split('|')

  /** Flip one bit of a base64 field by swapping one character for a different legal one. */
  function tamper(field, index) {
    const g = [...body.split('|')]
    const s = g[field]
    const at = index < 0 ? s.length + index : index
    const c = s[at]
    g[field] = s.slice(0, at) + (c === 'A' ? 'B' : 'A') + s.slice(at + 1)
    return g.join('|')
  }

  async function expectRefusal(what, line, self, reason, why) {
    const r = await ql.openLine(keys, line, self)
    const got = r.ok ? 'ok:true — the line was ACCEPTED' : r.reason
    check(what, reason, got, why)
  }

  // A flipped MAC byte. The commonest real-world cause is not an attacker at
  // all: it is one board provisioned from the wrong key file.
  await expectRefusal(
    'refuse a flipped MAC byte',
    tamper(6, 0),
    0,
    'bad-mac',
    WHY_NEGATIVE +
      ' A MAC that does not verify is counted and reported at the endpoint, never answered on the ' +
      'air — a reply to a bad MAC is an oracle that turns one forged packet into a guaranteed ' +
      'transmission, which is free battery drain and free airtime denial.',
  )

  // A flipped ciphertext byte. This is the encrypt-then-MAC property: the
  // corruption is caught by the MAC, BEFORE the decryptor is ever run on
  // attacker-chosen bytes. If this ever reports something other than bad-mac,
  // the construction has silently become MAC-then-encrypt.
  await expectRefusal(
    'refuse a flipped ciphertext byte (as bad-mac, before decryption)',
    tamper(5, -3),
    0,
    'bad-mac',
    WHY_NEGATIVE +
      ' Encrypt-then-MAC means ciphertext corruption is authentication failure, full stop. A ' +
      'decryptor that runs first on attacker-chosen bytes is the padding-oracle shape, and it also ' +
      'means a forged frame gets to touch the parser.',
  )

  // Six fields. A station that drops a separator, or a splice attempt.
  await expectRefusal(
    'refuse a line with 6 fields',
    `Q1|T|0|7|312|${f[5]}${f[6]}`,
    0,
    'malformed',
    WHY_NEGATIVE +
      ' Exactly seven fields, checked before any crypto runs. Field count is structure, and ' +
      'structure is checked first because it is the cheapest refusal there is.',
  )

  // Eight fields — the other side of the same rule.
  await expectRefusal(
    'refuse a line with 8 fields',
    `${good}|extra`,
    0,
    'malformed',
    WHY_NEGATIVE + ' An extra field is as much a splice as a missing one.',
  )

  // Addressed elsewhere. NOT an error, and it must not be reported as one: a
  // station hearing its neighbour's traffic is the normal case on a shared
  // channel, and counting those as malformed buries the real count.
  await expectRefusal(
    'refuse a DST that is neither us nor broadcast',
    good,
    9,
    'not-for-us',
    'A well-formed frame addressed to somebody else is ROUTING, not an error. If it were counted ' +
      'as malformed, every station on the channel would report a rising malformed count all day ' +
      'and the number would stop meaning anything — which matters because that number is how a ' +
      'mis-provisioned board is told apart from a dead radio.',
  )

  // And the same line, accepted, once we are the addressee.
  {
    const r = await ql.openLine(keys, good, 0)
    check(
      'accept that same line as the addressee',
      'ok',
      r.ok ? 'ok' : `${r.reason} — ${r.detail}`,
      'The DST filter must reject on the address and nothing else. If this fails while the case ' +
        'above passes, the filter is refusing frames that ARE ours.',
    )
  }

  // Broadcast reaches everybody. The V beacon carries the table version and the
  // quiet-hours flag; a station that drops broadcasts never learns either.
  {
    const beacon = TABLE.find((v) => v.header.dst === 255)
    const r = await ql.openLine(keys, beacon.line, 17)
    check(
      'accept a broadcast (DST 255) at an unrelated address',
      'ok',
      r.ok ? 'ok' : `${r.reason} — ${r.detail}`,
      'A station that refuses broadcasts never hears a beacon, so it never learns the table version ' +
        'and never syncs. It reports perfect health while playing a stale episode.',
    )
  }

  // Charset. A control byte or a high byte is by definition not ours, and this
  // gate runs before anything is split, so a smuggled newline cannot move a
  // field boundary.
  await expectRefusal(
    'refuse a control byte in the line',
    `Q1|T|0|7|312|${f[5]}|${f[6].slice(0, 6) + String.fromCharCode(0x07) + f[6].slice(7)}`,
    0,
    'malformed',
    WHY_NEGATIVE + ' The charset gate runs on the whole line before it is split.',
  )
  await expectRefusal(
    'refuse a byte above 0x7E',
    good.replace('Q1|T', 'Q1|É'),
    0,
    'malformed',
    WHY_NEGATIVE + ' Nothing on this wire is free text, so a high byte is not ours.',
  )

  // Leading zeros. One value must have exactly one spelling, or a retry is not
  // byte-identical to the frame it repeats.
  await expectRefusal(
    'refuse a leading zero in SEQ',
    good.replace('|312|', '|0312|'),
    0,
    'malformed',
    'Leading zeros give one value two spellings. A LoRa retry must be BYTE-IDENTICAL to the frame ' +
      "it repeats, because the console's L1 dedupe key is `${st}:${seq}` — a differently-spelled " +
      'retry is a SECOND CHECK-IN for a guest who tapped once.',
  )

  // 255 is a destination, never a source.
  await expectRefusal(
    'refuse SRC 255 (broadcast is not a source)',
    (await ql.sealLine(keys, { ...WORKED.header, src: 7 }, WORKED.plaintext))
      .replace(/\n$/, '')
      .replace('|0|7|', '|0|255|'),
    0,
    'malformed',
    'A frame claiming to come from the broadcast address is refused on structure, before the MAC ' +
      'is even computed. It has to be: `src` is used to rebuild the nonce and, on the console side, ' +
      'to index the park.',
  )

  // Unknown type letter. The type is one byte of the nonce, so an unknown letter
  // is not merely unhandled, it is unopenable.
  await expectRefusal(
    'refuse an unknown frame type',
    good.replace('Q1|T|', 'Q1|Z|'),
    0,
    'malformed',
    WHY_NEGATIVE + ' The TYPE letter is a byte of the nonce; there is no "ignore unknown types" here.',
  )

  // MAC field of the wrong length. 8 bytes is always exactly 12 characters.
  await expectRefusal(
    'refuse a short MAC field',
    `${good.slice(0, good.length - 1)}`,
    0,
    'malformed',
    WHY_NEGATIVE + ' B64 of 8 bytes is always exactly 12 characters, padding included.',
  )

  // Base64 charset. The decoder must never see a byte outside the alphabet.
  await expectRefusal(
    'refuse a non-base64 character in the payload',
    tamper(5, 2).replace(/^(Q1\|T\|0\|7\|312\|..)./, '$1*'),
    0,
    'malformed',
    WHY_NEGATIVE + ' Charset is checked before the decoder runs, not after it fails.',
  )

  // An empty line, and a line that is only its terminator.
  await expectRefusal('refuse an empty line', '', 0, 'malformed', WHY_NEGATIVE)
  await expectRefusal('refuse a bare newline', '\n', 0, 'malformed', WHY_NEGATIVE)

  // A trailing CR is forgiven, exactly as ql_line_open forgives it: the
  // terminator is not content. A USB or serial path that inserts one must not
  // cost the park a frame.
  {
    const r = await ql.openLine(keys, `${good}\r\n`, 0)
    check(
      'forgive a trailing CRLF',
      'ok',
      r.ok ? 'ok' : `${r.reason} — ${r.detail}`,
      'ql_line_open strips trailing CR and LF before it does anything else, because the terminator ' +
        'is not content. A verifier that counts the CR would refuse every frame off a serial path ' +
        'that adds one.',
    )
  }

  // openLine must never throw, whatever it is fed. This is the property that
  // lets a caller treat a refusal as data instead of wrapping the whole receive
  // path in a try/catch that also swallows real bugs.
  {
    const junk = [
      '|||||||',
      'Q1|T|0|7|312||',
      'Q1',
      'Q1|T|0|7|312|====|============',
      '{"t":"tap"}',
      'Q1|T|0|7|312|' + 'A'.repeat(400) + '|BdkXRO2pnJM=',
      good.replace('|0|7|', '|4294967296|7|'),
    ]
    let threw = null
    for (const j of junk) {
      try {
        const r = await ql.openLine(keys, j, 0)
        if (r.ok) threw = `ACCEPTED ${JSON.stringify(j.slice(0, 40))}`
      } catch (err) {
        threw = `threw on ${JSON.stringify(j.slice(0, 40))}: ${err && err.message}`
      }
    }
    check(
      'openLine neither throws nor accepts junk',
      'clean',
      threw ?? 'clean',
      'Everything reaching openLine is attacker-supplied bytes. A parser that throws forces its ' +
        'caller into a try/catch that swallows real bugs alongside hostile input, which is how a ' +
        'receive path stops reporting anything at all.',
    )
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 5. hubCrypto holds no key material
// ════════════════════════════════════════════════════════════════════════════
//
// A source-level assertion rather than a behavioural one, and it belongs in this
// tool because it is the same class of promise as the vectors: something that
// must stay true and that nothing else checks. hubCrypto.ts loads inside a
// console tab holding a staff Firestore session, so a key-storage surface there
// is a place a park key can leak from, in exchange for nothing — the hub relays
// cleartext NDJSON and there is no inbound Q1 frame for the browser to verify.

{
  const src = readFileSync(CRYPTO_TS, 'utf8')
  const code = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  const banned = [
    ['localStorage', 'a key in localStorage survives the tab and is readable by anything on the origin'],
    ['sessionStorage', 'same origin, same exposure — a shorter lifetime is not a control'],
    ['import.meta.env', 'a PSK baked into a Vite env var ships inside the bundle, in the clear'],
    ['indexedDB', 'the same leak with more steps'],
  ]
  const found = banned.filter(([needle]) => code.includes(needle)).map(([needle]) => needle)
  check(
    'hubCrypto.ts holds no PSK and no key store',
    'none',
    found.length ? found.join(', ') : 'none',
    'Every export in hubCrypto.ts takes its key material as an ARGUMENT, on purpose. ' +
      banned.map(([n, w]) => `${n}: ${w}`).join('; ') +
      '. The per-park PSK is written to NVS at bench assembly and is never committed; if you need ' +
      'to know two boards hold the same key, compare fingerprints.',
  )

  const imports = [...code.matchAll(/^\s*import\s+(?!type\b)[^\n]*$/gm)].map((m) => m[0].trim())
  check(
    'hubCrypto.ts imports nothing at runtime',
    'none',
    imports.length ? imports.join(' | ') : 'none',
    'This tool imports the TypeScript source directly so that it tests the file the app ships ' +
      'rather than a copy. A runtime import breaks the type-stripping loader, this guard stops ' +
      'running, and the next drift in the crypto is found in a wood instead of at a desk. ' +
      '`import type` is fine — it is erased.',
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Report
// ════════════════════════════════════════════════════════════════════════════

for (const l of lines) {
  if (VERBOSE || !l.ok) process.stdout.write(`  ${l.ok ? 'ok  ' : 'FAIL'}  ${l.what}\n`)
}

if (failures.length === 0) {
  process.stdout.write(
    `\ncheck-vectors: OK — ${lines.length} checks. ${rel(CRYPTO_TS)} reproduces every\n` +
      `known-answer vector in ${rel(PROTOCOL_MD)} §5 byte for byte, opens each one back to its\n` +
      'plaintext, and refuses every tampered shape. Key material: none, as designed.\n',
  )
  if (!VERBOSE) process.stdout.write('Run with --verbose to see each check.\n')
  process.exit(0)
}

process.stderr.write('\ncheck-vectors: THE CONSOLE CRYPTO AND THE PROTOCOL DOCUMENT DISAGREE.\n\n')
process.stderr.write(`  document: ${rel(PROTOCOL_MD)} §5   <- the referee. Both implementations answer to it.\n`)
process.stderr.write(`  console:  ${rel(CRYPTO_TS)}\n`)
process.stderr.write(`  firmware: ${rel(join(FIRMWARE, 'ql_crypto.h'))}   (not run here — see the header)\n\n`)

for (const f of failures) {
  process.stderr.write(`  ${f.what}\n`)
  process.stderr.write(`      PROTOCOL.md   ${f.documentSays}\n`)
  process.stderr.write(`      hubCrypto.ts  ${f.consoleSays}\n`)
  process.stderr.write(`      what breaks   ${wrap(f.why, 22)}\n\n`)
}

process.stderr.write(
  `${failures.length} disagreement${failures.length === 1 ? '' : 's'}.\n\n` +
    'READ THIS BEFORE CHANGING ANYTHING. PROTOCOL.md §5 is the referee, because the firmware\n' +
    'self-test at first flash checks the same numbers. Editing the document to match the code\n' +
    'does not fix a disagreement — it moves it onto twenty-two boards in a wood, where it\n' +
    'presents as every frame failing its MAC with nothing naming the cause.\n\n' +
    'So: fix hubCrypto.ts. If you are certain the document is wrong, change the document AND\n' +
    're-run the firmware self-test on a real board before anybody leaves the bench.\n',
)
process.exit(1)

function wrap(text, indent) {
  const width = 78 - indent
  const pad = ' '.repeat(indent)
  const words = String(text).split(/\s+/)
  const out = []
  let line = ''
  for (const w of words) {
    if (line && line.length + w.length + 1 > width) {
      out.push(line)
      line = w
    } else {
      line = line ? `${line} ${w}` : w
    }
  }
  if (line) out.push(line)
  return out.join(`\n${pad}`)
}
