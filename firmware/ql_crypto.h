// ql_crypto.h — sealing and opening a Q1 line.
//
// AES-128-CTR for confidentiality, truncated HMAC-SHA256 for authenticity,
// ENCRYPT-THEN-MAC, over mbedtls — which ships inside Arduino-ESP32, so this
// costs no new dependency and no library-manager step at bench assembly.
//
// This file owns the LINE, because the line is where the MAC boundary is.
// ql_proto.h owns the field layout and the payload codecs; ql_crypto.h wraps a
// payload into the seven-field line and takes it apart again.
//
//   Q1|<TYPE>|<DST>|<SRC>|<SEQ>|<B64(EPOCH || ciphertext)>|<B64(MAC[0..7])>\n
//
// ── WHAT THIS BUYS, AND WHAT IT DOES NOT ────────────────────────────────────
//
// It buys: nobody standing in the car park with a $30 SDR can read which pole
// is bound to which order, and nobody can inject a frame the park will act on
// without the per-park PSK. Combined with the replay window below, a recorded
// frame cannot be played back later either.
//
// It does NOT buy content validity. The MAC answers exactly one question — WHO
// SENT THIS — and a station is a $66 board on a post in a public wood, held
// shut by four screws, holding the PSK in its flash. A station that has been
// opened, or one that is simply buggy, produces perfectly authentic garbage.
// EVERY PARSER IN ql_proto.h THEREFORE VALIDATES AS THOUGH THE MAC DID NOT
// EXIST: exact field counts, per-field charsets, range checks before indexing.
// Authentication and validation are orthogonal. If a future change relaxes a
// bound because "it's authenticated anyway", that is the bug this paragraph is
// here to prevent.
//
// It also does not buy anything at the RFID layer. A MIFARE uid is a factory
// number read in the clear at 13.56 MHz; ~$5 clones one. That is an accepted
// risk in the plan — a clone steals a WALK, not money, because the Passage was
// spent at the booth — and the mitigation is the console's impossible-travel
// check, not this file.
//
// ── NO PLAINTEXT FALLBACK ───────────────────────────────────────────────────
//
// A board with no PSK in NVS refuses to transmit at all. It logs QL_LOG_NO_KEY
// over its service channel and stays on ambience. There is deliberately no
// "unencrypted if unprovisioned" mode, because a downgrade path IS a downgrade
// attack: an attacker who can make one station think it is unprovisioned gets
// the whole protocol in the clear. An unprovisioned board is a bench problem
// and must present as one.
//
// ── THE KEY IS NEVER IN THIS REPOSITORY ─────────────────────────────────────
//
// The per-park PSK is 16 random bytes written to NVS at bench assembly by
// tools/provision-key.mjs and it is NOT COMMITTED, not in an example, not in a
// test vector, not in a comment. The known-answer vectors in PROTOCOL.md use an
// obviously-fake counting pattern (00 01 02 ... 0F) and say so. If you ever
// need to check two boards hold the same key, print ql_key_fingerprint() — it
// is derived through HMAC and reveals nothing about the key itself.

#pragma once

#include <Preferences.h>
#include <mbedtls/aes.h>
#include <mbedtls/base64.h>
#include <mbedtls/md.h>
#include <mbedtls/platform_util.h>

#include "ql_proto.h"

// ── Sizes ───────────────────────────────────────────────────────────────────

#define QL_PSK_LEN 16
#define QL_KENC_LEN 16
#define QL_KMAC_LEN 32
/** Truncated to 8 bytes: 64 bits of forgery resistance on a link carrying a few frames a minute. */
#define QL_MAC_LEN 8
#define QL_MAC_B64_LEN 12  /* QL_B64_LEN(8) — exact, padding included */
#define QL_NONCE_LEN 16

/** NVS location the provisioning tool writes. Namespace is shared with the rest of the firmware. */
#define QL_NVS_NAMESPACE "questland"
#define QL_NVS_PSK_KEY "psk"

// ── Outcomes ────────────────────────────────────────────────────────────────

typedef enum {
  QL_RX_OK = 0,
  /** Structurally not a Q1 line: length, charset, field count, header ranges. */
  QL_RX_MALFORMED,
  /** Well-formed, but DST is neither us nor broadcast. Not an error — just not ours. */
  QL_RX_NOT_FOR_US,
  /** The MAC did not verify. See the policy note on ql_mac_failures(). */
  QL_RX_BAD_MAC,
  /** No PSK loaded. The board must not transmit and must not act on receptions. */
  QL_RX_NO_KEY,
  /** Decrypted, but the plaintext would not fit the caller's buffer. */
  QL_RX_TOO_LONG,
} QlRxResult;

// ── Key state ───────────────────────────────────────────────────────────────

static uint8_t ql_kenc_[QL_KENC_LEN];
static uint8_t ql_kmac_[QL_KMAC_LEN];
static char ql_fpr_[9];
static bool ql_key_ready_ = false;

/**
 * Failure counters. RAM only, reset on boot.
 *
 * ── THE POLICY, AND WHY ───────────────────────────────────────────────────
 *
 * A MAC failure is COUNTED LOCALLY AND REPORTED AT THE ENDPOINT. It is never
 * answered on the air, and it never produces a per-frame log frame.
 *
 * Not answered, because a reply to a bad MAC is an oracle: it tells an attacker
 * their frame reached us, which turns a blind guess into a feedback loop, and it
 * turns one forged packet into a guaranteed transmission — free battery drain
 * and free airtime denial for the cost of noise.
 *
 * Not silent either, because "drop it and say nothing" is how a mis-provisioned
 * board becomes a four-hour debugging session: a station with the wrong PSK and
 * a station with a dead radio look EXACTLY the same from the counter. So the
 * count rides out in the heartbeat's ERR field and, rate-limited to one per
 * minute, as a numeric QL_LOG_MAC_FAIL frame — both of which are authenticated
 * frames from a station we do trust, not a reply to the forger.
 *
 * On the HUB there is a third rule: a frame that fails its MAC produces NO
 * NDJSON LINE, ever. Unauthenticated content must not reach the console tab,
 * which is holding a staff Firestore session.
 */
static uint32_t ql_mac_fail_ = 0;
static uint32_t ql_replay_drop_ = 0;
static uint32_t ql_malformed_ = 0;

static inline uint32_t ql_mac_failures(void) { return ql_mac_fail_; }
static inline uint32_t ql_replay_drops(void) { return ql_replay_drop_; }
static inline uint32_t ql_malformed_frames(void) { return ql_malformed_; }

// ── Key loading and derivation ──────────────────────────────────────────────

static inline void ql_hmac_sha256(const uint8_t *key, size_t keyLen, const uint8_t *msg,
                                  size_t msgLen, uint8_t out[32]) {
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_hmac(info, key, keyLen, msg, msgLen, out);
}

/**
 * Load the PSK from NVS and derive the two working keys.
 *
 * ── WHY TWO KEYS AND NOT ONE ────────────────────────────────────────────────
 *
 * The plan says "per-park PSK", and using that one value directly as both the
 * AES key and the HMAC key would work — but reusing one key across two
 * primitives is the kind of shortcut that is fine until someone changes one of
 * them. Deriving is three lines and one HMAC each, done once at boot:
 *
 *   K_enc = HMAC-SHA256(PSK, "QL1-enc")[0..15]
 *   K_mac = HMAC-SHA256(PSK, "QL1-mac")        (all 32 bytes)
 *   fpr   = HMAC-SHA256(PSK, "QL1-fpr")[0..3]  (printed, never secret)
 *
 * The PSK is the HMAC KEY and the label is the MESSAGE — get that the wrong way
 * round and two implementations derive different keys while both look correct.
 *
 * ⚠ CROSS-FILE CONTRACT: the console's hubCrypto.ts must derive IDENTICALLY,
 * same labels, same byte order, same truncation. Nothing on the wire records
 * which derivation was used, so a mismatch presents as "every frame fails its
 * MAC" with no clue as to which side is wrong. The labels are ASCII with no NUL
 * terminator included.
 *
 * Returns false if there is no 16-byte PSK. The caller MUST then refuse to
 * transmit — see the no-plaintext-fallback note at the top of this file.
 */
static inline bool ql_crypto_begin(void) {
  uint8_t psk[QL_PSK_LEN];
  memset(psk, 0, sizeof(psk));
  ql_key_ready_ = false;

  Preferences prefs;
  if (!prefs.begin(QL_NVS_NAMESPACE, /*readOnly=*/true)) return false;
  size_t got = prefs.getBytesLength(QL_NVS_PSK_KEY);
  if (got != QL_PSK_LEN) {
    prefs.end();
    return false;
  }
  prefs.getBytes(QL_NVS_PSK_KEY, psk, QL_PSK_LEN);
  prefs.end();

  uint8_t out[32];
  ql_hmac_sha256(psk, QL_PSK_LEN, (const uint8_t *)"QL1-enc", 7, out);
  memcpy(ql_kenc_, out, QL_KENC_LEN);

  ql_hmac_sha256(psk, QL_PSK_LEN, (const uint8_t *)"QL1-mac", 7, ql_kmac_);

  ql_hmac_sha256(psk, QL_PSK_LEN, (const uint8_t *)"QL1-fpr", 7, out);
  ql_hex_encode(out, 4, ql_fpr_, sizeof(ql_fpr_));

  // Wipe the PSK and the scratch block. mbedtls_platform_zeroize, not memset:
  // a plain memset to a buffer that is never read again is dead-store-eliminated
  // by any optimising compiler, and the key stays in the stack frame.
  mbedtls_platform_zeroize(psk, sizeof(psk));
  mbedtls_platform_zeroize(out, sizeof(out));

  ql_key_ready_ = true;
  return true;
}

/** True once a PSK has been loaded. Nothing may be transmitted before this is true. */
static inline bool ql_crypto_ready(void) { return ql_key_ready_; }

/**
 * Eight uppercase hex characters identifying WHICH key this board holds,
 * without revealing any of it. Print it at boot and on the service channel: the
 * bench procedure is "all twenty-two boards show the same fingerprint", which is
 * the only cheap way to catch one board provisioned from the wrong file.
 */
static inline const char *ql_key_fingerprint(void) { return ql_key_ready_ ? ql_fpr_ : "--------"; }

// ── Nonce ───────────────────────────────────────────────────────────────────

/**
 * Nonce = SRC(1) || TYPE(1) || SEQ(4) || EPOCH(4), zero-padded to 16.
 *
 * ── BYTE ORDER, STATED EXPLICITLY ───────────────────────────────────────────
 *
 * SEQ and EPOCH are BIG-ENDIAN (network order, most significant byte first).
 * An ambiguity here is a field-only bug: two implementations that disagree
 * still each produce a self-consistent keystream, so the bench test passes on
 * one vendor's boards and every frame fails on the other's — and the failure
 * mode is a MAC error, which points at the key, not at the nonce.
 *
 *   byte  0      SRC        the sending address (0 hub, 1..23 places)
 *   byte  1      TYPE       the frame-type letter, as its ASCII byte
 *   bytes 2..5   SEQ        big-endian uint32
 *   bytes 6..9   EPOCH      big-endian uint32
 *   bytes 10..13 0x00       reserved padding
 *   bytes 14..15 counter    big-endian block counter, starts at 0
 *
 * ── WHY THE COUNTER LIVES IN THE LAST TWO BYTES ─────────────────────────────
 *
 * mbedtls_aes_crypt_ctr treats the whole 16-byte block as one big-endian
 * integer and increments it from byte 15 backwards. Our longest frame is 158
 * bytes = 10 AES blocks, so only byte 15 ever moves; the nonce proper cannot be
 * reached without 65536 blocks (1 MB) in a single frame, which the 255-byte
 * radio makes impossible. Do not shrink the reserved padding to "use the
 * space" — that is what stops a long frame's counter walking into EPOCH.
 *
 * ── WHY EPOCH IS IN HERE AT ALL ─────────────────────────────────────────────
 *
 * (SRC, SEQ) is already unique while a board's NVS counter survives, and the
 * 64-ahead reservation makes it brownout-proof. EPOCH covers the case the
 * reservation cannot: a REFLASH, an NVS erase, or a board swap, after which SEQ
 * restarts near zero and the same (SRC, SEQ) recurs with different plaintext.
 * In CTR mode that is keystream reuse — the two plaintexts XOR to each other and
 * the confidentiality of both is gone. EPOCH is the unix second at which this
 * board most recently began a fresh SEQ lineage, so a reflashed board can never
 * collide with its own past.
 */
static inline void ql_nonce(uint8_t src, char type, uint32_t seq, uint32_t epoch,
                            uint8_t out[QL_NONCE_LEN]) {
  memset(out, 0, QL_NONCE_LEN);
  out[0] = src;
  out[1] = (uint8_t)type;
  out[2] = (uint8_t)(seq >> 24);
  out[3] = (uint8_t)(seq >> 16);
  out[4] = (uint8_t)(seq >> 8);
  out[5] = (uint8_t)(seq);
  out[6] = (uint8_t)(epoch >> 24);
  out[7] = (uint8_t)(epoch >> 16);
  out[8] = (uint8_t)(epoch >> 8);
  out[9] = (uint8_t)(epoch);
  // bytes 10..15 stay zero: 10..13 reserved, 14..15 the block counter.
}

// ── Base64 ──────────────────────────────────────────────────────────────────
//
// RFC 4648 STANDARD alphabet (A-Z a-z 0-9 '+' '/') WITH '=' padding.
//
// Standard, not URL-safe, because mbedtls only implements standard and a
// hand-rolled second alphabet is a second thing to get wrong. Padded, because
// mbedtls_base64_encode always pads and cannot be told not to — and because a
// padded field has a length that is a pure function of the payload length,
// which is what makes the static_assert in ql_proto.h a real bound.
//
// Neither '+' nor '/' nor '=' is the field delimiter '|', and none of them is a
// newline, so a base64 field can never move a field boundary. That is the
// property being relied on; do not switch alphabets without re-checking it.

static inline bool ql_b64_charset_ok(const char *s, size_t len) {
  for (size_t i = 0; i < len; i++) {
    char c = s[i];
    bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
              c == '+' || c == '/' || c == '=';
    if (!ok) return false;
  }
  return true;
}

/** Encode. `out` needs QL_B64_LEN(len) + 1 bytes. Returns encoded length, or 0. */
static inline size_t ql_b64_encode(const uint8_t *in, size_t len, char *out, size_t cap) {
  size_t olen = 0;
  if (mbedtls_base64_encode((unsigned char *)out, cap, &olen, in, len) != 0) return 0;
  return olen;
}

/** Decode, charset-checked FIRST so mbedtls never sees a byte outside the alphabet. */
static inline size_t ql_b64_decode(const char *in, size_t len, uint8_t *out, size_t cap) {
  if (!ql_b64_charset_ok(in, len)) return 0;
  size_t olen = 0;
  if (mbedtls_base64_decode(out, cap, &olen, (const unsigned char *)in, len) != 0) return 0;
  return olen;
}

// ── Constant-time comparison ────────────────────────────────────────────────

/**
 * Compare two MACs without leaking WHERE they differ.
 *
 * A byte-by-byte compare that returns early leaks, through timing, how many
 * leading bytes an attacker got right — which turns a 2^64 forgery into eight
 * rounds of a 2^8 search. Over a radio the measurement is noisy, but "noisy" is
 * not "impossible" and this costs eight XORs.
 *
 * `volatile` on the accumulator is load-bearing: without it a compiler is
 * entitled to notice the result is a boolean and reintroduce an early exit.
 */
static inline bool ql_ct_equal(const uint8_t *a, const uint8_t *b, size_t len) {
  volatile uint8_t diff = 0;
  for (size_t i = 0; i < len; i++) diff |= (uint8_t)(a[i] ^ b[i]);
  return diff == 0;
}

// ── Replay window ───────────────────────────────────────────────────────────
//
// Per-peer high-water mark on (EPOCH, SEQ), compared lexicographically. EPOCH
// first because a reflashed board restarts SEQ but never restarts EPOCH, so its
// first frame after the swap is still strictly newer than everything before it.
//
// THE MAC IS CHECKED BEFORE THIS. If the replay check ran first, an attacker
// could push our high-water mark to 0xFFFFFFFF with one forged frame and every
// genuine frame after it would be dropped as stale — a one-packet permanent
// denial of service. Order matters and it is: structure, MAC, replay, decrypt,
// payload validation.

typedef struct {
  uint32_t epoch;
  uint32_t seq;
  bool seen;
} QlPeer;

/**
 * Accept and advance, or reject as a replay.
 *
 * ⚠ A REJECTION IS NOT A "DO NOTHING". A station retransmits its TAP frame
 * byte-identically until the hub ACKs it, so the hub sees genuine duplicates as
 * a matter of routine — and if it merely drops them, the station retries four
 * times, gives up, and the guest's check-in sits in NVS until closing time. The
 * hub must still RE-SEND THE ACK for a replayed TAP (when pcReady) while
 * declining to process it a second time. See hub.ino.
 */
static inline bool ql_peer_accept(QlPeer *peer, uint32_t epoch, uint32_t seq) {
  if (!peer->seen) {
    peer->seen = true;
    peer->epoch = epoch;
    peer->seq = seq;
    return true;
  }
  if (epoch < peer->epoch) { ql_replay_drop_++; return false; }
  if (epoch == peer->epoch && seq <= peer->seq) { ql_replay_drop_++; return false; }
  peer->epoch = epoch;
  peer->seq = seq;
  return true;
}

// ── Seal ────────────────────────────────────────────────────────────────────

/**
 * Wrap a plaintext payload into a complete, sealed, newline-terminated Q1 line.
 *
 * ⚠ A RETRANSMISSION MUST RE-SEND THE STORED BYTES, NOT RE-CALL THIS FUNCTION.
 * Two reasons, either of which is sufficient:
 *   1. re-sealing with the same (SRC, TYPE, SEQ, EPOCH) and even slightly
 *      different plaintext — a TS that ticked, a queue depth that moved — is
 *      CTR keystream reuse, the one failure this whole file is arranged to
 *      avoid;
 *   2. the console's L1 dedupe key is `${st}:${seq}` and it swallows an exact
 *      repeat, so a retry that differs anywhere becomes a SECOND CHECK-IN for a
 *      guest who tapped once.
 * Seal once, store the line in the NVS ring, and put those exact bytes on the
 * air every time.
 *
 * Returns the line length (including the trailing '\n'), or 0.
 */
static inline size_t ql_line_seal(char type, uint8_t dst, uint8_t src, uint32_t seq, uint32_t epoch,
                                  const char *plain, size_t plainLen, char *out, size_t cap) {
  if (!ql_key_ready_) return 0;
  if (!ql_type_known(type)) return 0;
  if (plain == NULL || plainLen > QL_PLAIN_MAX) return 0;

  // 1. Encrypt. The payload blob is EPOCH (cleartext, big-endian) followed by
  //    the ciphertext — the receiver needs EPOCH to rebuild the nonce, and the
  //    seven-field line format has no header slot for it. It is authenticated,
  //    because the MAC covers the whole line up to the MAC and the blob is part
  //    of that line.
  uint8_t blob[QL_PAYLOAD_BLOB_MAX];
  blob[0] = (uint8_t)(epoch >> 24);
  blob[1] = (uint8_t)(epoch >> 16);
  blob[2] = (uint8_t)(epoch >> 8);
  blob[3] = (uint8_t)(epoch);

  uint8_t nonce[QL_NONCE_LEN];
  uint8_t stream[16];
  size_t ncOff = 0;
  ql_nonce(src, type, seq, epoch, nonce);

  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);
  // setkey_ENC even though we are "encrypting or decrypting": CTR only ever
  // runs the block cipher forward. Calling setkey_dec here produces a keystream
  // that is self-consistent and wrong, and the symptom is a MAC that verifies
  // followed by garbage plaintext — which sends you hunting in the parser.
  if (mbedtls_aes_setkey_enc(&aes, ql_kenc_, 128) != 0) {
    mbedtls_aes_free(&aes);
    return 0;
  }
  int rc = mbedtls_aes_crypt_ctr(&aes, plainLen, &ncOff, nonce, stream,
                                 (const unsigned char *)plain, blob + QL_EPOCH_PREFIX_LEN);
  mbedtls_aes_free(&aes);
  mbedtls_platform_zeroize(stream, sizeof(stream));
  if (rc != 0) return 0;

  size_t blobLen = QL_EPOCH_PREFIX_LEN + plainLen;

  char payload[QL_PAYLOAD_B64_MAX + 1];
  size_t payloadLen = ql_b64_encode(blob, blobLen, payload, sizeof(payload));
  if (payloadLen == 0) return 0;

  // 2. Build the line up to and including the '|' that precedes the MAC.
  QlBuf b = ql_buf(out, cap);
  ql_put(&b, QL_MAGIC);
  ql_putc(&b, '|');
  ql_putc(&b, type);
  ql_putc(&b, '|');
  ql_putu(&b, dst);
  ql_putc(&b, '|');
  ql_putu(&b, src);
  ql_putc(&b, '|');
  ql_putu(&b, seq);
  ql_putc(&b, '|');
  ql_put(&b, payload);
  ql_putc(&b, '|');
  if (!b.ok) return 0;

  // 3. MAC over EXACTLY those bytes — the entire line up to the MAC, INCLUDING
  //    the separator immediately before it. Including the separator is not
  //    decoration: it means the covered region ends at an unambiguous byte, so
  //    a payload that happened to end in something pipe-like cannot be re-cut
  //    into a different split with the same MAC.
  uint8_t mac[32];
  ql_hmac_sha256(ql_kmac_, QL_KMAC_LEN, (const uint8_t *)out, b.len, mac);

  char macB64[QL_MAC_B64_LEN + 1];
  if (ql_b64_encode(mac, QL_MAC_LEN, macB64, sizeof(macB64)) != QL_MAC_B64_LEN) return 0;
  ql_put(&b, macB64);
  ql_putc(&b, '\n');
  if (!b.ok || b.len > QL_LINE_MAX) return 0;
  return b.len;
}

// ── Open ────────────────────────────────────────────────────────────────────

/**
 * Verify, decrypt and hand back a Q1 line's header and plaintext payload.
 *
 * ORDER OF OPERATIONS, and every step is deliberate:
 *   1. length and charset on the WHOLE line          (cheapest, and no crypto)
 *   2. exactly seven fields, magic, header ranges    (structure, no crypto)
 *   3. DST filter                                    (routing; not our frame)
 *   4. base64 charset + decode both blobs
 *   5. MAC verify, constant time                     (authenticity)
 *   6. -- caller does the replay check here --       (AFTER the MAC, see above)
 *   7. decrypt
 *   8. -- caller validates the payload structure --  (as if 5 never happened)
 *
 * `line` is NOT modified; the caller keeps its receive buffer. The payload is
 * written to `plainOut` NUL-terminated so ql_proto.h's splitters can chew on it.
 */
static inline QlRxResult ql_line_open(const char *line, size_t len, uint8_t self, QlHeader *hdr,
                                      char *plainOut, size_t plainCap, size_t *plainLen) {
  if (!ql_key_ready_) return QL_RX_NO_KEY;
  if (line == NULL || hdr == NULL || plainOut == NULL) return QL_RX_MALFORMED;

  // A trailing newline is the frame terminator, not content.
  while (len && (line[len - 1] == '\n' || line[len - 1] == '\r')) len--;
  if (len == 0 || len > QL_LINE_MAX) { ql_malformed_++; return QL_RX_MALFORMED; }

  // Printable ASCII on the whole line. Nothing on this wire is free text, so a
  // control byte or a high byte is by definition not ours.
  for (size_t i = 0; i < len; i++) {
    if ((unsigned char)line[i] < 0x20 || (unsigned char)line[i] > 0x7E) {
      ql_malformed_++;
      return QL_RX_MALFORMED;
    }
  }

  // Exactly seven fields. A local writable copy, because splitting mutates.
  char work[QL_LINE_MAX + 1];
  memcpy(work, line, len);
  work[len] = '\0';
  char *f[7];
  if (!ql_split_exact(work, '|', f, 7)) { ql_malformed_++; return QL_RX_MALFORMED; }

  if (strcmp(f[0], QL_MAGIC) != 0) { ql_malformed_++; return QL_RX_MALFORMED; }
  if (strlen(f[1]) != 1 || !ql_type_known(f[1][0])) { ql_malformed_++; return QL_RX_MALFORMED; }

  uint32_t dst, src, seq;
  if (!ql_parse_u32(f[2], 255, &dst)) { ql_malformed_++; return QL_RX_MALFORMED; }
  if (!ql_parse_u32(f[3], 255, &src)) { ql_malformed_++; return QL_RX_MALFORMED; }
  if (!ql_parse_u32(f[4], QL_U32_MAX, &seq)) { ql_malformed_++; return QL_RX_MALFORMED; }
  // SRC must be a real node. 255 is broadcast — a destination, never a source.
  if (src != QL_ADDR_HUB && !ql_st_is_place((uint16_t)src)) { ql_malformed_++; return QL_RX_MALFORMED; }

  if (dst != self && dst != QL_ADDR_BROADCAST) return QL_RX_NOT_FOR_US;

  size_t payloadB64Len = strlen(f[5]);
  size_t macB64Len = strlen(f[6]);
  if (payloadB64Len == 0 || payloadB64Len > QL_PAYLOAD_B64_MAX) { ql_malformed_++; return QL_RX_MALFORMED; }
  if (macB64Len != QL_MAC_B64_LEN) { ql_malformed_++; return QL_RX_MALFORMED; }

  uint8_t blob[QL_PAYLOAD_BLOB_MAX];
  size_t blobLen = ql_b64_decode(f[5], payloadB64Len, blob, sizeof(blob));
  if (blobLen < QL_EPOCH_PREFIX_LEN) { ql_malformed_++; return QL_RX_MALFORMED; }

  uint8_t theirMac[QL_MAC_LEN];
  if (ql_b64_decode(f[6], macB64Len, theirMac, sizeof(theirMac)) != QL_MAC_LEN) {
    ql_malformed_++;
    return QL_RX_MALFORMED;
  }

  // The covered region: the original bytes from index 0 through the '|' before
  // the MAC field, inclusive. `f[6] - work` is the offset of the first MAC byte,
  // so that is exactly the count we want — the separator sits at offset-1 and is
  // included by construction.
  size_t covered = (size_t)(f[6] - work);
  uint8_t ourMac[32];
  ql_hmac_sha256(ql_kmac_, QL_KMAC_LEN, (const uint8_t *)line, covered, ourMac);
  if (!ql_ct_equal(ourMac, theirMac, QL_MAC_LEN)) {
    ql_mac_fail_++;
    return QL_RX_BAD_MAC;
  }

  uint32_t epoch = ((uint32_t)blob[0] << 24) | ((uint32_t)blob[1] << 16) |
                   ((uint32_t)blob[2] << 8) | (uint32_t)blob[3];

  size_t ctLen = blobLen - QL_EPOCH_PREFIX_LEN;
  if (ctLen > QL_PLAIN_MAX || ctLen + 1 > plainCap) return QL_RX_TOO_LONG;

  uint8_t nonce[QL_NONCE_LEN];
  uint8_t stream[16];
  size_t ncOff = 0;
  ql_nonce((uint8_t)src, f[1][0], seq, epoch, nonce);

  mbedtls_aes_context aes;
  mbedtls_aes_init(&aes);
  if (mbedtls_aes_setkey_enc(&aes, ql_kenc_, 128) != 0) {  // ENC: CTR is forward-only
    mbedtls_aes_free(&aes);
    return QL_RX_MALFORMED;
  }
  int rc = mbedtls_aes_crypt_ctr(&aes, ctLen, &ncOff, nonce, stream, blob + QL_EPOCH_PREFIX_LEN,
                                 (unsigned char *)plainOut);
  mbedtls_aes_free(&aes);
  mbedtls_platform_zeroize(stream, sizeof(stream));
  if (rc != 0) return QL_RX_MALFORMED;

  plainOut[ctLen] = '\0';
  // A NUL inside the plaintext would truncate every splitter downstream and let
  // a sender hide trailing bytes from validation. No legal payload contains one.
  if (strlen(plainOut) != ctLen) { ql_malformed_++; return QL_RX_MALFORMED; }
  *plainLen = ctLen;

  hdr->type = f[1][0];
  hdr->dst = (uint8_t)dst;
  hdr->src = (uint8_t)src;
  hdr->seq = seq;
  hdr->epoch = epoch;
  return QL_RX_OK;
}
