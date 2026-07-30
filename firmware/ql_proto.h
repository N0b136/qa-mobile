// ql_proto.h — the Questland wire, shared by every board in the park.
//
// Two wires meet in this file and they are NOT the same wire:
//
//   1. "Q1" — the LoRa line between a station in the woods and the hub at the
//      counter. Pipe-delimited, authenticated and encrypted (ql_crypto.h owns
//      the sealing; this file owns the field layout and the payload codecs).
//   2. NDJSON — the USB line between the hub and the console tab. One JSON
//      object per line. THE CONSOLE'S CODEC IS THE AUTHORITY HERE, not this
//      header: `questland/src/services/hubProtocol.ts` decides what is legal,
//      and `tools/sync-proto.mjs` asserts that the constants below still agree
//      with it. If you change a bound here and the guard fails, the guard is
//      right.
//
// The hub is the only board that touches both. A station never emits JSON and
// never sees a JSON byte.
//
// ── THE WIRE INVARIANT ──────────────────────────────────────────────────────
//
// NOTHING ON THE AIR IS FREE TEXT. Every field on both wires is a hex uid, a
// single enum letter, or a bounded integer. The flag-table rows are
// `uid:org:ep:state` — all hex and numeric — which is WHY the broadcast is
// injection-proof, and the `L` LOG frame carries a numeric code with numeric
// arguments rather than a message string for the same reason.
//
// The first person who wants a station to greet a party by name will propose
// putting `groupName` in the flag table. THAT is the change this invariant
// exists to stop. A name is guest-chosen bytes; the moment one rides in a
// semicolon-delimited row, a party called `A;B:1:2:0` re-writes the row after
// it, and the station's cached table quietly binds the wrong story to the wrong
// pole. There is no escaping scheme here on purpose — the answer is that the
// data has no room for a delimiter, not that the delimiter is escaped.
//
// ── THE RFID UID IS ATTACKER-SUPPLIED BYTES ─────────────────────────────────
//
// A uid is whatever was held against a reader: a $5 clone, a phone emulating a
// tag, a deliberately malformed response. It is safe on this wire ONLY because
// the firmware HEX-ENCODES the bytes the reader returns (`ql_hex_encode`) and
// never passes them through. Hex has no delimiter in it, no NUL, no newline and
// no shell character, so a hostile tag cannot reach the field boundaries. This
// is an invariant, not an accident: if you ever find yourself copying reader
// bytes into a payload with memcpy, you have removed the only thing protecting
// the parser at the far end.
//
// ── AUTHENTICATION AND VALIDATION ARE ORTHOGONAL ────────────────────────────
//
// ql_crypto.h puts a truncated HMAC on every Q1 line. That MAC answers exactly
// one question: WHO SENT THIS. It says nothing whatever about whether the
// content is well-formed, and a station is a $66 board on a post in a public
// wood that can be opened with a screwdriver — a station that is buggy, or one
// that has been opened, holds the park PSK and can therefore produce perfectly
// authentic garbage. Every parser below validates STRUCTURE INDEPENDENTLY OF
// THE MAC: exact field count, per-field charset, per-field length, and numeric
// range checks BEFORE any value is used as an index. Do not let the arrival of
// the crypto justify relaxing one of them.

#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// ── Protocol identity ───────────────────────────────────────────────────────

/** The first field of every Q1 line. Bump only for an incompatible change. */
#define QL_MAGIC "Q1"
#define QL_MAGIC_LEN 2

/** Firmware build, reported in the `H` heartbeat and the hub's NDJSON `hub` frame. 0..65535. */
#ifndef QL_FW_BUILD
#define QL_FW_BUILD 1
#endif

// ── Addressing ──────────────────────────────────────────────────────────────
//
// The LoRa address IS the console's station number. There is no mapping table
// and there must never be one: `hubProtocol.ts` derives 1..21 from the canon
// STATION_COORDS order, then 22 chief, then 23 gate, and the moment firmware
// keeps a second copy of that ordering the two can drift without either side
// noticing until a guest hears the wrong plinth's audio.
//
// 0 and 255 are RADIO-ONLY. A `st` of 0 or 255 on the USB wire is refused by
// the console outright, so the hub must never relay one — see ql_st_is_place().

#define QL_ADDR_HUB 0
#define QL_ADDR_ST_MIN 1
/** 21 — the last canon plinth. 22 and 23 are places, not plinths. */
#define QL_ADDR_PLINTH_MAX 21
/** 22 — the Chief's House, the quest start. A reader, not one of the canon 21. */
#define QL_ADDR_CHIEF 22
/** 23 — the gate; a guest read here is in the Village of Queston. */
#define QL_ADDR_GATE 23
/** 23 — highest addressable place. Anything above this except 255 is illegal. */
#define QL_ADDR_ST_MAX 23
#define QL_ADDR_BROADCAST 255

/** True for an address the console will accept in a `st` field. */
static inline bool ql_st_is_place(uint16_t addr) {
  return addr >= QL_ADDR_ST_MIN && addr <= QL_ADDR_ST_MAX;
}

// ── Q1 frame types ──────────────────────────────────────────────────────────
//
// One uppercase letter, cleartext, in the second field. It is part of the nonce
// (see ql_crypto.h), so it must be exactly one byte and must never be reused
// for a second meaning.

#define QL_T_TAP 'T'      // st -> hub   UIDHEX,TS,ORG,EP,RES        needs ACK
#define QL_T_ACK 'A'      // hub -> st   OK                          sent only when pcReady
#define QL_T_QUERY 'Q'    // st -> hub   UIDHEX                      only if ACK landed, RESOLVE did not
#define QL_T_RESOLVE 'R'  // hub -> st   UIDHEX,ORG,EP,STATE,TTL
#define QL_T_BEACON 'V'   // hub -> 255  TABLEVER,COUNT,TABLECRC,EPOCH,QUIET
#define QL_T_CHUNK 'U'    // hub -> *    VER,IDX,TOTAL,E;E;...
#define QL_T_SYNC 'S'     // st -> hub   HAVEVER,WANTVER,MISSINGHEX
#define QL_T_HB 'H'       // st -> hub   UPS,TBLVER,TBLAGE,QDEPTH,SD,DF,ERR,RSSI,VOL,FW
#define QL_T_CMD 'C'      // hub -> st   VERB,ARG
#define QL_T_CMDACK 'K'   // st -> hub   VERB,RESULT
#define QL_T_LOG 'L'      // st -> hub   LEVEL,CODE,A1,A2

static inline bool ql_type_known(char t) {
  switch (t) {
    case QL_T_TAP: case QL_T_ACK: case QL_T_QUERY: case QL_T_RESOLVE:
    case QL_T_BEACON: case QL_T_CHUNK: case QL_T_SYNC: case QL_T_HB:
    case QL_T_CMD: case QL_T_CMDACK: case QL_T_LOG:
      return true;
    default:
      return false;
  }
}

// ── Enumerations that cross both wires ──────────────────────────────────────

/** `RES` on a TAP. Mirrors HubTapResult in questland/src/types.ts. */
#define QL_RES_LOCAL 'L'   // resolved from a COMMITTED table row
#define QL_RES_QUERY 'Q'   // resolved from a cached RESOLVE answer, not a committed table
#define QL_RES_UNRESOLVED 'U'  // not resolved at all: SILENCE, and keep asking

/**
 * Audio folder = order. PHYSICAL numbers, written on twenty-one SD cards, not
 * derived from any array order. `flagService.ORG_WIRE` holds the same mapping;
 * renumbering either means re-cutting every card in the park.
 */
#define QL_ORG_UNKNOWN 0
#define QL_ORG_RANGERS 1
#define QL_ORG_ALEHIIM 2
#define QL_ORG_ELM 3
#define QL_ORG_RAID 4

/** Folders that are not orders. There is deliberately NO fallback narrative folder. */
#define QL_FOLDER_SYSTEM 8
#define QL_FOLDER_AMBIENCE 9
#define QL_TRK_OUT_OF_SERVICE 4  // {8,4}
#define QL_TRK_RETURN 5          // {8,5}

/** `STATE` on the wire. 2 (returned) is written when the booth pad takes a pole back. */
#define QL_STATE_ASSIGNED 0
#define QL_STATE_SEALED 1
#define QL_STATE_RETURNED 2

/** `C`/`K` command verbs. No REBOOT and no queue-wipe in v1, deliberately. */
#define QL_CMD_VOL "VOL"
#define QL_CMD_QVOL "QVOL"
#define QL_CMD_PLAY "PLAY"
#define QL_CMD_SYNC "SYNC"
#define QL_CMD_PING "PING"

// ── Field bounds ────────────────────────────────────────────────────────────
//
// EVERY ONE OF THESE MIRRORS hubProtocol.ts. tools/sync-proto.mjs parses both
// files and asserts they match; a bound that drifts is a frame the console
// silently drops as `range`, which on a plinth reads as "the audio just stopped
// working" with nothing in any log to say why.

#define QL_UID_MIN 8
#define QL_UID_MAX 20
#define QL_ORG_MIN 0
#define QL_ORG_MAX 4
#define QL_EP_MIN 0
#define QL_EP_MAX 10
#define QL_STATE_MIN 0
#define QL_STATE_MAX 2
#define QL_PARTY_MIN 0
#define QL_PARTY_MAX 99
#define QL_TTL_MAX 86400u
#define QL_RSSI_MIN (-200)
#define QL_RSSI_MAX 20
#define QL_VOL_MAX 30
#define QL_LVL_MAX 7
#define QL_U16_MAX 65535u
#define QL_U32_MAX 4294967295u

/**
 * `tblver` is a MILLISECOND EPOCH bounded to 2^53-1, not a u32 counter.
 *
 * It is `max(flag.tableAt)` on the console side — the newest write that changed
 * the broadcast — so today it is ~1.78e12 and it needs 41 bits. Carry it as
 * uint64_t everywhere. A station that truncates it to 32 bits compares a
 * garbage number against the beacon's and reads as PERMANENTLY STALE: it will
 * resync, commit, and still report stale on its very next heartbeat, forever.
 */
#define QL_TBLVER_MAX 9007199254740991ull

/**
 * `a1`/`a2` on a LOG frame are bounded -4294967295..4294967295. That does NOT
 * fit in int32_t. Hold them in int64_t. A firmware using int32 clamps silently
 * and the one diagnostic that was supposed to survive the wire invariant stops
 * being trustworthy.
 */
#define QL_LOG_ARG_MIN (-4294967295ll)
#define QL_LOG_ARG_MAX (4294967295ll)

/** The console's NDJSON line ceiling (hubProtocol.MAX_LINE). Never emit longer. */
#define QL_NDJSON_MAX 16384
/** Rows per NDJSON `table` chunk (hubProtocol.TABLE_CHUNK_ROWS). The hub must accept this many. */
#define QL_NDJSON_TABLE_CHUNK_ROWS 64
/**
 * The console drops anything past 120 NDJSON lines in a rolling second and
 * counts it as rate-limited — it does NOT queue it. Draining a large NVS tap
 * backlog at full tilt therefore LOSES taps. Throttle the drain below this.
 */
#define QL_NDJSON_MAX_FRAMES_PER_SEC 120

// ── Q1 line geometry ────────────────────────────────────────────────────────
//
//   Q1|<TYPE>|<DST>|<SRC>|<SEQ>|<B64(EPOCH || ciphertext)>|<B64(MAC[0..7])>\n
//
// Seven fields, six pipes. The header fields stay cleartext because they are
// needed for routing AND because they are the nonce.
//
// The whole line must fit one SX1276 packet (255 bytes, explicit header), so
// the plaintext ceiling below is derived from that, not chosen. If you raise
// QL_PLAIN_MAX the static_assert at the bottom of this block will fail — that
// assert is the only thing standing between you and a table chunk that is
// silently truncated by the radio, which is precisely the half-applied table
// stage-then-commit exists to prevent.

#define QL_LINE_MAX 255

/** Fixed cost: "Q1|" + T + "|" + DST(3) + "|" + SRC(3) + "|" + SEQ(10) + "|" + "|" + MAC b64(12) + "\n". */
#define QL_LINE_OVERHEAD 38

/** base64 of n bytes, unpadded length. RFC 4648 with '=' padding, so this is exact. */
#define QL_B64_LEN(n) ((((n) + 2) / 3) * 4)

/** Bytes of cleartext epoch prefixed to the ciphertext inside the payload field. See ql_crypto.h. */
#define QL_EPOCH_PREFIX_LEN 4

/** Longest plaintext payload any frame may carry. */
#define QL_PLAIN_MAX 158

#define QL_PAYLOAD_BLOB_MAX (QL_EPOCH_PREFIX_LEN + QL_PLAIN_MAX)
#define QL_PAYLOAD_B64_MAX QL_B64_LEN(QL_PAYLOAD_BLOB_MAX)

#ifdef __cplusplus
static_assert(QL_LINE_OVERHEAD + QL_PAYLOAD_B64_MAX <= QL_LINE_MAX,
              "a sealed Q1 line must fit one SX1276 packet");
#endif

/**
 * Entries per `U` CHUNK frame.
 *
 * THE PLAN SAID 6. It is 4, and this is a deliberate correction, not a typo.
 * An entry is `UIDHEX:ORG:EP:STATE`; a 10-byte tag uid is 20 hex characters and
 * is perfectly legal (UID_RE admits 8..20), so a worst-case entry is 27 bytes.
 * Six of them plus the `VER,IDX,TOTAL,` prefix is 188 bytes of plaintext — 30
 * past the ceiling above. It fits today only because the tags in the BOM happen
 * to be 7-byte NTAG213s; the first 10-byte MIFARE in the rack would overflow
 * the frame, and a chunk that overflows is a chunk that never arrives, so the
 * station stages forever and never commits. Four entries fit ANY legal uid.
 */
#define QL_CHUNK_ENTRIES 4

/** Chunk indices a station will track while staging. 256 chunks x 4 = 1024 poles. */
#define QL_CHUNK_MAX 256
#define QL_SYNC_BITMAP_BYTES (QL_CHUNK_MAX / 8)

// ── Q1 header ───────────────────────────────────────────────────────────────

typedef struct {
  char type;
  uint8_t dst;
  uint8_t src;
  uint32_t seq;
  /** Cleartext, carried in the first 4 bytes of the payload field. See ql_crypto.h. */
  uint32_t epoch;
} QlHeader;

// ── Payload structs ─────────────────────────────────────────────────────────

typedef struct {
  char uid[QL_UID_MAX + 1];
  /**
   * Epoch SECONDS, from the beacon's EPOCH. 0 when the station has never heard
   * a beacon and therefore has no clock.
   *
   * NEVER put millis() here, and never milliseconds: the console bounds `ts` to
   * 0..4294967295 and silently drops the whole frame as `range/ts` if it is
   * larger. A millisecond epoch is ~1.78e12. This is the single most likely
   * first-boot bug in the whole project, and it presents as "taps do nothing".
   * 0 is in range, so a clockless station still gets its guest checked in — the
   * console ignores `ts` anyway and stamps with its own clock.
   */
  uint32_t ts;
  uint8_t org;
  uint8_t ep;
  char res;
} QlTap;

typedef struct {
  char uid[QL_UID_MAX + 1];
  uint8_t org;
  uint8_t ep;
  uint8_t state;
  uint32_t ttl;
} QlResolve;

typedef struct {
  uint64_t tableVer;
  uint16_t count;
  uint32_t tableCrc;
  uint32_t epoch;
  /** Seconds for which stations should suppress NON-URGENT uplinks (H, L, S). Taps still go. */
  uint16_t quiet;
} QlBeacon;

typedef struct {
  uint32_t ups;
  uint64_t tblver;
  /**
   * Seconds since this station last COMMITTED a table.
   *
   * "Which version do you hold" and "when did you last hear from the hub" are
   * DIFFERENT QUESTIONS and staff asked for the second. A station holding the
   * current version with a TBLAGE of nine hours is a station whose radio died
   * shortly after the last rebinding — it looks perfect on version alone.
   */
  uint32_t tblage;
  uint16_t qdepth;
  /** 1 = HEALTHY, 0 = fault. Naming these after faults and setting 1 on error inverts the board. */
  uint8_t sd;
  uint8_t df;
  uint16_t err;
  int16_t rssi;
  uint8_t vol;
  uint16_t fw;
} QlHeartbeat;

typedef struct {
  uint8_t lvl;
  uint16_t code;
  int64_t a1;
  int64_t a2;
} QlLog;

typedef struct {
  uint64_t haveVer;
  uint64_t wantVer;
  uint8_t missing[QL_SYNC_BITMAP_BYTES];
  uint8_t missingBytes;
} QlSync;

/** One flag-table row AS IT CROSSES LoRa. Note: no partySize — that field never leaves USB. */
typedef struct {
  char uid[QL_UID_MAX + 1];
  uint8_t org;
  uint8_t ep;
  uint8_t state;
} QlRow;

typedef struct {
  uint64_t ver;
  uint16_t idx;
  uint16_t total;
  QlRow rows[QL_CHUNK_ENTRIES];
  uint8_t count;
} QlChunk;

typedef struct {
  char verb[8];
  uint32_t arg;
} QlCmd;

// ── Numeric log codes ───────────────────────────────────────────────────────
//
// The `L` frame was the one free-text exception on the air and it is now this
// enum plus two numbers. Keep them stable: the console will eventually chart
// them, and a renumbered code silently rewrites history.

#define QL_LOG_BOOT 100             // a1 = reset reason, a2 = fw build
#define QL_LOG_CLOCK_ADOPTED 101    // a1 = epoch adopted
#define QL_LOG_TABLE_COMMIT 102     // a1 = row count, a2 = crc
#define QL_LOG_TABLE_CRC_FAIL 103   // a1 = computed crc, a2 = beacon crc
#define QL_LOG_RESYNC_START 104     // a1 = attempt, a2 = missing chunks
#define QL_LOG_RESYNC_GAVE_UP 105   // a1 = attempts, a2 = missing chunks
#define QL_LOG_UNRESOLVED_TAG 106   // a1 = consecutive unresolved taps
#define QL_LOG_MAC_FAIL 110         // a1 = total mac failures since boot
#define QL_LOG_REPLAY_DROP 111      // a1 = src, a2 = seq
#define QL_LOG_MALFORMED 112        // a1 = total malformed since boot, a2 = first bad byte offset
#define QL_LOG_NO_KEY 113           // no PSK in NVS: the board is refusing to transmit
#define QL_LOG_SD_FAULT 120
#define QL_LOG_DF_FAULT 121         // a1 = busy-timeout ms
/**
 * 122 — the MFRC522 stopped answering and was re-initialised. a1 = re-init
 * count since boot, a2 = the byte VersionReg returned (0x00 or 0xFF).
 *
 * Added with station.ino, in the 12x hardware-fault block beside SD and
 * DFPlayer, because a wedged reader is the single most operationally important
 * fault a plinth can have and the station had no way to say it: a latched
 * MFRC522 answers SPI perfectly and simply never sees another card, so the
 * plinth looks healthy on every other field of the heartbeat while every guest
 * who taps it gets nothing.
 */
#define QL_LOG_READER_FAULT 122
#define QL_LOG_QUEUE_HIGH 130       // a1 = depth
#define QL_LOG_QUEUE_FULL 131       // a1 = depth, a2 = taps discarded
#define QL_LOG_ACK_GAVE_UP 140      // a1 = attempts

// ── Small strict scanners ───────────────────────────────────────────────────
//
// Everything below rejects rather than repairs. There is exactly one legal
// encoding of every value on this wire and both ends are ours, so leniency buys
// nothing and costs a second interpretation — which is how a parser grows a
// place for two peers to disagree about what a frame said.

static inline bool ql_is_digit(char c) { return c >= '0' && c <= '9'; }

static inline bool ql_is_hex(char c) {
  return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F');
}

/**
 * Hex-encode reader bytes, uppercase, no separators. THE boundary the whole
 * parser's safety rests on — see the invariant at the top of this file.
 * Returns false if the result would not be a legal uid.
 */
static inline bool ql_hex_encode(const uint8_t *bytes, size_t len, char *out, size_t cap) {
  static const char HEX[] = "0123456789ABCDEF";
  if (bytes == NULL || out == NULL) return false;
  if (len * 2 + 1 > cap) return false;
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = HEX[(bytes[i] >> 4) & 0x0F];
    out[i * 2 + 1] = HEX[bytes[i] & 0x0F];
  }
  out[len * 2] = '\0';
  return len * 2 >= QL_UID_MIN && len * 2 <= QL_UID_MAX;
}

/**
 * The uid allowlist, byte for byte the same rule as hubProtocol.UID_RE
 * (/^[0-9A-F]{8,20}$/) applied after uppercasing.
 *
 * Note the one quirk of the console's implementation you must respect: its
 * length test runs BEFORE trim(), so a legal 20-character uid with a single
 * leading space is refused outright. Never emit padding, never emit a uid with
 * surrounding whitespace, and never lowercase one.
 */
static inline bool ql_uid_valid(const char *uid) {
  if (uid == NULL) return false;
  size_t n = strlen(uid);
  if (n < QL_UID_MIN || n > QL_UID_MAX) return false;
  for (size_t i = 0; i < n; i++) {
    if (!ql_is_hex(uid[i])) return false;
  }
  return true;
}

/**
 * Strict unsigned decimal. Rejects the empty string, a sign, whitespace,
 * anything non-digit, a leading zero on a multi-digit number, and overflow.
 *
 * Leading zeros are refused because they give one value two spellings, and a
 * LoRa retry must be BYTE-IDENTICAL to the frame it repeats (the console's L1
 * dedupe key is `${st}:${seq}` and a differently-spelled retry is a second
 * check-in). One spelling per value is how that stays true by construction.
 */
static inline bool ql_parse_u64(const char *s, uint64_t max, uint64_t *out) {
  if (s == NULL || *s == '\0') return false;
  if (s[0] == '0' && s[1] != '\0') return false;
  uint64_t v = 0;
  for (const char *p = s; *p; p++) {
    if (!ql_is_digit(*p)) return false;
    if (v > (UINT64_MAX - (uint64_t)(*p - '0')) / 10ull) return false;
    v = v * 10ull + (uint64_t)(*p - '0');
    if (v > max) return false;
  }
  *out = v;
  return true;
}

static inline bool ql_parse_u32(const char *s, uint32_t max, uint32_t *out) {
  uint64_t v;
  if (!ql_parse_u64(s, max, &v)) return false;
  *out = (uint32_t)v;
  return true;
}

/** Strict signed decimal for LOG args and RSSI. `-0` is refused; there is one spelling of zero. */
static inline bool ql_parse_i64(const char *s, int64_t lo, int64_t hi, int64_t *out) {
  if (s == NULL || *s == '\0') return false;
  bool neg = (*s == '-');
  const char *digits = neg ? s + 1 : s;
  if (neg && digits[0] == '0') return false;
  uint64_t mag;
  if (!ql_parse_u64(digits, (uint64_t)INT64_MAX, &mag)) return false;
  int64_t v = neg ? -(int64_t)mag : (int64_t)mag;
  if (v < lo || v > hi) return false;
  *out = v;
  return true;
}

/** Fixed-width uppercase hex, exactly `digits` characters. Used for TABLECRC and the sync bitmap. */
static inline bool ql_parse_hex_u32(const char *s, uint8_t digits, uint32_t *out) {
  if (s == NULL || strlen(s) != digits || digits > 8) return false;
  uint32_t v = 0;
  for (uint8_t i = 0; i < digits; i++) {
    char c = s[i];
    if (!ql_is_hex(c)) return false;
    v = (v << 4) | (uint32_t)(c <= '9' ? c - '0' : c - 'A' + 10);
  }
  *out = v;
  return true;
}

/**
 * Split a NUL-terminated, WRITABLE string on `sep` into exactly `want` fields.
 *
 * Mutates in place. By the time a payload reaches here the MAC has already been
 * verified, so the receive buffer is ours to chew on — but never pass a buffer
 * you still need intact.
 *
 * Returns false unless the field count is EXACTLY `want`. Not "at least": a
 * frame with an extra comma is not a frame with a bonus field, it is a frame
 * whose boundaries moved, and accepting it is how one payload becomes two
 * different readings.
 */
static inline bool ql_split_exact(char *s, char sep, char **out, int want) {
  if (s == NULL || out == NULL || want <= 0) return false;
  int n = 0;
  out[n++] = s;
  for (char *p = s; *p; p++) {
    if (*p == sep) {
      if (n >= want) return false;  // more fields than expected
      *p = '\0';
      out[n++] = p + 1;
    }
  }
  return n == want;
}

/** Split into AT MOST `cap` fields; returns the count, or -1 if there are more than `cap`. */
static inline int ql_split_upto(char *s, char sep, char **out, int cap) {
  if (s == NULL || out == NULL || cap <= 0) return -1;
  int n = 0;
  out[n++] = s;
  for (char *p = s; *p; p++) {
    if (*p == sep) {
      if (n >= cap) return -1;
      *p = '\0';
      out[n++] = p + 1;
    }
  }
  return n;
}

// ── Decimal writers ─────────────────────────────────────────────────────────
//
// Hand-rolled rather than snprintf("%llu") ON PURPOSE.
//
// newlib-nano — which several ESP32 board configurations link by default — can
// be built without long-long support in printf. When it is, "%llu" prints
// nonsense (commonly the low word, or the literal text) with no warning at
// compile time or run time. The one 64-bit field on this wire is `tblver`, and
// a station that reports a mangled tblver reads as permanently stale on the
// console's health map forever. Do not "simplify" these back to snprintf.

static inline size_t ql_u64_dec(uint64_t v, char *out, size_t cap) {
  char tmp[21];
  size_t n = 0;
  do {
    tmp[n++] = (char)('0' + (v % 10ull));
    v /= 10ull;
  } while (v && n < sizeof(tmp));
  if (n + 1 > cap) return 0;
  for (size_t i = 0; i < n; i++) out[i] = tmp[n - 1 - i];
  out[n] = '\0';
  return n;
}

static inline size_t ql_i64_dec(int64_t v, char *out, size_t cap) {
  if (v >= 0) return ql_u64_dec((uint64_t)v, out, cap);
  if (cap < 2) return 0;
  out[0] = '-';
  size_t n = ql_u64_dec((uint64_t)(-(v + 1)) + 1ull, out + 1, cap - 1);
  return n ? n + 1 : 0;
}

static inline size_t ql_hex_u32(uint32_t v, uint8_t digits, char *out, size_t cap) {
  static const char HEX[] = "0123456789ABCDEF";
  if (digits > 8 || (size_t)digits + 1 > cap) return 0;
  for (uint8_t i = 0; i < digits; i++) {
    out[digits - 1 - i] = HEX[(v >> (4 * i)) & 0x0F];
  }
  out[digits] = '\0';
  return digits;
}

// ── A bounded appender ──────────────────────────────────────────────────────
//
// Every encoder below writes through this. It latches `ok=false` on the first
// overflow and never writes again, so a caller can build a whole frame and
// check once at the end instead of checking each field — which is the pattern
// that actually gets written correctly at 3am.

typedef struct {
  char *buf;
  size_t cap;
  size_t len;
  bool ok;
} QlBuf;

static inline QlBuf ql_buf(char *buf, size_t cap) {
  QlBuf b;
  b.buf = buf;
  b.cap = cap;
  b.len = 0;
  b.ok = (buf != NULL && cap > 0);
  if (b.ok) buf[0] = '\0';
  return b;
}

static inline void ql_put(QlBuf *b, const char *s) {
  if (!b->ok || s == NULL) { b->ok = false; return; }
  size_t n = strlen(s);
  if (b->len + n + 1 > b->cap) { b->ok = false; return; }
  memcpy(b->buf + b->len, s, n + 1);
  b->len += n;
}

static inline void ql_putc(QlBuf *b, char c) {
  if (!b->ok) return;
  if (b->len + 2 > b->cap) { b->ok = false; return; }
  b->buf[b->len++] = c;
  b->buf[b->len] = '\0';
}

static inline void ql_putu(QlBuf *b, uint64_t v) {
  if (!b->ok) return;
  char tmp[21];
  if (!ql_u64_dec(v, tmp, sizeof(tmp))) { b->ok = false; return; }
  ql_put(b, tmp);
}

static inline void ql_puti(QlBuf *b, int64_t v) {
  if (!b->ok) return;
  char tmp[22];
  if (!ql_i64_dec(v, tmp, sizeof(tmp))) { b->ok = false; return; }
  ql_put(b, tmp);
}

// ── The table CRC ───────────────────────────────────────────────────────────
//
// CRC-32/ISO-HDLC (the zlib/Ethernet one): reflected polynomial 0xEDB88320,
// init 0xFFFFFFFF, final XOR 0xFFFFFFFF.
//
// The CANONICAL SERIALISATION is part of the protocol, not an implementation
// detail, because the station compares its computed CRC against the BEACON's
// TABLECRC and refuses to commit on a mismatch (correction #3). Both ends must
// build the same bytes:
//
//   rows sorted by uid, byte-ascending (plain strcmp)
//   for each row: "UIDHEX:ORG:EP:STATE;"   — decimal, no padding, TRAILING ';'
//
// `partySize` is NOT included: it does not cross LoRa at all, so a station could
// not compute it. The console-side sort is `uid.localeCompare`, which for the
// pure [0-9A-F] uid charset gives the same order as strcmp — and if it ever did
// not, the CRC would mismatch, the station would refuse the table and log
// QL_LOG_TABLE_CRC_FAIL. That is a loud failure, which is the point: the
// alternative to a strict CRC is twenty-one stations quietly holding twenty-one
// slightly different tables.

static inline uint32_t ql_crc32_update(uint32_t crc, const uint8_t *data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int k = 0; k < 8; k++) {
      crc = (crc >> 1) ^ (0xEDB88320u & (uint32_t)(-(int32_t)(crc & 1)));
    }
  }
  return crc;
}

static inline uint32_t ql_crc32_begin(void) { return 0xFFFFFFFFu; }
static inline uint32_t ql_crc32_end(uint32_t crc) { return crc ^ 0xFFFFFFFFu; }

/** Feed one row's canonical bytes. Call for every row in uid order, then ql_crc32_end(). */
static inline uint32_t ql_crc32_row(uint32_t crc, const QlRow *row) {
  char tmp[QL_UID_MAX + 12];
  QlBuf b = ql_buf(tmp, sizeof(tmp));
  ql_put(&b, row->uid);
  ql_putc(&b, ':');
  ql_putu(&b, row->org);
  ql_putc(&b, ':');
  ql_putu(&b, row->ep);
  ql_putc(&b, ':');
  ql_putu(&b, row->state);
  ql_putc(&b, ';');
  if (!b.ok) return crc;
  return ql_crc32_update(crc, (const uint8_t *)tmp, b.len);
}

// ── Q1 payload encoders ─────────────────────────────────────────────────────
//
// Each writes the PRE-ENCRYPTION payload. ql_crypto.h::ql_line_seal takes it
// from here, prefixes the epoch, encrypts, MACs and assembles the line.

static inline bool ql_pay_tap(const QlTap *t, char *out, size_t cap) {
  if (!ql_uid_valid(t->uid)) return false;
  if (t->org > QL_ORG_MAX || t->ep > QL_EP_MAX) return false;
  if (t->res != QL_RES_LOCAL && t->res != QL_RES_QUERY && t->res != QL_RES_UNRESOLVED) return false;
  QlBuf b = ql_buf(out, cap);
  ql_put(&b, t->uid);
  ql_putc(&b, ',');
  ql_putu(&b, t->ts);
  ql_putc(&b, ',');
  ql_putu(&b, t->org);
  ql_putc(&b, ',');
  ql_putu(&b, t->ep);
  ql_putc(&b, ',');
  ql_putc(&b, t->res);
  return b.ok;
}

static inline bool ql_pay_query(const char *uid, char *out, size_t cap) {
  if (!ql_uid_valid(uid)) return false;
  QlBuf b = ql_buf(out, cap);
  ql_put(&b, uid);
  return b.ok;
}

static inline bool ql_pay_ack(char *out, size_t cap) {
  QlBuf b = ql_buf(out, cap);
  ql_put(&b, "OK");
  return b.ok;
}

static inline bool ql_pay_resolve(const QlResolve *r, char *out, size_t cap) {
  if (!ql_uid_valid(r->uid)) return false;
  if (r->org > QL_ORG_MAX || r->ep > QL_EP_MAX || r->state > QL_STATE_MAX || r->ttl > QL_TTL_MAX) return false;
  QlBuf b = ql_buf(out, cap);
  ql_put(&b, r->uid);
  ql_putc(&b, ',');
  ql_putu(&b, r->org);
  ql_putc(&b, ',');
  ql_putu(&b, r->ep);
  ql_putc(&b, ',');
  ql_putu(&b, r->state);
  ql_putc(&b, ',');
  ql_putu(&b, r->ttl);
  return b.ok;
}

static inline bool ql_pay_beacon(const QlBeacon *v, char *out, size_t cap) {
  if (v->tableVer > QL_TBLVER_MAX) return false;
  char crc[9];
  if (!ql_hex_u32(v->tableCrc, 8, crc, sizeof(crc))) return false;
  QlBuf b = ql_buf(out, cap);
  ql_putu(&b, v->tableVer);
  ql_putc(&b, ',');
  ql_putu(&b, v->count);
  ql_putc(&b, ',');
  ql_put(&b, crc);
  ql_putc(&b, ',');
  ql_putu(&b, v->epoch);
  ql_putc(&b, ',');
  ql_putu(&b, v->quiet);
  return b.ok;
}

static inline bool ql_pay_chunk(const QlChunk *c, char *out, size_t cap) {
  if (c->ver > QL_TBLVER_MAX) return false;
  if (c->count > QL_CHUNK_ENTRIES) return false;
  if (c->total == 0 || c->total > QL_CHUNK_MAX || c->idx >= c->total) return false;
  QlBuf b = ql_buf(out, cap);
  ql_putu(&b, c->ver);
  ql_putc(&b, ',');
  ql_putu(&b, c->idx);
  ql_putc(&b, ',');
  ql_putu(&b, c->total);
  ql_putc(&b, ',');
  for (uint8_t i = 0; i < c->count; i++) {
    const QlRow *r = &c->rows[i];
    if (!ql_uid_valid(r->uid) || r->org > QL_ORG_MAX || r->ep > QL_EP_MAX || r->state > QL_STATE_MAX) {
      return false;
    }
    if (i) ql_putc(&b, ';');
    ql_put(&b, r->uid);
    ql_putc(&b, ':');
    ql_putu(&b, r->org);
    ql_putc(&b, ':');
    ql_putu(&b, r->ep);
    ql_putc(&b, ':');
    ql_putu(&b, r->state);
  }
  return b.ok;
}

static inline bool ql_pay_sync(const QlSync *s, char *out, size_t cap) {
  if (s->missingBytes > QL_SYNC_BITMAP_BYTES) return false;
  QlBuf b = ql_buf(out, cap);
  ql_putu(&b, s->haveVer);
  ql_putc(&b, ',');
  ql_putu(&b, s->wantVer);
  ql_putc(&b, ',');
  // Bitmap: byte j holds chunk indices 8j..8j+7, bit (i%8) with bit0 = lowest
  // index. Emitted byte 0 first, two uppercase hex digits per byte. An empty
  // bitmap is spelled "00" rather than "" — a field is never allowed to vanish,
  // because a vanished field is a moved boundary.
  if (s->missingBytes == 0) {
    ql_put(&b, "00");
  } else {
    for (uint8_t j = 0; j < s->missingBytes; j++) {
      char hx[3];
      ql_hex_u32(s->missing[j], 2, hx, sizeof(hx));
      ql_put(&b, hx);
    }
  }
  return b.ok;
}

static inline bool ql_pay_hb(const QlHeartbeat *h, char *out, size_t cap) {
  if (h->tblver > QL_TBLVER_MAX) return false;
  if (h->sd > 1 || h->df > 1 || h->vol > QL_VOL_MAX) return false;
  if (h->rssi < QL_RSSI_MIN || h->rssi > QL_RSSI_MAX) return false;
  QlBuf b = ql_buf(out, cap);
  ql_putu(&b, h->ups);
  ql_putc(&b, ',');
  ql_putu(&b, h->tblver);
  ql_putc(&b, ',');
  ql_putu(&b, h->tblage);
  ql_putc(&b, ',');
  ql_putu(&b, h->qdepth);
  ql_putc(&b, ',');
  ql_putu(&b, h->sd);
  ql_putc(&b, ',');
  ql_putu(&b, h->df);
  ql_putc(&b, ',');
  ql_putu(&b, h->err);
  ql_putc(&b, ',');
  ql_puti(&b, h->rssi);
  ql_putc(&b, ',');
  ql_putu(&b, h->vol);
  ql_putc(&b, ',');
  ql_putu(&b, h->fw);
  return b.ok;
}

static inline bool ql_pay_log(const QlLog *l, char *out, size_t cap) {
  if (l->lvl > QL_LVL_MAX) return false;
  if (l->a1 < QL_LOG_ARG_MIN || l->a1 > QL_LOG_ARG_MAX) return false;
  if (l->a2 < QL_LOG_ARG_MIN || l->a2 > QL_LOG_ARG_MAX) return false;
  QlBuf b = ql_buf(out, cap);
  ql_putu(&b, l->lvl);
  ql_putc(&b, ',');
  ql_putu(&b, l->code);
  ql_putc(&b, ',');
  ql_puti(&b, l->a1);
  ql_putc(&b, ',');
  ql_puti(&b, l->a2);
  return b.ok;
}

static inline bool ql_cmd_verb_known(const char *v) {
  return strcmp(v, QL_CMD_VOL) == 0 || strcmp(v, QL_CMD_QVOL) == 0 ||
         strcmp(v, QL_CMD_PLAY) == 0 || strcmp(v, QL_CMD_SYNC) == 0 ||
         strcmp(v, QL_CMD_PING) == 0;
}

static inline bool ql_pay_cmd(const QlCmd *c, char *out, size_t cap) {
  if (!ql_cmd_verb_known(c->verb) || c->arg > QL_U16_MAX) return false;
  QlBuf b = ql_buf(out, cap);
  ql_put(&b, c->verb);
  ql_putc(&b, ',');
  ql_putu(&b, c->arg);
  return b.ok;
}

// ── Q1 payload decoders ─────────────────────────────────────────────────────
//
// Called AFTER decryption and AFTER MAC verification, and written as though
// neither had happened. Read the note at the top of this file about why.

static inline bool ql_read_tap(char *payload, QlTap *out) {
  char *f[5];
  if (!ql_split_exact(payload, ',', f, 5)) return false;
  if (!ql_uid_valid(f[0])) return false;
  uint32_t ts, org, ep;
  if (!ql_parse_u32(f[1], QL_U32_MAX, &ts)) return false;
  if (!ql_parse_u32(f[2], QL_ORG_MAX, &org)) return false;
  if (!ql_parse_u32(f[3], QL_EP_MAX, &ep)) return false;
  if (strlen(f[4]) != 1) return false;
  char res = f[4][0];
  if (res != QL_RES_LOCAL && res != QL_RES_QUERY && res != QL_RES_UNRESOLVED) return false;
  memset(out, 0, sizeof(*out));
  strncpy(out->uid, f[0], QL_UID_MAX);
  out->ts = ts;
  out->org = (uint8_t)org;
  out->ep = (uint8_t)ep;
  out->res = res;
  return true;
}

static inline bool ql_read_query(char *payload, char *uidOut, size_t cap) {
  if (!ql_uid_valid(payload)) return false;
  if (strlen(payload) + 1 > cap) return false;
  strcpy(uidOut, payload);
  return true;
}

static inline bool ql_read_ack(const char *payload) { return strcmp(payload, "OK") == 0; }

static inline bool ql_read_resolve(char *payload, QlResolve *out) {
  char *f[5];
  if (!ql_split_exact(payload, ',', f, 5)) return false;
  if (!ql_uid_valid(f[0])) return false;
  uint32_t org, ep, state, ttl;
  if (!ql_parse_u32(f[1], QL_ORG_MAX, &org)) return false;
  if (!ql_parse_u32(f[2], QL_EP_MAX, &ep)) return false;
  if (!ql_parse_u32(f[3], QL_STATE_MAX, &state)) return false;
  if (!ql_parse_u32(f[4], QL_TTL_MAX, &ttl)) return false;
  memset(out, 0, sizeof(*out));
  strncpy(out->uid, f[0], QL_UID_MAX);
  out->org = (uint8_t)org;
  out->ep = (uint8_t)ep;
  out->state = (uint8_t)state;
  out->ttl = ttl;
  return true;
}

static inline bool ql_read_beacon(char *payload, QlBeacon *out) {
  char *f[5];
  if (!ql_split_exact(payload, ',', f, 5)) return false;
  uint64_t ver;
  uint32_t count, crc, epoch, quiet;
  if (!ql_parse_u64(f[0], QL_TBLVER_MAX, &ver)) return false;
  if (!ql_parse_u32(f[1], QL_U16_MAX, &count)) return false;
  if (!ql_parse_hex_u32(f[2], 8, &crc)) return false;
  if (!ql_parse_u32(f[3], QL_U32_MAX, &epoch)) return false;
  if (!ql_parse_u32(f[4], 3600, &quiet)) return false;
  out->tableVer = ver;
  out->count = (uint16_t)count;
  out->tableCrc = crc;
  out->epoch = epoch;
  out->quiet = (uint16_t)quiet;
  return true;
}

static inline bool ql_read_chunk(char *payload, QlChunk *out) {
  // VER,IDX,TOTAL,rest — split on the FIRST THREE commas only; the entry list
  // that follows is semicolon-delimited and may not contain a comma at all.
  char *f[4];
  if (!ql_split_exact(payload, ',', f, 4)) return false;
  uint64_t ver;
  uint32_t idx, total;
  if (!ql_parse_u64(f[0], QL_TBLVER_MAX, &ver)) return false;
  if (!ql_parse_u32(f[1], QL_CHUNK_MAX - 1, &idx)) return false;
  if (!ql_parse_u32(f[2], QL_CHUNK_MAX, &total)) return false;
  if (total == 0 || idx >= total) return false;

  memset(out, 0, sizeof(*out));
  out->ver = ver;
  out->idx = (uint16_t)idx;
  out->total = (uint16_t)total;

  // An empty entry list is legal: "the park holds no bindings at version v" is
  // information, and the console sends exactly one empty chunk to say it.
  if (f[3][0] == '\0') return true;

  char *ent[QL_CHUNK_ENTRIES];
  int n = ql_split_upto(f[3], ';', ent, QL_CHUNK_ENTRIES);
  if (n < 0) return false;
  for (int i = 0; i < n; i++) {
    char *p[4];
    if (!ql_split_exact(ent[i], ':', p, 4)) return false;
    if (!ql_uid_valid(p[0])) return false;
    uint32_t org, ep, state;
    if (!ql_parse_u32(p[1], QL_ORG_MAX, &org)) return false;
    if (!ql_parse_u32(p[2], QL_EP_MAX, &ep)) return false;
    if (!ql_parse_u32(p[3], QL_STATE_MAX, &state)) return false;
    strncpy(out->rows[i].uid, p[0], QL_UID_MAX);
    out->rows[i].org = (uint8_t)org;
    out->rows[i].ep = (uint8_t)ep;
    out->rows[i].state = (uint8_t)state;
  }
  out->count = (uint8_t)n;
  return true;
}

static inline bool ql_read_sync(char *payload, QlSync *out) {
  char *f[3];
  if (!ql_split_exact(payload, ',', f, 3)) return false;
  uint64_t have, want;
  if (!ql_parse_u64(f[0], QL_TBLVER_MAX, &have)) return false;
  if (!ql_parse_u64(f[1], QL_TBLVER_MAX, &want)) return false;
  size_t hexLen = strlen(f[2]);
  if (hexLen == 0 || (hexLen % 2) != 0 || hexLen / 2 > QL_SYNC_BITMAP_BYTES) return false;
  memset(out, 0, sizeof(*out));
  for (size_t j = 0; j < hexLen / 2; j++) {
    char pair[3] = {f[2][j * 2], f[2][j * 2 + 1], '\0'};
    uint32_t byte;
    if (!ql_parse_hex_u32(pair, 2, &byte)) return false;
    out->missing[j] = (uint8_t)byte;
  }
  out->haveVer = have;
  out->wantVer = want;
  out->missingBytes = (uint8_t)(hexLen / 2);
  return true;
}

static inline bool ql_read_hb(char *payload, QlHeartbeat *out) {
  char *f[10];
  if (!ql_split_exact(payload, ',', f, 10)) return false;
  uint32_t ups, tblage, qd, sd, df, err, vol, fw;
  uint64_t tblver;
  int64_t rssi;
  if (!ql_parse_u32(f[0], QL_U32_MAX, &ups)) return false;
  if (!ql_parse_u64(f[1], QL_TBLVER_MAX, &tblver)) return false;
  if (!ql_parse_u32(f[2], QL_U32_MAX, &tblage)) return false;
  if (!ql_parse_u32(f[3], QL_U16_MAX, &qd)) return false;
  if (!ql_parse_u32(f[4], 1, &sd)) return false;
  if (!ql_parse_u32(f[5], 1, &df)) return false;
  if (!ql_parse_u32(f[6], QL_U16_MAX, &err)) return false;
  if (!ql_parse_i64(f[7], QL_RSSI_MIN, QL_RSSI_MAX, &rssi)) return false;
  if (!ql_parse_u32(f[8], QL_VOL_MAX, &vol)) return false;
  if (!ql_parse_u32(f[9], QL_U16_MAX, &fw)) return false;
  out->ups = ups;
  out->tblver = tblver;
  out->tblage = tblage;
  out->qdepth = (uint16_t)qd;
  out->sd = (uint8_t)sd;
  out->df = (uint8_t)df;
  out->err = (uint16_t)err;
  out->rssi = (int16_t)rssi;
  out->vol = (uint8_t)vol;
  out->fw = (uint16_t)fw;
  return true;
}

static inline bool ql_read_log(char *payload, QlLog *out) {
  char *f[4];
  if (!ql_split_exact(payload, ',', f, 4)) return false;
  uint32_t lvl, code;
  int64_t a1, a2;
  if (!ql_parse_u32(f[0], QL_LVL_MAX, &lvl)) return false;
  if (!ql_parse_u32(f[1], QL_U16_MAX, &code)) return false;
  if (!ql_parse_i64(f[2], QL_LOG_ARG_MIN, QL_LOG_ARG_MAX, &a1)) return false;
  if (!ql_parse_i64(f[3], QL_LOG_ARG_MIN, QL_LOG_ARG_MAX, &a2)) return false;
  out->lvl = (uint8_t)lvl;
  out->code = (uint16_t)code;
  out->a1 = a1;
  out->a2 = a2;
  return true;
}

static inline bool ql_read_cmd(char *payload, QlCmd *out) {
  char *f[2];
  if (!ql_split_exact(payload, ',', f, 2)) return false;
  if (strlen(f[0]) + 1 > sizeof(out->verb)) return false;
  if (!ql_cmd_verb_known(f[0])) return false;
  uint32_t arg;
  if (!ql_parse_u32(f[1], QL_U16_MAX, &arg)) return false;
  strcpy(out->verb, f[0]);
  out->arg = arg;
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// NDJSON — the hub's USB tongue. HUB ONLY. A station never touches this half.
// ════════════════════════════════════════════════════════════════════════════
//
// Byte-identical to `hubProtocol.encodeLine`, which is the conformance test:
// run the same frame through both and diff. That means, exactly:
//
//   * the EXACT key set per frame type — a missing key, an extra key, or a
//     misspelling refuses the whole line as `field-count`. Do not add a MAC, a
//     protocol version, an RSSI on a tap or a debug string. The hub STRIPS all
//     LoRa framing before it prints;
//   * the canonical key ORDER below (decoding does not care, but byte-identity
//     does, and byte-identity is what makes hubSim worth trusting);
//   * unquoted JSON integers, no leading zeros, no '+', no decimal point;
//   * printable ASCII only, `\n` terminator, one complete line at a time;
//   * `partySize` is the ONLY camelCase key on this wire;
//   * `sd` and `df` are 1 = HEALTHY, 0 = fault;
//   * never emit `st` 0 or 255 — they are LoRa addresses and the console drops
//     the frame;
//   * never echo a console->hub frame back. `table`/`row`/`resolve`/`cmd`
//     decode fine inbound and then do nothing, so an echo just inflates the
//     frame counters and makes the status chip lie.

/** Longest NDJSON line this firmware will ever build. A 64-row table chunk fits. */
#define QL_NDJSON_BUF 4096

static inline void ql_json_key(QlBuf *b, const char *key, bool first) {
  if (!first) ql_putc(b, ',');
  ql_putc(b, '"');
  ql_put(b, key);
  ql_put(b, "\":");
}

static inline void ql_json_kv_u(QlBuf *b, const char *key, uint64_t v, bool first) {
  ql_json_key(b, key, first);
  ql_putu(b, v);
}

static inline void ql_json_kv_i(QlBuf *b, const char *key, int64_t v, bool first) {
  ql_json_key(b, key, first);
  ql_puti(b, v);
}

/**
 * A JSON string value. Only ever used for `t`, `uid`, `res` and `cmd`, every one
 * of which is drawn from a charset with no quote, no backslash and no control
 * character in it — so there is no escaping here and there must never need to
 * be. If you find yourself wanting an escaper, you are about to put free text on
 * the wire; read the invariant at the top of this file instead.
 */
static inline void ql_json_kv_s(QlBuf *b, const char *key, const char *v, bool first) {
  ql_json_key(b, key, first);
  ql_putc(b, '"');
  for (const char *p = v; *p; p++) {
    if (*p < 0x20 || *p > 0x7E || *p == '"' || *p == '\\') { b->ok = false; return; }
    ql_putc(b, *p);
  }
  ql_putc(b, '"');
}

/** {"t":"tap","st":..,"uid":"..","seq":..,"ts":..,"org":..,"ep":..,"res":".."} */
static inline size_t ql_ndjson_tap(char *out, size_t cap, uint8_t st, const QlTap *t, uint32_t seq) {
  if (!ql_st_is_place(st) || !ql_uid_valid(t->uid)) return 0;
  if (t->org > QL_ORG_MAX || t->ep > QL_EP_MAX) return 0;
  char res[2] = {t->res, '\0'};
  QlBuf b = ql_buf(out, cap);
  ql_putc(&b, '{');
  ql_json_kv_s(&b, "t", "tap", true);
  ql_json_kv_u(&b, "st", st, false);
  ql_json_kv_s(&b, "uid", t->uid, false);
  ql_json_kv_u(&b, "seq", seq, false);
  ql_json_kv_u(&b, "ts", t->ts, false);
  ql_json_kv_u(&b, "org", t->org, false);
  ql_json_kv_u(&b, "ep", t->ep, false);
  ql_json_kv_s(&b, "res", res, false);
  ql_put(&b, "}\n");
  return b.ok ? b.len : 0;
}

/**
 * {"t":"booth","uid":"..","ts":..}
 *
 * No `st` and no `seq`, so NOTHING DEDUPES A BOOTH FRAME. The hub must never
 * resend one: a retry is a second presentation at the pad, and the pad is where
 * a Passage gets spent. This is survivable only because the booth reader is
 * wired to the HUB ITSELF — there is no radio hop under it to retry.
 */
static inline size_t ql_ndjson_booth(char *out, size_t cap, const char *uid, uint32_t ts) {
  if (!ql_uid_valid(uid)) return 0;
  QlBuf b = ql_buf(out, cap);
  ql_putc(&b, '{');
  ql_json_kv_s(&b, "t", "booth", true);
  ql_json_kv_s(&b, "uid", uid, false);
  ql_json_kv_u(&b, "ts", ts, false);
  ql_put(&b, "}\n");
  return b.ok ? b.len : 0;
}

static inline size_t ql_ndjson_hb(char *out, size_t cap, uint8_t st, const QlHeartbeat *h) {
  if (!ql_st_is_place(st)) return 0;
  if (h->sd > 1 || h->df > 1 || h->vol > QL_VOL_MAX) return 0;
  if (h->rssi < QL_RSSI_MIN || h->rssi > QL_RSSI_MAX) return 0;
  if (h->tblver > QL_TBLVER_MAX) return 0;
  QlBuf b = ql_buf(out, cap);
  ql_putc(&b, '{');
  ql_json_kv_s(&b, "t", "hb", true);
  ql_json_kv_u(&b, "st", st, false);
  ql_json_kv_u(&b, "ups", h->ups, false);
  ql_json_kv_u(&b, "tblver", h->tblver, false);
  ql_json_kv_u(&b, "tblage", h->tblage, false);
  ql_json_kv_u(&b, "qd", h->qdepth, false);
  ql_json_kv_u(&b, "sd", h->sd, false);
  ql_json_kv_u(&b, "df", h->df, false);
  ql_json_kv_u(&b, "err", h->err, false);
  ql_json_kv_i(&b, "rssi", h->rssi, false);
  ql_json_kv_u(&b, "vol", h->vol, false);
  ql_json_kv_u(&b, "fw", h->fw, false);
  ql_put(&b, "}\n");
  return b.ok ? b.len : 0;
}

static inline size_t ql_ndjson_query(char *out, size_t cap, uint8_t st, const char *uid, uint32_t seq) {
  if (!ql_st_is_place(st) || !ql_uid_valid(uid)) return 0;
  QlBuf b = ql_buf(out, cap);
  ql_putc(&b, '{');
  ql_json_kv_s(&b, "t", "query", true);
  ql_json_kv_u(&b, "st", st, false);
  ql_json_kv_s(&b, "uid", uid, false);
  ql_json_kv_u(&b, "seq", seq, false);
  ql_put(&b, "}\n");
  return b.ok ? b.len : 0;
}

static inline size_t ql_ndjson_log(char *out, size_t cap, uint8_t st, const QlLog *l) {
  if (!ql_st_is_place(st) || l->lvl > QL_LVL_MAX) return 0;
  if (l->a1 < QL_LOG_ARG_MIN || l->a1 > QL_LOG_ARG_MAX) return 0;
  if (l->a2 < QL_LOG_ARG_MIN || l->a2 > QL_LOG_ARG_MAX) return 0;
  QlBuf b = ql_buf(out, cap);
  ql_putc(&b, '{');
  ql_json_kv_s(&b, "t", "log", true);
  ql_json_kv_u(&b, "st", st, false);
  ql_json_kv_u(&b, "lvl", l->lvl, false);
  ql_json_kv_u(&b, "code", l->code, false);
  ql_json_kv_i(&b, "a1", l->a1, false);
  ql_json_kv_i(&b, "a2", l->a2, false);
  ql_put(&b, "}\n");
  return b.ok ? b.len : 0;
}

/**
 * {"t":"hub","fw":..,"tblver":..,"stations":..,"up":..}
 *
 * THIS FRAME IS THE RESYNC TRIGGER, and it is the one the hub is most likely to
 * forget. `tapService` pushes the whole flag table only when
 * `frame.tblver < tableVersion()`, so a hub that never emits `hub` NEVER
 * RECEIVES THE FLAG TABLE after a reconnect, and every station in the park sits
 * silent on ambience with a current-looking version it got from nobody.
 *
 * Emit it: (a) the moment the USB host opens the port (DTR assert), (b) on every
 * table commit — which is what terminates the round trip, since the console
 * stops pushing once the reported version catches up — and (c) every 30 s
 * regardless, because a host-open signal is not reliable on every USB bridge and
 * a periodic emission costs nothing at 115200.
 */
static inline size_t ql_ndjson_hub(char *out, size_t cap, uint16_t fw, uint64_t tblver,
                                   uint16_t stations, uint32_t up) {
  if (tblver > QL_TBLVER_MAX || stations > 255) return 0;
  QlBuf b = ql_buf(out, cap);
  ql_putc(&b, '{');
  ql_json_kv_s(&b, "t", "hub", true);
  ql_json_kv_u(&b, "fw", fw, false);
  ql_json_kv_u(&b, "tblver", tblver, false);
  ql_json_kv_u(&b, "stations", stations, false);
  ql_json_kv_u(&b, "up", up, false);
  ql_put(&b, "}\n");
  return b.ok ? b.len : 0;
}

// ── NDJSON decode (console -> hub) ──────────────────────────────────────────
//
// Four frame types, and a deliberately narrow scanner rather than a general
// JSON parser. The console emits `JSON.stringify` output of a fixed shape: no
// whitespace, no escapes, no floats, no nesting beyond `rows`. Everything
// outside that is refused rather than interpreted — including a backslash,
// which cannot legally appear in ANY value on this wire, so an escape sequence
// is by definition not ours and refusing it removes the whole unescaping
// surface at a stroke.

typedef enum {
  QL_IN_NONE = 0,
  QL_IN_TABLE,
  QL_IN_ROW,
  QL_IN_RESOLVE,
  QL_IN_CMD,
} QlInboundType;

typedef struct {
  char uid[QL_UID_MAX + 1];
  uint8_t org;
  uint8_t ep;
  uint8_t state;
  uint8_t partySize;  // carried on USB only; never crosses LoRa
} QlJsonRow;

typedef struct {
  QlInboundType type;
  uint64_t ver;
  uint16_t idx;
  uint16_t of;
  uint8_t rowCount;
  QlJsonRow rows[QL_NDJSON_TABLE_CHUNK_ROWS];
  // resolve / cmd
  uint8_t st;
  uint32_t ttl;
  char verb[8];
  uint32_t arg;
} QlInbound;

static inline const char *ql_j_ws(const char *p) {
  while (*p == ' ') p++;
  return p;
}

static inline bool ql_j_lit(const char **p, char c) {
  const char *q = ql_j_ws(*p);
  if (*q != c) return false;
  *p = q + 1;
  return true;
}

/** A JSON string with NO escape handling: a backslash or a control byte is a refusal. */
static inline bool ql_j_str(const char **p, char *out, size_t cap) {
  const char *q = ql_j_ws(*p);
  if (*q != '"') return false;
  q++;
  size_t n = 0;
  while (*q && *q != '"') {
    if (*q == '\\' || (unsigned char)*q < 0x20 || (unsigned char)*q > 0x7E) return false;
    if (n + 1 >= cap) return false;
    out[n++] = *q++;
  }
  if (*q != '"') return false;
  out[n] = '\0';
  *p = q + 1;
  return true;
}

/** A JSON integer. Rejects '+', a leading zero, a decimal point and an exponent. */
static inline bool ql_j_int(const char **p, int64_t lo, int64_t hi, int64_t *out) {
  const char *q = ql_j_ws(*p);
  const char *start = q;
  if (*q == '-') q++;
  if (!ql_is_digit(*q)) return false;
  if (*q == '0' && ql_is_digit(q[1])) return false;
  while (ql_is_digit(*q)) q++;
  if (*q == '.' || *q == 'e' || *q == 'E' || *q == '+') return false;
  char tmp[24];
  size_t n = (size_t)(q - start);
  if (n + 1 > sizeof(tmp)) return false;
  memcpy(tmp, start, n);
  tmp[n] = '\0';
  if (!ql_parse_i64(tmp, lo, hi, out)) return false;
  *p = q;
  return true;
}

/**
 * One row object. Exact key set `uid, org, ep, state, partySize` — order-free,
 * duplicate-free, extra-free. The exact-set rule is also what closes
 * `__proto__`: after JSON.parse it is an own property, so on the TS side it is
 * simply an unexpected key; here it never gets a chance to be a key at all.
 */
static inline bool ql_j_row(const char **p, QlJsonRow *out) {
  if (!ql_j_lit(p, '{')) return false;
  uint8_t seen = 0;
  memset(out, 0, sizeof(*out));
  for (;;) {
    char key[16];
    if (!ql_j_str(p, key, sizeof(key))) return false;
    if (!ql_j_lit(p, ':')) return false;
    int64_t v;
    if (strcmp(key, "uid") == 0) {
      if (seen & 0x01) return false;
      seen |= 0x01;
      if (!ql_j_str(p, out->uid, sizeof(out->uid))) return false;
      if (!ql_uid_valid(out->uid)) return false;
    } else if (strcmp(key, "org") == 0) {
      if (seen & 0x02) return false;
      seen |= 0x02;
      if (!ql_j_int(p, QL_ORG_MIN, QL_ORG_MAX, &v)) return false;
      out->org = (uint8_t)v;
    } else if (strcmp(key, "ep") == 0) {
      if (seen & 0x04) return false;
      seen |= 0x04;
      if (!ql_j_int(p, QL_EP_MIN, QL_EP_MAX, &v)) return false;
      out->ep = (uint8_t)v;
    } else if (strcmp(key, "state") == 0) {
      if (seen & 0x08) return false;
      seen |= 0x08;
      if (!ql_j_int(p, QL_STATE_MIN, QL_STATE_MAX, &v)) return false;
      out->state = (uint8_t)v;
    } else if (strcmp(key, "partySize") == 0) {
      if (seen & 0x10) return false;
      seen |= 0x10;
      if (!ql_j_int(p, QL_PARTY_MIN, QL_PARTY_MAX, &v)) return false;
      out->partySize = (uint8_t)v;
    } else {
      return false;  // unknown key
    }
    if (ql_j_lit(p, ',')) continue;
    if (ql_j_lit(p, '}')) break;
    return false;
  }
  return seen == 0x1F;
}

/**
 * One NDJSON line from the console. `line` must be NUL-terminated and must NOT
 * contain its own newline; a single trailing CR is tolerated by the caller's
 * line splitter, not here.
 *
 * Returns false for anything it does not fully understand. Never repairs.
 */
static inline bool ql_ndjson_parse(const char *line, QlInbound *out) {
  if (line == NULL || out == NULL) return false;
  size_t len = strlen(line);
  if (len == 0 || len > QL_NDJSON_MAX) return false;
  for (size_t i = 0; i < len; i++) {
    if ((unsigned char)line[i] < 0x20 || (unsigned char)line[i] > 0x7E) return false;
  }
  memset(out, 0, sizeof(*out));

  const char *p = line;
  if (!ql_j_lit(&p, '{')) return false;

  // The type must come first — the console's canonical key order puts it there,
  // and knowing it up front is what lets the key-set check below be exact.
  char key[16];
  if (!ql_j_str(&p, key, sizeof(key))) return false;
  if (strcmp(key, "t") != 0) return false;
  if (!ql_j_lit(&p, ':')) return false;
  char type[12];
  if (!ql_j_str(&p, type, sizeof(type))) return false;

  // ONE DISTINCT BIT PER KEY NAME across the union of all four frame types.
  //
  // An earlier draft economised by letting `rows` and `org` share a bit, on the
  // reasoning that no frame carries both. It is wrong twice over: the mask then
  // has to encode "which type am I" as well as "which keys have I seen", and a
  // `resolve` carrying a stray `rows` key satisfies the same bit as its `org`
  // and passes the exact-set check with a field missing. Bits are free; a key
  // set that can be satisfied two ways is not.
  enum {
    K_VER = 0x0001, K_IDX = 0x0002, K_OF = 0x0004, K_ROWS = 0x0008,
    K_ROW = 0x0010, K_ST = 0x0020, K_UID = 0x0040, K_ORG = 0x0080,
    K_EP = 0x0100, K_STATE = 0x0200, K_TTL = 0x0400, K_CMD = 0x0800,
    K_ARG = 0x1000,
  };

  uint16_t seen = 0, want = 0;
  if (strcmp(type, "table") == 0) { out->type = QL_IN_TABLE; want = K_VER | K_IDX | K_OF | K_ROWS; }
  else if (strcmp(type, "row") == 0) { out->type = QL_IN_ROW; want = K_VER | K_ROW; }
  else if (strcmp(type, "resolve") == 0) { out->type = QL_IN_RESOLVE; want = K_ST | K_UID | K_ORG | K_EP | K_STATE | K_TTL; }
  else if (strcmp(type, "cmd") == 0) { out->type = QL_IN_CMD; want = K_ST | K_CMD | K_ARG; }
  else return false;

  for (;;) {
    if (ql_j_lit(&p, '}')) break;
    if (!ql_j_lit(&p, ',')) return false;
    if (!ql_j_str(&p, key, sizeof(key))) return false;
    if (!ql_j_lit(&p, ':')) return false;
    int64_t v;
    uint16_t bit = 0;

    // A `resolve` is a one-row answer, so its uid/org/ep/state land in rows[0]
    // rather than growing a second set of fields that mean the same thing.
    if (strcmp(key, "ver") == 0) {
      bit = K_VER;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, 0, (int64_t)QL_TBLVER_MAX, &v)) return false;
      out->ver = (uint64_t)v;
    } else if (strcmp(key, "idx") == 0) {
      bit = K_IDX;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, 0, QL_CHUNK_MAX - 1, &v)) return false;
      out->idx = (uint16_t)v;
    } else if (strcmp(key, "of") == 0) {
      bit = K_OF;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, 1, 255, &v)) return false;
      out->of = (uint16_t)v;
    } else if (strcmp(key, "rows") == 0) {
      bit = K_ROWS;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_lit(&p, '[')) return false;
      if (!ql_j_lit(&p, ']')) {
        for (;;) {
          if (out->rowCount >= QL_NDJSON_TABLE_CHUNK_ROWS) return false;
          if (!ql_j_row(&p, &out->rows[out->rowCount])) return false;
          out->rowCount++;
          if (ql_j_lit(&p, ',')) continue;
          if (ql_j_lit(&p, ']')) break;
          return false;
        }
      }
    } else if (strcmp(key, "row") == 0) {
      bit = K_ROW;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_row(&p, &out->rows[0])) return false;
      out->rowCount = 1;
    } else if (strcmp(key, "st") == 0) {
      bit = K_ST;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, QL_ADDR_ST_MIN, QL_ADDR_ST_MAX, &v)) return false;
      out->st = (uint8_t)v;
    } else if (strcmp(key, "uid") == 0) {
      bit = K_UID;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_str(&p, out->rows[0].uid, sizeof(out->rows[0].uid))) return false;
      if (!ql_uid_valid(out->rows[0].uid)) return false;
      out->rowCount = 1;
    } else if (strcmp(key, "org") == 0) {
      bit = K_ORG;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, QL_ORG_MIN, QL_ORG_MAX, &v)) return false;
      out->rows[0].org = (uint8_t)v;
    } else if (strcmp(key, "ep") == 0) {
      bit = K_EP;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, QL_EP_MIN, QL_EP_MAX, &v)) return false;
      out->rows[0].ep = (uint8_t)v;
    } else if (strcmp(key, "state") == 0) {
      bit = K_STATE;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, QL_STATE_MIN, QL_STATE_MAX, &v)) return false;
      out->rows[0].state = (uint8_t)v;
    } else if (strcmp(key, "ttl") == 0) {
      bit = K_TTL;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, 0, QL_TTL_MAX, &v)) return false;
      out->ttl = (uint32_t)v;
    } else if (strcmp(key, "cmd") == 0) {
      bit = K_CMD;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_str(&p, out->verb, sizeof(out->verb))) return false;
      if (!ql_cmd_verb_known(out->verb)) return false;
    } else if (strcmp(key, "arg") == 0) {
      bit = K_ARG;
      if (!(want & bit) || (seen & bit)) return false;
      if (!ql_j_int(&p, 0, QL_U16_MAX, &v)) return false;
      out->arg = (uint32_t)v;
    } else {
      return false;  // unknown key — this is also what closes __proto__
    }
    seen |= bit;
  }

  if (*ql_j_ws(p) != '\0') return false;  // trailing junk after the object
  if (seen != want) return false;         // exact key set, not minimum key set

  // `idx` is bounded by `of` on the console side, and `of` is validated first.
  // Mirror that here rather than trusting the sender: a chunk claiming idx 200
  // of 1 is a table that can never complete, and a station staging it waits
  // forever.
  if (out->type == QL_IN_TABLE && out->idx >= out->of) return false;
  return true;
}
