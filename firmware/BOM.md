# Bill of materials

Twenty-one plinths in a wood and one hub on a counter.

Most of this list is unremarkable and you can buy the cheapest thing that matches the
description. **Section 3 is the part that matters.** Every entry in it is something a
reasonable person will try to remove to save a few dollars a board, and the purpose of this
document is to say what removing it actually costs — because in every case the failure is
intermittent, appears weeks later, and looks like something else.

---

## 1. Budget

The plan's figures, quoted as given:

| | |
|---|---|
| Per station | **~$66** |
| 21 stations | **~$1,390** |
| Hub | **~$18** |

Per-line prices are deliberately **not** recorded here. They move, they differ by supplier
and quantity, and a stale price table in a repository is worse than none — somebody budgets
against it. The two totals above are the planning figures; price the lines at purchase time.

### Two things that total does not include

**Addresses 22 and 23.** The firmware supports twenty-three station addresses: 1–21 are the
canon plinths, 22 is the Chief's House and 23 is the gate. The $1,390 covers **twenty-one
plinths only**. Whether the chief and the gate get full boards — reader, speaker, radio,
enclosure — or are handled some other way is a build decision that has not been made, and it
is two more stations' worth of parts if the answer is yes. Note that the **booth pad's
reader is wired to the hub**, not to station 23, so the gate as a *place* and the booth pad
as a *device* are separate things.

**Spares.** See §5.

---

## 2. Per station

| Qty | Part | Notes |
|---|---|---|
| 1 | ESP32 DevKitC, 4 MB flash | Built with the Huge APP partition scheme — see `README.md` §4 |
| 1 | MFRC522 module (13.56 MHz reader) | On the shared VSPI bus |
| 1 | **Genuine DFRobot DFPlayer Mini** | §3.2. Not a clone |
| 1 | 8 GB microSD card, **FAT32** | §3.9 |
| 1 | **RA-01H / SX1276, 915 MHz** | §3.8. **Not RA-02** |
| 1 | 915 MHz antenna | §3.7. **Never power the module without one** |
| 1 | 3 W weatherproof speaker | |
| 1 | 5 V 3 A power supply | Headroom for the amplifier and a 120 mA radio burst together |
| 1 | **Separate 3.3 V 1 A buck converter, for the LoRa module only** | §3.1 |
| 2 | 10 kΩ resistor | §3.4. Chip-select pull-ups, GPIO 5 and GPIO 21 |
| 1 | 1 kΩ resistor | §3.5. ESP32 TX → DFPlayer RX |
| 1 | 1000 µF electrolytic capacitor | §3.3. Bulk, at the supply entry |
| 1 | 100 µF electrolytic capacitor | §3.3. Local, at the amplifier |
| 1 | 0.1 µF ceramic capacitor | §3.3. Local, at each IC |
| 1 | IP65 enclosure, **≤ 4 mm non-metallic face over the reader** | §3.6 |
| — | Wire, glands, standoffs, **one star ground point** | §3.3 |

### Pinout

Fixed in `station/config.h`; repeated here so it can be checked against a board without
opening a text editor.

| Signal | GPIO | Note |
|---|---|---|
| SPI SCK / MISO / MOSI | 18 / 19 / 23 | VSPI, shared by the reader and the radio |
| MFRC522 CS | **5** | Strapping pin. **10 kΩ pull-up to 3V3** |
| MFRC522 RST | 27 | |
| LoRa NSS | **21** | **Not 15.** **10 kΩ pull-up to 3V3** |
| LoRa RST | 14 | |
| LoRa DIO0 | 26 | Wired, but never attached to an interrupt |
| DFPlayer TX (ESP → module RX) | 17 | **Through the 1 kΩ resistor** |
| DFPlayer RX (module TX → ESP) | 16 | |
| DFPlayer BUSY | 4 | Active LOW while playing |

---

## 3. The parts somebody will try to remove

### 3.1 The separate 3.3 V buck for the LoRa module

**What it is:** a dedicated 3.3 V 1 A buck converter from the 5 V rail, feeding the SX1276
module and nothing else. The DevKitC's own 3.3 V comes from an on-board AMS1117 linear
regulator, and it is tempting to run the radio off that.

**What breaks without it:** the AMS1117 sags on a 120 mA transmit burst. The sag is short
and it does not reset the ESP32 — it resets the **MFRC522**, mid-read.

**Why that is the worst possible symptom:** a reader reset during a card read presents as a
tag that did not read. So the fault reads as "this plinth misses about one tap in thirty",
and every instinct sends you to the antenna, the enclosure face, the tag, the potting, the
tag's distance from the ferrule. It is none of those. It is the radio, and it only happens
when the radio happens to transmit while a guest happens to be presenting a pole — which is
often, because a tap is what makes the radio transmit.

The same sag is a candidate cause of the brownouts that `QL_SEQ_RESERVE`'s 64-ahead
reservation exists to survive. The reservation makes a brownout harmless; the buck makes it
rare.

**Cost of doing it right:** a couple of dollars a board and a bit of space.

### 3.2 The genuine DFRobot DFPlayer Mini

**What it is:** the original module from DFRobot. The market is full of visually identical
clones at half the price, with different chipsets under the same silkscreen.

**What breaks with a clone:** `BUSY`.

The station's entire audio state machine reads the BUSY pin rather than trusting a command to
have worked. It is how "is the clip finished" is answered, and it is the only way to answer
it — the module's serial replies are not reliable enough to schedule against.

Common clone behaviours: BUSY left floating, or driven from the amplifier enable rather than
from playback state. With either, "is the clip finished" has **no answer**, and the ambience
loop either never restarts or restarts on top of the speech that is still playing. That is
not a subtle degradation; it is a plinth that sounds broken.

Clones also misbehave on advert stingers badly enough that v1 deliberately has no advert
feature at all. If a clone crept into the build and a future version adds adverts, it will
wedge.

**Cost of doing it right:** a few dollars a board. This is the single worst place in the BOM
to save money, because the failure is in the thing guests actually experience.

### 3.3 One star ground, and the decoupling

**What it is:** every ground returns to a single physical point, rather than daisy-chaining
the radio's ground through the amplifier's ground through the reader's ground. Plus
1000 µF bulk at the supply entry, 100 µF local to the amplifier, and 0.1 µF at each IC.

**What breaks without it:** DFPlayer and amplifier noise couples into the MFRC522's antenna.
Read range collapses, or reads become intermittent, and it happens **only when audio is
playing** — which, at a plinth, is most of the time a guest is standing there.

**This is the classic "works on the bench, not in the box" fault.** On a bench harness the
grounds are short, the speaker is often not connected, and the reader antenna is not sitting
40 mm from a switching amplifier. In a sealed enclosure all three change at once. A board
that passed every test on a desk fails in the field, and nothing about the failure points at
grounding.

**Cost of doing it right:** ten minutes of layout thought per board and three capacitors.

### 3.4 The two 10 kΩ chip-select pull-ups

**What they are:** 10 kΩ from GPIO 5 to 3V3, and 10 kΩ from GPIO 21 to 3V3.

**The window they cover:** from power-on until `setup()` runs, every GPIO is an input and both
chip-select lines **float**. `setup()` drives both HIGH as its first action after the BUSY
pin, but it cannot reach backwards into the boot ROM's run, and the boot ROM is clocking the
flash for that entire time.

**What breaks without them, part one — two masters on MISO.** A floating CS can leave the
MFRC522 selected while the boot ROM talks to the flash chip. The reader then drives MISO
against the flash. The usual damage is a corrupted first transaction, which lands on
`LoRa.begin()` and presents as an intermittent "LoRa not found".

**What breaks without them, part two — GPIO 5 is a strapping pin.** At reset the ESP32
samples GPIO 5 to choose SDIO slave timing, and it must be HIGH. With nothing holding it, the
strapping level is a coin toss.

**The symptom:** a board that boots nine times out of ten, and the tenth time comes up with a
dead reader or does not come up at all. It is temperature-dependent, so it passes on the
bench in March and fails inside a sealed enclosure in July.

**Cost of doing it right:** two resistors.

### 3.5 The 1 kΩ on the ESP32 TX line to the DFPlayer

**What it is:** a series resistor between GPIO 17 and the DFPlayer's RX pin.

**What breaks without it:** the DFPlayer's RX line has no series protection of its own and
sits beside a switching audio amplifier. Driven hard from an ESP32 push-pull output it
couples amplifier noise back into the MCU, and on some module revisions it latches the
DFPlayer's UART.

**The symptom:** "the module stopped answering after an hour."

**Cost of doing it right:** one resistor, about a cent.

### 3.6 The ≤ 4 mm non-metallic face over the reader

**What it is:** the part of the enclosure a guest presses the pole against. Non-metallic —
ABS, polycarbonate, HDPE — and no thicker than 4 mm at the reader.

**What breaks otherwise:** 13.56 MHz is near-field inductive coupling, and coupling falls
away fast with distance. A thicker face pushes the tag out of usable range; a metal face,
or a metal plate behind it, or a decorative metal ring around it, acts as a shorted turn and
absorbs the field. A **metal** face does not reduce range — it removes it.

**The symptom is deceptive:** a face 6 mm thick reads a tag held perfectly flat against it,
on a bench, at room temperature. Then a guest holds a pole at a slight angle in the cold and
it does not read, and staff learn to press harder and hold longer, and the plinth acquires a
reputation.

**The matching rule on the flag:** the 25 mm tag is potted in the tip **at least 8 mm from
any metal ferrule**, for the same physics. A ferrule right against the tag detunes it, and
the pole then reads badly at every plinth in the park rather than at one — which is a much
more confusing bug report.

**Cost of doing it right:** nothing, if it is designed in. A great deal, if twenty-one
enclosures have already been machined.

### 3.7 Never power the radio without an antenna

**Not a part — a rule.** It belongs in a bill of materials because the moment it gets broken
is the moment somebody powers a board on a bench "just to check it flashes" with the antenna
still in the bag.

**What breaks:** a 20 dBm PA driving an open port reflects its own power back into the output
stage. The module survives it for a while, and then it does not.

**Why it is worse than it sounds:** the failure is not a dead board. The board still
enumerates, still answers SPI, `LoRa.begin()` still succeeds, and the firmware reports a
perfectly healthy radio. You get a station with a working driver and a range of four metres —
which you discover after it is bolted to a post in a wood.

**Procedure:** antennas are fitted before power, every time, including on the bench, including
for a five-second test. Buy the antennas with the modules so there is never a board without
one to hand.

### 3.8 RA-01H, not RA-02

**What it is:** the 915 MHz SX1276 module. The RA-02 is the **433 MHz** part.

**Why this is a trap:** the two modules are physically interchangeable, near-identically
silkscreened at a glance, and sold side by side by the same suppliers, often in the same
photograph.

**What breaks:** a 433 MHz module tuned by this firmware to 915 MHz transmits into a matching
network built for a third of the frequency. It links across a bench. It reaches perhaps forty
metres in a wood.

**Procedure:** check the silkscreen on **every** board at assembly, not on the first one out
of the bag. A single 433 module in a batch of twenty-two is one plinth that is mysteriously
unreachable, and you will look at its antenna, its position, its trees and its power before
you look at its part number.

**Regulatory note:** 915 MHz is the ITU Region 2 ISM band (US and Canada). A park elsewhere
must change `QL_LORA_FREQ_HZ` *and* check the duty-cycle rules — EU 868 in particular has a
1% duty limit that the 30-second beacon alone does not violate but that a resync storm can.

### 3.9 The 8 GB FAT32 card

**Why small:** a card over 32 GB is formatted **exFAT** by default, and the DFPlayer cannot
read exFAT. A bigger card is not a bonus here; it is a formatting trap that presents as
`sd=0` on a board that is otherwise perfect.

The largest card any station actually needs holds fifteen files. Eight gigabytes is already
absurd headroom.

Format FAT32 explicitly, and see `AUDIO.md` §3 for what must and must not be on the card.

---

## 4. Hub

One board, on the counter in the Adventurer's Hall, on a USB cable to the console PC.

| Qty | Part | Notes |
|---|---|---|
| 1 | ESP32 DevKitC, 4 MB flash | Huge APP partition |
| 1 | **RA-01H / SX1276, 915 MHz** | Same part, same warnings as §3.8 |
| 1 | 915 MHz antenna | §3.7 applies identically |
| 1 | MFRC522 module | **The booth pad's reader.** See below |
| 2 | 10 kΩ resistor | Chip-select pull-ups, GPIO 5 and GPIO 21. §3.4 applies identically |
| 1 | USB cable to the console PC | Data, not charge-only |

No DFPlayer, no speaker, no SD card — the hub plays nothing.

### The booth pad is wired to the hub

The pad reader hangs off the hub over about 20 cm of ribbon, not off station 23.

**This is a correctness requirement, not a convenience.** The NDJSON `booth` frame carries no
station number and no sequence number, so **nothing dedupes it** — and the pad is where a
Passage gets spent. A retry at the pad is a second presentation, and a second presentation is
a second spend. That rule is only satisfiable if there is no radio hop underneath the pad to
retry: a read either becomes a line on the USB wire or it does not happen.

Station 23 remains the gate as a *place* — an addressable arrival point — but it is not the
pad.

### Consider a separate 3.3 V buck here too

The $18 hub figure does not include one, and the hub's situation is genuinely better than a
plinth's: it sits on a counter, on a good USB supply, with no audio amplifier beside it.

But the failure mode is identical. The hub's radio transmits beacons every 30 seconds and
table chunks in bursts, off the same AMS1117, with the booth pad's MFRC522 on the same bus —
and a reader reset at the booth means a Guide taps a pole and nothing happens. Given that the
hub is one board rather than twenty-one, the extra cost is trivial and the argument for
skipping it is weak.

Treat this as a recommendation with an honest note attached: the plan's hub figure assumes
otherwise, and this document is flagging the discrepancy rather than resolving it.

---

## 5. Flags, and everything else

### The poles

| Qty | Part | Notes |
|---|---|---|
| 1 per pole | 25 mm NTAG213 or MIFARE 1K tag | Potted in the tip, **≥ 8 mm from any metal ferrule** (§3.6) |
| 1 per pole | Printed label, `FLAG-07` | Staff read it aloud; it is the read-back at the booth |

The tag carries **nothing but its factory uid**. Nothing is written to it. The binding
between a pole, a party and an episode is a database record, which is what lets a tap resolve
locally at a plinth with no network.

That decision also means **a cloned uid is a free walk** — about $5 of hardware. It is an
accepted risk, and `SECURITY.md` §6 explains why (the Passage is spent at the booth, so a
clone steals a walk and not money) and what the upgrade path is (NTAG424 DNA, per-tap CMAC,
same price line).

### Consumables and tooling

Not costed in the $66, and needed before the first plinth is assembled:

- Potting compound for the tag in the pole tip
- Cable glands and gaskets for the enclosures
- A label printer, for `FLAG-NN` on the poles and the station number on every board, every
  card and every enclosure
- A USB-serial cable and a bench supply for provisioning
- The bench-soak setup itself: a power strip that will run twenty-four boards, and space to
  lay them out (`README.md` §10)

### Spares

Buy spares of the cheap parts that fail, because a plinth in the ground gets **swapped**, not
repaired in the field. Walking out to a plinth with a screwdriver and a multimeter is an
afternoon; walking out with a known-good board is twenty minutes.

The parts worth stocking, in rough order of how likely you are to need them:

- microSD cards — cheapest, and the most likely single point of failure in a damp box
- MFRC522 modules — the part most exposed to RF noise and enclosure conditions
- DFPlayer Mini modules — genuine ones, so the spare is not quietly a clone
- One fully assembled spare station, provisioned with the park key, station number unset
  until it is needed

That last one is the useful one. A complete spare board with the key already in NVS turns a
dead plinth into a two-command fix: set `QL_STATION_NUMBER`, flash, fit the failed station's
SD card, bolt it on.
