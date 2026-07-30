// hub/config.h — the one board in the park that touches both wires.
//
// The hub sits on the counter in the Adventurer's Hall on a USB cable to the
// console PC. On one side it speaks Q1 over LoRa to twenty-one plinths, the
// chief's house and the gate; on the other it speaks newline-delimited JSON to
// a browser tab holding a staff Firestore session. It stores almost nothing and
// decides almost nothing: the console is the authority, the stations are the
// cache, and the hub is the bridge that must never invent a frame.
//
// Everything in this file is a knob. The reasoning lives beside the knob,
// because every one of these numbers was chosen against a specific failure and
// a reader six months from now will otherwise assume they were guessed.
//
// INCLUDE THIS FIRST, before ql_proto.h — QL_FW_BUILD below is picked up by the
// `#ifndef` in that header, and including it the other way round silently
// leaves the firmware reporting build 1 forever.

#pragma once

#include <stdint.h>

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Firmware build, reported in the NDJSON `hub` frame's `fw` field, 0..65535.
 *
 * Bump it on every flash that goes into the field. Staff read it off the
 * console when a station misbehaves, and "which build is the hub on" is the
 * first question of every support conversation.
 */
#define QL_FW_BUILD 1

/**
 * The hub's LoRa address. Fixed at 0 by the protocol — it is the DST every
 * station sends to and it is byte 0 of the CTR nonce. There is exactly one hub.
 */
#define QL_HUB_SELF_ADDR 0

// ── Radio: RA-01H / SX1276 at 915 MHz ───────────────────────────────────────
//
// RA-01H, NOT RA-02. The RA-02 is a 433 MHz part and the two modules are
// physically interchangeable, identically silkscreened at a glance, and sold
// side by side. A 433 MHz module tuned at 915 will appear to work across a
// bench and then reach about forty metres in a wood.
//
// NEVER POWER THE MODULE WITHOUT AN ANTENNA. A 20 dBm PA driving an open port
// reflects its own power back into the output stage; the module survives it for
// a while and then does not, and the failure is intermittent range loss rather
// than a dead board, which is far harder to diagnose.

#define QL_LORA_FREQ_HZ 915000000L
#define QL_LORA_SF 9
#define QL_LORA_BW_HZ 125000L
#define QL_LORA_CR4 5
/** 0x5A. A private syncword: other LoRa traffic in the band is filtered in hardware. */
#define QL_LORA_SYNCWORD 0x5A
#define QL_LORA_TX_DBM 20

/**
 * SPI clock for the SX1276, in Hz.
 *
 * ── WHY THIS IS 4 MHz AND MUST MATCH THE MFRC522 ────────────────────────────
 *
 * The radio and the RFID reader share one SPI bus. The MFRC522 Arduino library
 * runs its transactions at 4 MHz and does not ask anybody's permission; if the
 * radio is left at the LoRa library's 8 MHz default, the two peripherals are
 * driven at different clocks on the same wires and the bus settles differently
 * for each. On a bench with 10 cm jumpers it works. In an IP65 box with 30 cm
 * of loom and a 3 W speaker amplifier 40 mm away it produces occasional
 * corrupted reads from whichever device was NOT the last one configured — which
 * presents as "the reader misses about one tap in thirty" and sends you looking
 * at the antenna.
 *
 * Matched 4 MHz on both, plus the 10k pull-ups below, plus never using
 * LoRa.onReceive(), is the whole answer to the shared-SPI hazard.
 */
#define QL_SPI_HZ 4000000L

// ── Pinout (ESP32 DevKitC) ──────────────────────────────────────────────────
//
// ⚠ LoRa NSS IS GPIO 21, NOT GPIO 15. GPIO 15 is a strapping pin (MTDO): the
// chip samples it at reset to choose the boot log level, and an SPI slave-select
// idling high or low through a reset changes boot behaviour, so a hub with NSS
// on 15 boots reliably on the bench and then fails to boot roughly one power
// cycle in five in the field, after a brownout, with nothing on the serial port
// to say why.
//
// ⚠ BOTH CHIP SELECTS NEED A 10k PULL-UP TO 3V3. Between reset and the moment
// setup() configures the pins, every GPIO is an input and both CS lines float.
// Two SPI slaves that both believe they are selected will drive MISO against
// each other; the usual damage is a corrupted first transaction, which lands
// exactly on LoRa.begin() and presents as an intermittent "LoRa not found".

#define QL_PIN_LORA_SCK 18
#define QL_PIN_LORA_MISO 19
#define QL_PIN_LORA_MOSI 23
#define QL_PIN_LORA_NSS 21  /* NOT 15 — see above. Needs a 10k pull-up. */
#define QL_PIN_LORA_RST 14
#define QL_PIN_LORA_DIO0 26

/** The booth pad's MFRC522, on the same SPI bus. GPIO 5 needs a 10k pull-up. */
#define QL_PIN_RFID_SS 5
#define QL_PIN_RFID_RST 27

/** Onboard LED. The only status indicator the hub has; see the blink table in hub.ino. */
#define QL_PIN_LED 2

/**
 * The DevKitC's BOOT button. Held for a second at runtime it toggles the
 * verbose service channel, which is the only way to turn decrypted-frame
 * tracing on without a reflash — the console wire cannot carry a command for it,
 * because the NDJSON key sets are exact and there is no frame type for one.
 */
#define QL_PIN_VERBOSE_BTN 0

// ── The booth pad ───────────────────────────────────────────────────────────

/**
 * 1 when this hub has the booth pad's reader wired to it, 0 for a bare bridge.
 *
 * ── WHY THE PAD IS ON THE HUB AND NOT ON STATION 23 ─────────────────────────
 *
 * The NDJSON `booth` frame carries no `st` and no `seq`, so NOTHING DEDUPES IT
 * — and the pad is where a Passage gets spent. A retry at the pad is a second
 * presentation, and a second presentation is a second spend. That rule is only
 * satisfiable if there is no radio hop underneath the pad to retry: the reader
 * is wired to the hub itself, over 20 cm of ribbon, and a read either becomes a
 * line on the USB wire or it does not happen. Station 23 remains the GATE as a
 * place — an addressable arrival point — but it is not the pad.
 */
#define QL_HUB_HAS_BOOTH 1

/**
 * How often the pad is polled, milliseconds.
 *
 * Each poll is an SPI transaction on the bus the radio also uses. 50 ms is
 * twenty looks a second — far faster than a hand can place a pole, and quiet
 * enough that the reader is not contending with every LoRa register read.
 */
#define QL_BOOTH_POLL_MS 50

/** A tag must be out of the field this long before the same tag counts as a new presentation. */
#define QL_BOOTH_CLEAR_MS 1200

/**
 * Floor between two presentations of the SAME tag, even across a clean lift.
 *
 * A Guide resting a pole on the pad while they talk produces a stream of reads;
 * a guest handing back a pole and immediately picking up another produces two
 * legitimate reads a second apart. This window is set below the second and
 * above the first.
 */
#define QL_BOOTH_REPEAT_MS 3000

// ── USB / NDJSON ────────────────────────────────────────────────────────────

#define QL_HUB_BAUD 115200

/**
 * UART TX buffer, bytes. Enlarged before Serial.begin().
 *
 * The default 256 bytes is smaller than two heartbeat lines. When a TDMA frame
 * lands and twenty-three heartbeats arrive inside a couple of seconds, a small
 * buffer makes Serial.write() block until the bridge drains — and a blocked
 * write in loop() is a frozen radio poll, which drops the next tap. The hub
 * never blocks on the console wire; see ndjsonQueue() in hub.ino.
 */
#define QL_HUB_TX_BUFFER 2048

/**
 * Outbound line queue, in lines, and the size of one slot in bytes.
 *
 * The longest line the hub BUILDS is a heartbeat at roughly 150 characters, so
 * 208 is comfortable with room for a field to grow. Forty-eight lines is about
 * two TDMA frames' worth of heartbeats plus a burst of taps.
 */
#define QL_HUB_TX_QUEUE 48
#define QL_HUB_TX_SLOT 208

/**
 * Minimum gap between two NDJSON lines, milliseconds.
 *
 * ── THIS IS A CORRECTNESS SETTING, NOT A POLITENESS ONE ─────────────────────
 *
 * The console drops anything past 120 frames in a rolling second and counts it
 * as `rateLimited`. It does NOT queue it. So a station draining a large NVS tap
 * backlog at full tilt does not go slowly — it LOSES taps, permanently, with the
 * loss recorded only as a counter on a status chip nobody is watching. 10 ms
 * paces us at 100 lines a second, comfortably under the ceiling, and no human at
 * a plinth can tell.
 */
#define QL_NDJSON_GAP_MS 10

/**
 * Longest inbound line the hub will assemble, bytes.
 *
 * The console's own ceiling is 16384, but the largest thing it actually sends is
 * a 64-row `table` chunk, and a row with a legal 20-hex-character uid is 71
 * characters: 64 * 72 + a 60-character envelope is about 4670. 5120 covers that
 * with margin and costs 5 KB of RAM. A longer line is discarded up to the next
 * newline and counted — the same discipline hubLink applies in the other
 * direction.
 */
#define QL_HUB_RX_LINE_MAX 5120

// ── The flag table the hub caches ───────────────────────────────────────────

/**
 * Maximum poles the hub will hold. 512 rows is 128 chunks of 4, well inside the
 * 256-chunk index space, and about 12 KB of RAM per copy (there are two: the
 * live table and the staging buffer a multi-chunk push builds into).
 *
 * ── THE TABLE IS RAM-ONLY, DELIBERATELY ─────────────────────────────────────
 *
 * The default ESP32 NVS partition is 20 KB. A 12 KB blob rewritten on every
 * binding would fill it, wear it and eventually fail a write at the worst
 * moment. So the hub forgets the park on a power cycle, and this is safe ONLY
 * because of a contract the station firmware must honour:
 *
 *   ⚠ A STATION MUST NEVER ADOPT A BEACON WHOSE TABLEVER IS NOT GREATER THAN
 *     THE VERSION IT ALREADY HOLDS, AND MUST NEVER WIPE ITS TABLE BECAUSE THE
 *     BEACON ADVERTISES A LOWER ONE.
 *
 * A freshly booted hub beacons TABLEVER 0, COUNT 0 and the CRC of the empty
 * table, honestly, until a console attaches and pushes. If a station treated
 * that as "the park has no bindings", one hub power cycle would silence
 * twenty-one plinths with guests standing in front of them.
 */
#define QL_HUB_TABLE_MAX 512

/** Chunks a `table` push may be split into on the USB side. hubProtocol bounds `of` to 1..255. */
#define QL_HUB_STAGE_CHUNKS 255

// ── Timing ──────────────────────────────────────────────────────────────────

/** `V` BEACON cadence. Stations take their clock and their TDMA anchor from it. */
#define QL_BEACON_MS 30000

/**
 * NDJSON `hub` status cadence.
 *
 * ── THIS FRAME IS THE RESYNC TRIGGER AND IT IS THE ONE THE HUB FORGETS ──────
 *
 * `tapService` pushes the flag table only when a `hub` frame reports a `tblver`
 * lower than the console's. A hub that never emits `hub` NEVER RECEIVES THE
 * FLAG TABLE after a reconnect, and every plinth in the park sits silent on
 * ambience holding a current-looking version it got from nobody.
 *
 * There is no host-open signal available on a CP2102 bridge (its DTR and RTS
 * are wired to EN and IO0 for auto-reset, not to the ESP32 as data), so the
 * periodic emission is not a belt-and-braces extra — on this hardware it is the
 * only mechanism. It also fires on every table commit, which is what terminates
 * the round trip: once the reported version catches up, the console stops
 * pushing.
 */
#define QL_HUB_STATUS_MS 30000

/**
 * How long a valid inbound NDJSON frame counts as proof that a console tab is
 * attached, milliseconds.
 *
 * Paired with QL_PC_PROBE_MS below: the hub provokes a reply every 20 s, so in
 * a healthy park this window is refreshed three times before it lapses. Making
 * it much longer widens the false-positive window in which the hub would ACK a
 * tap into a tab that has already closed; making it much shorter starts
 * refusing custody during an ordinary browser stall.
 */
#define QL_PC_ATTACH_MS 60000

/** How often to provoke a reply from the console so `attached` stays honest during a quiet hour. */
#define QL_PC_PROBE_MS 20000

/** How long a custody probe may go unanswered before it is retried with a different uid. */
#define QL_CUSTODY_WAIT_MS 3000

/**
 * Probes per tap before the hub stops trying to earn custody for it.
 *
 * Giving up is not losing the tap: the station holds it in its NVS ring and
 * retransmits, and the whole exchange starts again. Three attempts inside the
 * station's four-attempt ACK budget keeps the two loops from beating against
 * each other.
 */
#define QL_CUSTODY_PROBE_TRIES 3

/**
 * How long the hub waits for the console to answer a station's real `Q` QUERY
 * before answering from its own cached table, milliseconds.
 *
 * The console is the authority while it is there, so its answer wins. But a
 * guest is standing at a plinth in silence for the whole of this window, and the
 * hub usually holds the same row — so after this it answers itself. It answers
 * ONLY from a row it actually holds. There is no guess and no generic clip:
 * unresolved is silence, and that is a user mandate, not a default.
 */
#define QL_RESOLVE_WAIT_MS 2500

/** Gap between two `U` CHUNK broadcasts, so a table sweep does not monopolise the air. */
#define QL_CHUNK_GAP_MS 300

/** TTL, seconds, on a single-row change broadcast as an `R` RESOLVE to 255. */
#define QL_ROW_TTL 3600

/** TTL, seconds, the hub puts on an `R` it answers from its own table. */
#define QL_LOCAL_RESOLVE_TTL 900

/** Floor between two `log` lines about the same numeric code, milliseconds. */
#define QL_LOG_RATE_MS 60000

/**
 * Re-ACKs of an already-settled tap: how many, and how close together.
 *
 * ── WHY THIS IS NOT SIMPLY A RATE LIMIT ─────────────────────────────────────
 *
 * A station retransmits a tap because it did not hear the ACK, on a backoff of
 * 250 / 500 / 1000 / 2000 ms. So the FIRST repeat is answered immediately —
 * rate-limiting it against the original ACK, which is what a naive one-second
 * floor does, silently eats the first two of the station's four attempts and
 * makes a lost ACK look like a lost tap.
 *
 * The limit exists for the other case: a captured frame replayed in a loop,
 * where every repeat would otherwise buy the attacker a free transmission from
 * the hub. Eight is comfortably more than any station will ever need and small
 * enough that a replay is not an amplifier.
 */
#define QL_REACK_MAX 8
#define QL_REACK_MIN_MS 200

// ── Media access ────────────────────────────────────────────────────────────

/**
 * Listen-before-talk threshold, dBm. Above this the channel is considered busy.
 *
 * Applied to BEACONS and CHUNK sweeps only. An `A` ACK and an `R` RESOLVE go out
 * immediately: both have a guest standing in front of a plinth waiting for
 * them, and deferring an ACK to be polite is how a station burns its retry
 * budget and queues a tap that had already arrived.
 */
#define QL_LBT_RSSI_FLOOR -105

/** Maximum random pre-transmit jitter for deferrable frames, milliseconds. */
#define QL_LBT_JITTER_MS 250

// ── NVS ─────────────────────────────────────────────────────────────────────

/** Shared with ql_crypto.h, which reads the PSK from the same namespace. */
#define QL_HUB_NVS_NS "questland"
#define QL_NVS_SEQ_TOP "hubSeqTop"
#define QL_NVS_SEQ_EPOCH "hubEpoch"
#define QL_NVS_WALL "hubWall"
#define QL_NVS_TAPMARKS "hubMarks"

/**
 * How far ahead the uplink counter is reserved in NVS.
 *
 * ── WHY A RESERVATION AND NOT A COUNTER ─────────────────────────────────────
 *
 * Writing the counter on every frame would be a flash write inside the tap path
 * and would wear the partition out inside a season. Not writing it at all means
 * a brownout — the thing that actually happens, when a 120 mA transmit burst
 * meets a tired 5 V supply — rolls SEQ backwards. A rolled-back SEQ is not a
 * cosmetic problem: it re-uses a nonce, which in CTR mode is keystream reuse,
 * AND it lands at or below the peer's replay high-water mark, so the frame is
 * dropped as a forgery. A real guest's check-in disappears and the log says
 * "replay".
 *
 * So the counter is reserved in blocks: take the stored ceiling as the starting
 * value, immediately store ceiling + 64, and only write again when the block is
 * exhausted. A brownout costs at most 64 unused sequence numbers and can never
 * hand one out twice.
 */
#define QL_SEQ_RESERVE 64

/** Debounce on persisting the tap replay marks, milliseconds. */
#define QL_MARKS_PERSIST_MS 300000

/** Debounce on persisting the wall-clock estimate, milliseconds. */
#define QL_WALL_PERSIST_MS 600000

// ── Verbose service channel ─────────────────────────────────────────────────

/**
 * 1 to bring up Serial1 as a dedicated tracing port on the pins below.
 *
 * Debuggability is preserved AT THE ENDPOINTS, not over the air: the frames on
 * the radio are encrypted and stay that way, and the place to read them in
 * clear is here, on a board a human is standing in front of.
 */
#define QL_HUB_VERBOSE_UART 1
#define QL_PIN_VERBOSE_TX 17
#define QL_PIN_VERBOSE_RX 16
#define QL_HUB_VERBOSE_BAUD 115200

/**
 * 1 to let verbose tracing fall back to the CONSOLE wire when Serial1 is not
 * built in. BENCH USE ONLY, and off by default.
 *
 * Every trace line the console reads is a line that is not JSON, which
 * `decodeLine` refuses as `bad-json` and counts as malformed. The status chip
 * then shows a fault that is not there, and the one number staff would use to
 * spot a genuinely misbehaving hub becomes noise.
 */
#define QL_HUB_VERBOSE_ON_CONSOLE 0

/** Verbose starts off. Hold BOOT for a second to toggle it. */
#define QL_HUB_VERBOSE_DEFAULT 0

// ── Numeric log codes the hub adds ──────────────────────────────────────────
//
// ⚠ THESE BELONG IN ql_proto.h's QL_LOG_* BLOCK and are defined here only
// because that header is shared with the station firmware and is owned
// elsewhere. Fold them in, and teach tools/sync-proto.mjs about them, before
// the console starts charting log codes — a code that means two things in two
// builds silently rewrites history.

/**
 * A station answered a `C` CMD.
 *
 * There is no `cmdack` frame type on the NDJSON wire — the key sets are exact
 * and inventing one would refuse the whole line — so a `K` is relayed as the
 * numeric diagnostic it already is. a1 = the verb (below), a2 = the station's
 * result code.
 */
#define QL_LOG_CMDACK 150
#define QL_CMDACK_VERB_VOL 1
#define QL_CMDACK_VERB_QVOL 2
#define QL_CMDACK_VERB_PLAY 3
#define QL_CMDACK_VERB_SYNC 4
#define QL_CMDACK_VERB_PING 5

/** A station asked for table chunks. a1 = chunks it says it is missing, a2 = the version it holds. */
#define QL_LOG_SYNC_REQUEST 151
