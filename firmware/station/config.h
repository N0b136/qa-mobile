// config.h — everything about ONE plinth that differs from every other plinth,
// plus every timing constant station.ino reads.
//
// The sketch is identical on all twenty-three boards. The ONLY value that
// changes per board is QL_STATION_NUMBER, and it can be set from the build
// rather than by editing this file — see below. That matters at bench assembly:
// twenty-three edit-save-flash cycles on a shared file is twenty-three chances
// to flash board 14 with board 13's number, and a station with the wrong number
// is not obviously broken. It plays perfectly correct audio and files every
// guest's check-in against the wrong place, which surfaces days later as a
// Station Records CSV that says a party walked the park backwards.
//
// Verify after flashing: the board prints its number and its key fingerprint on
// the service channel at boot, and answers a `C PING` with its uptime.

#pragma once

// ════════════════════════════════════════════════════════════════════════════
// 1. WHICH PLINTH IS THIS
// ════════════════════════════════════════════════════════════════════════════
//
// 1..21  the canon stations, in `STATION_COORDS` order, so N == st-NN
// 22     the Chief's House (the quest start; free, no seal)
// 23     the gate (a read here puts the party in the Village of Queston)
//
// THE NUMBER IS THE ADDRESS AND THE ADDRESS IS THE PLACE. `hubProtocol.ts`
// derives the mapping from the canon station order and there is deliberately no
// second copy of that ordering anywhere — not here, not in the hub. If firmware
// ever grows its own list of place ids, the two can drift without either side
// noticing until a guest hears the wrong plinth's audio.
//
// Prefer setting this from the build so this file stays byte-identical across
// the park, e.g. with arduino-cli:
//
//   arduino-cli compile --fqbn esp32:esp32:esp32
//     --build-property "compiler.cpp.extra_flags=-DQL_STATION_NUMBER=7" station
//
#ifndef QL_STATION_NUMBER
#define QL_STATION_NUMBER 1
#endif

#if QL_STATION_NUMBER < 1 || QL_STATION_NUMBER > 23
#error "QL_STATION_NUMBER must be 1..23 (1-21 plinths, 22 chief, 23 gate)"
#endif

/**
 * Firmware build number, reported in the `H` heartbeat's FW field and printed
 * at boot. Bump it on every flash that goes to the field: the console's health
 * board shows it, and "which boards did we actually update" is a question that
 * gets asked at 7am on an opening day.
 */
#ifndef QL_FW_BUILD
#define QL_FW_BUILD 1
#endif

// ════════════════════════════════════════════════════════════════════════════
// 2. PIN MAP
// ════════════════════════════════════════════════════════════════════════════
//
// Two SPI peripherals share the VSPI bus: the MFRC522 reader and the SX1276
// radio. Everything below exists to make that sharing boring.

/** VSPI. Shared by the reader and the radio; nothing else is on this bus. */
#define QL_PIN_SPI_SCK 18
#define QL_PIN_SPI_MISO 19
#define QL_PIN_SPI_MOSI 23

/**
 * MFRC522 chip select.
 *
 * GPIO 5 IS A STRAPPING PIN and that is precisely why it needs the 10k pull-up
 * to 3V3 called out in the BOM. At reset the ESP32 samples GPIO 5 to choose the
 * SDIO slave timing, and it must be HIGH; meanwhile the ESP32 has not yet
 * driven any of its outputs, so a chip-select line with nothing holding it is
 * FLOATING for the whole of the boot ROM's run. Two things go wrong at once
 * without the resistor: the strapping level is a coin toss, and a floating CS
 * can leave the MFRC522 selected while the boot ROM clocks the flash — the
 * reader then drives MISO against the flash chip. The symptom is a board that
 * boots nine times out of ten, and the tenth time comes up with a dead reader
 * or does not come up at all. It is temperature-dependent, so it passes on the
 * bench in March and fails in a sealed enclosure in July.
 */
#define QL_PIN_RFID_CS 5

/** MFRC522 hard reset. Ordinary GPIO, no boot function, safe to drive at any time. */
#define QL_PIN_RFID_RST 27

/**
 * SX1276 (RA-01H) chip select — GPIO 21, NOT GPIO 15.
 *
 * GPIO 15 is MTDO, a strapping pin: its level at reset selects whether the boot
 * ROM prints its log on U0TXD and it participates in SDIO timing. A LoRa
 * module's NSS line has its own weak pull and a metre of enclosure wiring
 * hanging off it, which is more than enough to move a strapping pin's sampled
 * level. What you get is boards that boot differently from one another with
 * identical firmware, and boot-ROM chatter injected into a serial line at the
 * exact moment the DFPlayer is being initialised.
 *
 * GPIO 21 has no boot function at all. It gets the SECOND 10k pull-up for the
 * same reason GPIO 5 does: during reset both chip selects must be held
 * de-asserted, or two devices answer one transaction.
 */
#define QL_PIN_LORA_NSS 21

/** SX1276 reset. */
#define QL_PIN_LORA_RST 14

/**
 * SX1276 DIO0. WIRED, BUT NEVER ATTACHED TO AN INTERRUPT.
 *
 * The arduino-LoRa library wants a DIO0 pin in setPins() and uses it internally
 * for TX-done polling, so it must be connected. What must NOT happen is
 * LoRa.onReceive() — see the long note in station.ino. Correction #1.
 */
#define QL_PIN_LORA_DIO0 26

/**
 * DFPlayer Mini on UART2.
 *
 * QL_PIN_DF_TX goes to the DFPlayer's RX THROUGH THE 1k RESISTOR in the BOM.
 * The DFPlayer's RX line has no series protection of its own and sits right
 * beside a switching audio amplifier; driven hard from an ESP32 push-pull
 * output it both couples amplifier noise back into the MCU and, on some module
 * revisions, latches the DFPlayer's UART. The resistor costs a cent and turns
 * an intermittent "the module stopped answering after an hour" into nothing.
 */
#define QL_PIN_DF_TX 17
#define QL_PIN_DF_RX 16

/**
 * DFPlayer BUSY, active LOW while a file is playing.
 *
 * The whole audio state machine reads this pin rather than trusting a command
 * to have worked, which is why the BOM insists on a GENUINE DFRobot module:
 * the common clones either leave BUSY floating or drive it from the amplifier
 * enable rather than from playback state, and then "is the clip finished" has
 * no answer and the ambience loop either never restarts or restarts on top of
 * itself.
 */
#define QL_PIN_DF_BUSY 4

// ════════════════════════════════════════════════════════════════════════════
// 3. RADIO
// ════════════════════════════════════════════════════════════════════════════
//
// NEVER POWER THE MODULE WITHOUT AN ANTENNA. A 20 dBm PA into an open circuit
// destroys itself, and it does it quietly enough that the board still enumerates
// and still answers SPI — you get a station with a working radio driver and a
// range of four metres.
//
// The module also gets its OWN 3.3V 1A buck (BOM). The DevKitC's on-board
// AMS1117 is fed from 5V and sags on a 120 mA TX burst; the sag resets the
// MFRC522 mid-read. That fault looks exactly like a bad tag.

/**
 * 915 MHz — RA-01H. RA-02 IS A DIFFERENT MODULE AT 433 MHz and the two are
 * visually near-identical and pin-compatible. A 433 module tuned by this
 * firmware to 915 transmits into a matching network built for a third of the
 * frequency: it will link on the bench across a desk and fail across a wood.
 * Check the silkscreen on every board at assembly.
 *
 * 915 MHz is the ITU Region 2 ISM band (US/Canada). A park elsewhere must
 * change this AND check the duty-cycle rules; EU 868 in particular has a 1%
 * duty limit that the 30 s beacon alone does not violate but that a resync
 * storm can.
 */
#define QL_LORA_FREQ_HZ 915000000L

/** SF9/BW125/CR4/5: ~250-400 ms of airtime for a full 255-byte frame. */
#define QL_LORA_SF 9
#define QL_LORA_BW_HZ 125000L
#define QL_LORA_CR_DENOM 5
#define QL_LORA_PREAMBLE 8

/**
 * Sync word 0x5A. Not a security feature — it is in the clear in every packet
 * and anyone can set it. It exists so the park's radios ignore other people's
 * LoRa traffic in hardware, before a single byte reaches the MAC check.
 */
#define QL_LORA_SYNCWORD 0x5A

#define QL_LORA_TX_DBM 20
#define QL_LORA_PABOOST true

/**
 * 4 MHz on the SPI bus, for BOTH devices.
 *
 * Correct beginTransaction() use ought to make mismatched clocks safe, and on a
 * bench jumper harness it is. In a sealed enclosure with the reader antenna on
 * a flying lead, an 8 MHz radio clock (the arduino-LoRa default) rings the
 * shared SCK enough to corrupt MFRC522 reads that are happening between LoRa
 * transactions — the reader's own sampling is what suffers, not the transfer.
 * Matching both at 4 MHz plus the two pull-ups is the combination that held
 * through a soak. Do not raise it to "speed up" the table sync; the table sync
 * is not bus-bound.
 */
#define QL_SPI_HZ 4000000L

/**
 * Listen-before-talk threshold, dBm. Above this the channel is considered busy.
 *
 * -100 dBm is well above the SF9 noise floor and well below a real neighbouring
 * station, so it discriminates without stalling on thermal noise. If the SX1276
 * ever returns a stuck value the CCA attempt cap below makes the station
 * transmit anyway rather than go permanently mute.
 */
#define QL_CCA_RSSI_DBM (-100)

/** Deferrals before a frame goes out regardless. See the ALOHA note in station.ino. */
#define QL_CCA_ATTEMPTS 4
/** Random 0..this milliseconds added to every backoff, so two deferred stations desynchronise. */
#define QL_CCA_JITTER_MS 250
/** Backoff is min(QL_CCA_BACKOFF_CAP_MS, QL_CCA_BACKOFF_BASE_MS << n). */
#define QL_CCA_BACKOFF_BASE_MS 250
#define QL_CCA_BACKOFF_CAP_MS 3200

// ════════════════════════════════════════════════════════════════════════════
// 4. STORAGE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rows the cached flag table can hold.
 *
 * The protocol allows 1024 (256 chunks x 4 entries) but NVS on the Huge APP
 * partition scheme is 20 KB total and the table is stored as ONE blob, so this
 * is the honest ceiling, not the protocol's. 256 rows is 3602 bytes on flash
 * and two copies (committed + staging) in RAM. A park with more than 256 poles
 * in circulation needs a custom partition table with a larger `nvs`, not a
 * bigger number here — station.ino static_asserts the blob size.
 */
#define QL_TABLE_MAX 256

/**
 * Unsent taps held in flash.
 *
 * THE TAP RING IS ITS OWN RING (correction #2). It is never shared with
 * heartbeats, logs or sync frames. Twenty-one stations heartbeat 630 times an
 * hour between them; a shared 256-entry ring is full of heartbeats inside 24
 * minutes and the first thing evicted is a guest's check-in. Heartbeats are
 * disposable by nature — the next one is 120 seconds away and carries the same
 * facts — and a tap is not disposable at all, so they must not compete for the
 * same space.
 *
 * 48 taps is roughly four hours of a busy plinth with the console tab shut.
 */
#define QL_TAP_RING 48

/**
 * NVS sequence numbers reserved ahead in one write (correction #7).
 *
 * On boot the station reads the stored high-water mark, immediately writes back
 * (mark + 64), and issues sequence numbers from the old mark up to the new one
 * before touching flash again.
 *
 * WHAT BREAKS IF THIS BECOMES "WRITE seq ON EVERY USE": nothing, until a
 * brownout. A DFPlayer TX burst on a marginal supply can reset the MCU inside
 * the few milliseconds between issuing a sequence number and committing it, and
 * then the board comes back and REUSES it. The hub keeps a per-station
 * high-water mark and drops anything at or below it as a replay, so the reused
 * numbers are silently discarded: the guest tapped, the station played the right
 * clip, the tap transmitted, the hub dropped it, and nothing anywhere logged a
 * problem. Reserving forward means a crash can only ever SKIP sequence numbers,
 * and a gap is harmless.
 */
#define QL_SEQ_RESERVE 64

// ════════════════════════════════════════════════════════════════════════════
// 5. READER
// ════════════════════════════════════════════════════════════════════════════

/** How often the MFRC522 is asked whether a card is present. */
#define QL_RFID_POLL_MS 40

/**
 * Per-UID debounce. The same pole is ignored for this long after a tap.
 *
 * The reader sees a held card ten times a second; without this every tap is
 * thirty taps. It is per-UID and not global so a second party's pole can be
 * read immediately — plinths queue at opening time and a global lockout would
 * make the second party think the reader is broken.
 *
 * Longer than the longest speech clip, so a guest cannot re-trigger their own
 * clip on top of itself.
 */
#define QL_TAG_COOLDOWN_MS 12000

/** Minimum gap between any two accepted reads. Protects against a chattering field. */
#define QL_TAG_GLOBAL_GAP_MS 300

/** UIDs tracked for the cooldown above. Beyond this the oldest entry is recycled. */
#define QL_TAG_RECENT 12

/**
 * The MFRC522 is asked for its VersionReg this often, and re-initialised if it
 * answers 0x00 or 0xFF.
 *
 * These chips latch up in RF-noisy enclosures — the failure is a reader that
 * answers SPI perfectly and never sees another card until the power is cycled.
 * The re-init is cheap and the alternative is a plinth that is dead until
 * somebody walks out to it.
 */
#define QL_RFID_WATCHDOG_MS 5000

// ════════════════════════════════════════════════════════════════════════════
// 6. AUDIO
// ════════════════════════════════════════════════════════════════════════════

/** Startup volume, 0..30. Overridden by the value in NVS and by `C VOL`. */
#define QL_VOL_DEFAULT 22

/**
 * BUSY is ignored for this long after any play command.
 *
 * The DFPlayer takes 100-300 ms to seek a file and pull BUSY low. Sampling it
 * immediately reads "not playing", the state machine concludes the clip ended,
 * and it restarts ambience straight over the speech that was just starting. The
 * symptom is a plinth that plays two seconds of story and then birdsong.
 */
#define QL_DF_SETTLE_MS 600

/** BUSY must be continuously idle for this long before the clip counts as finished. */
#define QL_DF_IDLE_MS 300

/** Gap between the end of one ambience file and the start of the next. */
#define QL_AMBIENCE_GAP_MS 900

/**
 * Files in the ambience folder (9). The station cycles through them so a guest
 * standing at a plinth for ten minutes does not hear a four-minute loop three
 * times. Must match what gen-clip-map.mjs puts on the card.
 */
#define QL_AMBIENCE_TRACKS 3

/** How long a play command is watched for a DFPlayer error report. */
#define QL_DF_ERROR_WINDOW_MS 1200

// ════════════════════════════════════════════════════════════════════════════
// 7. PROTOCOL TIMINGS
// ════════════════════════════════════════════════════════════════════════════

/** How long the hub is given to ACK a TAP before it is retransmitted. */
#define QL_ACK_TIMEOUT_MS 2500

/** Retransmissions before the tap is put back to sleep in the ring. */
#define QL_ACK_ATTEMPTS 4

/**
 * How long the station waits before offering the head of the tap ring again
 * after the hub failed to ACK it.
 *
 * THIS IS THE CONSTANT THE BENCH SOAK EXISTS TO TEST. The hub deliberately does
 * not ACK while the console tab is shut (correction #2), so a station with a
 * queued tap and no console gets four retries, gives up, and then — without this
 * hold — starts again 2.5 seconds later. Thirty minutes of a closed tab is then
 * about 1400 transmissions from ONE station. Twenty-one stations doing that is
 * a band nobody else can use, including the hub's beacons, so the park cannot
 * recover even when the tab is reopened. Two minutes of quiet costs nothing:
 * the tap is safe in flash and the guest already heard their clip.
 */
#define QL_TAP_HOLD_MS 120000

/**
 * Minimum gap between dequeuing one tap and the next when draining a backlog.
 *
 * The console drops anything past 120 NDJSON lines in a rolling second and
 * counts it as rate-limited — it does NOT queue it, so an over-fast drain LOSES
 * taps. One station cannot reach 120/s on its own, but twenty-one stations all
 * emptying their rings the instant a console tab opens can, and that is exactly
 * the moment it happens.
 */
#define QL_DRAIN_GAP_MS 400

/** After a TAP with ORG=0 is ACKed, wait this long for an unsolicited RESOLVE before asking. */
#define QL_RESOLVE_WAIT_MS 3000

/**
 * How long after an unresolved tap a late RESOLVE will still start the clip.
 *
 * The guest is standing at a plinth, not walking past it. Eight seconds is
 * long enough for an ACK, a QUERY and an answer at SF9, and short enough that
 * the clip cannot start after they have given up and walked on — which would
 * play one party's story at the next party's arrival.
 */
#define QL_RESOLVE_HOLD_MS 8000

/** A given UID is not QUERYed again within this window, however often it is tapped. */
#define QL_QUERY_COOLDOWN_MS 60000

/** Entries in the point-answer RESOLVE cache. */
#define QL_RESOLVE_CACHE 8

/** Resync backoff, milliseconds, indexed by attempt. Correction #4. */
#define QL_SYNC_BACKOFF_MS \
  { 4000, 8000, 16000, 32000, 32000 }
/**
 * Timed resync attempts before the station falls back to at most one SYNC per
 * received beacon. Correction #4.
 *
 * WHAT BREAKS WITHOUT THE CAP: a station missing one chunk asks again every few
 * seconds forever. That is tolerable for one station and fatal for twenty-one,
 * because the moment they all go stale together is a bulk rebinding at the
 * counter — twenty parties at opening time — and the resulting storm is
 * congestion collapse at the one moment the park cannot absorb it.
 */
#define QL_SYNC_MAX_ATTEMPTS 5

/** A staging buffer that has not received a chunk in this long is abandoned. */
#define QL_STAGE_TIMEOUT_MS 60000

/** Beacon period the hub promises. Used only to decide when the hub has gone quiet. */
#define QL_BEACON_PERIOD_MS 30000
/** Three missed beacons and the hub counts as silent. */
#define QL_HUB_SILENT_MS 100000

/**
 * Heartbeat TDMA frame, seconds, and the width of one station's slot.
 *
 * 23 slots x 5 s = 115 s inside a 120 s frame, so every place has its own slot
 * with margin, and a full 255-byte frame at SF9 (~400 ms) occupies under a tenth
 * of it. Widen the slot before adding a 24th place.
 */
#define QL_HB_FRAME_S 120
#define QL_HB_SLOT_S 5

#if (QL_HB_SLOT_S * 24) > QL_HB_FRAME_S
#error "TDMA slots overflow the heartbeat frame - widen QL_HB_FRAME_S"
#endif

/** At most one LOG frame per this interval. The wire is for guests, not for chatter. */
#define QL_LOG_MIN_GAP_MS 60000

// ════════════════════════════════════════════════════════════════════════════
// 8. SERVICE CHANNEL
// ════════════════════════════════════════════════════════════════════════════
//
// Debuggability is preserved AT THE ENDPOINTS, not over the air. A station in
// the woods has no USB cable attached to it, so its endpoint is Bluetooth
// Serial: a staff laptop pairs, and the board prints decrypted frames, its
// table version, its queue depth and its key fingerprint.
//
// BluetoothSerial is why the BOM specifies the HUGE APP partition scheme — the
// Bluetooth Classic stack is roughly 700 kB of flash and the default 1.2 MB app
// partition will not hold it alongside mbedtls and the audio and radio drivers.
// If the sketch suddenly stops fitting, this is the first thing to check, and
// the answer is the partition scheme, not deleting the service channel: a
// plinth you cannot interrogate in the field is a plinth that gets swapped out
// and driven back to the workshop to answer a question a laptop could have
// answered on the spot.

#ifndef QL_SERVICE_BT
#define QL_SERVICE_BT 1
#endif

/** Bluetooth device name. The station number is appended at runtime. */
#define QL_SERVICE_BT_PREFIX "Questland-ST"

/**
 * Verbose frame printing at boot. Toggleable at runtime with `v` on the service
 * channel; off by default because a paired laptop left connected all day is
 * otherwise a stream of decrypted flag bindings on an unauthenticated link.
 */
#define QL_VERBOSE_DEFAULT 0

/** USB serial speed. Bench only; there is no USB cable on a plinth in the woods. */
#define QL_SERIAL_BAUD 115200
