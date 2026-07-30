// hub.ino — the Questland hub.
//
// One ESP32 on the counter in the Adventurer's Hall, on a USB cable to the
// console PC. It is the only board in the park that touches both wires:
//
//   LoRa 915 MHz, Q1, encrypted   <->   USB serial 115200, newline-delimited JSON
//
// It stores almost nothing and decides almost nothing. The console is the
// authority on what a pole means; the stations are the cache that lets a plinth
// answer a tap without asking anybody. The hub is the bridge between them, and
// its whole job is to relay faithfully and to never, under any circumstances,
// invent a frame.
//
// ── THE ONE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE ───────────────
//
// CUSTODY DOES NOT TRANSFER ON RECEPTION.
//
// When a station puts a tap on the air it keeps that tap in its own NVS ring
// and retransmits until the hub sends back an `A` ACK. The ACK is not "I heard
// you" — it is "this guest's check-in is somebody else's problem now", and the
// station deletes its copy on the strength of it. So the hub must not send one
// until the tap has actually reached a consuming console tab. If the hub ACKed
// on reception, closing the console tab would quietly destroy every tap taken
// while it was closed: no presence, no progress, no leg, no error anywhere, and
// a party who walked seven stations in the rain with nothing to show for it.
//
// That is the worst failure this system can have, so the ACK is earned rather
// than assumed. See "pcReady" below — it is not a boolean about a cable, it is
// a proof about a browser tab.
//
// ── THE HEADERS ARE THE CONTRACT ────────────────────────────────────────────
//
// ql_proto.h owns every field layout and every bound on both wires and mirrors
// `questland/src/services/hubProtocol.ts`, which is the authority. ql_crypto.h
// owns the sealed line. Nothing in this file re-implements either: if you find
// yourself formatting a JSON key or a Q1 field by hand here, stop — the two
// halves will drift and the drift will present as a plinth that has gone quiet.
//
// The Arduino build only searches the sketch folder for quoted includes, so
// hub/ carries symlinks to ../ql_proto.h and ../ql_crypto.h. They are one file
// each; do not copy them.

#include "config.h"

#include "ql_proto.h"
#include "ql_crypto.h"

#include <LoRa.h>
#include <MFRC522.h>
#include <Preferences.h>
#include <SPI.h>
#include <esp_system.h>

// ════════════════════════════════════════════════════════════════════════════
// Verbose service channel
// ════════════════════════════════════════════════════════════════════════════
//
// The frames on the radio are encrypted and stay that way — debuggability is
// preserved AT THE ENDPOINTS, not over the air. This is the hub's endpoint: a
// human standing in front of the board can read every frame in clear.
//
// It defaults OFF and, when Serial1 is not fitted, refuses to use the console
// wire unless QL_HUB_VERBOSE_ON_CONSOLE is set — because a trace line is not
// JSON, `decodeLine` refuses it as `bad-json`, and the console's malformed
// counter becomes noise exactly when somebody is trying to read it.

static bool verbose_ = QL_HUB_VERBOSE_DEFAULT;

#if QL_HUB_VERBOSE_UART
#define QL_TRACE_PORT Serial1
#define QL_TRACE_AVAILABLE 1
#elif QL_HUB_VERBOSE_ON_CONSOLE
#define QL_TRACE_PORT Serial
#define QL_TRACE_AVAILABLE 1
#else
#define QL_TRACE_AVAILABLE 0
#endif

#if QL_TRACE_AVAILABLE
#define TRACE(...)                       \
  do {                                   \
    if (verbose_) QL_TRACE_PORT.printf(__VA_ARGS__); \
  } while (0)
#define TRACELN(...)                     \
  do {                                   \
    if (verbose_) {                      \
      QL_TRACE_PORT.printf(__VA_ARGS__); \
      QL_TRACE_PORT.println();           \
    }                                    \
  } while (0)
/** Always printed, verbose or not: boot banner, key fingerprint, hard faults. */
#define NOTE(...)                        \
  do {                                   \
    QL_TRACE_PORT.printf(__VA_ARGS__);   \
    QL_TRACE_PORT.println();             \
  } while (0)
#else
#define TRACE(...) do { } while (0)
#define TRACELN(...) do { } while (0)
#define NOTE(...) do { } while (0)
#endif

// ════════════════════════════════════════════════════════════════════════════
// Small helpers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Wrap-safe elapsed time. millis() rolls over every 49.7 days and a hub that
 * lives on a counter will cross that; `now - then` in unsigned arithmetic is
 * correct across the wrap, `now > then + window` is not.
 */
static inline bool elapsed(uint32_t since, uint32_t window) {
  return (uint32_t)(millis() - since) >= window;
}

static Preferences prefs_;
static bool prefsOpen_ = false;

// ════════════════════════════════════════════════════════════════════════════
// The clock, and the two different things called "epoch"
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ THERE ARE TWO EPOCHS IN THIS FIRMWARE AND CONFUSING THEM IS A CRYPTO BUG.
//
//   wallClock_  unix SECONDS. Rides in the `V` BEACON's EPOCH field and is how
//               twenty-one stations in a wood get a clock at all.
//   seqEpoch_   the unix second at which THIS BOARD last began a fresh SEQ
//               lineage. It goes in the CTR nonce and it changes only when the
//               NVS sequence reservation is lost. It is not a clock.
//
// ── WHERE THE HUB GETS WALL TIME, AND WHY IT IS A FLOOR ─────────────────────
//
// The hub has no RTC, no GPS and no network — it is on a USB cable to a browser
// tab, and the NDJSON key sets are EXACT, so there is no frame type the console
// could use to tell it the time even if somebody wanted to add one.
//
// But `table.ver` and `row.ver` are `max(flag.tableAt)` on the console side: a
// MILLISECOND unix epoch, stamped when a Guide last bound a pole. That is real
// wall time and it is never in the future. So the hub adopts `ver / 1000` as a
// LOWER BOUND and free-runs from millis() between updates, never rewinding.
//
// A lower bound is enough, and it is worth being explicit about why:
//
//   * the console IGNORES a tap's `ts` entirely and stamps the check-in with
//     its own clock, so nothing a guest experiences depends on this being
//     accurate;
//   * the beacon EPOCH's real job is to be SHARED and MONOTONIC, not correct —
//     it anchors the heartbeat TDMA frame, and a slot plan works as well on a
//     clock that is an hour slow as on a right one, provided every station has
//     the same one;
//   * it is monotonic across a hub reboot because it is persisted, so stations
//     never see time run backwards.
//
// Accuracy is a bonus that arrives with the first binding of the day.

static uint32_t wallClock_ = 0;   // unix seconds, monotonic, a lower bound
static uint32_t wallBase_ = 0;    // millis() at which wallClock_ was last set
static uint32_t wallDirtyAt_ = 0;
static bool wallDirty_ = false;

static uint32_t nowSeconds(void) {
  if (wallClock_ == 0) return 0;  // no clock yet: 0 is in range and the console re-stamps
  return wallClock_ + (uint32_t)((millis() - wallBase_) / 1000ul);
}

/** Adopt a floor. Never rewinds — a stale `ver` from an old binding must not move time backwards. */
static void clockFloor(uint32_t seconds) {
  if (seconds == 0) return;
  uint32_t current = nowSeconds();
  if (seconds <= current) return;
  wallClock_ = seconds;
  wallBase_ = millis();
  if (!wallDirty_) {
    wallDirty_ = true;
    wallDirtyAt_ = millis();
  }
  TRACELN("[clock] floor adopted: %lu", (unsigned long)seconds);
}

// ── The uplink sequence counter ─────────────────────────────────────────────

static uint32_t seq_ = 0;
static uint32_t seqTop_ = 0;
static uint32_t seqEpoch_ = 0;

/**
 * Hand out the next SEQ, reserving a fresh block in NVS when the current one is
 * exhausted. See QL_SEQ_RESERVE in config.h for why this is a reservation and
 * not a counter — the short version is that a brownout inside a transmit burst
 * would otherwise roll SEQ backwards, which is simultaneously CTR keystream
 * reuse and a frame every peer drops as a replay.
 */
static uint32_t nextSeq(void) {
  if (seq_ >= seqTop_) {
    seqTop_ = seq_ + QL_SEQ_RESERVE;
    if (prefsOpen_) prefs_.putULong(QL_NVS_SEQ_TOP, seqTop_);
  }
  return seq_++;
}

// ════════════════════════════════════════════════════════════════════════════
// The flag table
// ════════════════════════════════════════════════════════════════════════════
//
// Held in RAM only — see the long note on QL_HUB_TABLE_MAX in config.h, and in
// particular the station-side contract it depends on: a station must NEVER
// adopt or wipe on a beacon whose TABLEVER is not greater than the version it
// already holds. A freshly booted hub honestly advertises version 0 until a
// console attaches, and if a station treated that as "the park has no
// bindings", one power cycle would silence the whole park.
//
// Rows are kept sorted by uid, byte-ascending, because the table CRC is
// computed over that order and the CRC is what a station checks before it
// commits. The console sorts the same way before it sends.

struct HubRow {
  char uid[QL_UID_MAX + 1];
  uint8_t org;
  uint8_t ep;
  uint8_t state;
};

static HubRow table_[QL_HUB_TABLE_MAX];
static uint16_t tableCount_ = 0;
static uint64_t tableVer_ = 0;
static uint32_t tableCrc_ = 0;
static bool tableEverCommitted_ = false;

/** Staging for a multi-chunk `table` push. Stage, then commit — never apply a partial table. */
static HubRow stage_[QL_HUB_TABLE_MAX];
static uint16_t stageCount_ = 0;
static uint64_t stageVer_ = 0;
static uint16_t stageOf_ = 0;
static uint8_t stageSeen_[(QL_HUB_STAGE_CHUNKS + 7) / 8];
static uint16_t stageSeenCount_ = 0;

static uint32_t computeTableCrc(const HubRow *rows, uint16_t count) {
  uint32_t crc = ql_crc32_begin();
  for (uint16_t i = 0; i < count; i++) {
    QlRow r;
    memset(&r, 0, sizeof(r));
    strncpy(r.uid, rows[i].uid, QL_UID_MAX);
    r.org = rows[i].org;
    r.ep = rows[i].ep;
    r.state = rows[i].state;
    crc = ql_crc32_row(crc, &r);
  }
  return ql_crc32_end(crc);
}

/** Binary search over the uid-sorted table. Returns the index, or -1. */
static int tableFind(const char *uid) {
  int lo = 0, hi = (int)tableCount_ - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    int c = strcmp(table_[mid].uid, uid);
    if (c == 0) return mid;
    if (c < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

static uint16_t tableChunkCount(void) {
  uint16_t n = (uint16_t)((tableCount_ + QL_CHUNK_ENTRIES - 1) / QL_CHUNK_ENTRIES);
  // An empty table is still one chunk. "The park holds no bindings at version v"
  // is information, and a station that receives nothing cannot tell the
  // difference between that and a hub that has stopped talking.
  return n == 0 ? 1 : n;
}

// ════════════════════════════════════════════════════════════════════════════
// Outbound NDJSON — the console wire
// ════════════════════════════════════════════════════════════════════════════
//
// Every line is built by ql_proto.h's emitters, queued whole, and written whole.
// Three rules, each of which is a way to break the console:
//
//   * NEVER emit a partial line and then stall. The console's assembler
//     discards its pending buffer and everything up to the next newline once it
//     passes 16384 characters with no terminator.
//   * NEVER block on Serial.write(). A blocked write is a frozen radio poll,
//     and the tap that arrives during it is gone.
//   * NEVER exceed 120 lines in a rolling second. Past that the console DROPS
//     frames and counts them; it does not queue them. So the queue below is
//     paced, and a station draining a backlog is slowed here rather than losing
//     taps there.

struct TxSlot {
  uint16_t len;
  uint32_t ticket;
  char buf[QL_HUB_TX_SLOT];
};

static TxSlot txq_[QL_HUB_TX_QUEUE];
static uint8_t txHead_ = 0;
static uint8_t txCount_ = 0;
static uint32_t txTicket_ = 0;
static uint32_t txDropped_ = 0;
static uint32_t txLastAt_ = 0;
static uint32_t framesOut_ = 0;

/**
 * Queue one complete NDJSON line. Returns its ticket, or 0 if it was refused.
 *
 * ── THE QUEUE DROPS THE NEWEST LINE, NOT THE OLDEST ─────────────────────────
 *
 * hubLink's write queue on the console side drops the oldest, which is right
 * there: an old flag-table chunk has been superseded by a newer one. Here it is
 * exactly wrong. The oldest line in this queue is a guest's tap whose ticket a
 * pending ACK is already waiting on; discarding it would leave the hub about to
 * certify custody of a line that never left the building. Refusing the newest
 * line instead means the tap is simply not forwarded, no ACK is earned, and the
 * station retransmits — which is the whole point of the station holding a copy.
 */
static uint32_t ndjsonQueue(const char *line, size_t len) {
  if (len == 0 || len >= QL_HUB_TX_SLOT) {
    txDropped_++;
    TRACELN("[tx] refused a %u byte line (slot is %u)", (unsigned)len, (unsigned)QL_HUB_TX_SLOT);
    return 0;
  }
  if (txCount_ >= QL_HUB_TX_QUEUE) {
    txDropped_++;
    TRACELN("[tx] queue full, refusing the new line (dropped %lu total)", (unsigned long)txDropped_);
    return 0;
  }
  uint8_t slot = (uint8_t)((txHead_ + txCount_) % QL_HUB_TX_QUEUE);
  memcpy(txq_[slot].buf, line, len);
  txq_[slot].len = (uint16_t)len;
  txq_[slot].ticket = ++txTicket_;
  txCount_++;
  return txq_[slot].ticket;
}

static void pumpTx(void) {
  if (txCount_ == 0) return;
  if (!elapsed(txLastAt_, QL_NDJSON_GAP_MS)) return;
  TxSlot &slot = txq_[txHead_];
  // If the host is not draining, do not block waiting for room. On a CP2102
  // bridge this never triggers (the bridge always accepts and discards with the
  // port closed); on a native-USB board with the port shut it is the difference
  // between a lossy hub and a wedged one.
  if ((size_t)Serial.availableForWrite() < slot.len) return;
  Serial.write((const uint8_t *)slot.buf, slot.len);
  txHead_ = (uint8_t)((txHead_ + 1) % QL_HUB_TX_QUEUE);
  txCount_--;
  txLastAt_ = millis();
  framesOut_++;
#if QL_TRACE_AVAILABLE
  if (verbose_) {
    // `slot` still names the slot we just sent — the reference binds to the
    // object, not to txHead_. The line already carries its own '\n'.
    QL_TRACE_PORT.printf("[usb >] ");
    QL_TRACE_PORT.write((const uint8_t *)slot.buf, slot.len);
  }
#endif
}

// ════════════════════════════════════════════════════════════════════════════
// pcReady — what actually earns an ACK
// ════════════════════════════════════════════════════════════════════════════
//
// "Is the console tab attached and consuming?" cannot be answered by looking at
// the cable. On the DevKitC's CP2102 bridge the ESP32's TX line goes to the
// bridge chip whether or not any program on the host has the port open; bytes
// written with nothing listening are simply discarded, with no error and no
// flow-control feedback. There is no DTR visible to the firmware either — the
// bridge's DTR and RTS are wired to EN and IO0 for the auto-reset circuit, not
// to a readable pin. So the only evidence that a console exists is BYTES COMING
// BACK.
//
// The hub therefore builds pcReady out of two tiers, and only the second of
// them is allowed to release a guest's check-in from its station.
//
// ── TIER 1: ATTACHED ────────────────────────────────────────────────────────
//
// A well-formed NDJSON frame arrived within QL_PC_ATTACH_MS. Malformed lines do
// not count: something writing garbage to the port is not a console.
//
// On its own this would decay to false during a quiet hour, because a healthy
// console sends nothing unsolicited — it pushes the flag table when its version
// is ahead of ours, answers queries, and is otherwise silent. So the hub
// PROVOKES a reply every QL_PC_PROBE_MS. See the probe below.
//
// ── TIER 2: CUSTODY, PROVEN BY ORDERING ─────────────────────────────────────
//
// Attachment is not enough to release a tap: the tab may have closed in the
// last few seconds, or the browser may have stalled mid-line. What we need is
// proof that the console consumed bytes written AFTER the tap line.
//
// Serial is an ordered stream and hubLink dispatches lines in order,
// synchronously. So: write the tap line, then write a `query` frame for a uid
// we know the console holds, and wait for the `resolve` it answers with. If
// that answer arrives, the console necessarily processed every line written
// before the query — including the tap. THAT is a custody receipt, and it is
// what the ACK is made of.
//
// The probe is not a special frame invented for this. `tapService.answerQuery`
// already answers a query for a known uid with a resolve, has no side effects
// when it does, and is registered by the same `startTapPipeline()` call that
// registers the tap handler — so a successful probe proves not merely that a
// tab is open but that THE TAP PIPELINE IS RUNNING IN IT. A tab sitting on some
// other screen with no pipeline is correctly reported as not ready.
//
// ── THE ONE WEAK PATH, AND WHY IT IS ACCEPTABLE ─────────────────────────────
//
// A probe needs a uid the console will recognise, which the hub takes from the
// table the console pushed it. With an EMPTY table there is no probeable uid,
// and the hub falls back to tier 1 alone.
//
// That is sound rather than a shortcut: an empty table means the park holds no
// bindings at all, so every tap that can possibly arrive is an unknown tag,
// which `tapService` refuses as `unknown-tag` before it reaches a check-in.
// There is no walk in progress to lose. (Note that the console does not even
// push an empty table unprompted: `tableVersion()` of an empty rack is 0, and
// its push is guarded on `frame.tblver < tableVersion()`, so 0 < 0 is false.
// With no bindings anywhere the hub may never see an inbound frame at all, tier
// 1 stays false, nothing is ACKed, and nothing is lost.)

static uint32_t lastInboundAt_ = 0;
static bool everInbound_ = false;
static uint32_t framesIn_ = 0;
static uint32_t rxMalformed_ = 0;

static bool pcAttached(void) {
  return everInbound_ && !elapsed(lastInboundAt_, QL_PC_ATTACH_MS);
}

struct Probe {
  bool active;
  uint8_t st;
  char uid[QL_UID_MAX + 1];
  uint32_t ticket;
  uint32_t at;
  uint8_t tries;
  /** Set when a station's REAL query for the same uid arrived while this probe was outstanding. */
  bool relayAnswer;
};

static Probe probe_;
static uint16_t probeCursor_ = 0;
static uint32_t probeSeq_ = 0;
static uint32_t custodyProven_ = 0;  // every ticket at or below this reached the console
static uint32_t lastProbeAt_ = 0;

/**
 * Per-station tap bookkeeping. The first three fields are persisted: they are
 * the replay high-water mark for `T` frames, and the `acked` flag with them.
 *
 * ── WHY THE MARK IS PER (STATION, FRAME TYPE) AND NOT PER STATION ───────────
 *
 * SEQ is one monotonic counter per node shared by every frame type, and a `T`
 * retransmission must be BYTE-IDENTICAL — same SEQ — or the console's
 * `${st}:${seq}` dedupe key sees a second check-in. But a station also sends
 * heartbeats on a TDMA schedule, and those take the next SEQ. So the sequence
 * a station actually emits looks like:
 *
 *      T#312   H#313   T#312 (retry)   L#314   T#312 (retry)
 *
 * Against a single per-station high-water mark, the heartbeat pushes the mark
 * to 313 and every subsequent retry of a real guest's tap is dropped as a
 * replay — permanently, because the station will keep sending exactly those
 * bytes. Per-type marks are exactly as strong (each type's subsequence of a
 * single monotonic counter is itself strictly increasing) and they make a
 * retransmission expressible.
 *
 * ── AND WHY EQUALITY IS ACCEPTED FOR `T`, CONDITIONALLY ─────────────────────
 *
 * A retry has SEQ equal to the mark, so equality has to be allowed or the retry
 * is undeliverable. Allowing it unconditionally would let a captured frame be
 * replayed indefinitely; after the console's 6-hour dedupe TTL lapsed, one of
 * those replays would land as a fresh check-in. So equality is accepted only
 * while the tap is UNSETTLED. Once ACKed, an equal frame can only ever produce
 * another ACK — never a second NDJSON line — and the re-ACK is rate-limited so
 * a replay flood cannot be turned into an airtime amplifier.
 */
struct TapMark {
  uint32_t epoch;
  uint32_t seq;
  bool seen;
  bool acked;
  // RAM only from here down.
  uint32_t ticket;
  uint8_t probeTries;
  uint32_t lastAckAt;
  uint8_t reAcks;
};

static TapMark tapMarks_[QL_ADDR_ST_MAX + 1];
static bool marksDirty_ = false;
static uint32_t marksDirtyAt_ = 0;

/** Packed on-flash form. Keep it explicit — a struct layout is not a file format. */
struct __attribute__((packed)) TapMarkRec {
  uint32_t epoch;
  uint32_t seq;
  uint8_t flags;  // bit0 seen, bit1 acked
};

#define QL_MARK_SEEN 0x01
#define QL_MARK_ACKED 0x02

static void marksLoad(void) {
  if (!prefsOpen_) return;
  TapMarkRec recs[QL_ADDR_ST_MAX + 1];
  memset(recs, 0, sizeof(recs));
  size_t got = prefs_.getBytes(QL_NVS_TAPMARKS, recs, sizeof(recs));
  if (got != sizeof(recs)) return;
  for (uint8_t i = 0; i <= QL_ADDR_ST_MAX; i++) {
    tapMarks_[i].epoch = recs[i].epoch;
    tapMarks_[i].seq = recs[i].seq;
    tapMarks_[i].seen = (recs[i].flags & QL_MARK_SEEN) != 0;
    tapMarks_[i].acked = (recs[i].flags & QL_MARK_ACKED) != 0;
  }
}

static void marksSave(void) {
  if (!prefsOpen_) return;
  TapMarkRec recs[QL_ADDR_ST_MAX + 1];
  memset(recs, 0, sizeof(recs));
  for (uint8_t i = 0; i <= QL_ADDR_ST_MAX; i++) {
    recs[i].epoch = tapMarks_[i].epoch;
    recs[i].seq = tapMarks_[i].seq;
    recs[i].flags = (uint8_t)((tapMarks_[i].seen ? QL_MARK_SEEN : 0) |
                              (tapMarks_[i].acked ? QL_MARK_ACKED : 0));
  }
  prefs_.putBytes(QL_NVS_TAPMARKS, recs, sizeof(recs));
  marksDirty_ = false;
}

static void marksTouch(void) {
  if (!marksDirty_) {
    marksDirty_ = true;
    marksDirtyAt_ = millis();
  }
}

// ── Replay marks for every other uplink type ────────────────────────────────

static const char RX_TYPES_[] = {QL_T_QUERY, QL_T_SYNC, QL_T_HB, QL_T_LOG, QL_T_CMDACK};
#define QL_RX_TYPE_COUNT 5

static QlPeer peers_[QL_ADDR_ST_MAX + 1][QL_RX_TYPE_COUNT];
static uint32_t hubReplayDrops_ = 0;

static int rxTypeIndex(char t) {
  for (int i = 0; i < QL_RX_TYPE_COUNT; i++) {
    if (RX_TYPES_[i] == t) return i;
  }
  return -1;
}

// ════════════════════════════════════════════════════════════════════════════
// LoRa
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠ LoRa.onReceive() IS NEVER USED. The callback fires from the SX1276's DIO0
// interrupt, which means it runs SPI transactions from inside an ISR — on a bus
// the MFRC522 is also using, from code that may itself have been interrupted
// mid-transaction. The corruption that follows is intermittent, load-dependent
// and impossible to reproduce on a bench. Polling parsePacket() from loop()
// costs a few milliseconds of latency that nobody standing at a plinth can
// perceive, and it makes every SPI access sequential by construction.
//
// ⚠ endPacket(true) — ASYNCHRONOUS. A blocking endPacket() at SF9 holds loop()
// for up to about 1.2 s on a full-length frame. That is 1.2 s in which the
// booth pad is not read, the console wire is not drained and the next station's
// tap is not received. Same rule as the station's ACK retry: no blocking waits
// anywhere in the hot path.

static bool radioUp_ = false;
static bool txBusy_ = false;
static uint32_t radioTxCount_ = 0;
static uint32_t radioRxCount_ = 0;

struct RadioSlot {
  uint16_t len;
  char buf[QL_LINE_MAX + 2];
};

#define QL_RADIO_QUEUE 8
static RadioSlot radioQ_[QL_RADIO_QUEUE];
static uint8_t radioQCount_ = 0;
static uint32_t radioDropped_ = 0;

/**
 * Queue a sealed line for transmission. `urgent` goes to the head of the queue.
 *
 * An `A` ACK and an `R` RESOLVE are urgent because a guest is standing in front
 * of a plinth waiting for one; a beacon or a table chunk is not, and deferring
 * one costs nothing.
 */
static bool radioSend(const char *line, size_t len, bool urgent) {
  if (!radioUp_ || len == 0 || len > QL_LINE_MAX) return false;
  if (radioQCount_ >= QL_RADIO_QUEUE) {
    radioDropped_++;
    TRACELN("[lora] queue full, dropped a frame (%lu total)", (unsigned long)radioDropped_);
    return false;
  }
  uint8_t at = urgent ? 0 : radioQCount_;
  if (urgent) {
    for (uint8_t i = radioQCount_; i > 0; i--) radioQ_[i] = radioQ_[i - 1];
  }
  memcpy(radioQ_[at].buf, line, len);
  radioQ_[at].len = (uint16_t)len;
  radioQCount_++;
  return true;
}

/** Seal a payload into a Q1 line and queue it. Returns false if the board holds no PSK. */
static bool sendFrame(char type, uint8_t dst, const char *payload, size_t payloadLen, bool urgent) {
  if (!ql_crypto_ready()) return false;
  char line[QL_LINE_MAX + 2];
  uint32_t s = nextSeq();
  size_t n = ql_line_seal(type, dst, QL_HUB_SELF_ADDR, s, seqEpoch_, payload, payloadLen, line,
                          sizeof(line));
  if (n == 0) {
    TRACELN("[lora] refused to seal a %c frame for %u", type, (unsigned)dst);
    return false;
  }
  TRACELN("[air >] %c dst=%u seq=%lu  %s", type, (unsigned)dst, (unsigned long)s, payload);
  return radioSend(line, n, urgent);
}

static void pumpRadioTx(void) {
  if (!radioUp_) return;
  if (txBusy_) {
    if (!LoRa.isTransmitting()) {
      txBusy_ = false;
      LoRa.receive();  // back to continuous RX; parsePacket() alone would not do it
    }
    return;
  }
  if (radioQCount_ == 0) return;
  if (!LoRa.beginPacket()) return;
  LoRa.write((const uint8_t *)radioQ_[0].buf, radioQ_[0].len);
  LoRa.endPacket(true);
  txBusy_ = true;
  radioTxCount_++;
  for (uint8_t i = 1; i < radioQCount_; i++) radioQ_[i - 1] = radioQ_[i];
  radioQCount_--;
}

/**
 * True when the channel looks clear enough to put a DEFERRABLE frame on it.
 *
 * Only beacons and table chunks consult this. An `A` ACK and an `R` RESOLVE go
 * out regardless: both have a guest standing in front of a plinth waiting, and
 * deferring an ACK to be polite is how a station burns its four-attempt retry
 * budget on a tap that had already arrived.
 */
static bool channelClear(void) {
  if (!radioUp_) return false;
  return LoRa.rssi() < QL_LBT_RSSI_FLOOR;
}

// ════════════════════════════════════════════════════════════════════════════
// Outstanding station queries
// ════════════════════════════════════════════════════════════════════════════
//
// A station that holds no row for a tapped uid asks the hub. The hub forwards
// the question to the console, which is the authority, and waits — because a
// guest is standing in silence, but a wrong story is worse than a pause and
// that is a user mandate, not a preference.
//
// Two things can end the wait. The console answers, and the answer is relayed.
// Or QL_RESOLVE_WAIT_MS passes and the hub answers from its own cached table —
// ONLY if it actually holds the row. It never guesses. A uid nobody holds gets
// nothing at all, which is exactly what `tapService.answerQuery` does with one,
// and the station stays on ambience and keeps asking.

struct PendingQuery {
  bool active;
  char uid[QL_UID_MAX + 1];
  uint32_t at;
};

static PendingQuery queries_[QL_ADDR_ST_MAX + 1];

static void sendResolveTo(uint8_t st, const char *uid, uint8_t org, uint8_t ep, uint8_t state,
                          uint32_t ttl) {
  QlResolve r;
  memset(&r, 0, sizeof(r));
  strncpy(r.uid, uid, QL_UID_MAX);
  r.org = org;
  r.ep = ep;
  r.state = state;
  r.ttl = ttl;
  char payload[QL_PLAIN_MAX + 1];
  if (!ql_pay_resolve(&r, payload, sizeof(payload))) return;
  sendFrame(QL_T_RESOLVE, st, payload, strlen(payload), /*urgent=*/true);
}

// ════════════════════════════════════════════════════════════════════════════
// Table broadcast: the beacon and the chunk sweep
// ════════════════════════════════════════════════════════════════════════════

static uint8_t wanted_[QL_SYNC_BITMAP_BYTES];
static uint16_t wantedCount_ = 0;
static uint16_t sweepCursor_ = 0;
static uint32_t sweepLastAt_ = 0;
static uint32_t beaconAt_ = 0;
static uint16_t beaconJitter_ = 0;
static uint32_t quietUntil_ = 0;

static void wantChunk(uint16_t idx) {
  if (idx >= QL_CHUNK_MAX) return;
  uint8_t mask = (uint8_t)(1u << (idx % 8));
  if (wanted_[idx / 8] & mask) return;
  wanted_[idx / 8] |= mask;
  wantedCount_++;
}

static void wantWholeTable(void) {
  memset(wanted_, 0, sizeof(wanted_));
  wantedCount_ = 0;
  uint16_t total = tableChunkCount();
  for (uint16_t i = 0; i < total && i < QL_CHUNK_MAX; i++) wantChunk(i);
  sweepCursor_ = 0;
  // Ask the park to keep quiet for roughly as long as the sweep will take.
  // QUIET suppresses heartbeats, logs and sync requests only — taps ALWAYS go,
  // because a quiet period that silences a check-in is a quiet period that
  // loses a guest's walk.
  //
  // A short sweep asks for nothing: silencing the whole park's telemetry for
  // six seconds to push four chunks costs more in blindness at the console than
  // it buys in airtime.
  if (wantedCount_ > 4) {
    uint32_t seconds = (uint32_t)wantedCount_ + 5;
    if (seconds > 3600) seconds = 3600;
    quietUntil_ = millis() + seconds * 1000ul;
  }
}

static uint16_t quietRemaining(void) {
  if ((int32_t)(quietUntil_ - millis()) <= 0) return 0;
  uint32_t s = (uint32_t)(quietUntil_ - millis()) / 1000ul;
  return (uint16_t)(s > 3600 ? 3600 : s);
}

static void sendBeacon(void) {
  QlBeacon v;
  memset(&v, 0, sizeof(v));
  v.tableVer = tableVer_;
  v.count = tableCount_;
  v.tableCrc = tableCrc_;
  v.epoch = nowSeconds();
  v.quiet = quietRemaining();
  char payload[QL_PLAIN_MAX + 1];
  if (!ql_pay_beacon(&v, payload, sizeof(payload))) return;
  sendFrame(QL_T_BEACON, QL_ADDR_BROADCAST, payload, strlen(payload), /*urgent=*/false);
}

static void pumpSweep(void) {
  if (wantedCount_ == 0) return;
  if (txBusy_ || radioQCount_ > 0) return;
  if (!elapsed(sweepLastAt_, QL_CHUNK_GAP_MS)) return;
  if (!channelClear()) return;

  uint16_t total = tableChunkCount();
  for (uint16_t scanned = 0; scanned < QL_CHUNK_MAX; scanned++) {
    uint16_t idx = (uint16_t)((sweepCursor_ + scanned) % QL_CHUNK_MAX);
    uint8_t mask = (uint8_t)(1u << (idx % 8));
    if (!(wanted_[idx / 8] & mask)) continue;
    wanted_[idx / 8] &= (uint8_t)~mask;
    if (wantedCount_) wantedCount_--;
    sweepCursor_ = (uint16_t)((idx + 1) % QL_CHUNK_MAX);
    if (idx >= total) break;  // a stale request for a chunk this version does not have

    QlChunk c;
    memset(&c, 0, sizeof(c));
    c.ver = tableVer_;
    c.idx = idx;
    c.total = total;
    uint16_t base = (uint16_t)(idx * QL_CHUNK_ENTRIES);
    for (uint8_t k = 0; k < QL_CHUNK_ENTRIES && base + k < tableCount_; k++) {
      strncpy(c.rows[k].uid, table_[base + k].uid, QL_UID_MAX);
      c.rows[k].org = table_[base + k].org;
      c.rows[k].ep = table_[base + k].ep;
      c.rows[k].state = table_[base + k].state;
      c.count++;
    }
    char payload[QL_PLAIN_MAX + 1];
    if (ql_pay_chunk(&c, payload, sizeof(payload))) {
      sendFrame(QL_T_CHUNK, QL_ADDR_BROADCAST, payload, strlen(payload), /*urgent=*/false);
      sweepLastAt_ = millis();
    }
    break;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// The NDJSON `hub` frame
// ════════════════════════════════════════════════════════════════════════════

static uint32_t bootAt_ = 0;
static uint32_t hubStatusAt_ = 0;
static uint32_t stationsSeen_ = 0;  // bitmask over addresses 1..23

static uint16_t stationsSeenCount(void) {
  uint16_t n = 0;
  for (uint8_t i = QL_ADDR_ST_MIN; i <= QL_ADDR_ST_MAX; i++) {
    if (stationsSeen_ & (1ul << i)) n++;
  }
  return n;
}

/**
 * Introduce ourselves.
 *
 * ⚠ THIS IS THE RESYNC TRIGGER, and forgetting it is the classic hub bug.
 * `tapService` pushes the flag table only when a `hub` frame reports a `tblver`
 * below the console's. Without it the park never receives a table after a
 * reconnect, and twenty-one plinths sit silent on ambience holding a
 * current-looking version they got from nobody.
 *
 * Emitted on every table commit — which is what TERMINATES the round trip, since
 * the console stops pushing once the reported version catches up — and every
 * QL_HUB_STATUS_MS regardless, because there is no host-open signal available on
 * a CP2102 bridge.
 */
static void emitHubStatus(void) {
  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_hub(line, sizeof(line), QL_FW_BUILD, tableVer_, stationsSeenCount(),
                           (uint32_t)((millis() - bootAt_) / 1000ul));
  if (n) ndjsonQueue(line, n);
  hubStatusAt_ = millis();
}

// ════════════════════════════════════════════════════════════════════════════
// Custody
// ════════════════════════════════════════════════════════════════════════════

static void sendAck(uint8_t st) {
  char payload[8];
  if (!ql_pay_ack(payload, sizeof(payload))) return;
  sendFrame(QL_T_ACK, st, payload, strlen(payload), /*urgent=*/true);
}

/**
 * Start (or renew) the custody probe.
 *
 * `st` is only cosmetic — the console reads a query's `st` and `uid` and ignores
 * its `seq` entirely — but addressing it at the station whose tap we are trying
 * to release keeps the console's own logs readable.
 *
 * The uid rotates through the cached table so that a row the console has since
 * removed cannot wedge the probe: an unanswered probe simply picks a different
 * pole next time.
 */
static void startProbe(uint8_t st) {
  if (tableCount_ == 0 || !pcAttached()) return;
  if (probe_.active && !elapsed(probe_.at, QL_CUSTODY_WAIT_MS)) return;

  probeCursor_ = (uint16_t)((probeCursor_ + 1) % tableCount_);
  const char *uid = table_[probeCursor_].uid;

  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_query(line, sizeof(line), st, uid, ++probeSeq_);
  if (!n) return;
  uint32_t ticket = ndjsonQueue(line, n);
  if (!ticket) return;

  probe_.active = true;
  probe_.st = st;
  strncpy(probe_.uid, uid, QL_UID_MAX);
  probe_.uid[QL_UID_MAX] = '\0';
  probe_.ticket = ticket;
  probe_.at = millis();
  probe_.relayAnswer = false;
  probe_.tries++;
  lastProbeAt_ = millis();
  TRACELN("[custody] probing with %s via st %u (ticket %lu)", uid, (unsigned)st,
          (unsigned long)ticket);
}

/** ACK every tap whose forwarded line is now known to have reached the console. */
static void sweepCustody(void) {
  for (uint8_t st = QL_ADDR_ST_MIN; st <= QL_ADDR_ST_MAX; st++) {
    TapMark &m = tapMarks_[st];
    if (!m.seen || m.acked || m.ticket == 0) continue;
    if (m.ticket > custodyProven_) continue;
    sendAck(st);
    m.acked = true;
    m.lastAckAt = millis();
    m.probeTries = 0;
    marksTouch();
    TRACELN("[custody] st %u tap seq %lu released (proven up to %lu)", (unsigned)st,
            (unsigned long)m.seq, (unsigned long)custodyProven_);
  }
}

/** Any tap still waiting on custody? Drives the probe. */
static uint8_t oldestUnsettled(void) {
  uint8_t best = 0;
  uint32_t bestTicket = 0xFFFFFFFFul;
  for (uint8_t st = QL_ADDR_ST_MIN; st <= QL_ADDR_ST_MAX; st++) {
    TapMark &m = tapMarks_[st];
    if (!m.seen || m.acked || m.ticket == 0) continue;
    if (m.probeTries >= QL_CUSTODY_PROBE_TRIES) continue;
    if (m.ticket < bestTicket) {
      bestTicket = m.ticket;
      best = st;
    }
  }
  return best;
}

static void pumpCustody(void) {
  if (probe_.active && elapsed(probe_.at, QL_CUSTODY_WAIT_MS)) {
    probe_.active = false;
    TRACELN("[custody] probe timed out (ticket %lu, via st %u)", (unsigned long)probe_.ticket,
            (unsigned)probe_.st);
    // Charge the attempt to the station the probe was addressed at, not to
    // whichever tap happens to be oldest now — otherwise a station whose probes
    // keep failing never exhausts its budget and one whose tap arrived
    // afterwards exhausts somebody else's.
    if (ql_st_is_place(probe_.st) && tapMarks_[probe_.st].seen && !tapMarks_[probe_.st].acked) {
      tapMarks_[probe_.st].probeTries++;
    }
  }
  if (probe_.active) return;

  uint8_t waiting = oldestUnsettled();
  if (waiting) {
    startProbe(waiting);
    return;
  }
  // Keepalive. Without this, `attached` decays during a quiet hour at a park
  // where nothing is being bound, and the next tap would go un-ACKed for no
  // reason other than the console having had nothing to say.
  if (pcAttached() && elapsed(lastProbeAt_, QL_PC_PROBE_MS)) {
    startProbe(QL_ADDR_ST_MIN);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Inbound NDJSON — console to hub
// ════════════════════════════════════════════════════════════════════════════

static char rxLine_[QL_HUB_RX_LINE_MAX + 1];
static size_t rxLen_ = 0;
static bool rxSkipping_ = false;
static QlInbound inbound_;

static void commitTable(uint64_t version) {
  tableVer_ = version;
  tableCrc_ = computeTableCrc(table_, tableCount_);
  tableEverCommitted_ = true;
  clockFloor((uint32_t)(version / 1000ull));
  wantWholeTable();
  // Announce the new version straight away: that is what stops the console
  // pushing, and it is the half of the round trip that terminates it.
  emitHubStatus();
  TRACELN("[table] committed v%llu, %u rows, crc %08lX", (unsigned long long)tableVer_,
          (unsigned)tableCount_, (unsigned long)tableCrc_);
}

static void applyTableChunk(const QlInbound &in) {
  // ── THE TABLE VERSION NEVER GOES BACKWARDS ────────────────────────────────
  //
  // The console's write queue survives a reconnect, so a chunk of a superseded
  // version can arrive after a newer table has already committed. Staging it
  // would eventually commit the OLD rack over the new one — and the beacon would
  // advertise a version the park has already been past, so every station would
  // ignore it and the hub and the park would hold different tables with nothing
  // saying so. Equal versions are allowed: a re-push of the current table after
  // a reconnect is legitimate and idempotent.
  if (in.ver < tableVer_) {
    TRACELN("[table] ignoring a chunk of stale v%llu (holding v%llu)",
            (unsigned long long)in.ver, (unsigned long long)tableVer_);
    return;
  }
  if (in.ver != stageVer_ || in.of != stageOf_) {
    // A new version, or a sender that changed its mind about the chunk count.
    // memset the staging buffer at the START of a version — carrying rows over
    // from a half-received earlier push is how a table that looks complete ends
    // up holding a row nobody sent.
    memset(stage_, 0, sizeof(stage_));
    memset(stageSeen_, 0, sizeof(stageSeen_));
    stageCount_ = 0;
    stageSeenCount_ = 0;
    stageVer_ = in.ver;
    stageOf_ = in.of;
  }
  uint8_t mask = (uint8_t)(1u << (in.idx % 8));
  if (stageSeen_[in.idx / 8] & mask) return;  // duplicate chunk, already staged

  // ── ROWS GO AT THEIR CHUNK'S POSITION, NOT AT THE END ─────────────────────
  //
  // Chunks arrive in order today, but nothing on this wire promises it — the
  // console's write queue survives a reconnect and drains whatever is in it.
  // Appending in arrival order would leave the staged table out of uid order
  // after a single reordering, and the table CRC is computed over uid order:
  // every station in the park would then refuse the commit with
  // QL_LOG_TABLE_CRC_FAIL and resync forever. The console chunks at exactly
  // QL_NDJSON_TABLE_CHUNK_ROWS rows with only the last chunk short, so a row's
  // place is a pure function of (idx, i).
  //
  // A short chunk that is not the LAST chunk would leave a hole of zeroed rows
  // in the middle of the staged table, and a zeroed row has an empty uid that
  // no station can match. Refuse the whole version rather than commit a table
  // with a silent gap in it.
  if (in.idx + 1 < in.of && in.rowCount != QL_NDJSON_TABLE_CHUNK_ROWS) {
    TRACELN("[table] chunk %u of %u carries %u rows, not %u — refusing the version",
            (unsigned)in.idx, (unsigned)in.of, (unsigned)in.rowCount,
            (unsigned)QL_NDJSON_TABLE_CHUNK_ROWS);
    stageVer_ = 0;
    stageOf_ = 0;
    return;
  }
  uint16_t base = (uint16_t)(in.idx * QL_NDJSON_TABLE_CHUNK_ROWS);
  if ((uint32_t)base + in.rowCount > QL_HUB_TABLE_MAX) {
    TRACELN("[table] push exceeds %u rows — refusing the whole version", (unsigned)QL_HUB_TABLE_MAX);
    stageVer_ = 0;
    stageOf_ = 0;
    return;
  }
  for (uint8_t i = 0; i < in.rowCount; i++) {
    HubRow &dst = stage_[base + i];
    strncpy(dst.uid, in.rows[i].uid, QL_UID_MAX);
    dst.uid[QL_UID_MAX] = '\0';
    dst.org = in.rows[i].org;
    dst.ep = in.rows[i].ep;
    dst.state = in.rows[i].state;
  }
  if ((uint16_t)(base + in.rowCount) > stageCount_) stageCount_ = (uint16_t)(base + in.rowCount);
  stageSeen_[in.idx / 8] |= mask;
  stageSeenCount_++;
  if (stageSeenCount_ < stageOf_) return;

  // Every chunk of this version is in hand. Only now does anything change.
  memcpy(table_, stage_, sizeof(HubRow) * stageCount_);
  tableCount_ = stageCount_;
  stageVer_ = 0;
  stageOf_ = 0;
  commitTable(in.ver);
}

static void applyRow(const QlInbound &in) {
  const QlJsonRow &r = in.rows[0];
  // Same rule as a table chunk, and for a sharper reason: applying the row but
  // keeping the higher version would change the CRC without changing the
  // version, so every station would compute a mismatch against a beacon that
  // says nothing has changed and resync in a loop that never converges.
  if (in.ver < tableVer_) {
    TRACELN("[table] ignoring a stale row at v%llu (holding v%llu)", (unsigned long long)in.ver,
            (unsigned long long)tableVer_);
    return;
  }
  int at = tableFind(r.uid);
  if (at >= 0) {
    table_[at].org = r.org;
    table_[at].ep = r.ep;
    table_[at].state = r.state;
  } else if (tableCount_ < QL_HUB_TABLE_MAX) {
    // Insert in uid order — the CRC is computed over that order and a station
    // that sorts differently from the hub would refuse every table it is sent.
    uint16_t pos = 0;
    while (pos < tableCount_ && strcmp(table_[pos].uid, r.uid) < 0) pos++;
    for (uint16_t i = tableCount_; i > pos; i--) table_[i] = table_[i - 1];
    strncpy(table_[pos].uid, r.uid, QL_UID_MAX);
    table_[pos].uid[QL_UID_MAX] = '\0';
    table_[pos].org = r.org;
    table_[pos].ep = r.ep;
    table_[pos].state = r.state;
    tableCount_++;
  } else {
    TRACELN("[table] full, dropped row %s", r.uid);
    return;
  }

  tableVer_ = in.ver;
  tableCrc_ = computeTableCrc(table_, tableCount_);
  tableEverCommitted_ = true;
  clockFloor((uint32_t)(in.ver / 1000ull));

  // ── A ONE-ROW CHANGE MUST NOT COST A FULL TABLE SWEEP ─────────────────────
  //
  // The common case at the counter is a Guide binding a pole, and the urgent
  // case is a party sealing an episode: `state` goes to 1, and until the park
  // knows it, a Hero party hears the episode they just finished at the next
  // plinth. Both must take effect NOW.
  //
  // Rebroadcasting 128 chunks for one row would be about two minutes of solid
  // airtime per binding, which at opening time is congestion collapse. So the
  // row goes out as a BROADCAST `R` RESOLVE — the frame type that already
  // carries exactly UIDHEX,ORG,EP,STATE — and the next beacon's TABLECRC does
  // the rest: a station that applied the row recomputes a matching CRC and
  // adopts the new TABLEVER for free, and a station that missed it computes a
  // mismatch and asks for chunks with an `S` SYNC. Convergence is driven by the
  // CRC, and it costs one frame in the case that happens.
  sendResolveTo(QL_ADDR_BROADCAST, r.uid, r.org, r.ep, r.state, QL_ROW_TTL);
  emitHubStatus();
  TRACELN("[table] row %s -> org %u ep %u state %u (v%llu, crc %08lX)", r.uid, (unsigned)r.org,
          (unsigned)r.ep, (unsigned)r.state, (unsigned long long)tableVer_,
          (unsigned long)tableCrc_);
}

static void applyResolve(const QlInbound &in) {
  const QlJsonRow &r = in.rows[0];

  // Is this the answer to our own custody probe rather than to a station's
  // question? If so it is a receipt, not a message, and it does not go on the
  // air — unless a real query for the same pole from the same station arrived
  // while the probe was outstanding, in which case the station is genuinely
  // waiting for it.
  if (probe_.active && probe_.st == in.st && strcmp(probe_.uid, r.uid) == 0) {
    if (probe_.ticket > custodyProven_) custodyProven_ = probe_.ticket;
    bool relay = probe_.relayAnswer;
    probe_.active = false;
    probe_.tries = 0;
    TRACELN("[custody] receipt: everything up to ticket %lu reached the console",
            (unsigned long)custodyProven_);
    sweepCustody();
    if (!relay) return;
  }

  // Clear the outstanding question only if this is the answer TO it. A resolve
  // for some other pole — the console may push one unprompted — must not make
  // the hub stop waiting on a guest who is still standing in silence.
  if (ql_st_is_place(in.st) && queries_[in.st].active &&
      strcmp(queries_[in.st].uid, r.uid) == 0) {
    queries_[in.st].active = false;
  }
  sendResolveTo(in.st, r.uid, r.org, r.ep, r.state, in.ttl);
}

static void applyCmd(const QlInbound &in) {
  QlCmd c;
  memset(&c, 0, sizeof(c));
  strncpy(c.verb, in.verb, sizeof(c.verb) - 1);
  c.arg = in.arg;
  char payload[QL_PLAIN_MAX + 1];
  if (!ql_pay_cmd(&c, payload, sizeof(payload))) return;
  sendFrame(QL_T_CMD, in.st, payload, strlen(payload), /*urgent=*/true);
}

static void handleConsoleLine(const char *line) {
  if (line[0] == '\0') return;  // blank lines are not frames and are not evidence
  if (!ql_ndjson_parse(line, &inbound_)) {
    rxMalformed_++;
    TRACELN("[usb <] refused: %s", line);
    return;
  }

  // ── EVIDENCE OF A CONSOLE ─────────────────────────────────────────────────
  //
  // Only a frame that PARSED counts. Something writing garbage to the port is
  // not a console tab, and treating it as one would let a stray serial monitor
  // release a guest's check-in from its station.
  framesIn_++;
  lastInboundAt_ = millis();
  everInbound_ = true;
  TRACELN("[usb <] %s", line);

  switch (inbound_.type) {
    case QL_IN_TABLE:
      applyTableChunk(inbound_);
      break;
    case QL_IN_ROW:
      applyRow(inbound_);
      break;
    case QL_IN_RESOLVE:
      applyResolve(inbound_);
      break;
    case QL_IN_CMD:
      applyCmd(inbound_);
      break;
    default:
      break;
  }
}

static void pumpSerialIn(void) {
  // Bounded per call so a burst cannot starve the radio poll.
  int budget = 512;
  while (Serial.available() > 0 && budget-- > 0) {
    int c = Serial.read();
    if (c < 0) break;
    if (c == '\n') {
      if (rxSkipping_) {
        rxSkipping_ = false;
        rxLen_ = 0;
        continue;
      }
      // Exactly one trailing CR is content-free; CRLF is legal on this wire.
      if (rxLen_ > 0 && rxLine_[rxLen_ - 1] == '\r') rxLen_--;
      rxLine_[rxLen_] = '\0';
      handleConsoleLine(rxLine_);
      rxLen_ = 0;
      continue;
    }
    if (rxLen_ >= QL_HUB_RX_LINE_MAX) {
      // Overlong: discard the buffer AND everything up to the next newline, so
      // the tail of a monster line cannot be parsed as a frame of its own.
      rxSkipping_ = true;
      rxLen_ = 0;
      rxMalformed_++;
      continue;
    }
    rxLine_[rxLen_++] = (char)c;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Inbound Q1 — station to hub
// ════════════════════════════════════════════════════════════════════════════

static uint32_t lastSynthLogAt_[QL_ADDR_ST_MAX + 1];

/** Relay a numeric diagnostic upward, rate-limited so one noisy station cannot flood the wire. */
static void synthLog(uint8_t st, uint8_t lvl, uint16_t code, int64_t a1, int64_t a2) {
  if (!ql_st_is_place(st)) return;
  if (lastSynthLogAt_[st] && !elapsed(lastSynthLogAt_[st], QL_LOG_RATE_MS)) return;
  QlLog l;
  l.lvl = lvl;
  l.code = code;
  l.a1 = a1;
  l.a2 = a2;
  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_log(line, sizeof(line), st, &l);
  if (n && ndjsonQueue(line, n)) lastSynthLogAt_[st] = millis();
}

static void handleTap(const QlHeader &h, char *payload) {
  QlTap tap;
  if (!ql_read_tap(payload, &tap)) {
    rxMalformed_++;
    TRACELN("[air <] st %u sent a malformed T", (unsigned)h.src);
    return;
  }

  TapMark &m = tapMarks_[h.src];
  bool sameFrame = m.seen && m.epoch == h.epoch && m.seq == h.seq;

  if (sameFrame && m.acked) {
    // We already released this tap; the station is retransmitting because our
    // ACK was lost. Send it again and do NOT put a second line on the console
    // wire — the console already has this one, and it is the ACK that went
    // missing, not the tap.
    //
    // The first repeat is answered at once. Measuring a floor from the ORIGINAL
    // ACK instead would eat the first two of the station's four attempts, which
    // turns a lost ACK into a tap that sits in a ring until closing time. The
    // cap is what keeps a replay loop from being an airtime amplifier; see
    // QL_REACK_MAX.
    bool first = (m.reAcks == 0);
    if (m.reAcks < QL_REACK_MAX && (first || elapsed(m.lastAckAt, QL_REACK_MIN_MS))) {
      sendAck(h.src);
      m.lastAckAt = millis();
      m.reAcks++;
    }
    return;
  }

  if (!sameFrame) {
    // Strictly newer, or it is a replay. Equality is only ever legitimate for
    // the frame we are currently holding — see the long note on TapMark.
    bool newer = !m.seen || h.epoch > m.epoch || (h.epoch == m.epoch && h.seq > m.seq);
    if (!newer) {
      hubReplayDrops_++;
      TRACELN("[air <] st %u replay dropped (epoch %lu seq %lu, held %lu/%lu)", (unsigned)h.src,
              (unsigned long)h.epoch, (unsigned long)h.seq, (unsigned long)m.epoch,
              (unsigned long)m.seq);
      synthLog(h.src, 4, QL_LOG_REPLAY_DROP, (int64_t)h.src, (int64_t)h.seq);
      return;
    }
    m.seen = true;
    m.epoch = h.epoch;
    m.seq = h.seq;
    m.acked = false;
    m.ticket = 0;
    m.probeTries = 0;
    m.lastAckAt = 0;
    m.reAcks = 0;
    marksTouch();
  }

  // ── FORWARD ALWAYS, ACK ONLY WHEN EARNED ──────────────────────────────────
  //
  // The asymmetry is deliberate. Writing the line costs nothing and might land:
  // with the tab shut the bytes go nowhere, and with the tab open but our
  // attachment evidence stale it gets the guest checked in anyway. Withholding
  // the ACK is what preserves the station's copy either way, and a re-forward
  // after a retransmission is swallowed by the console's `${st}:${seq}` dedupe
  // ring, so the guest is never checked in twice.
  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_tap(line, sizeof(line), h.src, &tap, h.seq);
  if (n == 0) {
    TRACELN("[air <] st %u tap would not encode", (unsigned)h.src);
    return;
  }
  uint32_t ticket = ndjsonQueue(line, n);
  if (ticket) m.ticket = ticket;

  if (!pcAttached()) {
    TRACELN("[custody] st %u tap held: no console attached", (unsigned)h.src);
    return;
  }

  if (tableEverCommitted_ && tableCount_ == 0) {
    // The weak path, and the only one. See the pcReady note: with no bindings
    // anywhere there is no walk to lose, because every tap that can arrive is
    // an unknown tag the console refuses before it reaches a check-in.
    //
    // `tableEverCommitted_` IS LOAD-BEARING, not a belt-and-braces extra. On its
    // own, `tableCount_ == 0` says "THIS HUB holds no table", which is a
    // different claim from "the park has no bindings" — and only the second one
    // justifies releasing a tap. The flag table is RAM-only by design, so the
    // count reads 0 after every hub reboot until the console's push commits,
    // and it stays 0 if that push dies half-way (a closed tab, a stalled
    // browser) because applyTableChunk commits nothing until the last chunk
    // lands. The chunks that DID arrive have already made pcAttached() true and
    // keep it true for a further QL_PC_ATTACH_MS.
    //
    // WHAT BREAKS IF THIS GUARD IS REMOVED: that window falls exactly where the
    // stations are draining their NVS tap rings into the hub that just came
    // back. Every tap in the burst is new to tapMarks_, so every one takes this
    // path and is ACKed on enqueue alone — each station deletes its only copy —
    // into a queue nobody is reading. No presence, no leg, no error anywhere,
    // which is the failure the note at the top of this file says must never
    // happen. A hub that has never committed a table knows nothing about the
    // park's bindings and must HOLD the tap, not release it.
    if (ticket) {
      sendAck(h.src);
      m.acked = true;
      m.lastAckAt = millis();
      marksTouch();
    }
    return;
  }

  startProbe(h.src);
}

static void handleQuery(const QlHeader &h, char *payload) {
  char uid[QL_UID_MAX + 1];
  if (!ql_read_query(payload, uid, sizeof(uid))) {
    rxMalformed_++;
    return;
  }

  // If our own probe is out on this pole from this station, the console's answer
  // is about to arrive and the station wants it too.
  if (probe_.active && probe_.st == h.src && strcmp(probe_.uid, uid) == 0) probe_.relayAnswer = true;

  queries_[h.src].active = true;
  strncpy(queries_[h.src].uid, uid, QL_UID_MAX);
  queries_[h.src].uid[QL_UID_MAX] = '\0';
  queries_[h.src].at = millis();

  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_query(line, sizeof(line), h.src, uid, h.seq);
  if (n) ndjsonQueue(line, n);
}

static void handleSync(const QlHeader &h, char *payload) {
  QlSync s;
  if (!ql_read_sync(payload, &s)) {
    rxMalformed_++;
    return;
  }
  uint16_t asked = 0;
  if (s.haveVer != tableVer_) {
    // It holds a different version entirely; its bitmap describes chunks of a
    // table that no longer exists. Send the whole thing.
    wantWholeTable();
    asked = wantedCount_;
  } else {
    for (uint8_t j = 0; j < s.missingBytes; j++) {
      for (uint8_t b = 0; b < 8; b++) {
        if (s.missing[j] & (1u << b)) {
          wantChunk((uint16_t)(j * 8 + b));
          asked++;
        }
      }
    }
  }
  TRACELN("[air <] st %u sync: have %llu want %llu, %u chunks", (unsigned)h.src,
          (unsigned long long)s.haveVer, (unsigned long long)s.wantVer, (unsigned)asked);
  synthLog(h.src, 6, QL_LOG_SYNC_REQUEST, (int64_t)asked, (int64_t)(s.haveVer / 1000ull));
}

static void handleHeartbeat(const QlHeader &h, char *payload) {
  QlHeartbeat hb;
  if (!ql_read_hb(payload, &hb)) {
    rxMalformed_++;
    return;
  }
  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_hb(line, sizeof(line), h.src, &hb);
  if (n) ndjsonQueue(line, n);
}

static void handleLog(const QlHeader &h, char *payload) {
  QlLog l;
  if (!ql_read_log(payload, &l)) {
    rxMalformed_++;
    return;
  }
  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_log(line, sizeof(line), h.src, &l);
  if (n) ndjsonQueue(line, n);
}

static void handleCmdAck(const QlHeader &h, char *payload) {
  QlCmd c;
  if (!ql_read_cmd(payload, &c)) {
    rxMalformed_++;
    return;
  }
  // There is no `cmdack` type on the NDJSON wire and the key sets are exact, so
  // inventing one would refuse the whole line. A command acknowledgement is a
  // numeric diagnostic and travels as one.
  uint8_t verb = 0;
  if (strcmp(c.verb, QL_CMD_VOL) == 0) verb = QL_CMDACK_VERB_VOL;
  else if (strcmp(c.verb, QL_CMD_QVOL) == 0) verb = QL_CMDACK_VERB_QVOL;
  else if (strcmp(c.verb, QL_CMD_PLAY) == 0) verb = QL_CMDACK_VERB_PLAY;
  else if (strcmp(c.verb, QL_CMD_SYNC) == 0) verb = QL_CMDACK_VERB_SYNC;
  else if (strcmp(c.verb, QL_CMD_PING) == 0) verb = QL_CMDACK_VERB_PING;

  QlLog l;
  l.lvl = 6;
  l.code = QL_LOG_CMDACK;
  l.a1 = (int64_t)verb;
  l.a2 = (int64_t)c.arg;
  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_log(line, sizeof(line), h.src, &l);
  if (n) ndjsonQueue(line, n);
}

static void pumpRadioRx(void) {
  if (!radioUp_ || txBusy_) return;
  int size = LoRa.parsePacket();
  if (size <= 0) return;

  char raw[QL_LINE_MAX + 2];
  size_t n = 0;
  while (LoRa.available()) {
    int b = LoRa.read();
    if (b < 0) break;
    if (n < QL_LINE_MAX) raw[n++] = (char)b;
  }
  raw[n] = '\0';
  radioRxCount_++;

  QlHeader h;
  char plain[QL_PLAIN_MAX + 1];
  size_t plainLen = 0;
  QlRxResult rc = ql_line_open(raw, n, QL_HUB_SELF_ADDR, &h, plain, sizeof(plain), &plainLen);

  if (rc == QL_RX_BAD_MAC) {
    // ── NO REPLY, AND NO LINE ON THE CONSOLE WIRE ───────────────────────────
    //
    // Not answered, because a reply to a bad MAC is an oracle: it tells whoever
    // sent it that their frame reached us, and it turns one forged packet into a
    // guaranteed transmission — free airtime denial for the cost of noise.
    //
    // And no NDJSON, because the console tab is holding a staff Firestore
    // session and unauthenticated content must not reach it. The count surfaces
    // here, on the service channel, where a human is standing in front of the
    // board — which is also how a mis-provisioned station is told apart from a
    // dead one, since from the counter they look identical.
    TRACELN("[air <] MAC FAILURE from claimed src %u (%lu since boot)", (unsigned)h.src,
            (unsigned long)ql_mac_failures());
    return;
  }
  if (rc == QL_RX_NOT_FOR_US) return;
  if (rc != QL_RX_OK) {
    rxMalformed_++;
    TRACELN("[air <] refused a frame (rc %d)", (int)rc);
    return;
  }
  if (!ql_st_is_place(h.src)) return;  // 0 and 255 are not senders

  stationsSeen_ |= (1ul << h.src);
  TRACELN("[air <] %c src=%u seq=%lu epoch=%lu  %s", h.type, (unsigned)h.src,
          (unsigned long)h.seq, (unsigned long)h.epoch, plain);

  // ── ORDER: structure, MAC, replay, payload validation ─────────────────────
  //
  // ql_line_open has done structure and MAC and has decrypted; the replay check
  // is here, before anything acts on the content. Decryption having happened
  // first is harmless — it has no side effects — but ACTING on a frame before
  // the replay check would not be. And the replay check must never run before
  // the MAC: one forged frame could otherwise push a peer's high-water mark to
  // its maximum and every genuine frame after it would be dropped as stale. A
  // one-packet permanent denial of service.
  if (h.type == QL_T_TAP) {
    handleTap(h, plain);  // TAP owns its own mark: a retransmission is legitimate
    return;
  }

  int ti = rxTypeIndex(h.type);
  if (ti < 0) return;  // A, R, V, U, C are ours to send, never to receive
  if (!ql_peer_accept(&peers_[h.src][ti], h.epoch, h.seq)) {
    TRACELN("[air <] st %u %c dropped as a replay", (unsigned)h.src, h.type);
    return;
  }

  switch (h.type) {
    case QL_T_QUERY:
      handleQuery(h, plain);
      break;
    case QL_T_SYNC:
      handleSync(h, plain);
      break;
    case QL_T_HB:
      handleHeartbeat(h, plain);
      break;
    case QL_T_LOG:
      handleLog(h, plain);
      break;
    case QL_T_CMDACK:
      handleCmdAck(h, plain);
      break;
    default:
      break;
  }
}

/** A station's question the console never answered. Answer it ourselves, but only from a real row. */
static void pumpQueryTimeouts(void) {
  for (uint8_t st = QL_ADDR_ST_MIN; st <= QL_ADDR_ST_MAX; st++) {
    PendingQuery &q = queries_[st];
    if (!q.active || !elapsed(q.at, QL_RESOLVE_WAIT_MS)) continue;
    q.active = false;
    int at = tableFind(q.uid);
    if (at < 0) {
      // Nobody knows this pole. NOTHING is sent — no guess, no generic clip, no
      // "please wait" hold. The station keeps its ambience loop running and
      // keeps asking, which is the user's hard mandate: a wrong story is worse
      // than a pause.
      TRACELN("[query] st %u asked about %s and nobody holds it — left unanswered, by design",
              (unsigned)st, q.uid);
      continue;
    }
    sendResolveTo(st, table_[at].uid, table_[at].org, table_[at].ep, table_[at].state,
                  QL_LOCAL_RESOLVE_TTL);
    TRACELN("[query] st %u answered from the hub's own table", (unsigned)st);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// The booth pad
// ════════════════════════════════════════════════════════════════════════════

#if QL_HUB_HAS_BOOTH
static MFRC522 booth_(QL_PIN_RFID_SS, QL_PIN_RFID_RST);
static char boothLastUid_[QL_UID_MAX + 1];
static uint32_t boothLastAt_ = 0;
static uint32_t boothSeenAt_ = 0;
static uint32_t boothRefused_ = 0;
static uint32_t boothPollAt_ = 0;

static void pumpBooth(void) {
  // Polled rather than run flat out. PICC_IsNewCardPresent() is an SPI
  // transaction, and this bus also carries the radio; asking twenty thousand
  // times a second buys nothing a Guide can perceive and puts continuous
  // traffic alongside every LoRa register read.
  if (!elapsed(boothPollAt_, QL_BOOTH_POLL_MS)) return;
  boothPollAt_ = millis();
  if (!booth_.PICC_IsNewCardPresent()) return;
  if (!booth_.PICC_ReadCardSerial()) return;

  char uid[QL_UID_MAX + 1];
  bool ok = ql_hex_encode(booth_.uid.uidByte, booth_.uid.size, uid, sizeof(uid));
  booth_.PICC_HaltA();
  booth_.PCD_StopCrypto1();
  if (!ok) {
    // ── THE UID IS ATTACKER-SUPPLIED BYTES ──────────────────────────────────
    // Whatever the reader handed up is hex-encoded before it is looked at, and
    // a result that is not a legal uid is dropped here rather than repaired.
    // Hex has no delimiter, no NUL and no newline in it, which is the only
    // reason a hostile tag cannot reach a field boundary at the far end.
    TRACELN("[booth] reader returned %u bytes that are not a legal uid", (unsigned)booth_.uid.size);
    return;
  }

  bool sameTag = strcmp(uid, boothLastUid_) == 0;
  if (sameTag && boothLastAt_ && !elapsed(boothLastAt_, QL_BOOTH_REPEAT_MS)) {
    boothSeenAt_ = millis();
    return;
  }
  if (sameTag && boothSeenAt_ && !elapsed(boothSeenAt_, QL_BOOTH_CLEAR_MS)) {
    boothSeenAt_ = millis();
    return;
  }

  // ── A BOOTH FRAME IS NEVER RESENT, SO IT IS NEVER QUEUED ──────────────────
  //
  // It carries no `st` and no `seq`, so nothing on the console side dedupes it,
  // and the pad is where a Passage gets spent — a second frame is a second
  // spend. If there is no console attached, the read does not become a line
  // that arrives ten minutes later out of context; it does not happen, the LED
  // says so, and the Guide presents the tag again.
  if (!pcAttached()) {
    boothRefused_++;
    NOTE("[booth] %s read with no console attached — NOT sent. Present it again.", uid);
    return;
  }

  char line[QL_NDJSON_BUF];
  size_t n = ql_ndjson_booth(line, sizeof(line), uid, nowSeconds());
  if (n && ndjsonQueue(line, n)) {
    strncpy(boothLastUid_, uid, QL_UID_MAX);
    boothLastUid_[QL_UID_MAX] = '\0';
    boothLastAt_ = millis();
    boothSeenAt_ = millis();
    TRACELN("[booth] %s", uid);
  } else {
    boothRefused_++;
    NOTE("[booth] %s could not be queued — present it again.", uid);
  }
}
#endif

// ════════════════════════════════════════════════════════════════════════════
// LED and the verbose button
// ════════════════════════════════════════════════════════════════════════════
//
//   solid            a console is attached and custody is flowing
//   slow blink 1 Hz  attached, but nothing has proven custody recently
//   fast blink 5 Hz  no console
//   off              no PSK — the board is refusing to transmit

static uint32_t ledAt_ = 0;
static bool ledOn_ = false;

static void pumpLed(void) {
  if (!ql_crypto_ready()) {
    digitalWrite(QL_PIN_LED, LOW);
    return;
  }
  uint32_t period;
  if (!pcAttached()) period = 100;
  else if (probe_.active || oldestUnsettled()) period = 500;
  else period = 0;

  if (period == 0) {
    digitalWrite(QL_PIN_LED, HIGH);
    ledOn_ = true;
    return;
  }
  if (elapsed(ledAt_, period)) {
    ledOn_ = !ledOn_;
    digitalWrite(QL_PIN_LED, ledOn_ ? HIGH : LOW);
    ledAt_ = millis();
  }
}

static uint32_t btnDownAt_ = 0;

static void pumpVerboseButton(void) {
  bool down = digitalRead(QL_PIN_VERBOSE_BTN) == LOW;
  if (down && btnDownAt_ == 0) {
    btnDownAt_ = millis();
    return;
  }
  if (!down) {
    btnDownAt_ = 0;
    return;
  }
  if (btnDownAt_ && elapsed(btnDownAt_, 1000)) {
    verbose_ = !verbose_;
    btnDownAt_ = 0;
    NOTE("[hub] verbose %s", verbose_ ? "ON" : "off");
  }
}

/** A one-screen summary a human can read at the counter. Service channel only. */
static void printStatus(void) {
  NOTE("[hub] fw %u  key %s  up %lus  clock %lu", (unsigned)QL_FW_BUILD, ql_key_fingerprint(),
       (unsigned long)((millis() - bootAt_) / 1000ul), (unsigned long)nowSeconds());
  NOTE("      table v%llu  %u rows  crc %08lX  %s", (unsigned long long)tableVer_,
       (unsigned)tableCount_, (unsigned long)tableCrc_,
       tableEverCommitted_ ? "committed" : "NEVER COMMITTED — no console has pushed one");
  NOTE("      console %s  in %lu  out %lu  malformed %lu  dropped %lu",
       pcAttached() ? "ATTACHED" : "absent", (unsigned long)framesIn_, (unsigned long)framesOut_,
       (unsigned long)rxMalformed_, (unsigned long)txDropped_);
  NOTE("      air rx %lu  tx %lu  mac-fail %lu  replay %lu/%lu  stations seen %u",
       (unsigned long)radioRxCount_, (unsigned long)radioTxCount_,
       (unsigned long)ql_mac_failures(), (unsigned long)ql_replay_drops(),
       (unsigned long)hubReplayDrops_, (unsigned)stationsSeenCount());
}

// ════════════════════════════════════════════════════════════════════════════
// setup / loop
// ════════════════════════════════════════════════════════════════════════════

void setup() {
  pinMode(QL_PIN_LED, OUTPUT);
  digitalWrite(QL_PIN_LED, LOW);
  pinMode(QL_PIN_VERBOSE_BTN, INPUT_PULLUP);

  // Buffers before begin(): setTxBufferSize has no effect once the driver is
  // running, and a 256-byte default is smaller than two heartbeat lines.
  Serial.setRxBufferSize(2048);
  Serial.setTxBufferSize(QL_HUB_TX_BUFFER);
  Serial.begin(QL_HUB_BAUD);

#if QL_HUB_VERBOSE_UART
  Serial1.begin(QL_HUB_VERBOSE_BAUD, SERIAL_8N1, QL_PIN_VERBOSE_RX, QL_PIN_VERBOSE_TX);
#endif

  bootAt_ = millis();
  memset(tapMarks_, 0, sizeof(tapMarks_));
  memset(peers_, 0, sizeof(peers_));
  memset(queries_, 0, sizeof(queries_));
  memset(&probe_, 0, sizeof(probe_));
  memset(wanted_, 0, sizeof(wanted_));
  memset(lastSynthLogAt_, 0, sizeof(lastSynthLogAt_));

  randomSeed((unsigned long)esp_random());

  // ── Key first ─────────────────────────────────────────────────────────────
  //
  // A board with no PSK in NVS REFUSES TO TRANSMIT. There is deliberately no
  // "unencrypted if unprovisioned" mode, because a downgrade path is a
  // downgrade attack: anyone who can make one board believe it is unprovisioned
  // gets the whole protocol in the clear. An unprovisioned board is a bench
  // problem and must present as one.
  bool haveKey = ql_crypto_begin();
  NOTE("");
  NOTE("Questland hub, fw %u", (unsigned)QL_FW_BUILD);
  if (haveKey) {
    NOTE("  park key fingerprint %s", ql_key_fingerprint());
    NOTE("  (every board in the park must print this same eight characters)");
  } else {
    NOTE("  NO PARK KEY IN NVS. This board will not transmit.");
    NOTE("  Run tools/provision-key.mjs against it before it leaves the bench.");
  }

  // ql_crypto_begin() opened and closed its own read-only handle; ours is
  // read-write and stays open for the life of the board.
  prefsOpen_ = prefs_.begin(QL_HUB_NVS_NS, /*readOnly=*/false);
  if (prefsOpen_) {
    wallClock_ = prefs_.getULong(QL_NVS_WALL, 0);
    wallBase_ = millis();

    // A stored ceiling of 0 means the key is absent: a fresh flash, an NVS
    // erase or a new board. After the very first boot it is at least
    // QL_SEQ_RESERVE, so 0 is unambiguous and this needs no Preferences::isKey
    // (which only exists in newer cores).
    uint32_t storedTop = prefs_.getULong(QL_NVS_SEQ_TOP, 0);
    bool freshReservation = (storedTop == 0);
    seq_ = storedTop;
    seqTop_ = seq_ + QL_SEQ_RESERVE;
    prefs_.putULong(QL_NVS_SEQ_TOP, seqTop_);

    seqEpoch_ = prefs_.getULong(QL_NVS_SEQ_EPOCH, 0);
    if (freshReservation) {
      // The reservation is gone: an erase, a reflash or a new board. SEQ is
      // about to restart near zero, so the lineage epoch MUST move or the same
      // (SRC, SEQ) recurs with different plaintext — which in CTR mode is
      // keystream reuse, and to every peer looks like a stale replay.
      uint32_t candidate = nowSeconds();
      uint32_t bumped = seqEpoch_ + 1;
      seqEpoch_ = candidate > bumped ? candidate : bumped;
      prefs_.putULong(QL_NVS_SEQ_EPOCH, seqEpoch_);
      NOTE("  new sequence lineage, epoch %lu", (unsigned long)seqEpoch_);
    }
    marksLoad();
  } else {
    NOTE("  NVS unavailable — sequence numbers are NOT brownout-safe on this boot");
  }

  // ── SPI, shared by the radio and the pad ──────────────────────────────────
  SPI.begin(QL_PIN_LORA_SCK, QL_PIN_LORA_MISO, QL_PIN_LORA_MOSI);

  LoRa.setPins(QL_PIN_LORA_NSS, QL_PIN_LORA_RST, QL_PIN_LORA_DIO0);
  LoRa.setSPIFrequency(QL_SPI_HZ);  // matched to the MFRC522 — see config.h
  if (LoRa.begin(QL_LORA_FREQ_HZ)) {
    LoRa.setSpreadingFactor(QL_LORA_SF);
    LoRa.setSignalBandwidth(QL_LORA_BW_HZ);
    LoRa.setCodingRate4(QL_LORA_CR4);
    LoRa.setSyncWord(QL_LORA_SYNCWORD);
    LoRa.setTxPower(QL_LORA_TX_DBM, PA_OUTPUT_PA_BOOST_PIN);
    LoRa.enableCrc();
    LoRa.receive();
    radioUp_ = haveKey;  // no key, no transmissions
    NOTE("  radio up at %ld Hz SF%d BW%ld", (long)QL_LORA_FREQ_HZ, (int)QL_LORA_SF,
         (long)QL_LORA_BW_HZ);
  } else {
    NOTE("  RADIO DID NOT START. Check NSS on GPIO %d and its 10k pull-up.", QL_PIN_LORA_NSS);
  }

#if QL_HUB_HAS_BOOTH
  booth_.PCD_Init();
  NOTE("  booth pad reader on SS %d", QL_PIN_RFID_SS);
#endif

  // Introduce ourselves immediately. If a console is already attached this is
  // what makes it push the flag table; if not, the 30-second repeat covers it.
  emitHubStatus();
  beaconAt_ = millis();
  printStatus();
}

void loop() {
  pumpSerialIn();
  pumpTx();

  pumpRadioTx();
  pumpRadioRx();

  pumpCustody();
  pumpQueryTimeouts();

#if QL_HUB_HAS_BOOTH
  pumpBooth();
#endif

  if (radioUp_) {
    // Listen before talking, but only for a bounded while. A channel that is
    // busy for a full jitter window still gets the beacon: stations take their
    // clock and their TDMA anchor from it, and a park that stops beaconing
    // because somebody left a transmitter keyed loses its heartbeat plan.
    uint32_t due = QL_BEACON_MS + beaconJitter_;
    if (elapsed(beaconAt_, due) && (channelClear() || elapsed(beaconAt_, due + QL_LBT_JITTER_MS))) {
      sendBeacon();
      beaconAt_ = millis();
      beaconJitter_ = (uint16_t)random(QL_LBT_JITTER_MS);
    }
  }
  pumpSweep();

  if (elapsed(hubStatusAt_, QL_HUB_STATUS_MS)) emitHubStatus();

  if (marksDirty_ && elapsed(marksDirtyAt_, QL_MARKS_PERSIST_MS)) marksSave();
  if (wallDirty_ && elapsed(wallDirtyAt_, QL_WALL_PERSIST_MS) && prefsOpen_) {
    prefs_.putULong(QL_NVS_WALL, nowSeconds());
    wallDirty_ = false;
  }

  pumpLed();
  pumpVerboseButton();
}
