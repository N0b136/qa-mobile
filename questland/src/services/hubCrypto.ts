// hubCrypto.ts — the console's mirror of firmware/ql_crypto.h.
//
// AES-128-CTR for confidentiality, HMAC-SHA256 truncated to 8 bytes for
// authenticity, ENCRYPT-THEN-MAC, over WebCrypto. It seals a Q1 line and it
// takes one apart again, byte-for-byte identically to the C on the poles:
//
//   Q1|<TYPE>|<DST>|<SRC>|<SEQ>|<B64(EPOCH_BE32 || ciphertext)>|<B64(MAC[0..7])>\n
//
// ── WHY THIS FILE EXISTS, STATED PLAINLY ────────────────────────────────────
//
// It is NOT wired into the console, and it is not a feature. The hub relays
// CLEARTEXT NDJSON over USB by design (PROTOCOL.md §6) — it verifies the Q1 MAC
// itself on the radio side and, on failure, emits no NDJSON line at all. So
// there is no inbound Q1 frame for a browser tab to verify today, and nothing
// here is on the path of a real tap.
//
// What it is, is the CROSS-IMPLEMENTATION DRIFT GUARD. PROTOCOL.md §5 carries
// known-answer vectors and ql_crypto.h carries the only other implementation of
// them; nothing on the wire records which derivation produced a frame, so a
// disagreement between the two presents as "every frame fails its MAC" with no
// clue which side is wrong. A second implementation that can be run in a second
// and diffed against the vectors is how that gets caught at a desk instead of in
// a wood. `firmware/tools/check-vectors.mjs` is that run.
//
// It is also the ready-made verifier IF a future hub is ever changed to relay
// raw Q1 lines instead of decoding them. That day it becomes load-bearing. It
// is not that day.
//
// ── THIS MODULE NEVER HOLDS A PSK ───────────────────────────────────────────
//
// Every export takes its key material as an ARGUMENT. There is no localStorage
// read, no sessionStorage read, no `import.meta.env` read, no module-level cache
// of a PSK or of anything derived from one. That is deliberate and it is not
// negotiable:
//
//   * the per-park PSK is 16 random bytes written to a station's NVS at bench
//     assembly by tools/provision-key.mjs, and it is NEVER COMMITTED — not in an
//     example, not in a test, not in a comment (ql_crypto.h says the same thing
//     at its head, and means it);
//   * this file loads inside a console tab that is holding a STAFF FIRESTORE
//     SESSION. Inventing a key-storage surface there — any surface, however
//     careful — buys exactly nothing today, because there is no inbound Q1 frame
//     to verify, and costs a real place for a park key to leak from.
//
// So: no key store, no "convenience" default, no env fallback. A caller that
// wants to verify a line brings the bytes. The only key literal anywhere near
// this code is the obviously-fake counting pattern in PROTOCOL.md §5, which
// lives in the test tooling and says on its face that it is fake.
//
// ── WHAT AUTHENTICATION BUYS, AND WHAT IT DOES NOT ──────────────────────────
//
// The MAC answers exactly one question — WHO SENT THIS. It says nothing about
// whether the content is well-formed. A station is a $66 board on a post in a
// public wood held shut by four screws, and one that has been opened, or is
// simply buggy, produces perfectly authentic garbage. So the payload parsers in
// hubProtocol.ts validate as though the MAC did not exist, and they must keep
// doing so. Authentication and validation are orthogonal; if a future change
// relaxes a bound "because it's authenticated anyway", that is the bug this
// paragraph is here to prevent.
//
// ── NO IMPORTS, ON PURPOSE ──────────────────────────────────────────────────
//
// Nothing is imported at runtime — not a project module, not a package. The file
// is therefore loadable straight by Node's type-stripping loader, which is what
// lets a plain .mjs tool in firmware/tools/ exercise THE EXACT SOURCE the app
// ships rather than a hand-copied twin. A twin is the thing this file exists to
// prevent, so it must not need one to be tested. Erasable TypeScript syntax
// only: no enum, no namespace, no parameter properties, no decorators. Add an
// import here and the drift guard stops running.

// ── Sizes, mirrored from ql_crypto.h / ql_proto.h ───────────────────────────

/** The provisioned per-park secret is 16 bytes. Anything else is not a PSK. */
export const PSK_LEN = 16
/** K_enc: the first 16 bytes of HMAC-SHA256(PSK, "QL1-enc"). */
export const KENC_LEN = 16
/** K_mac: all 32 bytes of HMAC-SHA256(PSK, "QL1-mac"). */
export const KMAC_LEN = 32
/** Truncated to 8 bytes: 64 bits of forgery resistance on a link carrying a few frames a minute. */
export const MAC_LEN = 8
/** B64 of 8 bytes is always exactly 12 characters, padding included. A different length is a refusal. */
export const MAC_B64_LEN = 12
export const NONCE_LEN = 16
/** The cleartext EPOCH that prefixes the payload blob, big-endian. */
export const EPOCH_PREFIX_LEN = 4
/** QL_LINE_MAX — one SX1276 packet. */
export const LINE_MAX = 255
/** QL_PLAIN_MAX — 158 bytes, the number the static_assert in ql_proto.h defends. */
export const PLAIN_MAX = 158
/** QL_PAYLOAD_B64_MAX — B64 of (4 + 158) bytes. */
export const PAYLOAD_B64_MAX = 216

export const MAGIC = 'Q1'
export const ADDR_HUB = 0
export const ADDR_ST_MIN = 1
/** 1..21 plinths, 22 the Chief's House, 23 the gate. Derived in hubProtocol.ts; restated here as a bound. */
export const ADDR_ST_MAX = 23
export const ADDR_BROADCAST = 255
export const U32_MAX = 4294967295

/**
 * The frame-type letters, mirrored from ql_proto.h.
 *
 * A const object and a union type rather than an enum: this file must stay
 * erasable so Node can strip it (see the header). The letter is one cleartext
 * ASCII byte and it is PART OF THE NONCE, so it must never be reused for a
 * second meaning and must never become two characters.
 */
export const QL_TYPES = {
  TAP: 'T',
  ACK: 'A',
  QUERY: 'Q',
  RESOLVE: 'R',
  BEACON: 'V',
  CHUNK: 'U',
  SYNC: 'S',
  HB: 'H',
  CMD: 'C',
  CMDACK: 'K',
  LOG: 'L',
}

const TYPE_LETTERS = 'TAQRVUSHCKL'

/** True for a type letter ql_type_known() would accept. */
export function isKnownType(type: string): boolean {
  return type.length === 1 && TYPE_LETTERS.indexOf(type) !== -1
}

// ── Types ───────────────────────────────────────────────────────────────────

/** The two working keys plus the printable fingerprint. Opaque CryptoKeys — the raw bytes are not kept. */
export interface QlKeys {
  /** AES-128-CTR key, non-extractable. */
  enc: CryptoKey
  /** HMAC-SHA256 key, non-extractable. */
  mac: CryptoKey
  /** Eight uppercase hex characters. Printed, never secret. */
  fingerprint: string
}

/** The cleartext header of a Q1 line. These fields are the nonce as well as the routing. */
export interface QlHeader {
  type: string
  dst: number
  src: number
  seq: number
  epoch: number
}

/** What sealLine needs. EPOCH is the sender's key-epoch, not the beacon's clock. */
export interface QlSealHeader {
  type: string
  dst: number
  src: number
  seq: number
  epoch: number
}

/**
 * Why a line was refused. One reason per step of ql_line_open's order of
 * operations, because "it didn't open" is not an answer anybody can act on.
 *
 * `not-for-us` is NOT an error — the line was well-formed, it was simply
 * addressed elsewhere, and ql_line_open does not count it as malformed either.
 */
export type QlOpenReason = 'malformed' | 'not-for-us' | 'bad-mac' | 'too-long'

/**
 * openLine's result. A discriminated union, never an exception: everything
 * arriving here is attacker-supplied bytes, exactly like hubProtocol.decodeLine,
 * and a parser that throws on hostile input is a parser whose caller ends up
 * wrapped in a try/catch that swallows real bugs too.
 */
export type QlOpenResult =
  | { ok: true; header: QlHeader; plaintext: string }
  | { ok: false; reason: QlOpenReason; detail: string }

// ── Bytes and text ──────────────────────────────────────────────────────────
//
// Everything on this wire is one byte per character. TextEncoder is deliberately
// NOT used: it encodes UTF-8, so a byte above 0x7F would become two bytes and
// the character offsets this file computes MAC coverage from would stop being
// byte offsets. Hand-rolled latin1 keeps char index == byte index, which is the
// property the `covered` arithmetic below depends on.

function bytesFromLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c > 0xff) throw new RangeError(`hubCrypto: code point ${c} at ${i} is not a byte`)
    out[i] = c
  }
  return out
}

function latin1FromBytes(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

function hex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0').toUpperCase()
  return out
}

// ── Base64 ──────────────────────────────────────────────────────────────────
//
// RFC 4648 STANDARD alphabet (A-Z a-z 0-9 '+' '/') WITH '=' padding — the same
// choice ql_crypto.h makes, for the same reason: mbedtls implements only the
// standard alphabet, and a hand-rolled second alphabet is a second thing to get
// wrong. Padded, because mbedtls_base64_encode always pads and cannot be told
// not to, and because a padded field's length is a pure function of the payload
// length, which is what makes the line budget in PROTOCOL.md §3 a real bound.
//
// Hand-rolled rather than atob/btoa. Not for speed — for STRICTNESS and for
// determinism: atob accepts unpadded input and whitespace, which would let two
// spellings of one payload both decode, and a LoRa retry has to be byte-
// identical to the frame it repeats. Neither '+' nor '/' nor '=' is the field
// delimiter '|' and none of them is a newline, so a base64 field can never move
// a field boundary. That property is being relied on; re-check it before
// changing alphabets.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** True for a string of only alphabet characters and '='. Charset FIRST, so the decoder never sees a stray byte. */
export function isBase64Charset(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const ok =
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x61 && c <= 0x7a) || // a-z
      (c >= 0x30 && c <= 0x39) || // 0-9
      c === 0x2b || // +
      c === 0x2f || // /
      c === 0x3d // =
    if (!ok) return false
  }
  return true
}

export function base64Encode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (b0 << 16) | (b1 << 8) | b2
    out += B64_ALPHABET[(n >> 18) & 63]
    out += B64_ALPHABET[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64_ALPHABET[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64_ALPHABET[n & 63] : '='
  }
  return out
}

/**
 * Decode, or null. Null rather than a throw, because every caller here is on the
 * receive path and a decode failure is an ordinary refusal, not an exception.
 *
 * Strict: charset first, then a length that is a multiple of four, then padding
 * only at the very end and at most two of it. mbedtls_base64_decode refuses the
 * same shapes; anything looser would give one payload two spellings.
 */
export function base64Decode(text: string): Uint8Array | null {
  if (!isBase64Charset(text)) return null
  if (text.length === 0 || text.length % 4 !== 0) return null
  let pad = 0
  while (pad < 2 && text.charCodeAt(text.length - 1 - pad) === 0x3d) pad++
  for (let i = 0; i < text.length - pad; i++) if (text.charCodeAt(i) === 0x3d) return null

  const out = new Uint8Array((text.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    const q =
      (B64_ALPHABET.indexOf(text[i]) << 18) |
      (B64_ALPHABET.indexOf(text[i + 1]) << 12) |
      (Math.max(B64_ALPHABET.indexOf(text[i + 2]), 0) << 6) |
      Math.max(B64_ALPHABET.indexOf(text[i + 3]), 0)
    if (o < out.length) out[o++] = (q >> 16) & 0xff
    if (o < out.length) out[o++] = (q >> 8) & 0xff
    if (o < out.length) out[o++] = q & 0xff
  }
  return out
}

// ── Constant-time comparison ────────────────────────────────────────────────

/**
 * Compare two MACs without leaking WHERE they differ.
 *
 * A loop that returns early leaks, through timing, how many leading bytes an
 * attacker got right — which turns a 2^64 forgery into eight rounds of a 2^8
 * search. This accumulates with OR over every byte and branches once, at the
 * end, on the accumulator.
 *
 * HONEST LIMIT: JavaScript has no `volatile`. ql_crypto.h can force its
 * compiler not to reintroduce an early exit; nothing here can force a JIT to the
 * same promise. So treat this as best-effort, and note the mitigating fact that
 * on the console side nothing today feeds attacker-controlled MACs to it at all
 * (the hub verifies on the radio side — see the header). If a future hub relays
 * raw Q1 lines, the verification wants to happen in the firmware or in a worker
 * that is not also holding a staff session, not in a React render path.
 */
export function macEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ── Key derivation ──────────────────────────────────────────────────────────

function subtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c || !c.subtle) {
    throw new Error(
      'hubCrypto: no WebCrypto. A browser needs a secure context (https or localhost); ' +
        'Node needs 18 or newer.',
    )
  }
  return c.subtle
}

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', toBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const sig = await subtle().sign('HMAC', k, toBuffer(bytesFromLatin1(message)))
  return new Uint8Array(sig)
}

/** WebCrypto wants an ArrayBuffer view it owns the bounds of; a subarray of a bigger buffer is a trap. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy.buffer
}

/**
 * Derive the two working keys and the fingerprint from a 16-byte PSK.
 *
 *   K_enc = HMAC-SHA256(PSK, "QL1-enc")[0..15]     16 bytes, the AES key
 *   K_mac = HMAC-SHA256(PSK, "QL1-mac")            all 32 bytes, the HMAC key
 *   fpr   = HMAC-SHA256(PSK, "QL1-fpr")[0..3]      8 uppercase hex, never secret
 *
 * THE PSK IS THE HMAC KEY AND THE LABEL IS THE MESSAGE. Get that the wrong way
 * round and two implementations derive different keys while both look correct,
 * and the symptom is every frame failing its MAC with nothing on the wire to say
 * which side is wrong. The labels are ASCII, seven bytes, no NUL terminator.
 *
 * CROSS-FILE CONTRACT with ql_crypto.h's ql_crypto_begin(): same labels, same
 * byte order, same truncation. firmware/tools/check-vectors.mjs asserts it
 * against the known-answer vectors in PROTOCOL.md §5. If you change anything
 * here, that tool must go red — if it does not, it has stopped guarding.
 *
 * The derived keys are imported non-extractable, and the PSK bytes handed in are
 * not retained. There is nothing to clear afterwards because nothing is kept;
 * note that JavaScript cannot promise the caller's own array is wiped, which is
 * one more reason the park key does not belong in a browser tab.
 */
export async function deriveKeys(psk: Uint8Array): Promise<QlKeys> {
  if (psk.length !== PSK_LEN) {
    throw new RangeError(`hubCrypto: PSK must be ${PSK_LEN} bytes, got ${psk.length}`)
  }
  const encBytes = (await hmacSha256(psk, 'QL1-enc')).subarray(0, KENC_LEN)
  const macBytes = await hmacSha256(psk, 'QL1-mac')
  const fprBytes = (await hmacSha256(psk, 'QL1-fpr')).subarray(0, 4)

  const enc = await subtle().importKey('raw', toBuffer(encBytes), { name: 'AES-CTR' }, false, [
    'encrypt',
    'decrypt',
  ])
  const mac = await subtle().importKey(
    'raw',
    toBuffer(macBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return { enc, mac, fingerprint: hex(fprBytes) }
}

/**
 * Eight uppercase hex characters identifying WHICH key a board holds, without
 * revealing any of it.
 *
 * The bench procedure is literally "all twenty-two boards print the same eight
 * characters" — it is the only cheap way to catch one board provisioned from the
 * wrong file, and it can be read aloud across a workshop because it is an HMAC
 * output, not the key.
 */
export async function keyFingerprint(psk: Uint8Array): Promise<string> {
  if (psk.length !== PSK_LEN) {
    throw new RangeError(`hubCrypto: PSK must be ${PSK_LEN} bytes, got ${psk.length}`)
  }
  return hex((await hmacSha256(psk, 'QL1-fpr')).subarray(0, 4))
}

// ── Nonce ───────────────────────────────────────────────────────────────────

/**
 * Nonce = SRC(1) || TYPE-ascii(1) || SEQ(4 BE) || EPOCH(4 BE) || 6 zero bytes.
 *
 *   byte  0      SRC        the sending address (0 hub, 1..23 places)
 *   byte  1      TYPE       the frame-type letter, as its ASCII byte
 *   bytes 2..5   SEQ        big-endian uint32
 *   bytes 6..9   EPOCH      big-endian uint32
 *   bytes 10..13 0x00       reserved padding
 *   bytes 14..15 counter    big-endian block counter, starts at 0
 *
 * SEQ and EPOCH are BIG-ENDIAN (network order). An ambiguity here is a field-only
 * bug: two implementations that disagree each produce a self-consistent
 * keystream, so the bench passes on one vendor's boards and every frame fails on
 * the other's — and the symptom is a MAC error, which points at the key, not at
 * the nonce.
 *
 * DO NOT SHRINK THE RESERVED PADDING "to use the space". It is what stops a
 * long frame's block counter walking into EPOCH. The longest legal frame is 158
 * bytes = 10 AES blocks, so only byte 15 ever moves.
 *
 * EPOCH is in the nonce because (SRC, SEQ) is unique only while a board's NVS
 * counter survives. A REFLASH, an NVS erase or a board swap restarts SEQ near
 * zero, and the same (SRC, SEQ) then recurs with different plaintext — which in
 * CTR mode is keystream reuse, and the two plaintexts XOR to each other.
 */
export function qlNonce(src: number, type: string, seq: number, epoch: number): Uint8Array {
  const out = new Uint8Array(NONCE_LEN)
  out[0] = src & 0xff
  out[1] = type.charCodeAt(0) & 0xff
  out[2] = (seq >>> 24) & 0xff
  out[3] = (seq >>> 16) & 0xff
  out[4] = (seq >>> 8) & 0xff
  out[5] = seq & 0xff
  out[6] = (epoch >>> 24) & 0xff
  out[7] = (epoch >>> 16) & 0xff
  out[8] = (epoch >>> 8) & 0xff
  out[9] = epoch & 0xff
  // bytes 10..15 stay zero: 10..13 reserved, 14..15 the block counter.
  return out
}

/**
 * AES-128-CTR, forward-only, with the counter in the low 16 bits.
 *
 * `length: 16` tells WebCrypto that only the last two bytes of the block are the
 * counter, which is the same region ql_crypto.h reserves. mbedtls counts the
 * whole 16-byte block as one big-endian integer, but on a frame of at most 10
 * blocks the two agree exactly — and pinning it here means a hypothetical
 * overlong frame WRAPS inside the counter rather than carrying into EPOCH.
 *
 * CTR is symmetric: encrypt and decrypt are the same operation, which is why
 * ql_crypto.h calls mbedtls_aes_setkey_ENC on both paths. There is no decrypt
 * direction to get wrong.
 */
async function aesCtr(key: CryptoKey, nonce: Uint8Array, input: Uint8Array): Promise<Uint8Array> {
  const out = await subtle().encrypt(
    { name: 'AES-CTR', counter: toBuffer(nonce), length: 16 },
    key,
    toBuffer(input),
  )
  return new Uint8Array(out)
}

// ── Strict decimal ──────────────────────────────────────────────────────────

/**
 * Decimal with no leading zeros, no sign, no whitespace — ql_parse_u32's rules.
 *
 * Leading zeros are refused because one value must have exactly one spelling: a
 * LoRa retry has to be BYTE-IDENTICAL to the frame it repeats, and the console's
 * L1 dedupe key is `${st}:${seq}`, so a differently-spelled retry becomes a
 * SECOND CHECK-IN for a guest who tapped once.
 */
function parseU32(text: string, max: number): number | null {
  if (text.length === 0) return null
  if (text.length > 1 && text.charCodeAt(0) === 0x30) return null
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x30 || c > 0x39) return null
  }
  const v = Number(text)
  if (!Number.isSafeInteger(v) || v > max) return null
  return v
}

// ── Seal ────────────────────────────────────────────────────────────────────

/**
 * Wrap a plaintext payload into a complete, sealed, newline-terminated Q1 line.
 *
 * A RETRANSMISSION MUST RE-SEND THE STORED BYTES, NOT RE-CALL THIS FUNCTION.
 * Two reasons, either sufficient on its own:
 *   1. re-sealing with the same (SRC, TYPE, SEQ, EPOCH) and even slightly
 *      different plaintext — a TS that ticked, a queue depth that moved — is CTR
 *      keystream reuse, the one failure the whole design is arranged to avoid;
 *   2. the console's L1 dedupe key is `${st}:${seq}` and it swallows an exact
 *      repeat, so a retry that differs anywhere becomes a second check-in for a
 *      guest who tapped once.
 * Seal once, store the line, put those exact bytes on the air every time.
 *
 * This one DOES throw, unlike openLine, and the asymmetry is the point: openLine
 * is fed attacker-supplied bytes and must treat garbage as data, while
 * everything reaching sealLine came from our own code. A bad type letter or an
 * over-long payload here is a programmer error, and a programmer error that
 * returns a quiet null is a frame that never goes out with nothing to say why.
 */
export async function sealLine(
  keys: QlKeys,
  header: QlSealHeader,
  plaintext: string,
): Promise<string> {
  if (!isKnownType(header.type)) {
    throw new RangeError(`hubCrypto: unknown frame type ${JSON.stringify(header.type)}`)
  }
  if (!Number.isInteger(header.dst) || header.dst < 0 || header.dst > 255) {
    throw new RangeError(`hubCrypto: DST ${header.dst} is outside 0..255`)
  }
  if (header.src !== ADDR_HUB && (header.src < ADDR_ST_MIN || header.src > ADDR_ST_MAX)) {
    // 255 is broadcast: a destination, never a source.
    throw new RangeError(`hubCrypto: SRC ${header.src} is not the hub or an addressable place`)
  }
  if (!Number.isInteger(header.seq) || header.seq < 0 || header.seq > U32_MAX) {
    throw new RangeError(`hubCrypto: SEQ ${header.seq} is outside 0..${U32_MAX}`)
  }
  if (!Number.isInteger(header.epoch) || header.epoch < 0 || header.epoch > U32_MAX) {
    throw new RangeError(`hubCrypto: EPOCH ${header.epoch} is outside 0..${U32_MAX}`)
  }

  const plain = bytesFromLatin1(plaintext)
  if (plain.length > PLAIN_MAX) {
    throw new RangeError(
      `hubCrypto: ${plain.length} bytes of plaintext exceeds QL_PLAIN_MAX (${PLAIN_MAX}). ` +
        'A frame past that ceiling is silently truncated by the radio, which is the half-applied ' +
        'table stage-then-commit exists to prevent.',
    )
  }
  if (plain.indexOf(0) !== -1) {
    throw new RangeError('hubCrypto: a NUL in the plaintext would truncate every splitter downstream')
  }

  // 1. Encrypt, then build the blob: EPOCH cleartext big-endian, then the
  //    ciphertext. The receiver needs EPOCH to rebuild the nonce and the seven
  //    field line has no header slot for it. It is still AUTHENTICATED, because
  //    the MAC covers the whole line and the payload field is part of the line.
  const nonce = qlNonce(header.src, header.type, header.seq, header.epoch)
  const cipher = await aesCtr(keys.enc, nonce, plain)

  const blob = new Uint8Array(EPOCH_PREFIX_LEN + cipher.length)
  blob[0] = (header.epoch >>> 24) & 0xff
  blob[1] = (header.epoch >>> 16) & 0xff
  blob[2] = (header.epoch >>> 8) & 0xff
  blob[3] = header.epoch & 0xff
  blob.set(cipher, EPOCH_PREFIX_LEN)

  const payload = base64Encode(blob)
  if (payload.length > PAYLOAD_B64_MAX) {
    throw new RangeError(`hubCrypto: payload field is ${payload.length} chars, over ${PAYLOAD_B64_MAX}`)
  }

  // 2. The covered region: the whole line up to AND INCLUDING the '|' that
  //    precedes the MAC. Including the separator is not decoration — it means the
  //    covered bytes end at an unambiguous byte, so a payload that happened to
  //    end in something pipe-like cannot be re-cut into a different field split
  //    with the same MAC.
  const covered = `${MAGIC}|${header.type}|${header.dst}|${header.src}|${header.seq}|${payload}|`

  // 3. MAC over exactly those bytes. Encrypt-then-MAC.
  const sig = await subtle().sign('HMAC', keys.mac, toBuffer(bytesFromLatin1(covered)))
  const macB64 = base64Encode(new Uint8Array(sig).subarray(0, MAC_LEN))

  const line = `${covered}${macB64}\n`
  if (line.length > LINE_MAX) {
    throw new RangeError(`hubCrypto: sealed line is ${line.length} bytes, over QL_LINE_MAX (${LINE_MAX})`)
  }
  return line
}

// ── Open ────────────────────────────────────────────────────────────────────

function refuse(reason: QlOpenReason, detail: string): QlOpenResult {
  return { ok: false, reason, detail }
}

/**
 * Verify, decrypt and hand back a Q1 line's header and plaintext payload.
 *
 * ORDER OF OPERATIONS, mirroring ql_line_open exactly. Every step is deliberate
 * and every one is a distinct outcome:
 *   1. length and charset on the WHOLE line          (cheapest, and no crypto)
 *   2. exactly seven fields, magic, header ranges    (structure, no crypto)
 *   3. DST filter                                    (routing; not our frame)
 *   4. base64 charset + decode both blobs
 *   5. MAC verify, constant time                     (authenticity)
 *   6. -- the CALLER does the replay check here --   (AFTER the MAC; see below)
 *   7. decrypt
 *   8. NUL check, then the CALLER validates the payload as though 5 never ran
 *
 * THE REPLAY CHECK BELONGS AFTER THE MAC, AND IT IS NOT IN THIS FUNCTION.
 * ql_crypto.h explains why at its replay-window block: if the replay check ran
 * first, one forged frame could push a peer's high-water mark to 0xFFFFFFFF and
 * every genuine frame after it would be dropped as stale — a ONE-PACKET
 * PERMANENT DENIAL OF SERVICE. This function stops at the MAC and hands the
 * caller an authenticated (EPOCH, SEQ) to compare; keeping the window out here
 * is also what stops a verifier accumulating per-peer state it has no business
 * owning. And note the other half of that rule: a replay rejection is not "do
 * nothing" — a station retransmits its TAP byte-identically until it is ACKed,
 * so a receiver must still re-send the ACK while declining to process twice.
 *
 * NEVER THROWS. Every failure is `{ ok: false, reason, detail }`, exactly like
 * hubProtocol.decodeLine, because everything arriving here is attacker-supplied.
 *
 * `self` is this node's address. A line addressed to anyone else, other than
 * broadcast (255), comes back `not-for-us` — which is not an error and is not
 * counted as one.
 */
export async function openLine(keys: QlKeys, line: string, self: number): Promise<QlOpenResult> {
  // ── 1. length and charset, on the whole line ──────────────────────────────
  // A trailing newline is the frame terminator, not content.
  let end = line.length
  while (end > 0) {
    const c = line.charCodeAt(end - 1)
    if (c !== 0x0a && c !== 0x0d) break
    end--
  }
  const body = line.slice(0, end)

  if (body.length === 0) return refuse('malformed', 'empty line')
  if (body.length > LINE_MAX) {
    return refuse('malformed', `${body.length} bytes, over QL_LINE_MAX (${LINE_MAX})`)
  }
  // Printable ASCII throughout. Nothing on this wire is free text, so a control
  // byte or a high byte is by definition not ours.
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i)
    if (c < 0x20 || c > 0x7e) {
      return refuse('malformed', `byte 0x${c.toString(16)} at offset ${i} is not printable ASCII`)
    }
  }

  // ── 2. exactly seven fields, magic, header ranges ─────────────────────────
  const f = body.split('|')
  if (f.length !== 7) return refuse('malformed', `${f.length} fields, expected exactly 7`)
  if (f[0] !== MAGIC) return refuse('malformed', `magic ${JSON.stringify(f[0])}, expected "Q1"`)
  if (!isKnownType(f[1])) return refuse('malformed', `unknown frame type ${JSON.stringify(f[1])}`)

  const dst = parseU32(f[2], 255)
  if (dst === null) return refuse('malformed', `DST ${JSON.stringify(f[2])} is not 0..255`)
  const src = parseU32(f[3], 255)
  if (src === null) return refuse('malformed', `SRC ${JSON.stringify(f[3])} is not 0..255`)
  const seq = parseU32(f[4], U32_MAX)
  if (seq === null) return refuse('malformed', `SEQ ${JSON.stringify(f[4])} is not 0..${U32_MAX}`)
  // SRC must be a real node. 255 is broadcast — a destination, never a source.
  if (src !== ADDR_HUB && (src < ADDR_ST_MIN || src > ADDR_ST_MAX)) {
    return refuse('malformed', `SRC ${src} is neither the hub nor an addressable place`)
  }

  // ── 3. DST filter ─────────────────────────────────────────────────────────
  if (dst !== self && dst !== ADDR_BROADCAST) {
    return refuse('not-for-us', `addressed to ${dst}, we are ${self}`)
  }

  // ── 4. base64 charset + decode both blobs ─────────────────────────────────
  if (f[5].length === 0 || f[5].length > PAYLOAD_B64_MAX) {
    return refuse('malformed', `payload field is ${f[5].length} chars, expected 1..${PAYLOAD_B64_MAX}`)
  }
  if (f[6].length !== MAC_B64_LEN) {
    return refuse('malformed', `MAC field is ${f[6].length} chars, expected exactly ${MAC_B64_LEN}`)
  }
  const blob = base64Decode(f[5])
  if (blob === null) return refuse('malformed', 'payload field is not valid padded base64')
  if (blob.length < EPOCH_PREFIX_LEN) {
    return refuse('malformed', `payload decodes to ${blob.length} bytes, too short for the epoch prefix`)
  }
  const theirMac = base64Decode(f[6])
  if (theirMac === null || theirMac.length !== MAC_LEN) {
    return refuse('malformed', `MAC field does not decode to ${MAC_LEN} bytes`)
  }

  // ── 5. MAC verify, constant time ──────────────────────────────────────────
  // The covered region is offset 0 through the '|' before the MAC field,
  // inclusive. `body.length - f[6].length` is the offset of the first MAC
  // character, so that count includes the separator by construction — the same
  // arithmetic ql_line_open does with `f[6] - work`. Char index is byte index
  // here because the charset gate in step 1 already proved the line is ASCII.
  const covered = body.slice(0, body.length - f[6].length)
  const sig = await subtle().sign('HMAC', keys.mac, toBuffer(bytesFromLatin1(covered)))
  const ourMac = new Uint8Array(sig).subarray(0, MAC_LEN)
  if (!macEqual(ourMac, theirMac)) {
    return refuse(
      'bad-mac',
      'the MAC did not verify. Either this frame was not sealed with our PSK, or a board is ' +
        'provisioned from the wrong key file — compare fingerprints before suspecting the radio.',
    )
  }

  // ── 6. the caller's replay check goes here, and only here ─────────────────

  // ── 7. decrypt ────────────────────────────────────────────────────────────
  // Multiply rather than shift for the top byte: `blob[0] << 24` is SIGNED in
  // JavaScript, so any epoch past 2038 would come back negative and rebuild a
  // different nonce than the sender used.
  const epoch = blob[0] * 0x1000000 + ((blob[1] << 16) | (blob[2] << 8) | blob[3])
  const cipher = blob.subarray(EPOCH_PREFIX_LEN)
  if (cipher.length > PLAIN_MAX) {
    return refuse('too-long', `${cipher.length} bytes of payload exceeds QL_PLAIN_MAX (${PLAIN_MAX})`)
  }
  const nonce = qlNonce(src, f[1], seq, epoch)
  const plain = await aesCtr(keys.enc, nonce, cipher)

  // ── 8. NUL check ──────────────────────────────────────────────────────────
  // A NUL inside the plaintext would truncate every splitter downstream and let
  // a sender hide trailing bytes from validation. No legal payload contains one.
  if (plain.indexOf(0) !== -1) {
    return refuse('malformed', 'the plaintext contains a NUL, which would hide bytes from validation')
  }

  return {
    ok: true,
    header: { type: f[1], dst, src, seq, epoch },
    plaintext: latin1FromBytes(plain),
  }
}
