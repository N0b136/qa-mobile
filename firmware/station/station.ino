// station.ino — a plinth in the woods.
//
// One ESP32 on a post: an MFRC522 reader behind a 4 mm non-metallic face, a
// DFPlayer Mini and a 3 W speaker, and an SX1276 at 915 MHz talking to the hub
// at the counter. A guest holds their standard against the face; the station
// resolves the pole's factory RFID uid against a flag table it holds in its own
// flash, plays that party's order and episode, and reports the tap.
//
// ── THE ONE SENTENCE THAT MATTERS ───────────────────────────────────────────
//
// A STATION THAT CANNOT RESOLVE A TAPPED FLAG PLAYS NOTHING. Not a generic
// clip, not a guessed clip, not a "please wait" hold clip, not a beep. The
// ambience loop simply continues — which is this station's ordinary idle state
// and therefore not a fallback at all — and the station enters a capped resync
// loop and reports `RES=U` so the console shows it unresolved. A wrong story is
// worse than a pause. This is a user mandate, it is absolute, and it is why
// there is no TRK_FALLBACK anywhere in this file. If you are here to add one,
// the answer is no; add a recording to the card instead.
//
// ── HOW THIS LOOP IS BUILT ──────────────────────────────────────────────────
//
// Cooperative, non-blocking, single-threaded. There is NO delay() in this file
// outside setup(), no LoRa.onReceive(), no FreeRTOS task, no ISR that touches
// SPI. Every periodic or deferred action is a `uint32_t ...At` millis()
// deadline compared in loop(), and every pump function does a bounded amount of
// work per pass:
//
//   pumpService()    at most one line of operator input
//   pumpRadioRx()    at most ONE received packet
//   pumpRadioTx()    at most one transmission started (asynchronously)
//   pumpReader()     at most one card read
//   pumpAudio()      one BUSY sample and at most one DFPlayer command
//   pumpTapQueue()   at most one tap dequeued and sealed
//   pumpResolve()    at most one QUERY built
//   pumpSync()       at most one SYNC built
//   pumpHeartbeat()  at most one HB built
//   pumpLog()        at most one LOG built
//   pumpWatchdogs()  register reads only
//
// Worst-case pass is dominated by one AES+HMAC seal (well under a millisecond
// on a 240 MHz ESP32) so the reader is sampled at its full 40 ms cadence even
// while the radio is mid-air. That responsiveness is the entire point: the
// moment this loop can block for seconds is the moment three children pressing
// flags against a plinth get nothing.
//
// ── THE NINE CORRECTIONS, AND WHERE THEY LIVE ───────────────────────────────
//
//   1  no LoRa.onReceive; poll from loop; matched 4 MHz SPI  ..... pumpRadioRx
//   2  custody does not transfer on reception; taps own ring  .... tap ring
//   3  tableCommit() inside the CRC check; stage memset ........ stageBegin
//   4  nextSyncAt = 0 when not stale; resync capped at 5 ....... pumpSync
//   5  full slot delay, anchored to the beacon EPOCH ...... rescheduleHeartbeat
//   6  ACK retry is a retryAt timestamp, never delay() ....... pumpTapQueue
//   7  seq uses a 64-ahead NVS reservation window ................ nextSeq
//   8  STATE rides on the wire (0/1/2) ......................... speakFor
//   9  unresolved = silence + resync, never a clip ............... onTag
//
// Each is commented where it lives with what breaks if it is changed back. They
// are not style preferences; every one of them is the residue of a real failure.

// ── BUILDING THIS ───────────────────────────────────────────────────────────
//
//   arduino-cli compile --fqbn esp32:esp32:esp32
//     --board-options PartitionScheme=huge_app
//     --build-property "compiler.cpp.extra_flags=-I<repo>/firmware -DQL_STATION_NUMBER=7"
//     <repo>/firmware/station
//
// The -I is what lets `#include "ql_proto.h"` find the shared headers one
// directory up. The Arduino build copies the SKETCH FOLDER into a temporary
// build directory and nothing above it, so a plain `#include "../ql_proto.h"`
// resolves against that temporary directory and fails — which is why the
// fallback below exists for anyone who instead symlinks or copies the two
// headers into station/.

#include <Arduino.h>
#include <esp_system.h>
#include <MFRC522.h>
#include <Preferences.h>
#include <SPI.h>
#include <LoRa.h>
#include <DFRobotDFPlayerMini.h>

#include "config.h"

#if defined(__has_include) && __has_include("ql_proto.h")
#include "ql_proto.h"
#include "ql_crypto.h"
#elif defined(__has_include) && __has_include("../ql_proto.h")
#include "../ql_proto.h"
#include "../ql_crypto.h"
#else
#error "ql_proto.h not found - add firmware/ to the include path (see the build line above)"
#endif

#if QL_SERVICE_BT
#include <BluetoothSerial.h>
#endif

// ── The generated clip map ──────────────────────────────────────────────────
//
// station_clips.h is written by tools/gen-clip-map.mjs from the canon episode
// rotations. DO NOT HAND-EDIT IT. It answers exactly one question — "is there a
// recording for folder F track T on the card in THIS station?" — and the
// station asks it before every play command.
//
// WHY THAT QUESTION HAS TO BE ASKED. A DFPlayer told to play a track that is not
// on the card does not reliably do nothing. Depending on module revision it
// plays the numerically next file in the folder, replays the previous file, or
// reports an error several hundred milliseconds later — by which time a guest
// standing at a plinth they were never routed to has already heard the opening
// of somebody else's episode. Silence for an off-rotation tap is a decision, and
// the clip map is how the decision is enforced rather than hoped for.
//
// THE CONTRACT the generator must satisfy:
//
//   #define QL_CLIPS_FORMAT 1
//   #define QL_CLIP_STATION_MAX 23
//   static const uint16_t QL_CLIP_KEYS[];                       // (folder<<8)|track
//   static const uint16_t QL_CLIP_INDEX[QL_CLIP_STATION_MAX + 2];
//
// QL_CLIP_KEYS is one flat array; the keys for station N occupy the half-open
// range [QL_CLIP_INDEX[N], QL_CLIP_INDEX[N+1]) and are ascending within it, so
// the lookup below is a binary search over a run. A station with no speech files
// (the gate) is an empty run, which is legal and means "this card has ambience
// and system audio only".
#if defined(__has_include)
#if __has_include("station_clips.h")
#include "station_clips.h"
#define QL_HAVE_CLIPS 1
#endif
#endif

#ifndef QL_HAVE_CLIPS
#error "station/station_clips.h is missing - run: node firmware/tools/gen-clip-map.mjs"
#endif
#if !defined(QL_CLIPS_FORMAT) || QL_CLIPS_FORMAT != 1
#error "station_clips.h is a format this sketch does not understand - regenerate it"
#endif
#if QL_CLIP_STATION_MAX < QL_ADDR_ST_MAX
#error "station_clips.h does not cover every addressable place"
#endif

// ════════════════════════════════════════════════════════════════════════════
// State
// ════════════════════════════════════════════════════════════════════════════

static const uint8_t SELF = QL_STATION_NUMBER;

// Forward declarations. The Arduino toolchain usually synthesises these, but it
// does it by scanning the .ino with a heuristic that gives up on anything it
// finds surprising, and when it gives up the error names a function that is
// plainly right there in the file. Declaring the handful of genuine
// forward-references explicitly costs four lines and removes the whole class.
static void rescheduleHeartbeat(uint32_t nowMs);
static void playAmbience();
static void kickResync();

static MFRC522 rfid(QL_PIN_RFID_CS, QL_PIN_RFID_RST);
static DFRobotDFPlayerMini df;
static Preferences nvs;

#if QL_SERVICE_BT
static BluetoothSerial bt;
#endif
static bool verbose = QL_VERBOSE_DEFAULT;

// ── Clock ───────────────────────────────────────────────────────────────────
//
// A station has no RTC and no network. Its only clock is the EPOCH field of the
// hub's beacon, adopted once and then advanced from millis(). Everything that
// needs wall time — the tap's `ts`, the heartbeat slot, the table age — reads
// epochNow(), and epochNow() returns 0 until a beacon has been heard.
//
// 0 IS A LEGAL `ts` and the console accepts it: it stamps a tap with its own
// clock anyway. What is NOT legal is milliseconds. See ql_proto.h's note on
// QlTap::ts; it is the single most likely first-boot bug in the project and it
// presents as "taps do nothing".
static bool clockValid = false;
static uint32_t epochRef = 0;    // epoch seconds at the moment of adoption
static uint32_t epochRefMs = 0;  // millis() at that same moment

static inline uint32_t epochNow() {
  if (!clockValid) return 0;
  return epochRef + (uint32_t)((millis() - epochRefMs) / 1000UL);
}

// ── Sequence numbers ────────────────────────────────────────────────────────
static uint32_t seqNext = 1;      // the next number that may be issued
static uint32_t seqReserved = 1;  // one past the highest number reserved in NVS

/**
 * The board's SEQ lineage epoch. It goes into every nonce and it is the thing
 * that makes (SRC, SEQ) safe across a reflash — see the long note in
 * ql_crypto.h. It is minted the first time a fresh board adopts a clock and then
 * lives in NVS forever.
 *
 * 0 means "not minted yet", and a board in that state MAY NOT TRANSMIT. It can
 * still read tags, resolve them against a cached table and play audio; it simply
 * cannot put a frame on the air until it has heard one beacon. That is a
 * seconds-long condition on a bench and a permanent one only if the hub is dead,
 * in which case there was nobody to transmit to anyway.
 */
static uint32_t lineageEpoch = 0;

// ── Radio ───────────────────────────────────────────────────────────────────
static QlPeer hubPeer;  // replay high-water mark for frames from the hub
static bool txBusy = false;
static uint32_t txDeferUntil = 0;
static uint8_t ccaTries = 0;
static int16_t lastHubRssi = 0;
static uint32_t lastHubHeardAt = 0;
static uint8_t rxBuf[QL_LINE_MAX + 2];

/** Beacon-imposed suppression window for NON-URGENT uplinks (H, L, S). Taps always go. */
static uint32_t quietUntil = 0;

// ── The committed flag table ────────────────────────────────────────────────
//
// Stored packed and SORTED by uid so the lookup on the tap path is a binary
// search and so the CRC can be recomputed at any time — including at boot, which
// is how a table corrupted in flash is caught rather than played.

typedef struct __attribute__((packed)) {
  uint8_t uidLen;  // 4..10 bytes
  uint8_t uid[10];
  uint8_t org;
  uint8_t ep;
  uint8_t state;
} PackedRow;

typedef struct __attribute__((packed)) {
  uint32_t magic;
  uint64_t ver;
  uint16_t count;
  uint32_t crc;
  uint32_t committedAt;  // epoch seconds; 0 if the station had no clock then
  PackedRow rows[QL_TABLE_MAX];
} TableBlob;

#define QL_TABLE_MAGIC 0x514C5431u  // "QLT1"

static_assert(sizeof(PackedRow) == 14, "PackedRow must stay 14 bytes");
static_assert(sizeof(TableBlob) < 3900,
              "the table blob must fit one NVS blob on a 20 kB nvs partition - "
              "lower QL_TABLE_MAX or move to a custom partition table");

static TableBlob table;
static uint32_t tableCommittedAtMs = 0;  // millis() fallback when there is no clock

// ── Staging ─────────────────────────────────────────────────────────────────
static bool stageActive = false;
static uint64_t stageVer = 0;
static uint16_t stageTotal = 0;
static uint16_t stageGot = 0;
static uint16_t stageRows = 0;
static uint32_t stageTouchedAt = 0;
static uint8_t stageBitmap[QL_SYNC_BITMAP_BYTES];
static PackedRow stageRow[QL_TABLE_MAX];

// ── What the hub last told us ───────────────────────────────────────────────
static bool haveBeacon = false;
static uint64_t beaconVer = 0;
static uint16_t beaconCount = 0;
static uint32_t beaconCrc = 0;

// ── Resync ──────────────────────────────────────────────────────────────────
static const uint32_t SYNC_BACKOFF[] = QL_SYNC_BACKOFF_MS;
static uint8_t syncAttempts = 0;
static uint32_t nextSyncAt = 0;
static bool syncBeaconGated = false;

// ── Tap ring (its own ring — correction #2) ─────────────────────────────────
typedef struct __attribute__((packed)) {
  uint8_t uidLen;
  uint8_t uid[10];
  uint8_t org;
  uint8_t ep;
  char res;
  uint32_t ts;
} TapRec;

static uint16_t qHead = 0;
static uint16_t qCount = 0;
static uint32_t qDiscarded = 0;

static bool tapActive = false;
static TapRec tapRec;
static uint8_t tapLine[QL_LINE_MAX + 1];
static uint16_t tapLineLen = 0;
static uint8_t tapAttempts = 0;
static uint32_t tapRetryAt = 0;
static uint32_t tapHoldUntil = 0;
static uint32_t lastDrainAt = 0;

// ── Resolve ─────────────────────────────────────────────────────────────────
typedef struct {
  uint8_t uidLen;
  uint8_t uid[10];
  uint8_t org;
  uint8_t ep;
  uint8_t state;
  uint32_t expiresAtMs;
} ResolveEntry;

static ResolveEntry resolveCache[QL_RESOLVE_CACHE];

/** The tag we most recently could not resolve, and how long a late answer may still speak. */
static uint8_t holdUid[10];
static uint8_t holdUidLen = 0;
static uint32_t holdUntil = 0;

/** A QUERY armed by an ACKed unresolved TAP. Sent only if no RESOLVE arrives first. */
static uint8_t queryUid[10];
static uint8_t queryUidLen = 0;
static uint32_t queryDueAt = 0;

typedef struct {
  uint8_t uidLen;
  uint8_t uid[10];
  uint32_t at;
} UidStamp;

static UidStamp recentTag[QL_TAG_RECENT];
static UidStamp recentQuery[QL_TAG_RECENT];
static uint32_t unresolvedRun = 0;

// ── Audio ───────────────────────────────────────────────────────────────────
typedef enum { AUDIO_SILENT, AUDIO_AMBIENCE, AUDIO_SPEECH } AudioMode;

static AudioMode audioMode = AUDIO_SILENT;
static uint32_t audioCmdAt = 0;
static uint32_t audioIdleSince = 0;
static uint8_t ambienceTrack = 0;
static uint8_t volume = QL_VOL_DEFAULT;
static bool sdHealthy = false;
static bool dfHealthy = false;
static bool speechErrorArmed = false;

// ── Outbox: small, non-tap frames waiting for the air ───────────────────────
//
// Deliberately separate from the tap ring, and deliberately in RAM. These frames
// are all disposable: a heartbeat's replacement is 120 seconds away and carries
// the same facts, a SYNC will be re-armed by the next beacon, a LOG is a
// diagnostic. Nothing here is a guest's check-in, and nothing here may ever
// evict one.
#define QL_OUTBOX 6
#define QL_PRIO_QUERY 1
#define QL_PRIO_CMDACK 2
#define QL_PRIO_SYNC 3
#define QL_PRIO_HB 4
#define QL_PRIO_LOG 5

typedef struct {
  uint8_t line[QL_LINE_MAX + 1];
  uint16_t len;
  uint8_t prio;
  uint32_t at;
  bool used;
} OutFrame;

static OutFrame outbox[QL_OUTBOX];

// ── Heartbeat and log ───────────────────────────────────────────────────────
static uint32_t hbAtMs = 0;  // 0 = not scheduled (no clock yet)
static bool logPending = false;
static QlLog logRec;
static uint32_t lastLogAt = 0;
static uint16_t lastErrCode = 0;
static uint32_t bootMs = 0;
static uint32_t rfidWatchdogAt = 0;

// ════════════════════════════════════════════════════════════════════════════
// Service channel
// ════════════════════════════════════════════════════════════════════════════
//
// Debuggability lives at the ENDPOINTS, never on the air. Nothing here ever
// widens what a frame carries; it prints what this board already knows.

static void svc(const char *s) {
  Serial.print(s);
#if QL_SERVICE_BT
  if (bt.hasClient()) bt.print(s);
#endif
}

static void svcln(const char *s) {
  svc(s);
  svc("\r\n");
}

static void svcKV(const char *k, uint64_t v) {
  char n[24];
  ql_u64_dec(v, n, sizeof(n));
  svc(k);
  svc("=");
  svc(n);
  svc(" ");
}

// ════════════════════════════════════════════════════════════════════════════
// Small helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * "Has this deadline arrived?", with 0 meaning "no deadline set".
 *
 * EVERY DEADLINE IN THIS FILE GOES THROUGH HERE, and the reason is millis()
 * rollover. The natural spelling — `(int32_t)(now - deadline) >= 0` — is the
 * correct signed-difference comparison and it is exactly right for a deadline
 * that was actually set. It is WRONG for a deadline still holding its
 * zero-initialised value: once millis() passes 2^31, `now - 0` is a negative
 * int32 and the deadline reads as permanently in the future. A station is
 * expected to run for months, so this is not theoretical — it presents as a
 * plinth that works perfectly for twenty-four days and then stops transmitting
 * taps, with every other subsystem still healthy.
 *
 * Treating 0 as "no deadline, go now" is safe because every real deadline in
 * this file is `millis() + something positive`, and the one millisecond per
 * 49.7 days on which that lands exactly on 0 costs a single early wakeup.
 */
static inline bool due(uint32_t now, uint32_t at) {
  return at == 0 || (int32_t)(now - at) >= 0;
}

/**
 * A millis() stamp meaning "immediately" that is never 0.
 *
 * `nextSyncAt` uses 0 as its UNARMED sentinel — the opposite convention to
 * due() above — so storing a raw millis() into it during the first millisecond
 * after boot arms a resync that reads as unarmed and never fires. The window is
 * one millisecond wide and the consequence is a station that comes up with a
 * stale table and waits for the next beacon to try again, which is precisely
 * the sort of nearly-harmless, nearly-unreproducible bug that costs an
 * afternoon. One comparison removes it.
 */
static inline uint32_t armNow() {
  uint32_t t = millis();
  return t ? t : 1;
}

static bool hexDecode(const char *hex, uint8_t *out, uint8_t cap, uint8_t *outLen) {
  size_t n = strlen(hex);
  if ((n & 1) || n / 2 > cap) return false;
  for (size_t i = 0; i < n; i += 2) {
    uint32_t b;
    char pair[3] = {hex[i], hex[i + 1], '\0'};
    if (!ql_parse_hex_u32(pair, 2, &b)) return false;
    out[i / 2] = (uint8_t)b;
  }
  *outLen = (uint8_t)(n / 2);
  return true;
}

/**
 * Order two uids the way the console's table sort does.
 *
 * The console sorts the HEX STRINGS ascending; this compares the RAW BYTES with
 * a shorter-first tiebreak. They are the same order, because hex is a
 * fixed-width, order-preserving encoding over `[0-9A-F]` — two bytes map to two
 * characters whose relative order is the bytes' relative order, and a shorter
 * uid is a strict prefix of any longer one it ties with, which strcmp also puts
 * first.
 *
 * That equivalence is load-bearing: it is what makes the station's computed CRC
 * equal the hub's. If it were ever false the CRC would mismatch and the station
 * would refuse every table it was ever sent, which is a loud failure and
 * therefore the right one — but do not "optimise" this comparator without
 * re-deriving the argument above.
 */
static int uidCmp(const uint8_t *a, uint8_t an, const uint8_t *b, uint8_t bn) {
  uint8_t n = an < bn ? an : bn;
  int c = memcmp(a, b, n);
  if (c) return c;
  return (int)an - (int)bn;
}

static bool stampSeen(UidStamp *arr, const uint8_t *uid, uint8_t len, uint32_t now, uint32_t window) {
  for (uint8_t i = 0; i < QL_TAG_RECENT; i++) {
    if (arr[i].uidLen == len && memcmp(arr[i].uid, uid, len) == 0) {
      return (uint32_t)(now - arr[i].at) < window;
    }
  }
  return false;
}

static void stampNote(UidStamp *arr, const uint8_t *uid, uint8_t len, uint32_t now) {
  uint8_t oldest = 0;
  for (uint8_t i = 0; i < QL_TAG_RECENT; i++) {
    if (arr[i].uidLen == len && memcmp(arr[i].uid, uid, len) == 0) {
      arr[i].at = now;
      return;
    }
    if ((uint32_t)(now - arr[i].at) > (uint32_t)(now - arr[oldest].at)) oldest = i;
  }
  arr[oldest].uidLen = len;
  memcpy(arr[oldest].uid, uid, len);
  arr[oldest].at = now;
}

static void noteError(uint16_t code) { lastErrCode = code; }

/**
 * Queue a LOG frame. At most one per QL_LOG_MIN_GAP_MS reaches the air, and
 * while one is pending the MORE SEVERE event wins (syslog convention: lower is
 * worse). An error must not be displaced by the informational frame that
 * follows it, which is exactly what a plain last-writer-wins slot would do.
 */
static void logEvent(uint8_t lvl, uint16_t code, int64_t a1, int64_t a2) {
  // ── THE DIRECTION OF THIS TEST IS THE WHOLE FAULT CHANNEL ─────────────────
  // Syslog counts DOWNWARDS into severity, so the faults are 2 and 3 (NO_KEY,
  // MAC_FAIL, TABLE_CRC_FAIL, SD_FAULT, DF_FAULT, READER_FAULT, QUEUE_FULL) and
  // 4 and up are warnings and chatter (BOOT, TABLE_COMMIT, RESYNC_START). That
  // reads backwards to almost everyone, which is exactly how this line once got
  // written as `lvl >= 4` — the precise inversion of what it must do.
  //
  // WHAT BREAKS IF IT IS FLIPPED BACK: lastErrCode is what pumpHeartbeat puts
  // in the heartbeat's ERR field, and ERR is the only route a fault code has to
  // the console today (LOG frames are dropped there until Slice 6). Inverted,
  // every healthy plinth reports ERR=100 from its own boot log — staff learn
  // within a day that the field means nothing — while a wedged MFRC522, the one
  // fault with no dedicated heartbeat field and the one that stops a station
  // reading tags at all, reports nothing. SECURITY.md's "macfail non-zero on
  // one board means that board's PSK is wrong" rests on this line too, and
  // MAC_FAIL is logged at level 3.
  //
  // The code LATCHES until reboot on purpose: a reader that wedged for ten
  // minutes at noon and re-inited itself is still the reason that plinth went
  // quiet, and nothing else in the park remembers it. Whether a fault is
  // CURRENT is answered by the dedicated fields (h.sd, h.df, h.tblver), never
  // by ERR — do not "fix" the latch by clearing it on an unrelated recovery.
  if (lvl <= 3) noteError(code);
  if (logPending && logRec.lvl < lvl) return;
  logRec.lvl = lvl;
  logRec.code = code;
  logRec.a1 = a1;
  logRec.a2 = a2;
  logPending = true;
}

// ════════════════════════════════════════════════════════════════════════════
// NVS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Issue the next sequence number, reserving 64 ahead in flash. CORRECTION #7.
 *
 * The invariant this maintains is: THE NUMBER IN FLASH IS ALWAYS AT OR ABOVE THE
 * HIGHEST NUMBER THIS BOARD HAS EVER PUT ON THE AIR. Flash is written once per
 * 64 frames; between writes the counter lives only in RAM, and a crash loses
 * whatever RAM held — but it can only ever lose numbers we had already reserved,
 * so the board resumes ABOVE them.
 *
 * WHAT BREAKS IF THIS BECOMES `nvs.putUInt("seqhw", ++seq)` PER FRAME: nothing,
 * until the supply sags. The DFPlayer's amplifier draws hard at the start of a
 * clip and a marginal 5 V rail can brown the MCU out inside the few milliseconds
 * between issuing a number and committing it. The board reboots, reads back the
 * uncommitted value, and REUSES it. The hub keeps a per-station high-water mark
 * and drops anything at or below it as a replay, so those taps are silently
 * discarded: the guest tapped, the clip played, the frame transmitted, the hub
 * threw it away, and no log anywhere records it. Reserving forward means a crash
 * can only SKIP numbers, and a gap in a sequence is harmless to every consumer.
 */
static uint32_t nextSeq() {
  if (seqNext >= seqReserved) {
    seqReserved = seqNext + QL_SEQ_RESERVE;
    nvs.putUInt("seqhw", seqReserved);
  }
  return seqNext++;
}

static void seqBegin() {
  seqReserved = nvs.getUInt("seqhw", 0);
  seqNext = seqReserved == 0 ? 1 : seqReserved;
  seqReserved = seqNext + QL_SEQ_RESERVE;
  nvs.putUInt("seqhw", seqReserved);
}

static void tableSave() {
  nvs.putBytes("tbl", &table, sizeof(table));
}

static uint32_t tableComputeCrc(const PackedRow *rows, uint16_t count) {
  uint32_t crc = ql_crc32_begin();
  QlRow scratch;
  for (uint16_t i = 0; i < count; i++) {
    if (!ql_hex_encode(rows[i].uid, rows[i].uidLen, scratch.uid, sizeof(scratch.uid))) return 0;
    scratch.org = rows[i].org;
    scratch.ep = rows[i].ep;
    scratch.state = rows[i].state;
    crc = ql_crc32_row(crc, &scratch);
  }
  return ql_crc32_end(crc);
}

static void tableLoad() {
  memset(&table, 0, sizeof(table));
  size_t got = nvs.getBytes("tbl", &table, sizeof(table));
  if (got != sizeof(table) || table.magic != QL_TABLE_MAGIC || table.count > QL_TABLE_MAX) {
    memset(&table, 0, sizeof(table));
    table.magic = QL_TABLE_MAGIC;
    return;
  }
  // Re-verify on load. A table read back from flash has crossed a power cycle
  // and a wear-levelling layer; if it no longer hashes to what it hashed to when
  // it was committed, the honest state is "no table" — the station then resyncs
  // and stays silent in the meantime, which is the mandate. Playing a table
  // whose bytes moved is exactly the wrong-story failure this whole design is
  // arranged to avoid.
  uint32_t crc = tableComputeCrc(table.rows, table.count);
  if (crc != table.crc) {
    logEvent(3, QL_LOG_TABLE_CRC_FAIL, (int64_t)crc, (int64_t)table.crc);
    memset(&table, 0, sizeof(table));
    table.magic = QL_TABLE_MAGIC;
  }
}

static void tapRingBegin() {
  qHead = (uint16_t)nvs.getUShort("qh", 0);
  qCount = (uint16_t)nvs.getUShort("qn", 0);
  if (qHead >= QL_TAP_RING) qHead = 0;
  if (qCount > QL_TAP_RING) qCount = 0;
}

static void tapKey(uint16_t slot, char *out) {
  out[0] = 'q';
  out[1] = (char)('0' + (slot / 10) % 10);
  out[2] = (char)('0' + slot % 10);
  out[3] = '\0';
}

static bool tapPeek(TapRec *out) {
  if (qCount == 0) return false;
  char k[4];
  tapKey(qHead, k);
  return nvs.getBytes(k, out, sizeof(TapRec)) == sizeof(TapRec);
}

static void tapPop() {
  if (qCount == 0) return;
  qHead = (uint16_t)((qHead + 1) % QL_TAP_RING);
  qCount--;
  nvs.putUShort("qh", qHead);
  nvs.putUShort("qn", qCount);
}

/**
 * Append a tap. If the ring is full the OLDEST entry is dropped.
 *
 * Dropping the oldest rather than refusing the newest is the deliberate choice.
 * A full ring means the hub has been unreachable for hours; refusing new taps
 * freezes the record at the moment the outage began and every guest who walks
 * the park afterwards is invisible. Dropping the oldest keeps the ring a moving
 * window over the most recent hours, which is what staff are looking at. Either
 * way the loss is logged, and the domain layer's set-membership credit means a
 * lost station tap costs a credit, not a corrupted walk.
 */
static void tapPush(const TapRec *rec) {
  if (qCount == QL_TAP_RING) {
    qHead = (uint16_t)((qHead + 1) % QL_TAP_RING);
    qCount--;
    qDiscarded++;
    logEvent(3, QL_LOG_QUEUE_FULL, (int64_t)qCount, (int64_t)qDiscarded);
  }
  uint16_t slot = (uint16_t)((qHead + qCount) % QL_TAP_RING);
  char k[4];
  tapKey(slot, k);
  nvs.putBytes(k, rec, sizeof(TapRec));
  qCount++;
  nvs.putUShort("qh", qHead);
  nvs.putUShort("qn", qCount);
  if (qCount >= (QL_TAP_RING * 3) / 4) logEvent(4, QL_LOG_QUEUE_HIGH, (int64_t)qCount, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// The clip map
// ════════════════════════════════════════════════════════════════════════════

static bool clipPresent(uint8_t folder, uint8_t track) {
  if (folder == QL_FOLDER_SYSTEM || folder == QL_FOLDER_AMBIENCE) return true;
  uint16_t key = (uint16_t)((uint16_t)folder << 8) | track;
  uint16_t lo = QL_CLIP_INDEX[SELF];
  uint16_t hi = QL_CLIP_INDEX[SELF + 1];
  while (lo < hi) {
    uint16_t mid = (uint16_t)(lo + (hi - lo) / 2);
    if (QL_CLIP_KEYS[mid] == key) return true;
    if (QL_CLIP_KEYS[mid] < key) lo = (uint16_t)(mid + 1);
    else hi = mid;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// Audio
// ════════════════════════════════════════════════════════════════════════════

static void playAmbience() {
  ambienceTrack = (uint8_t)((ambienceTrack % QL_AMBIENCE_TRACKS) + 1);
  df.playFolder(QL_FOLDER_AMBIENCE, ambienceTrack);
  audioMode = AUDIO_AMBIENCE;
  audioCmdAt = millis();
  audioIdleSince = 0;
  speechErrorArmed = false;
}

static void playClip(uint8_t folder, uint8_t track) {
  df.playFolder(folder, track);
  audioMode = AUDIO_SPEECH;
  audioCmdAt = millis();
  audioIdleSince = 0;
  speechErrorArmed = true;
}

/**
 * Decide what — if anything — a RESOLVED tag makes this plinth say.
 *
 * ── CORRECTION #8: STATE RIDES ON THE WIRE ────────────────────────────────
 *
 * A row carries `state` 0 assigned / 1 sealed / 2 returned, and the station acts
 * on it. Without that field a Hero party who sealed rg-01 an hour ago walks past
 * a plinth and hears rg-01's clips again — the pole is still bound, the table
 * still resolves, and the station has no way to know the episode is behind them.
 * `state` is the only thing that distinguishes "walking this episode now" from
 * "walked it already", and the two must not sound the same.
 *
 * A sealed or returned standard gets the SYSTEM RETURN announcement {8,5}: go
 * back to the booth. THIS IS NOT A NARRATIVE FALLBACK and it does not weaken the
 * mandate. The mandate is about a tag the station CANNOT RESOLVE; this one
 * resolved perfectly and the answer happens to be "you are finished". The clip
 * carries no story, names no order and guesses at nothing.
 */
static void speakFor(uint8_t org, uint8_t ep, uint8_t state) {
  if (state != QL_STATE_ASSIGNED) {
    playClip(QL_FOLDER_SYSTEM, QL_TRK_RETURN);
    return;
  }
  // A row can legitimately resolve to nothing: a racked pole in the table with
  // no binding on it. There is no clip for that and there must not be one.
  if (org == QL_ORG_UNKNOWN || org > QL_ORG_MAX || ep < 1 || ep > QL_EP_MAX) return;

  // Off-rotation: this pole's episode does not route through this plinth, so
  // there is no recording for it on this card. Silence, and nothing else — see
  // the clip-map note at the top of this file for why the DFPlayer must not be
  // asked. The tap still goes to the hub with the real org and ep, so the
  // console records the off-rotation visit; the station simply has nothing to
  // say and does not invent something.
  if (!clipPresent(org, ep)) return;

  playClip(org, ep);
}

static void pumpAudio(uint32_t now) {
  // Drain the DFPlayer's event stream. This is the only place SD and module
  // health are learned, and both ride out in the heartbeat.
  while (df.available()) {
    uint8_t type = df.readType();
    uint16_t val = (uint16_t)df.read();
    switch (type) {
      case DFPlayerCardInserted:
      case DFPlayerCardOnline:
        sdHealthy = true;
        dfHealthy = true;
        break;
      case DFPlayerCardRemoved:
        sdHealthy = false;
        logEvent(3, QL_LOG_SD_FAULT, 0, 0);
        break;
      case DFPlayerError:
        // A file error inside the window after a speech command means the clip
        // map and the card disagree: the card is authored wrong, or a file is
        // corrupt. THAT is what {8,4} OUT OF SERVICE is for — a machine telling
        // a guest it is broken. It is reachable only because the SD card is
        // present; if the card itself were missing nothing on it could play,
        // which is precisely what the heartbeat's SD bit is for.
        dfHealthy = true;  // it answered, so the module is alive
        logEvent(3, QL_LOG_DF_FAULT, (int64_t)val, 0);
        if (speechErrorArmed && (uint32_t)(now - audioCmdAt) < QL_DF_ERROR_WINDOW_MS) {
          playClip(QL_FOLDER_SYSTEM, QL_TRK_OUT_OF_SERVICE);
          // playClip re-arms the error watch; disarm it so a failure to play the
          // out-of-service announcement cannot recurse into itself.
          speechErrorArmed = false;
          return;
        }
        break;
      default:
        break;
    }
  }

  // BUSY is ignored while the module seeks. Sampling it too early reads "not
  // playing", the state machine concludes the clip finished, and ambience
  // restarts straight over the speech that was just starting — two seconds of
  // story and then birdsong. QL_DF_SETTLE_MS is that window.
  if ((uint32_t)(now - audioCmdAt) < QL_DF_SETTLE_MS) return;

  bool busy = digitalRead(QL_PIN_DF_BUSY) == LOW;
  if (busy) {
    audioIdleSince = 0;
    return;
  }
  if (audioIdleSince == 0) {
    audioIdleSince = now;
    return;
  }
  uint32_t settle = (audioMode == AUDIO_AMBIENCE) ? QL_AMBIENCE_GAP_MS : QL_DF_IDLE_MS;
  if ((uint32_t)(now - audioIdleSince) < settle) return;

  // Whatever just ended — speech, a system announcement, or the previous
  // ambience file — the station returns to ambience. There is no other resting
  // state, which is exactly why an unresolved tap playing nothing is not a
  // degraded mode: it is this.
  playAmbience();
}

// ════════════════════════════════════════════════════════════════════════════
// Radio
// ════════════════════════════════════════════════════════════════════════════

static bool channelClear() {
  // LoRa.rssi() is the CURRENT channel RSSI (RegRssiValue), not the last
  // packet's. It is only meaningful while the radio is in receive, which it is
  // whenever txBusy is false.
  return LoRa.rssi() < QL_CCA_RSSI_DBM;
}

/**
 * Start a transmission if the air and the radio are free. Non-blocking: the
 * frame goes out with endPacket(async) and pumpRadioTx() notices completion.
 *
 * Listen-before-talk with an ESCAPE HATCH. After QL_CCA_ATTEMPTS deferrals the
 * frame goes out regardless. That is deliberate: a permanently "busy" reading is
 * far more likely to be a stuck RSSI register, a nearby non-LoRa emitter or a
 * jammer than twenty seconds of genuine park traffic, and a station that goes
 * mute rather than risk a collision has converted a probabilistic problem into a
 * certain one. Collisions cost a retry; muteness costs the guest's check-in.
 */
static bool txTryStart(const uint8_t *line, uint16_t len) {
  uint32_t now = millis();
  if (txBusy || !ql_crypto_ready()) return false;
  if (!due(now, txDeferUntil)) return false;
  if (ccaTries < QL_CCA_ATTEMPTS && !channelClear()) {
    ccaTries++;
    uint32_t back = (uint32_t)QL_CCA_BACKOFF_BASE_MS << ccaTries;
    if (back > QL_CCA_BACKOFF_CAP_MS) back = QL_CCA_BACKOFF_CAP_MS;
    txDeferUntil = now + back + (uint32_t)random(0, QL_CCA_JITTER_MS + 1);
    return false;
  }
  ccaTries = 0;
  if (LoRa.beginPacket() != 1) return false;
  LoRa.write(line, len);
  LoRa.endPacket(true);
  txBusy = true;
  return true;
}

static void pumpRadioTx() {
  if (!txBusy) return;
  if (LoRa.isTransmitting()) return;
  txBusy = false;
  LoRa.receive();
}

static bool outboxPush(const uint8_t *line, uint16_t len, uint8_t prio) {
  int8_t slot = -1;
  for (uint8_t i = 0; i < QL_OUTBOX; i++) {
    if (!outbox[i].used) {
      slot = (int8_t)i;
      break;
    }
  }
  if (slot < 0) {
    // Full: evict the least important, oldest frame. Never a tap — taps are not
    // in here (correction #2) and cannot be displaced by chatter.
    uint8_t worst = 0;
    for (uint8_t i = 1; i < QL_OUTBOX; i++) {
      if (outbox[i].prio > outbox[worst].prio ||
          (outbox[i].prio == outbox[worst].prio && (int32_t)(outbox[i].at - outbox[worst].at) < 0)) {
        worst = i;
      }
    }
    if (outbox[worst].prio < prio) return false;  // everything queued matters more
    slot = (int8_t)worst;
  }
  memcpy(outbox[slot].line, line, len);
  outbox[slot].len = len;
  outbox[slot].prio = prio;
  outbox[slot].at = millis();
  outbox[slot].used = true;
  return true;
}

static bool sealAndQueue(char type, uint8_t dst, const char *plain, uint8_t prio) {
  if (!ql_crypto_ready() || lineageEpoch == 0) return false;
  uint8_t line[QL_LINE_MAX + 1];
  size_t n = ql_line_seal(type, dst, SELF, nextSeq(), lineageEpoch, plain, strlen(plain),
                          (char *)line, sizeof(line));
  if (n == 0) return false;
  return outboxPush(line, (uint16_t)n, prio);
}

// ════════════════════════════════════════════════════════════════════════════
// Table lookup, staging and commit
// ════════════════════════════════════════════════════════════════════════════

static const PackedRow *tableFind(const uint8_t *uid, uint8_t len) {
  uint16_t lo = 0, hi = table.count;
  while (lo < hi) {
    uint16_t mid = (uint16_t)(lo + (hi - lo) / 2);
    int c = uidCmp(table.rows[mid].uid, table.rows[mid].uidLen, uid, len);
    if (c == 0) return &table.rows[mid];
    if (c < 0) lo = (uint16_t)(mid + 1);
    else hi = mid;
  }
  return NULL;
}

static uint32_t tableAgeSeconds() {
  if (table.count == 0 && table.ver == 0) return 0;
  uint32_t e = epochNow();
  // Prefer the persisted epoch: it survives a reboot, and a reboot does not make
  // a table younger. Reporting 0 after every restart would tell the console that
  // a station out of contact for a day had just synced — which is the exact
  // question TBLAGE exists to answer.
  if (e && table.committedAt && e >= table.committedAt) return e - table.committedAt;
  return (uint32_t)((millis() - tableCommittedAtMs) / 1000UL);
}

/**
 * Begin staging a version. CORRECTION #3, first half: the staging buffer is
 * memset at the START of a version, not reused.
 *
 * WHAT BREAKS WITHOUT THE MEMSET: version A's rows sit in slots that version B
 * never writes to. If B is shorter, or if the received-chunk bitmap ever
 * miscounts, the buffer that gets CRC'd is a MIXTURE OF TWO VERSIONS. The CRC
 * will usually catch it — but "usually" is doing far too much work in a sentence
 * about what a plinth says to a child, and a clean buffer makes the CRC a
 * confirmation rather than the only line of defence.
 */
static void stageBegin(uint64_t ver, uint16_t total) {
  memset(stageRow, 0, sizeof(stageRow));
  memset(stageBitmap, 0, sizeof(stageBitmap));
  stageVer = ver;
  stageTotal = total;
  stageGot = 0;
  stageRows = 0;
  stageActive = true;
  stageTouchedAt = millis();
}

static void stageAbandon() {
  stageActive = false;
  stageVer = 0;
  stageTotal = 0;
  stageGot = 0;
  stageRows = 0;
}

/** Insertion sort by uid. Commits are rare; clarity beats an unnecessary qsort comparator. */
static void sortRows(PackedRow *rows, uint16_t count) {
  for (uint16_t i = 1; i < count; i++) {
    PackedRow key = rows[i];
    int16_t j = (int16_t)i - 1;
    while (j >= 0 && uidCmp(rows[j].uid, rows[j].uidLen, key.uid, key.uidLen) > 0) {
      rows[j + 1] = rows[j];
      j--;
    }
    rows[j + 1] = key;
  }
}

static void resyncSatisfied() {
  syncAttempts = 0;
  syncBeaconGated = false;
  nextSyncAt = 0;
}

/**
 * Try to turn a complete staging buffer into the live table. CORRECTION #3,
 * second half: THE COMMIT IS INSIDE THE CRC CHECK.
 *
 * The CRC compared against is the BEACON's TABLECRC for this exact version — not
 * a self-consistency check, not a checksum of what we happen to hold. Anything
 * less does not detect the failure that matters: a chunk lost in the air, or a
 * chunk from a version that moved on underneath us. A half-applied table is
 * strictly worse than a stale one, because a stale table is honestly stale and
 * announces itself in the heartbeat, whereas a half-applied table LOOKS current
 * and plays the wrong episode to whichever parties fell in the hole.
 */
static void stageTryCommit() {
  if (!stageActive || stageGot != stageTotal) return;
  if (!haveBeacon || stageVer != beaconVer) return;  // the version moved on; wait for its chunks

  sortRows(stageRow, stageRows);
  uint32_t crc = tableComputeCrc(stageRow, stageRows);

  if (stageRows != beaconCount || crc != beaconCrc) {
    logEvent(3, QL_LOG_TABLE_CRC_FAIL, (int64_t)crc, (int64_t)beaconCrc);
    stageAbandon();
    // Ask again from scratch rather than sitting on a buffer we have proved
    // wrong. The backoff cap still applies, so this cannot become a storm.
    syncAttempts = 0;
    syncBeaconGated = false;
    nextSyncAt = armNow();
    return;
  }

  table.magic = QL_TABLE_MAGIC;
  table.ver = stageVer;
  table.count = stageRows;
  table.crc = crc;
  table.committedAt = epochNow();
  memcpy(table.rows, stageRow, sizeof(PackedRow) * stageRows);
  if (stageRows < QL_TABLE_MAX) {
    memset(&table.rows[stageRows], 0, sizeof(PackedRow) * (QL_TABLE_MAX - stageRows));
  }
  tableSave();
  tableCommittedAtMs = millis();
  stageAbandon();
  resyncSatisfied();
  logEvent(6, QL_LOG_TABLE_COMMIT, (int64_t)table.count, (int64_t)table.crc);

  if (verbose) {
    svc("[tbl] committed ");
    svcKV("ver", table.ver);
    svcKV("rows", table.count);
    svcKV("crc", table.crc);
    svcln("");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Resolve cache
// ════════════════════════════════════════════════════════════════════════════

static ResolveEntry *cacheFind(const uint8_t *uid, uint8_t len, uint32_t now) {
  for (uint8_t i = 0; i < QL_RESOLVE_CACHE; i++) {
    if (resolveCache[i].uidLen != len) continue;
    if (memcmp(resolveCache[i].uid, uid, len) != 0) continue;
    if ((int32_t)(now - resolveCache[i].expiresAtMs) >= 0) return NULL;  // a point answer must not outlive the truth
    return &resolveCache[i];
  }
  return NULL;
}

static void cacheStore(const QlResolve *r, uint32_t now) {
  uint8_t uid[10], len;
  if (!hexDecode(r->uid, uid, sizeof(uid), &len)) return;
  uint8_t slot = 0;
  for (uint8_t i = 0; i < QL_RESOLVE_CACHE; i++) {
    if (resolveCache[i].uidLen == len && memcmp(resolveCache[i].uid, uid, len) == 0) {
      slot = i;
      goto write;
    }
    if ((int32_t)(resolveCache[i].expiresAtMs - resolveCache[slot].expiresAtMs) < 0) slot = i;
  }
write:
  resolveCache[slot].uidLen = len;
  memcpy(resolveCache[slot].uid, uid, len);
  resolveCache[slot].org = r->org;
  resolveCache[slot].ep = r->ep;
  resolveCache[slot].state = r->state;
  resolveCache[slot].expiresAtMs = now + (r->ttl ? r->ttl : 1) * 1000UL;
}

// ════════════════════════════════════════════════════════════════════════════
// Reading a tag
// ════════════════════════════════════════════════════════════════════════════

static void kickResync() {
  // An unknown pole is EVIDENCE that this station's table is behind — the booth
  // binds flags all day and a plinth that missed a broadcast has no other way to
  // find out. Correction #9's second half: unresolved is silence AND a resync,
  // not silence alone.
  syncAttempts = 0;
  syncBeaconGated = false;
  nextSyncAt = armNow();
}

static void onTag(const uint8_t *uid, uint8_t len, uint32_t now) {
  char hex[QL_UID_MAX + 1];
  if (!ql_hex_encode(uid, len, hex, sizeof(hex))) {
    // A uid outside 4..10 bytes cannot be spelled on this wire. Reported as an
    // error, never forwarded: the hex encoder is the boundary the far-end parser
    // depends on, and the one thing it must never do is pass reader bytes
    // through when it cannot encode them.
    logEvent(4, QL_LOG_MALFORMED, (int64_t)ql_malformed_frames(), (int64_t)len);
    return;
  }

  uint8_t org = QL_ORG_UNKNOWN, ep = 0, state = QL_STATE_ASSIGNED;
  char res = QL_RES_UNRESOLVED;

  const PackedRow *row = tableFind(uid, len);
  if (row) {
    org = row->org;
    ep = row->ep;
    state = row->state;
    res = QL_RES_LOCAL;
  } else {
    ResolveEntry *c = cacheFind(uid, len, now);
    if (c) {
      org = c->org;
      ep = c->ep;
      state = c->state;
      // RES=Q: the audio is right, but it came from a point answer rather than a
      // committed table. Per tap, that is a warning that this station's table
      // sync is broken, and staff can see it before the plinth goes silent.
      res = QL_RES_QUERY;
    }
  }

  // ── CORRECTION #9 / THE USER MANDATE ──────────────────────────────────────
  //
  // Unresolved plays NOTHING. Note what is absent below: there is no call into
  // the DFPlayer on this branch at all — not a stop(), not a volume change, not
  // a "hold" clip. The ambience loop is left exactly as it was, running, which is
  // this station's normal idle state.
  //
  // WHAT BREAKS IF A FALLBACK CLIP IS ADDED HERE: a party hears an episode that
  // is not theirs, believes they were routed correctly, and walks the rest of
  // the day out of sequence. It is not recoverable at any later layer, because
  // by the time anyone notices, the guest's experience of the park has already
  // happened. A pause is a pause; a wrong story is a ruined visit.
  if (res == QL_RES_UNRESOLVED) {
    memcpy(holdUid, uid, len);
    holdUidLen = len;
    holdUntil = now + QL_RESOLVE_HOLD_MS;
    kickResync();
    unresolvedRun++;
    logEvent(4, QL_LOG_UNRESOLVED_TAG, (int64_t)unresolvedRun, 0);
  } else {
    unresolvedRun = 0;
    speakFor(org, ep, state);
  }

  // The tap is recorded either way. A guest who tapped did tap, and whether this
  // plinth could speak is a separate question from whether the walk happened.
  TapRec rec;
  memset(&rec, 0, sizeof(rec));
  rec.uidLen = len;
  memcpy(rec.uid, uid, len);
  rec.org = org;
  rec.ep = ep;
  rec.res = res;
  rec.ts = epochNow();
  tapPush(&rec);

  if (verbose) {
    svc("[tag] ");
    svc(hex);
    svc(" res=");
    char r2[2] = {res, 0};
    svc(r2);
    svc(" ");
    svcKV("org", org);
    svcKV("ep", ep);
    svcKV("state", state);
    svcln("");
  }
}

static void pumpReader(uint32_t now) {
  static uint32_t lastPollAt = 0;
  static uint32_t lastAcceptAt = 0;
  if ((uint32_t)(now - lastPollAt) < QL_RFID_POLL_MS) return;
  lastPollAt = now;
  if ((uint32_t)(now - lastAcceptAt) < QL_TAG_GLOBAL_GAP_MS) return;

  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  uint8_t len = rfid.uid.size;
  uint8_t uid[10];
  if (len >= 4 && len <= 10) memcpy(uid, rfid.uid.uidByte, len);

  // Halt immediately so the card can be presented again, and so a card left on
  // the face does not hold the field.
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  if (len < 4 || len > 10) return;

  // A pole tapped twice in a second is one tap. Per-uid rather than global, so
  // the party queued behind this one is read immediately — plinths queue at
  // opening time and a global lockout reads as a broken reader.
  if (stampSeen(recentTag, uid, len, now, QL_TAG_COOLDOWN_MS)) return;
  stampNote(recentTag, uid, len, now);
  lastAcceptAt = now;
  onTag(uid, len, now);
}

// ════════════════════════════════════════════════════════════════════════════
// Inbound frames
// ════════════════════════════════════════════════════════════════════════════

static void onAck(uint32_t now) {
  if (!tapActive) return;

  // ── STOP-AND-WAIT ─────────────────────────────────────────────────────────
  // The ACK payload is a bare `OK` with no sequence number in it, so an ACK
  // identifies no particular tap. That is what forces exactly one unacknowledged
  // TAP in flight at a time: with two outstanding, an ACK is ambiguous and the
  // station would have to guess which tap is now the hub's problem. The ring
  // makes the queueing behind it free, so the constraint costs nothing.
  TapRec done = tapRec;
  tapActive = false;
  tapAttempts = 0;
  tapPop();
  lastDrainAt = now;

  // Custody has now transferred: the hub only ACKs when the console tab is
  // attached and the NDJSON line went out (correction #2). Only at this point is
  // it safe for the tap to leave this board's flash.

  if (done.org == QL_ORG_UNKNOWN && done.uidLen) {
    // A QUERY is sent ONLY if the ACK landed and no RESOLVE followed. Asking
    // before the ACK produces two frames where one would do every time an ACK is
    // merely slow.
    memcpy(queryUid, done.uid, done.uidLen);
    queryUidLen = done.uidLen;
    queryDueAt = now + QL_RESOLVE_WAIT_MS;
  }
}

static void onResolve(char *plain, uint32_t now) {
  QlResolve r;
  if (!ql_read_resolve(plain, &r)) {
    logEvent(4, QL_LOG_MALFORMED, (int64_t)ql_malformed_frames(), 0);
    return;
  }
  cacheStore(&r, now);

  uint8_t uid[10], len;
  if (!hexDecode(r.uid, uid, sizeof(uid), &len)) return;

  if (queryUidLen == len && memcmp(queryUid, uid, len) == 0) {
    queryUidLen = 0;  // answered before we had to ask
    queryDueAt = 0;
  }

  // A LATE ANSWER STARTS THE CLIP, and does not produce a second TAP. The guest
  // is standing at the plinth; if the hub answers inside the hold window they
  // hear their episode a beat late instead of not at all. A second TAP would
  // carry a new SEQ and therefore be a second check-in for one gesture.
  if (holdUidLen == len && memcmp(holdUid, uid, len) == 0 && (int32_t)(now - holdUntil) < 0) {
    holdUidLen = 0;
    unresolvedRun = 0;
    speakFor(r.org, r.ep, r.state);
  }
}

static void onBeacon(char *plain, uint32_t now) {
  QlBeacon v;
  if (!ql_read_beacon(plain, &v)) {
    logEvent(4, QL_LOG_MALFORMED, (int64_t)ql_malformed_frames(), 0);
    return;
  }
  haveBeacon = true;
  beaconVer = v.tableVer;
  beaconCount = v.count;
  beaconCrc = v.tableCrc;
  quietUntil = now + (uint32_t)v.quiet * 1000UL;

  // ── The clock ─────────────────────────────────────────────────────────────
  if (v.epoch) {
    bool first = !clockValid;
    epochRef = v.epoch;
    epochRefMs = now;
    clockValid = true;
    if (first) {
      logEvent(6, QL_LOG_CLOCK_ADOPTED, (int64_t)v.epoch, 0);
      // Mint the SEQ lineage on a board that has never had one. See the note on
      // lineageEpoch: this is what stops a reflashed board reusing (SRC, SEQ)
      // pairs from its previous life, which in CTR mode is keystream reuse.
      if (lineageEpoch == 0) {
        lineageEpoch = v.epoch;
        nvs.putUInt("lineage", lineageEpoch);
      }
    }
    rescheduleHeartbeat(now);
  }

  bool stale = (table.ver != beaconVer);
  if (!stale) {
    // ── CORRECTION #4, FIRST HALF ───────────────────────────────────────────
    // nextSyncAt = 0 ON THE NOT-STALE BRANCH. Without it the backoff timer keeps
    // running while the station is perfectly in sync, and the next time it does
    // fall behind it starts from wherever the old timer had crept to instead of
    // from a clean first attempt. Worse, a station that has just committed can
    // fire one more pointless SYNC — twenty-one of those, immediately after
    // every rebinding, is the storm the cap exists to prevent.
    resyncSatisfied();
  } else if (syncBeaconGated) {
    // Past the attempt cap: one SYNC per beacon, no more. Correction #4, second
    // half. This is the floor the whole design rests on — a station can be
    // permanently unable to sync (a dead chunk path, a hub bug) and still cost
    // the band only one frame every thirty seconds.
    nextSyncAt = now ? now : 1;
  } else if (nextSyncAt == 0) {
    // ── CORRECTION #4, THE BRANCH THAT ARMS THE LADDER IN THE FIRST PLACE ────
    // GOING STALE MUST ARM AN ATTEMPT. Nothing else in the firmware does it on
    // this transition: the not-stale branch above zeroes nextSyncAt on every
    // beacon while we are in sync, pumpSync returns immediately on
    // `nextSyncAt == 0`, and syncBeaconGated is only ever set INSIDE pumpSync,
    // past that same return — so the gated branch above cannot bootstrap
    // itself. Without this third branch the 4/8/16/32 s ladder is never
    // entered at all.
    //
    // WHAT BREAKS IF IT IS DELETED: the counter rebinds twenty parties, the hub
    // publishes the new version, every plinth reads it in the next beacon and
    // then sits on its old table for the rest of the day. It is not even a
    // silent plinth, which would at least reach the unresolved-tag branch and
    // kickResync — a pole that ALSO existed at the old version still hits
    // tableFind, resolves locally off the stale row, and plays the WRONG
    // episode to the party standing there. A freshly flashed board is the same
    // story from ver 0: stale against its very first beacon and unable to ask
    // for a table until a guest has already been failed at it.
    //
    // The cap is untouched: one arm per stale transition (hence the
    // `nextSyncAt == 0` test — a pending attempt is not re-armed), then the
    // ladder, then syncBeaconGated collapses twenty-one stations going stale
    // together to one SYNC per beacon.
    syncAttempts = 0;
    nextSyncAt = armNow();
  }

  if (verbose) {
    svc("[beacon] ");
    svcKV("ver", v.tableVer);
    svcKV("count", v.count);
    svcKV("crc", v.tableCrc);
    svcKV("epoch", v.epoch);
    svcKV("quiet", v.quiet);
    svcln("");
  }
}

static void onChunk(char *plain, uint32_t now) {
  QlChunk c;
  if (!ql_read_chunk(plain, &c)) {
    logEvent(4, QL_LOG_MALFORMED, (int64_t)ql_malformed_frames(), 0);
    return;
  }
  if ((uint32_t)c.total * QL_CHUNK_ENTRIES > QL_TABLE_MAX) {
    // More poles than this board can hold. Refuse the whole version loudly
    // rather than commit a truncated table: a truncated table resolves some
    // poles and silently fails others, which is indistinguishable to staff from
    // a radio problem.
    logEvent(3, QL_LOG_TABLE_CRC_FAIL, (int64_t)((uint32_t)c.total * QL_CHUNK_ENTRIES),
             (int64_t)QL_TABLE_MAX);
    return;
  }
  // Every chunk but the last carries a full complement. A short middle chunk
  // would leave a hole in the row array; the CRC would catch it, but rejecting
  // it here says WHICH chunk was wrong.
  if (c.idx != c.total - 1 && c.count != QL_CHUNK_ENTRIES) return;

  if (!stageActive || stageVer != c.ver) stageBegin(c.ver, c.total);
  if (stageTotal != c.total) {
    stageBegin(c.ver, c.total);
  }
  stageTouchedAt = now;

  uint8_t byteIdx = (uint8_t)(c.idx / 8);
  uint8_t bit = (uint8_t)(1u << (c.idx % 8));
  if (stageBitmap[byteIdx] & bit) return;  // duplicate chunk; already staged

  uint16_t base = (uint16_t)(c.idx * QL_CHUNK_ENTRIES);
  for (uint8_t i = 0; i < c.count; i++) {
    uint8_t uid[10], len;
    if (!hexDecode(c.rows[i].uid, uid, sizeof(uid), &len)) return;
    stageRow[base + i].uidLen = len;
    memcpy(stageRow[base + i].uid, uid, len);
    stageRow[base + i].org = c.rows[i].org;
    stageRow[base + i].ep = c.rows[i].ep;
    stageRow[base + i].state = c.rows[i].state;
  }
  stageBitmap[byteIdx] |= bit;
  stageGot++;
  uint16_t end = (uint16_t)(base + c.count);
  if (end > stageRows) stageRows = end;

  stageTryCommit();
}

static void onCmd(char *plain, uint32_t now) {
  QlCmd c;
  if (!ql_read_cmd(plain, &c)) {
    logEvent(4, QL_LOG_MALFORMED, (int64_t)ql_malformed_frames(), 0);
    return;
  }
  uint32_t result = 0;

  if (strcmp(c.verb, QL_CMD_VOL) == 0) {
    volume = (uint8_t)(c.arg > QL_VOL_MAX ? QL_VOL_MAX : c.arg);
    df.volume(volume);
    nvs.putUChar("vol", volume);
    result = volume;
  } else if (strcmp(c.verb, QL_CMD_QVOL) == 0) {
    // QVOL reads the volume back. `C`/`K` share a payload shape (VERB then one
    // number), so a query is a verb whose RESULT is the answer rather than a
    // status code. The alternative — a second frame type for reads — buys
    // nothing on a wire this small.
    result = volume;
  } else if (strcmp(c.verb, QL_CMD_PLAY) == 0) {
    // ARG is (folder << 8) | track, so one u16 addresses the whole card. Bench
    // and commissioning only. It still goes through the clip map for folders
    // 1..4: an operator typo must not make a plinth play a story that is not
    // there and then behave unpredictably.
    uint8_t folder = (uint8_t)(c.arg >> 8);
    uint8_t track = (uint8_t)(c.arg & 0xFF);
    if (folder && track && clipPresent(folder, track)) {
      playClip(folder, track);
      result = 1;
    } else {
      result = 0;
    }
  } else if (strcmp(c.verb, QL_CMD_SYNC) == 0) {
    kickResync();
    result = 1;
  } else if (strcmp(c.verb, QL_CMD_PING) == 0) {
    result = (uint32_t)((millis() - bootMs) / 1000UL);
  }

  QlCmd ack;
  memset(&ack, 0, sizeof(ack));
  strncpy(ack.verb, c.verb, sizeof(ack.verb) - 1);
  ack.arg = result > QL_U16_MAX ? QL_U16_MAX : result;
  char pay[QL_PLAIN_MAX + 1];
  if (ql_pay_cmd(&ack, pay, sizeof(pay))) sealAndQueue(QL_T_CMDACK, QL_ADDR_HUB, pay, QL_PRIO_CMDACK);
  (void)now;
}

static void handleLine(const char *line, uint16_t len, int16_t rssi, uint32_t now) {
  QlHeader hdr;
  char plain[QL_PLAIN_MAX + 1];
  size_t plainLen = 0;

  QlRxResult r = ql_line_open(line, len, SELF, &hdr, plain, sizeof(plain), &plainLen);
  (void)plainLen;  // the payload is NUL-terminated; the splitters work from that
  switch (r) {
    case QL_RX_OK:
      break;
    case QL_RX_NOT_FOR_US:
      return;
    case QL_RX_BAD_MAC:
      // Counted, surfaced in the heartbeat's ERR and (rate-limited) as a numeric
      // LOG, and NEVER answered on the air. A reply to a bad MAC is an oracle:
      // it tells a forger their frame reached us, and it turns one forged packet
      // into a guaranteed transmission — free airtime denial for the price of
      // noise. Silence plus a count is the only combination that is neither an
      // oracle nor a four-hour debugging session.
      logEvent(3, QL_LOG_MAC_FAIL, (int64_t)ql_mac_failures(), 0);
      return;
    case QL_RX_NO_KEY:
      logEvent(2, QL_LOG_NO_KEY, 0, 0);
      return;
    default:
      logEvent(4, QL_LOG_MALFORMED, (int64_t)ql_malformed_frames(), 0);
      return;
  }

  // Stations do not talk to stations. A peer's frame is perfectly authentic —
  // every board in the park holds the same PSK — and is ignored anyway, because
  // the topology is a star and nothing here has a reason to act on a sibling.
  // That is what stops one opened enclosure from puppeting the other twenty:
  // not that it lacks the key, but that nobody is listening to it.
  if (hdr.src != QL_ADDR_HUB) return;

  if (!ql_peer_accept(&hubPeer, hdr.epoch, hdr.seq)) {
    logEvent(4, QL_LOG_REPLAY_DROP, (int64_t)hdr.src, (int64_t)hdr.seq);
    return;
  }

  lastHubRssi = rssi;
  lastHubHeardAt = now;

  if (verbose) {
    char t[2] = {hdr.type, 0};
    svc("[rx] ");
    svc(t);
    svc(" ");
    svcKV("seq", hdr.seq);
    svc("| ");
    svcln(plain);
  }

  switch (hdr.type) {
    case QL_T_ACK: if (ql_read_ack(plain)) onAck(now); break;
    case QL_T_RESOLVE: onResolve(plain, now); break;
    case QL_T_BEACON: onBeacon(plain, now); break;
    case QL_T_CHUNK: onChunk(plain, now); break;
    case QL_T_CMD: onCmd(plain, now); break;
    default: break;  // T, Q, S, H, L, K are uplinks; a hub sending one is not ours to act on
  }
}

/**
 * CORRECTION #1: THE RADIO IS POLLED FROM loop(). LoRa.onReceive() IS NEVER USED.
 *
 * WHAT BREAKS IF onReceive IS RE-INTRODUCED: the library's DIO0 handler calls
 * LoRa.read() from interrupt context, which starts an SPI transaction on the
 * bus the MFRC522 is also on. loop() can be halfway through a reader transfer at
 * that instant — a chip-select is asserted, bytes are in flight — and the ISR
 * asserts the radio's chip-select on top of it. Two devices then drive MISO. You
 * get corrupted tag reads AND corrupted frames, both intermittent, both
 * load-dependent, and neither reproducible on a bench where nobody is tapping a
 * card at the moment a packet lands.
 *
 * Polling is not a workaround for that; it is the fix. All SPI in this firmware
 * happens on one thread with no re-entry, which is why matched 4 MHz clocks and
 * the two 10k pull-ups are then sufficient rather than merely helpful.
 *
 * One packet per pass, so a burst cannot starve the reader.
 */
static void pumpRadioRx(uint32_t now) {
  if (txBusy) return;  // the FIFO belongs to the transmitter until it is done
  int sz = LoRa.parsePacket();
  if (sz <= 0) return;
  int16_t rssi = (int16_t)LoRa.packetRssi();
  uint16_t n = 0;
  bool over = false;
  while (LoRa.available()) {
    int b = LoRa.read();
    if (b < 0) break;
    if (n < QL_LINE_MAX) rxBuf[n++] = (uint8_t)b;
    else over = true;
  }
  if (over) {
    logEvent(4, QL_LOG_MALFORMED, (int64_t)ql_malformed_frames(), (int64_t)n);
    return;
  }
  rxBuf[n] = 0;
  handleLine((const char *)rxBuf, n, rssi, now);
}

// ════════════════════════════════════════════════════════════════════════════
// Uplink pumps
// ════════════════════════════════════════════════════════════════════════════

static bool quiet(uint32_t now) { return !due(now, quietUntil); }

/**
 * Seal the head of the tap ring and keep transmitting it until the hub takes
 * custody of it.
 *
 * ── CORRECTION #6: THE RETRY IS A TIMESTAMP, NOT A delay() ─────────────────
 *
 * WHAT BREAKS IF THIS BECOMES `delay(backoff)` AROUND A RETRY LOOP: the reader
 * stops being polled, BUSY stops being sampled and the radio stops being drained
 * for up to four seconds — and it happens at the exact moment the station is
 * busiest, because the thing that produced the tap was a guest arriving. Three
 * children pressing flags against the face during that window get nothing at
 * all, and the ambience loop stalls halfway through a file because nobody
 * restarted it. Every deadline in this file is a comparison in loop() for the
 * same reason; this is simply the one that was most tempting to write the other
 * way.
 *
 * ── CORRECTION #2: CUSTODY DOES NOT TRANSFER ON RECEPTION ─────────────────
 *
 * The entry is popped from flash in onAck() and NOWHERE ELSE. The hub ACKs only
 * when the console tab is attached, so with the tab shut this loop runs its four
 * attempts, gives up, and the tap stays exactly where it was — reboot-safe. If
 * the tap were popped on transmission instead, closing the console tab would
 * quietly destroy every check-in taken while it was closed, and nothing anywhere
 * would record that it had happened.
 */
static void pumpTapQueue(uint32_t now) {
  if (!ql_crypto_ready() || lineageEpoch == 0) return;

  if (!tapActive) {
    if (qCount == 0) return;
    if (!due(now, tapHoldUntil)) return;
    if ((uint32_t)(now - lastDrainAt) < QL_DRAIN_GAP_MS) return;
    if (!tapPeek(&tapRec)) {
      tapPop();  // unreadable slot: drop it rather than block the ring forever
      return;
    }
    char hex[QL_UID_MAX + 1];
    if (!ql_hex_encode(tapRec.uid, tapRec.uidLen, hex, sizeof(hex))) {
      tapPop();
      return;
    }
    QlTap t;
    memset(&t, 0, sizeof(t));
    strncpy(t.uid, hex, QL_UID_MAX);
    t.ts = tapRec.ts;
    t.org = tapRec.org;
    t.ep = tapRec.ep;
    t.res = tapRec.res;

    char pay[QL_PLAIN_MAX + 1];
    if (!ql_pay_tap(&t, pay, sizeof(pay))) {
      tapPop();
      return;
    }

    // ── WHY SEALING HERE IS SAFE, AND WHAT WOULD MAKE IT UNSAFE ─────────────
    //
    // ql_crypto.h forbids re-sealing a frame for a RETRANSMISSION, because
    // re-sealing even slightly different plaintext under the same (SRC, TYPE,
    // SEQ, EPOCH) is CTR keystream reuse. That rule is respected: a
    // retransmission below re-sends tapLine byte for byte and never comes back
    // through here.
    //
    // This call is not a retransmission. It takes a FRESH sequence number, so it
    // is a new frame with a new nonce. That also solves an ordering trap: the
    // tap ring can hold a tap for hours while heartbeats consume sequence
    // numbers, and a tap sealed at TAP time would go out carrying a number below
    // the hub's high-water mark and be dropped as a replay — a guest's check-in
    // discarded by the very mechanism meant to protect it.
    //
    // Every field of the PLAINTEXT is frozen at tap time and stored in flash.
    // The moment somebody adds a field that is read at seal time instead — the
    // current queue depth, the current RSSI, "now" — a reboot mid-flight starts
    // producing two different plaintexts for one tap. Keep the record complete.
    size_t n = ql_line_seal(QL_T_TAP, QL_ADDR_HUB, SELF, nextSeq(), lineageEpoch, pay, strlen(pay),
                            (char *)tapLine, sizeof(tapLine));
    if (n == 0) return;
    tapLineLen = (uint16_t)n;
    tapActive = true;
    tapAttempts = 0;
    tapRetryAt = now;
  }

  if (!due(now, tapRetryAt)) return;

  if (tapAttempts >= QL_ACK_ATTEMPTS) {
    // Give up on THIS ROUND, not on the tap. The entry stays at the head of the
    // ring; the hold below is what stops a closed console tab turning one
    // unacknowledged tap into a transmission every 2.5 seconds for as long as
    // the tab stays shut. See QL_TAP_HOLD_MS.
    tapActive = false;
    tapAttempts = 0;
    tapHoldUntil = now + QL_TAP_HOLD_MS;
    logEvent(4, QL_LOG_ACK_GAVE_UP, (int64_t)QL_ACK_ATTEMPTS, (int64_t)qCount);
    return;
  }

  if (txTryStart(tapLine, tapLineLen)) {
    tapAttempts++;
    tapRetryAt = now + QL_ACK_TIMEOUT_MS;
  }
}

static void pumpOutbox() {
  int8_t best = -1;
  for (uint8_t i = 0; i < QL_OUTBOX; i++) {
    if (!outbox[i].used) continue;
    if (best < 0 || outbox[i].prio < outbox[best].prio ||
        (outbox[i].prio == outbox[best].prio && (int32_t)(outbox[i].at - outbox[best].at) < 0)) {
      best = (int8_t)i;
    }
  }
  if (best < 0) return;
  if (txTryStart(outbox[best].line, outbox[best].len)) outbox[best].used = false;
}

static void pumpResolve(uint32_t now) {
  if (holdUidLen && due(now, holdUntil)) holdUidLen = 0;

  if (!queryUidLen) return;
  if (!due(now, queryDueAt)) return;

  uint8_t len = queryUidLen;
  uint8_t uid[10];
  memcpy(uid, queryUid, len);
  queryUidLen = 0;

  if (stampSeen(recentQuery, uid, len, now, QL_QUERY_COOLDOWN_MS)) return;
  stampNote(recentQuery, uid, len, now);

  char hex[QL_UID_MAX + 1];
  if (!ql_hex_encode(uid, len, hex, sizeof(hex))) return;
  char pay[QL_PLAIN_MAX + 1];
  if (!ql_pay_query(hex, pay, sizeof(pay))) return;
  // A QUERY is guest-triggered, so it is urgent and is NOT suppressed by QUIET —
  // a quiet period that silences a check-in path is a quiet period that loses a
  // guest's walk.
  sealAndQueue(QL_T_QUERY, QL_ADDR_HUB, pay, QL_PRIO_QUERY);
}

/**
 * CORRECTION #4: the resync backoff, capped, with a clean reset.
 *
 * 4 / 8 / 16 / 32 seconds for the first attempts, then at most one SYNC per
 * received beacon (armed in onBeacon). WHAT BREAKS WITHOUT BOTH HALVES: a
 * station missing a single chunk asks again every few seconds, forever. One
 * station doing that is merely wasteful. Twenty-one doing it is congestion
 * collapse — and they all go stale at the same instant, because what makes them
 * stale is a bulk rebinding at the counter. The worst moment in the park's day
 * is precisely when the naive version breaks.
 */
static void pumpSync(uint32_t now) {
  if (!haveBeacon || !ql_crypto_ready() || lineageEpoch == 0) return;
  if (table.ver == beaconVer) return;  // in sync; a leftover stage is reaped by pumpWatchdogs
  if (nextSyncAt == 0) return;         // 0 is the explicit "no attempt armed" state here
  if ((int32_t)(now - nextSyncAt) < 0) return;
  if (quiet(now)) return;

  if (stageActive && (uint32_t)(now - stageTouchedAt) > QL_STAGE_TIMEOUT_MS) stageAbandon();

  QlSync s;
  memset(&s, 0, sizeof(s));
  s.haveVer = table.ver;
  s.wantVer = beaconVer;

  if (stageActive && stageVer == beaconVer) {
    // Ask only for the chunks actually missing.
    uint16_t bytes = (uint16_t)((stageTotal + 7) / 8);
    if (bytes > QL_SYNC_BITMAP_BYTES) bytes = QL_SYNC_BITMAP_BYTES;
    for (uint16_t i = 0; i < stageTotal && i < QL_CHUNK_MAX; i++) {
      if (!(stageBitmap[i / 8] & (1u << (i % 8)))) s.missing[i / 8] |= (uint8_t)(1u << (i % 8));
    }
    s.missingBytes = (uint8_t)bytes;
  } else {
    s.missingBytes = 0;  // encoded as "00": send me everything
  }

  char pay[QL_PLAIN_MAX + 1];
  if (!ql_pay_sync(&s, pay, sizeof(pay))) return;
  if (!sealAndQueue(QL_T_SYNC, QL_ADDR_HUB, pay, QL_PRIO_SYNC)) return;

  if (syncAttempts < QL_SYNC_MAX_ATTEMPTS) {
    logEvent(6, QL_LOG_RESYNC_START, (int64_t)(syncAttempts + 1),
             (int64_t)(stageActive ? (stageTotal - stageGot) : 0));
    nextSyncAt = now + SYNC_BACKOFF[syncAttempts];
    syncAttempts++;
  } else {
    // Cap reached. From here a SYNC goes out only when a beacon arms one, which
    // is at most every 30 seconds however broken things are.
    if (!syncBeaconGated) {
      logEvent(4, QL_LOG_RESYNC_GAVE_UP, (int64_t)syncAttempts,
               (int64_t)(stageActive ? (stageTotal - stageGot) : 0));
    }
    syncBeaconGated = true;
    nextSyncAt = 0;
  }
}

/**
 * CORRECTION #5: the heartbeat's TDMA slot.
 *
 * TWO THINGS, and the failure is only visible when both are right:
 *
 * 1. THE FULL SLOT VALUE IS USED. An earlier draft offset by `slot % 1000`. A
 *    slot is a whole number of seconds expressed in milliseconds, so that
 *    expression is ALWAYS ZERO and every station transmits at the same instant
 *    of the frame. It looks like TDMA in the code and is a broadcast storm on
 *    the air.
 *
 * 2. THE FRAME IS ANCHORED TO THE BEACON EPOCH, NOT millis(). millis() starts at
 *    each board's own boot, so anchoring to it gives twenty-three free-running
 *    timers with no common origin — the slots mean nothing relative to each
 *    other. Two stations that booted within 370 ms of one another then collide
 *    on EVERY heartbeat, stably, forever, and the two that collide are the two
 *    that were installed on the same afternoon and powered up together. With a
 *    shared wall clock the frame boundary is the same instant for everybody and
 *    a slot actually reserves airtime.
 *
 * The offset is SCHEDULED rather than slept through. `delay(slot)` would be
 * correct on the wire and would freeze the reader for up to 115 seconds, which
 * correction #6 rules out for the same reasons everywhere else in this file.
 */
static void rescheduleHeartbeat(uint32_t nowMs) {
  if (!clockValid) {
    hbAtMs = 0;
    return;
  }
  uint32_t e = epochNow();
  uint32_t frameStart = (e / QL_HB_FRAME_S) * QL_HB_FRAME_S;
  uint32_t mine = frameStart + (uint32_t)SELF * (uint32_t)QL_HB_SLOT_S;
  while (mine <= e) mine += QL_HB_FRAME_S;
  hbAtMs = nowMs + (mine - e) * 1000UL;
  if (hbAtMs == 0) hbAtMs = 1;  // 0 is the "unscheduled" sentinel
}

static void pumpHeartbeat(uint32_t now) {
  if (hbAtMs == 0 || !ql_crypto_ready() || lineageEpoch == 0) return;
  if ((int32_t)(now - hbAtMs) < 0) return;
  if (quiet(now)) {
    rescheduleHeartbeat(now);
    return;
  }

  QlHeartbeat h;
  memset(&h, 0, sizeof(h));
  h.ups = (uint32_t)((millis() - bootMs) / 1000UL);
  h.tblver = table.ver;
  h.tblage = tableAgeSeconds();
  h.qdepth = qCount;
  h.sd = sdHealthy ? 1 : 0;  // 1 = HEALTHY. Inverting these inverts the console's health board, quietly.
  h.df = dfHealthy ? 1 : 0;
  h.err = lastErrCode;
  h.rssi = lastHubRssi < QL_RSSI_MIN ? QL_RSSI_MIN : (lastHubRssi > QL_RSSI_MAX ? QL_RSSI_MAX : lastHubRssi);
  h.vol = volume;
  h.fw = QL_FW_BUILD;

  char pay[QL_PLAIN_MAX + 1];
  if (ql_pay_hb(&h, pay, sizeof(pay))) sealAndQueue(QL_T_HB, QL_ADDR_HUB, pay, QL_PRIO_HB);
  rescheduleHeartbeat(now);
}

static void pumpLog(uint32_t now) {
  if (!logPending || !ql_crypto_ready() || lineageEpoch == 0) return;
  if ((uint32_t)(now - lastLogAt) < QL_LOG_MIN_GAP_MS && lastLogAt != 0) return;
  if (quiet(now)) return;
  char pay[QL_PLAIN_MAX + 1];
  if (!ql_pay_log(&logRec, pay, sizeof(pay))) {
    logPending = false;
    return;
  }
  if (!sealAndQueue(QL_T_LOG, QL_ADDR_HUB, pay, QL_PRIO_LOG)) return;
  logPending = false;
  lastLogAt = now;
}

static void pumpWatchdogs(uint32_t now) {
  if ((uint32_t)(now - rfidWatchdogAt) < QL_RFID_WATCHDOG_MS) return;
  rfidWatchdogAt = now;

  // MFRC522 chips latch up in RF-noisy enclosures: the part answers SPI
  // perfectly and never sees another card until it is power-cycled. Reading
  // VersionReg costs one transfer; 0x00 and 0xFF are the two "nobody home"
  // answers a floating or wedged bus gives.
  uint8_t v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (v == 0x00 || v == 0xFF) {
    static uint32_t reinits = 0;
    reinits++;
    rfid.PCD_Init();
    rfid.PCD_AntennaOn();
    logEvent(3, QL_LOG_READER_FAULT, (int64_t)reinits, (int64_t)v);
  }

  if (stageActive && (uint32_t)(now - stageTouchedAt) > QL_STAGE_TIMEOUT_MS) stageAbandon();

  if (lastHubHeardAt && (uint32_t)(now - lastHubHeardAt) > QL_HUB_SILENT_MS && verbose) {
    svcln("[hub] silent");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Service console
// ════════════════════════════════════════════════════════════════════════════

static void servicePrintStatus() {
  svc("[st] ");
  svcKV("no", SELF);
  svcKV("fw", QL_FW_BUILD);
  svc("key=");
  svc(ql_key_fingerprint());
  svc(" ");
  svcKV("tblver", table.ver);
  svcKV("rows", table.count);
  svcKV("tblage", tableAgeSeconds());
  svcKV("qdepth", qCount);
  svcKV("seq", seqNext);
  svcKV("epoch", epochNow());
  svcKV("vol", volume);
  svcKV("sd", sdHealthy ? 1 : 0);
  svcKV("df", dfHealthy ? 1 : 0);
  svcKV("macfail", ql_mac_failures());
  svcKV("replay", ql_replay_drops());
  svcKV("bad", ql_malformed_frames());
  svcln("");
}

static void serviceCommand(char c) {
  switch (c) {
    case 's': servicePrintStatus(); break;
    case 'v':
      verbose = !verbose;
      svcln(verbose ? "[svc] verbose on" : "[svc] verbose off");
      break;
    case 'r':
      kickResync();
      svcln("[svc] resync requested");
      break;
    case 'a':
      playAmbience();
      svcln("[svc] ambience");
      break;
    case '?':
      svcln("s status  v verbose  r resync  a ambience");
      break;
    default: break;
  }
}

static void pumpService() {
  if (Serial.available()) serviceCommand((char)Serial.read());
#if QL_SERVICE_BT
  if (bt.available()) serviceCommand((char)bt.read());
#endif
}

// ════════════════════════════════════════════════════════════════════════════
// setup / loop
// ════════════════════════════════════════════════════════════════════════════

void setup() {
  bootMs = millis();
  Serial.begin(QL_SERIAL_BAUD);

  pinMode(QL_PIN_DF_BUSY, INPUT);

  // Both chip selects are driven HIGH before either bus master runs. The two
  // external 10k pull-ups in the BOM cover the window BEFORE this line — from
  // power-on through the boot ROM — which is the window this code cannot reach.
  pinMode(QL_PIN_RFID_CS, OUTPUT);
  digitalWrite(QL_PIN_RFID_CS, HIGH);
  pinMode(QL_PIN_LORA_NSS, OUTPUT);
  digitalWrite(QL_PIN_LORA_NSS, HIGH);

  SPI.begin(QL_PIN_SPI_SCK, QL_PIN_SPI_MISO, QL_PIN_SPI_MOSI);

  rfid.PCD_Init();
  rfid.PCD_AntennaOn();

  // The DFPlayer is on UART2 with a 1k series resistor on the ESP TX line.
  // begin() blocks for up to a couple of seconds while the module enumerates the
  // card; that is acceptable here and nowhere else in this file.
  Serial2.begin(9600, SERIAL_8N1, QL_PIN_DF_RX, QL_PIN_DF_TX);
  dfHealthy = df.begin(Serial2, /*isACK=*/true, /*doReset=*/true);
  sdHealthy = dfHealthy;

  nvs.begin(QL_NVS_NAMESPACE, /*readOnly=*/false);
  volume = nvs.getUChar("vol", QL_VOL_DEFAULT);
  if (volume > QL_VOL_MAX) volume = QL_VOL_DEFAULT;
  lineageEpoch = nvs.getUInt("lineage", 0);
  seqBegin();
  tableLoad();
  tapRingBegin();
  tableCommittedAtMs = millis();

  if (dfHealthy) {
    df.volume(volume);
    playAmbience();
  } else {
    logEvent(3, QL_LOG_DF_FAULT, 0, 0);
  }

  randomSeed((long)esp_random());

  LoRa.setPins(QL_PIN_LORA_NSS, QL_PIN_LORA_RST, QL_PIN_LORA_DIO0);
  LoRa.setSPIFrequency(QL_SPI_HZ);
  if (LoRa.begin(QL_LORA_FREQ_HZ)) {
    LoRa.setSpreadingFactor(QL_LORA_SF);
    LoRa.setSignalBandwidth(QL_LORA_BW_HZ);
    LoRa.setCodingRate4(QL_LORA_CR_DENOM);
    LoRa.setPreambleLength(QL_LORA_PREAMBLE);
    LoRa.setSyncWord(QL_LORA_SYNCWORD);
    LoRa.setTxPower(QL_LORA_TX_DBM, QL_LORA_PABOOST ? PA_OUTPUT_PA_BOOST_PIN : PA_OUTPUT_RFO_PIN);
    LoRa.enableCrc();
    // DELIBERATELY NO LoRa.onReceive(). See pumpRadioRx().
    LoRa.receive();
  } else {
    // Deliberately not logged to the wire. A radio that will not initialise
    // cannot report itself, and there is no point building a LOG frame that will
    // never leave the board. The console sees this station as SILENT — no
    // heartbeat, no taps — which is the correct and honest condition for it, and
    // the service channel says why to anyone who pairs with it.
    svcln("[lora] begin failed - radio dead, station is audio-only");
  }

#if QL_SERVICE_BT
  {
    char name[32];
    QlBuf b = ql_buf(name, sizeof(name));
    ql_put(&b, QL_SERVICE_BT_PREFIX);
    ql_putc(&b, '-');
    ql_putu(&b, SELF);
    bt.begin(b.ok ? name : QL_SERVICE_BT_PREFIX);
  }
#endif

  // The PSK is loaded LAST, so a board that has not been provisioned still
  // reaches this line and can say so. There is deliberately no plaintext
  // fallback: a downgrade path is a downgrade attack, and an unprovisioned board
  // is a bench problem that must present as one. It will read tags, resolve them
  // against whatever table is already in flash and play audio; it will not put a
  // single frame on the air.
  if (!ql_crypto_begin()) {
    logEvent(2, QL_LOG_NO_KEY, 0, 0);
    svcln("[key] NOT PROVISIONED - radio disabled. Run tools/provision-key.mjs");
  }

  logEvent(6, QL_LOG_BOOT, (int64_t)esp_reset_reason(), (int64_t)QL_FW_BUILD);
  servicePrintStatus();
}

void loop() {
  uint32_t now = millis();

  pumpService();
  // Retire a finished transmission BEFORE trying to receive: endPacket(async)
  // leaves the radio in standby until pumpRadioTx puts it back into receive, so
  // the other order costs a whole extra pass of deafness after every frame.
  pumpRadioTx();
  pumpRadioRx(now);
  pumpReader(now);
  pumpAudio(now);
  pumpTapQueue(now);
  pumpResolve(now);
  pumpSync(now);
  pumpHeartbeat(now);
  pumpLog(now);
  pumpOutbox();
  pumpWatchdogs(now);
}
