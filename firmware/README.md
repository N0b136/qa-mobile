# Questland firmware

The twenty-three boards in the woods and the one on the counter.

This directory is the hardware half of the RFID chain. A guest carries a flagpole with an
RFID tag potted in the tip; they tap a plinth; the plinth plays the audio for *their* order
and *their* episode and reports the tap to a console tab, which writes it into Firestore
through the same `presenceService.checkIn` the phone app has always called.

Nothing here is a second pipeline. The tap lands on exactly one function on the TypeScript
side, which is why no guest screen and no existing console panel had to be rewritten to
light up.

---

## 1. The chain, end to end

```
[flagpole tip]  RFID tag, factory UID only, nothing written to it
      |  13.56 MHz
[STATION ESP32] MFRC522 + DFPlayer Mini + speaker
                flag table cached in NVS, clip map compiled in
      |  LoRa 915 MHz SF9, AES-128-CTR + truncated HMAC-SHA256 ("Q1")
[HUB ESP32]     decrypts, verifies, relays. Decides almost nothing.
      |  USB serial 115200, newline-delimited JSON
[CONSOLE TAB]   browser, staff Firebase session
      |
[FIRESTORE]     presence / progress / legs / passUses / flags
      |  onSnapshot
[GUEST PHONE]   every screen re-renders for free
```

Two seams matter more than the rest.

**The hub is the crypto boundary.** Frames on the air are encrypted and authenticated;
frames on the USB cable are cleartext JSON. Everything downstream of the hub trusts the
cable, which is why `hubProtocol.ts` validates every line as strictly as the firmware
validates every frame. See `SECURITY.md`.

**The station is the cache and the console is the authority.** A station resolves a tapped
pole from a table it already holds, so audio works with the hub down, the console shut, or
the band jammed. What it cannot do is invent an answer — see the mandate in §7.

---

## 2. What is in here

| Path | What it is |
|---|---|
| `PROTOCOL.md` | The Q1 wire protocol, frame by frame, with worked known-answer vectors. The authority. |
| `AUDIO.md` | Folder/track scheme, SD card layout, what has to be recorded. |
| `SECURITY.md` | Threat model, what the crypto does and does not cover, key handling. |
| `BOM.md` | Bill of materials, with the reasoning for the parts somebody will try to substitute. |
| `ql_proto.h` | Frame types, field layouts, addressing, bounds. Shared by station and hub. |
| `ql_crypto.h` | AES-128-CTR + truncated HMAC-SHA256 over mbedtls, nonce construction, key derivation. |
| `station/station.ino` | The plinth. |
| `station/config.h` | Everything about one plinth that differs from another, plus every timing constant. |
| `station/station_clips.h` | **Generated.** Do not hand-edit. |
| `hub/hub.ino` | The bridge. |
| `hub/config.h` | Hub knobs, each beside its reasoning. |
| `tools/gen-clip-map.mjs` | Reads the canon rotations; writes `station_clips.h` and the 21 manifests. |
| `tools/sync-proto.mjs` | The drift guard: asserts `ql_proto.h` and `hubProtocol.ts` agree. |
| `tools/provision-key.mjs` | Writes the per-park PSK to a board's NVS at bench assembly. |
| `sdcard-manifests/st-NN.txt` | **Generated.** Which audio files go on which card. |

The corresponding TypeScript lives in `questland/src/services/`: `hubProtocol.ts` (the
NDJSON codec), `hubLink.ts` (transport interface and state machine), `hubSim.ts` (a
simulated hub, so the whole chain is testable with zero hardware), `tapService.ts` (what
the console does with a tap) and `flagService.ts` (the flag table).

---

## 3. Prerequisites

**Arduino-ESP32 core**, version 2.x or later. It bundles mbedtls, which is why the crypto
costs no new dependency and no library-manager step at bench assembly.

**Three libraries**, from the Library Manager or `arduino-cli lib install`:

- `MFRC522` (Miguel Balboa) — the reader
- `LoRa` (Sandeep Mistry) — the SX1276 driver
- `DFRobotDFPlayerMini` (DFRobot) — the audio module

`BluetoothSerial`, `Preferences`, `SPI` and the mbedtls headers all ship with the core.

**Node 18+** for the three tools in `tools/`. They are plain ESM scripts with no
dependencies; they read the canon content out of `questland/src/content/` and write into
this directory.

---

## 4. Board settings

Both sketches target an **ESP32 DevKitC** (`esp32:esp32:esp32`, "ESP32 Dev Module" in the
IDE).

| Setting | Value |
|---|---|
| Partition Scheme | **Huge APP (3 MB No OTA / 1 MB SPIFFS)** |
| Flash Size | 4 MB |
| CPU Frequency | 240 MHz (default) |
| Upload Speed | 921600, or 115200 if a long cable makes that unreliable |

### Why the Huge APP partition, specifically

The station brings up `BluetoothSerial` as its service channel. Bluetooth Classic is
roughly 700 kB of flash on its own, and it has to sit alongside mbedtls, the LoRa driver,
the MFRC522 driver and the DFPlayer driver. The default partition scheme gives the
application about 1.2 MB and the sketch does not fit.

If the sketch suddenly stops fitting after a change, **check the partition scheme first**,
and do not "fix" it by deleting the service channel. A plinth you cannot interrogate in the
field is a plinth that gets unbolted and driven back to the workshop to answer a question a
paired laptop could have answered on the spot. `QL_SERVICE_BT` in `station/config.h` exists
so you *can* build without it, not so you routinely do.

### The other flash constraint, which is not the partition scheme

NVS on this scheme is about 20 kB in total, and the station stores its cached flag table as
one blob. That is why `QL_TABLE_MAX` is 256 rows and not the 1024 the protocol's chunk index
space would allow. A park with more than 256 poles in circulation needs a custom partition
table with a larger `nvs` partition — not a larger number in `config.h`. The sketch
`static_assert`s the blob size, so the mistake is a compile error rather than a field
failure.

---

## 5. Generate the clip map before the first compile

`station.ino` refuses to compile without `station/station_clips.h`:

```
#error "station/station_clips.h is missing - run: node firmware/tools/gen-clip-map.mjs"
```

That is deliberate. The clip map is what stops a DFPlayer being asked for a file that is not
on the card, and a stale one is worse than a missing one. Generate it:

```sh
node firmware/tools/gen-clip-map.mjs
```

It reads `EPISODE_STATIONS` out of `questland/src/content/stations.ts` and writes
`station/station_clips.h` plus the twenty-one files in `sdcard-manifests/`. Both outputs
are checked in, and the generator is deterministic: **re-running it on an unchanged
repository must produce byte-identical files.** That is the drift guard for the audio half —
if `git status` is dirty after running it, the rotations changed and the SD cards in the
park are now wrong.

Run the protocol drift guard at the same time:

```sh
node firmware/tools/sync-proto.mjs
```

It parses `ql_proto.h` and `questland/src/services/hubProtocol.ts` and asserts that every
shared bound matches. A bound that drifts is a frame the console silently drops as
`range` — which, on a plinth, reads as "the audio just stopped working" with nothing in any
log to say why.

If the `fw:clips` / `fw:proto` / `fw:key` npm aliases are wired up in your checkout, they
wrap exactly these commands; call `node` directly if they are not.

---

## 6. Building and flashing

### A station

The sketch is **identical on all twenty-three boards**. The only value that changes is the
station number, and it is set from the build rather than by editing a file:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 \
  --board-options PartitionScheme=huge_app \
  --build-property "compiler.cpp.extra_flags=-I$(pwd)/firmware -DQL_STATION_NUMBER=7 -DQL_FW_BUILD=3" \
  firmware/station

arduino-cli upload --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 firmware/station
```

**The `-I` is not optional.** The Arduino build copies the *sketch folder* into a temporary
build directory and nothing above it, so a plain `#include "../ql_proto.h"` resolves
against that temporary directory and fails. `station.ino` has an `__has_include` fallback
for anyone who instead copies or symlinks the two shared headers into `station/`, but the
include path is the clean way.

**Set `QL_STATION_NUMBER` from the build, never by editing `config.h`.** Twenty-three
edit-save-flash cycles on a shared file is twenty-three chances to flash board 14 with board
13's number, and a station with the wrong number is not obviously broken. It plays perfectly
correct audio and files every guest's check-in against the wrong place, which surfaces days
later as a Station Records CSV that says a party walked the park backwards.

**Bump `QL_FW_BUILD` on every flash that goes to the field.** It rides in the heartbeat's
`FW` field and shows on the console health board. "Which boards did we actually update" is a
question that gets asked at 7am on an opening day.

### The station numbering

| Number | Place |
|---|---|
| 1..21 | The canon plinths, in `STATION_COORDS` order, so N maps to `st-NN` |
| 22 | The Chief's House — the quest start; free, earns no seal |
| 23 | The gate — a read here puts the party in the Village of Queston |
| 255 | Broadcast (not a board) |
| 0 | The hub |

There is deliberately no second copy of that ordering in the firmware. `hubProtocol.ts`
derives the mapping from the canon station order; if firmware ever grows its own list of
place ids, the two can drift without either side noticing until a guest hears the wrong
plinth's audio.

### The hub

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 \
  --board-options PartitionScheme=huge_app \
  --build-property "compiler.cpp.extra_flags=-I$(pwd)/firmware" \
  firmware/hub

arduino-cli upload --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 firmware/hub
```

The hub takes no station number — it is address 0 by protocol and there is exactly one.
`QL_FW_BUILD` lives in `hub/config.h` and is picked up by the `#ifndef` in `ql_proto.h`,
which is why **`hub/config.h` must be included before `ql_proto.h`**; including them the
other way round silently leaves the firmware reporting build 1 forever.

---

## 7. Provisioning the per-park key

Every board — twenty-three stations and the hub — holds the same 16-byte per-park PSK in
NVS. Without it, a board **refuses to transmit at all**: it logs `QL_LOG_NO_KEY` on its
service channel, the hub's LED stays dark, and the station stays on ambience. There is
deliberately no "unencrypted if unprovisioned" mode, because a downgrade path *is* a
downgrade attack.

```sh
# Generate a park key ONCE, into a file that is not in the repository.
node firmware/tools/provision-key.mjs --new --out ~/questland-park.key

# Write it to each board, over USB, at bench assembly.
node firmware/tools/provision-key.mjs --key ~/questland-park.key --port /dev/ttyUSB0
```

**The key is never committed.** Not in an example, not in a test, not in a comment. The
known-answer vectors in `PROTOCOL.md` use `000102030405060708090A0B0C0D0E0F` — an obviously
fake counting pattern that says so on the line above it. If you find anything in this
repository that looks like real key material, treat it as a leak and rotate the park.

### The fingerprint is how you check without exposing anything

Each board derives an eight-hex-character fingerprint from the PSK through HMAC and prints
it at boot and in its service-channel status line. It reveals nothing about the key.

**Bench rule: all twenty-four boards must show the same fingerprint.** That is the only
cheap way to catch one board provisioned from the wrong file, and it matters because the
symptom otherwise is subtle — a station whose frames all fail their MAC looks exactly like a
station whose radio is dead, from the counter.

There is **no key rotation protocol in v1**. Reprovisioning is a bench operation on every
board at once; see `SECURITY.md` for what that costs and why it was accepted.

---

## 8. Verifying one board after flashing

Attach a serial terminal at 115200, or pair with the board's Bluetooth service channel
(`Questland-ST<NN>`).

Single-character commands:

| Key | Does |
|---|---|
| `s` | Print status: station number, fw build, key fingerprint, table version, row count, table age, queue depth, seq, epoch, volume, SD and DFPlayer health, MAC-failure / replay-drop / malformed counters |
| `v` | Toggle verbose decrypted-frame tracing |
| `r` | Request a table resync now |
| `a` | Restart ambience |
| `?` | The list above |

Verbose is **off by default** on purpose: a paired laptop left connected all day is
otherwise a stream of decrypted flag bindings on an unauthenticated link.

The hub has no keyboard; it signals with the on-board LED and a `BOOT`-button toggle.

| Hub LED | Means |
|---|---|
| Solid | A console is attached and custody is flowing |
| Slow blink, 1 Hz | Attached, but nothing has proven custody recently |
| Fast blink, 5 Hz | No console |
| Off | No PSK — the board is refusing to transmit |

Hold `BOOT` for a second to toggle the hub's verbose tracing. It goes to `Serial1` on
GPIO 17/16 by default, *not* to the console wire — every trace line the console reads is a
line that is not JSON, which `decodeLine` refuses as `bad-json` and counts as malformed,
turning the one number staff would use to spot a genuinely misbehaving hub into noise.

### A one-board smoke test

1. Board boots. Banner prints station number, fw build and key fingerprint.
2. `s` reports `sd=1 df=1`. If either is 0 the card or the module is the problem, not the code.
3. Ambience is playing out of the speaker within a couple of seconds.
4. Tap a bound pole on the reader. The correct clip plays. `s` shows `qdepth` rise if no hub
   is listening, and fall to 0 once one is.
5. Tap an *unbound* pole. **Nothing plays.** Ambience continues. That is correct behaviour,
   not a fault — see §9.
6. `macfail=0 replay=0 bad=0`. Any of those non-zero on a bench with one hub means a
   provisioning or wiring problem, and the numbers point at which.

---

## 9. The mandate this firmware is built around

**No fallback audio. Ever.**

A station that cannot resolve a tapped flag must not play a generic or guessed clip. It
stays on its ambience loop, asks the hub for the table, and keeps asking until it holds a
current one. A wrong story is worse than a pause.

This is why there is no `TRK_FALLBACK`, why an unresolved tag is a blocking retry loop
rather than a degrade, and why a "please wait" hold clip was also rejected — ambience simply
continues, which is the station's normal idle state, not a fallback. The tap still goes to
the hub with `RES=U`, so the console shows the station unresolved and staff can see it.

Two things that *are* played are not exceptions to this, and the distinction matters if you
ever touch `speakFor()`:

- A **sealed or returned** standard gets the system RETURN announcement `{8,5}`. That pole
  resolved perfectly; the answer happens to be "you are finished, go back to the booth". The
  clip carries no story, names no order and guesses at nothing.
- A **DFPlayer file error** inside the window after a speech command gets `{8,4}` OUT OF
  SERVICE. That is a machine telling a guest it is broken, which is a different thing from a
  machine guessing at a story.

An **off-rotation** tap — a pole whose episode does not route through this plinth — plays
nothing at all, because there is no recording for it on this card. The tap is still reported
with the real org and episode, so the console records the visit.

---

## 10. THE BENCH SOAK

**Bench-soak all twenty-one plinths, the chief, the gate and the hub before a single plinth
goes in the ground.** Not a sample. All of them, at once, on one bench, for at least twelve
hours.

### Why all of them, and why at once

Four whole classes of bug in this firmware are invisible with one board on a desk, and every
one of them is a *field* failure that costs a day of driving between plinths:

**Heartbeat slot collisions.** Heartbeats are TDMA: twenty-three slots of five seconds
inside a 120-second frame. The slot delay is `delay(slot)` and the frame anchors to the
beacon `EPOCH`, not to `millis()`. Get either wrong — `delay(slot % 1000)` is always zero,
and a `millis()` anchor drifts per board — and two stations that booted within about 370 ms
of each other collide on *every single heartbeat*, stably, forever. One board cannot collide
with itself. Two boards rarely collide by chance. Twenty-three boards powered from one strip
boot within milliseconds of each other, which is exactly the condition that produces it, and
exactly the condition on an opening morning.

**Resync storms.** A station that is missing one table chunk asks again on a 4/8/16/32-second
backoff, capped at five attempts, then at most one request per beacon. Remove the cap and
one dropped chunk means an `S` frame every few seconds forever. That is tolerable for one
station and fatal for twenty-one, because the moment they all go stale together is a bulk
rebinding at the counter — twenty parties at opening time — and the result is congestion
collapse at the one moment the park cannot absorb it.

**Clock adoption.** Stations have no RTC. They take `EPOCH` from the hub's beacon, and that
epoch goes into the CTR nonce and into the replay high-water mark. A board that adopts a
clock badly, or re-adopts one it should not, shows up as replay drops on the hub and
`macfail` on nobody — a silent, one-directional failure you will only see by watching a
whole park's counters side by side.

**Custody.** The hub ACKs a tap **only when a console tab is attached**. This is the design:
with the tab shut, the tap stays in the station's own NVS ring, which is already reboot-safe,
and custody never transfers to something that cannot store it.

### The thirty minutes with the console tab closed

**Mid-run, close the console tab for thirty minutes, and keep tapping poles.**

This one test exercises all four classes at once, which is why it is not optional and why it
is called out here rather than left as a nice-to-have.

What must happen while the tab is shut:

- Every tap still plays the right audio. The station resolves locally; the console has
  nothing to do with it.
- Taps accumulate in each station's own tap ring (`QL_TAP_RING`, 48 entries — roughly four
  hours of a busy plinth). Watch `qdepth` climb on the service channel.
- Each station tries four times to get an ACK, gives up, and then **goes quiet for two
  minutes** (`QL_TAP_HOLD_MS`) before offering the same tap again. Without that hold, thirty
  minutes of a closed tab is about 1400 transmissions from *one* station; twenty-one stations
  doing that is a band nobody else can use — including the hub's beacons — so the park cannot
  recover even when the tab is reopened.
- Beacons keep flowing. Stations keep their clocks and their table versions.
- Nobody's queue overflows. If `QL_LOG_QUEUE_HIGH` fires at 75% you are close; if
  `QL_LOG_QUEUE_FULL` fires, a guest's check-in was discarded and the ring is too small for
  the tap rate you just demonstrated.

What must happen when you reopen it:

- Every queued tap arrives. Count them going in and count them coming out.
- They arrive **paced**, not in a flood. The console drops anything past 120 NDJSON lines in
  a rolling second and counts it as rate-limited — it does *not* queue it, so an over-fast
  drain loses taps permanently, recorded only as a counter on a status chip nobody is
  watching. `QL_DRAIN_GAP_MS` on the station and `QL_NDJSON_GAP_MS` on the hub are what pace
  it, and twenty-one stations all emptying their rings the instant a tab opens is the exact
  condition they exist for.
- No duplicates. The L1 transport dedupe (`${stationNo}:${seq}` in a 512-entry ring) plus
  the domain-level dedupe in `questLogService` should mean one leg per tap, but the point of
  the soak is to prove it rather than assume it.
- `qdepth` returns to 0 on every board.

### The full procedure

**Setup**

1. Lay out all twenty-three station boards plus the hub. **Every radio has an antenna
   fitted before anything is powered.** A 20 dBm PA driving an open port damages itself, and
   it does it quietly enough that the board still enumerates and still answers SPI — you get
   a station with a working driver and a range of four metres.
2. Label each board physically with its number. Flash each with its `QL_STATION_NUMBER`.
3. Fit each station's SD card, prepared from its own `sdcard-manifests/st-NN.txt`.
4. `s` on every board. Record: station number, fw build, **key fingerprint**, `sd`, `df`.
   All twenty-four fingerprints must match. Any board reporting `sd=0` or `df=0` gets fixed
   before the soak starts — a card fault discovered on hour nine tells you nothing about the
   nine hours.
5. Attach the hub, open the console. Confirm all twenty-three places show **live** on The
   Park with a current table version.

**Run**

6. Bind a handful of poles at the booth pad across all three orders and a spread of
   episodes, including at least one that will seal.
7. Walk poles across the readers. Every plinth gets tapped at least twice, including at
   least one off-rotation tap and at least one unbound pole.
8. **Close the console tab. Wait thirty minutes. Keep tapping.** Record `qdepth` on several
   boards at ten, twenty and thirty minutes. Listen: the audio must not change at all.
9. Reopen the tab. Watch the drain. Assert every tap landed, once.
10. Leave everything running overnight, at least twelve hours total.
11. Near the end, **rebind twenty poles in a burst** at the counter, the way an opening
    morning looks. Every station should flip stale and then clear as it resyncs, within a
    couple of beacon periods, with no storm.

**Record, per board, at the end**

`s` on every board and write down: `tblver`, `tblage`, `qdepth`, `macfail`, `replay`, `bad`,
`sd`, `df`, `vol`, and the RSSI the console's health panel is showing for it.

**Pass criteria**

- Every board: `macfail = 0`, `bad = 0`, `qdepth = 0`, `sd = 1`, `df = 1`.
- Every board holds the same `tblver` as the hub, and `tblage` is under one beacon period.
- Taps in equals taps out, across the closed-tab window, with no duplicates.
- No heartbeat is persistently missing from the console health board. A station whose
  heartbeats never arrive while its taps do is a slot collision, and it will not fix itself.
- No `QL_LOG_QUEUE_FULL`, no `QL_LOG_RESYNC_GAVE_UP` outside the deliberate storm test, no
  `QL_LOG_TABLE_CRC_FAIL`.
- Audio: correct clip for every resolved tap, silence for every unresolved and every
  off-rotation one, RETURN for every sealed one.

A board that fails any of these goes back to the bench. It does not go in the ground with a
note to watch it, because nobody is going to watch it, and the woods are a long walk.

---

## 11. What still needs real hardware to prove

Honest list. None of the following can be verified from a repository or a headless browser,
and the simulated transport deliberately does not pretend otherwise:

- LoRa range through the actual trees, at the actual plinth positions, at the actual time of
  year the canopy is thickest.
- `LoRa.rssi()` returning current-channel RSSI on these modules — listen-before-talk depends
  on it, and a stuck value is why `QL_CCA_ATTEMPTS` makes a station transmit anyway rather
  than go permanently mute.
- DFPlayer folder/track addressing against a real card, with a real module, at volume, in a
  box. See `AUDIO.md`.
- MFRC522 and SX1276 sharing SPI inside a sealed IP65 enclosure with a 3 W amplifier 40 mm
  away. The bench harness is the easy case.
- The Web Serial permission grant flow in the console tab.
- The crypto's real cost in airtime and CPU on an actual SF9 link.

The known-answer vectors in `PROTOCOL.md` §5 exist so that a board can self-test its crypto
on first flash, before any of the above is in question.
