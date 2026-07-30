# The Questland wire

Two wires meet at the hub and they are **not the same wire**.

```
 [flagpole tip]  RFID tag, factory UID only
       | 13.56 MHz, cleartext, unauthenticated (accepted risk — see SECURITY.md)
 [STATION ESP32]  st-01 .. st-21, chief, gate
       | LoRa 915 MHz SF9 — "Q1", pipe-delimited, AES-128-CTR + truncated HMAC-SHA256
 [HUB ESP32]
       | USB serial 115200 — NDJSON, one JSON object per line, cleartext
 [CONSOLE TAB]  staff Firebase session -> Firestore
```

A station never emits a JSON byte and never sees one. The hub is the only board that
speaks both, and its job on the uplink is to **strip every trace of the radio** — the
magic, the addresses, the sequence header, the base64, the MAC — and print a bare JSON
object. Anything left over refuses the whole line at the far end.

| | Q1 (LoRa) | NDJSON (USB) |
|---|---|---|
| Authority | `firmware/ql_proto.h` + `firmware/ql_crypto.h` | **`questland/src/services/hubProtocol.ts`** |
| Framing | `\|`-delimited fields, `\n` terminated | one JSON object, `\n` terminated |
| Encrypted | yes, payload only | no |
| Authenticated | yes, whole line | no — USB is a wire in a locked booth |
| Max line | 255 bytes (one SX1276 packet) | 16384 characters |
| Drift guard | `tools/sync-proto.mjs` asserts the two agree | — |

> **The console's codec is the authority for the USB half.** If a bound in `ql_proto.h`
> disagrees with `hubProtocol.ts`, the header is wrong, not the TypeScript. The console
> silently drops an out-of-range frame as `range`, which on a plinth in the woods reads
> as "the audio just stopped working" with nothing in any log to say why.

---

## 1. The wire invariant

**Nothing on the air is free text.** Every field on both wires is a hex UID, a single
enum letter, or a bounded integer. The flag-table rows are `uid:org:ep:state` — all hex
and numeric — which is *why* the broadcast is injection-proof, and the `L` LOG frame
carries a numeric code with numeric arguments rather than a message string for the same
reason.

The first person who wants a station to greet a party by name will propose putting
`groupName` in the flag table. **That is the change this invariant exists to stop.** A
name is guest-chosen bytes; the moment one rides in a semicolon-delimited row, a party
called `A;B:1:2:0` rewrites the row after it and the station's cached table quietly binds
the wrong story to the wrong pole. There is no escaping scheme here on purpose — the
answer is that the data has no room for a delimiter, not that the delimiter is escaped.

**The RFID UID is attacker-supplied bytes.** A UID is whatever was held against a reader:
a $5 clone, a phone emulating a tag, a deliberately malformed response. It is safe on
this wire *only* because the firmware **hex-encodes** the bytes the reader returns
(`ql_hex_encode`) and never passes them through. Hex contains no delimiter, no NUL, no
newline and no shell character, so a hostile tag cannot reach a field boundary. This is
an invariant, not an accident.

**Authentication and validation are orthogonal.** The MAC in §5 answers exactly one
question — *who sent this* — and a station is a $66 board on a post in a public wood held
shut by four screws, with the park PSK in its flash. A station that has been opened, or
one that is simply buggy, produces perfectly authentic garbage. Every parser validates
structure as though the MAC did not exist: exact field counts, per-field charsets, and
range checks **before** any value is used as an index. Do not let the presence of crypto
justify a permissive parser.

---

## 2. Addressing

The LoRa address **is** the console's station number. There is no mapping table and there
must never be one — `hubProtocol.ts` derives it from the canon `STATION_COORDS` order, and
a second copy in firmware can drift without either side noticing until a guest hears the
wrong plinth's audio.

| Address | Place | On USB? |
|---|---|---|
| `0` | the hub | **no** — radio only |
| `1` .. `21` | `st-01` .. `st-21`, the canon plinths | yes |
| `22` | `st-chief` — the Chief's House, quest start | yes |
| `23` | `village` — the gate, Village of Queston | yes |
| `255` | broadcast | **no** — radio only |

`st` on the USB wire is range-checked to **1..23** before it indexes anything. A relayed
`st:0` or `st:255` drops the whole frame. 22 and 23 are not plinths but they *are*
addressable places with readers on them.

Radio: **915 MHz (RA-01H / SX1276 — not RA-02, which is 433)**, SF9, BW125, CR4/5,
syncword `0x5A`, 20 dBm, SPI 4 MHz.

---

## 3. The Q1 line

```
Q1|<TYPE>|<DST>|<SRC>|<SEQ>|<B64(EPOCH || ciphertext)>|<B64(HMAC-SHA256[0..7])>\n
```

Seven fields, six pipes, every field non-empty. Header fields stay cleartext because they
are needed for routing **and** because they are the nonce.

| Field | Encoding | Bound |
|---|---|---|
| `Q1` | literal magic | exact |
| `TYPE` | one uppercase ASCII letter | one of §4 |
| `DST` | decimal, no leading zeros | 0..255 |
| `SRC` | decimal, no leading zeros | 0 or 1..23 — **255 is a destination, never a source** |
| `SEQ` | decimal, no leading zeros | 0..4294967295 |
| payload | base64, RFC 4648 standard alphabet, padded | ≤ 216 chars |
| MAC | base64 of 8 bytes | exactly 12 chars |

**Leading zeros are refused everywhere.** One value must have exactly one spelling,
because a LoRa retry has to be byte-identical to the frame it repeats (§7) and one
spelling per value is how that stays true by construction.

### Line budget

| Part | Bytes |
|---|---|
| `Q1\|` | 3 |
| `TYPE\|` | 2 |
| `DST\|` (max `255`) | 4 |
| `SRC\|` (max `255`) | 4 |
| `SEQ\|` (max `4294967295`) | 11 |
| payload b64 + `\|` | ≤ 217 |
| MAC b64 | 12 |
| `\n` | 1 |
| **total** | **≤ 255** |

`QL_PLAIN_MAX` is therefore **158 bytes of plaintext**, and `ql_proto.h` carries a
`static_assert` on it. That assert is the only thing standing between you and a table
chunk silently truncated by the radio — which is precisely the half-applied table that
stage-then-commit exists to prevent.

---

## 4. Frame catalogue (Q1)

Payloads shown **pre-encryption**. Every worked line in this section is a real
known-answer vector computed with the fake key of §5 — you can verify them.

### `T` TAP — station → hub

```
UIDHEX,TS,ORG,EP,RES
```

| Field | Bound | Notes |
|---|---|---|
| `UIDHEX` | `/^[0-9A-F]{8,20}$/` | uppercase, no separators, no `0x` |
| `TS` | 0..4294967295 | **epoch SECONDS**, from the beacon. `0` when the station has no clock yet |
| `ORG` | 0..4 | 0 unknown · 1 Rangers · 2 Alehiim · 3 Elm · 4 RAID |
| `EP` | 0..10 | episode = DFPlayer track. 0 unknown |
| `RES` | `L` \| `Q` \| `U` | how it resolved |

Needs an ACK. Payload `04D00000000001,1785312000,1,3,L`:

```
Q1|T|0|7|312|ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=|BdkXRO2pnJM=
```

**`RES` semantics, decided here because the plan only names the letters:**

- `L` — resolved from a **committed table row**. The normal case.
- `Q` — resolved from a **cached `R` RESOLVE answer**, not from a committed table. The
  audio is correct, but this station is running on point answers because its table sync
  is broken. It is a warning, visible per tap.
- `U` — **not resolved at all.** ORG and EP are `0` and the station plays **nothing**.

**`U` is silence, never a clip.** This is the user's hard mandate and it deletes the
`TRK_FALLBACK` slot entirely. A station that cannot resolve a tapped flag stays on its
ambience loop — its ordinary idle state, not a fallback — sends `Q` QUERY, and keeps
asking until it holds a current table. A "please wait" hold clip is also rejected. **A
wrong story is worse than a pause.**

The station emits `T` **once per tap**, immediately, even when unresolved: a guest who
tapped did tap, and the check-in is recorded regardless. When the `R` answer arrives
inside the hold window the station starts the correct clip and does **not** emit a second
`T` — a second frame carries a new `SEQ` and would therefore be a second check-in.

### `A` ACK — hub → station

```
OK
```

```
Q1|A|7|0|41|ammvGK+B|zTVV65oVGHo=
```

**Custody does not transfer on reception.** The hub ACKs a `T` **only when `pcReady`** —
when the console tab is actually attached and the NDJSON line went out. With the tab shut
the tap stays in the station's NVS ring, which is already reboot-safe. If the hub ACKed
on reception, closing the console tab would quietly destroy every tap taken while it was
closed, and nothing anywhere would record that it happened.

The payload is a bare `OK` with no sequence number in it, which **forces stop-and-wait**:
a station may have exactly one unacknowledged `T` in flight at a time, or it cannot tell
which tap was acknowledged. That is consistent with the 4-attempt retry budget, and the
tap ring makes the queueing behind it free. *(Ambiguity resolved — see §9.)*

### `Q` QUERY — station → hub

```
UIDHEX
```

```
Q1|Q|0|7|314|ammzAN4pjV90piNs9aBU/lmy|DmzCXBK62jo=
```

Sent **only if the ACK landed and no RESOLVE followed** — otherwise a lost ACK produces
two frames where one would do.

If the hub's table has no row for that UID it **sends nothing back, by design**. No guess,
no generic clip, no "please wait". The station stays on ambience and keeps asking. The
console does the same: `tapService.answerQuery` returns silently on an unknown UID.

### `R` RESOLVE — hub → station

```
UIDHEX,ORG,EP,STATE,TTL
```

`TTL` is 0..86400 seconds; the console sends 3600 by default. Payload
`04D00000000009,2,5,0,3600`:

```
Q1|R|7|0|42|ammvGC9l4jT5QfKV0JL8xOZx2RM4HhELWJi9Jas=|ZUqJ9J7UYt8=
```

Unsolicited after ACKing a `T` with `ORG=0`, and in reply to a `Q`. The station caches it
for `TTL` seconds; a later tap on that UID reports `RES=Q`. When the cache expires the UID
goes back to `U` — which is what `TTL` is *for*: a point answer must not outlive the truth.

**`STATE` rides on the wire** (`0` assigned · `1` sealed · `2` returned) or a Hero party
that sealed `rg-01` hears `rg-01`'s clips again at the next plinth.

### `V` BEACON — hub → 255, every 30 s

```
TABLEVER,COUNT,TABLECRC,EPOCH,QUIET
```

| Field | Encoding |
|---|---|
| `TABLEVER` | decimal, 0..9007199254740991 — a **millisecond** epoch |
| `COUNT` | decimal 0..65535 — rows in the current table |
| `TABLECRC` | **exactly 8 uppercase hex digits** |
| `EPOCH` | decimal 0..4294967295 — unix **seconds**. This is how stations get a clock |
| `QUIET` | decimal 0..3600 — seconds to suppress non-urgent uplinks (`H`, `L`, `S`). Taps still go |

```
Q1|V|255|0|43|ammvGL4eRjkGdOudE1QL41si3wr3igOL2MVkMKG4qg7E6kVpu8GJUPFR|WeL2V9Gc9+k=
```

**`TABLEVER` is a millisecond epoch, not a counter.** It is `max(flag.tableAt)` on the
console side — today about `1.78e12`, needing 41 bits. Carry it as `uint64_t`. A station
that truncates it to 32 bits compares a garbage number against the beacon's and reads as
**permanently stale**: it resyncs, commits, and still reports stale on its very next
heartbeat, forever.

### `U` CHUNK — hub → station or broadcast

```
VER,IDX,TOTAL,E;E;...        E = UIDHEX:ORG:EP:STATE
```

```
Q1|U|255|0|44|ammvGCqzhrv91tcG4xzcRznZt4C/YYJZ0IQjjk7NTGdAN1uo7CQnm+D02R+tXyzTOo0/ZjURcJNJtrv3/SNKT4TsGpNNG3BRdXp0hctr2RV8ZoEjlJ9rRfXqhxeVSd0tM6xVNGkr1Vst|m5OWuW6Chi8=
```

decrypting to

```
1785310000000,0,3,04D00000000001:1:3:0;04D00000000002:2:5:1;04D00000000003:0:0:2;04D00000000004:3:9:0
```

**Four entries per chunk, not the plan's six.** An entry is `UIDHEX:ORG:EP:STATE`; a
10-byte tag UID is 20 hex characters and is perfectly legal (the allowlist admits 8..20),
so a worst-case entry is 27 bytes. Six of those plus the `VER,IDX,TOTAL,` prefix is 188
bytes of plaintext — 30 past the ceiling in §3. It fits today only because the tags in the
BOM happen to be 7-byte NTAG213s; **the first 10-byte MIFARE in the rack would overflow
the frame**, and a chunk that overflows is a chunk that never arrives, so the station
stages forever and never commits. Four entries fit *any* legal UID.

An **empty entry list is legal**: "the park holds no bindings at version *v*" is
information, and it is sent as one chunk with nothing after the third comma.

`partySize` is **not** in a chunk. It never crosses LoRa — the station has no use for it.

**Stage, then commit.** A station accumulates chunks keyed by `VER`, `memset`s its staging
buffer at the start of a version, and applies **only when all `TOTAL` chunks of that
version are in hand and the computed CRC equals the beacon's `TABLECRC`**. `tableCommit()`
lives *inside* the CRC check. A half-applied table is the one thing worse than a stale
one: it is a table that looks current and plays the wrong episode.

#### The table CRC — part of the protocol, not an implementation detail

CRC-32/ISO-HDLC (reflected poly `0xEDB88320`, init `0xFFFFFFFF`, final XOR `0xFFFFFFFF`)
over the canonical serialisation:

```
rows sorted by uid, byte-ascending (plain strcmp)
for each row:  "UIDHEX:ORG:EP:STATE;"    decimal, no padding, TRAILING ';' on every row
```

`partySize` is excluded — a station could not compute it. The console sorts with
`uid.localeCompare`, which for the pure `[0-9A-F]` UID charset gives the same order as
`strcmp`; if it ever did not, the CRC would mismatch, the station would refuse the table
and log `QL_LOG_TABLE_CRC_FAIL`. That is a **loud** failure, which is the point. The
alternative to a strict CRC is twenty-one stations quietly holding twenty-one slightly
different tables.

### `S` SYNC — station → hub

```
HAVEVER,WANTVER,MISSINGHEX
```

`MISSINGHEX` is a bitmap of missing chunk indices: byte *j* holds indices `8j..8j+7`,
bit `i%8` with bit 0 the lowest index, emitted byte 0 first, two uppercase hex digits per
byte, at most 32 bytes (256 chunks). An empty bitmap is spelled `00`, never the empty
string — **a field is never allowed to vanish, because a vanished field is a moved
boundary.**

```
Q1|S|0|7|315|ammzAAw1eWuGs7ldT7tXz3tpiS8xzjP6qjbemb1KtR9+sw==|fZ2UZxy0S8M=
```

Backoff **4 / 8 / 16 / 32 s, capped at 5 attempts**, then one per beacon, and
`nextSyncAt = 0` on the not-stale branch. Without both halves of that, one dropped chunk
means an `S` frame every 5 s forever, and a bulk rebinding at the counter — twenty parties
at opening time — becomes congestion collapse at the worst possible moment.

### `H` HB — station → hub, one TDMA slot per 120 s frame

```
UPS,TBLVER,TBLAGE,QDEPTH,SD,DF,ERR,RSSI,VOL,FW
```

| Field | Bound | Notes |
|---|---|---|
| `UPS` | 0..4294967295 | uptime, seconds |
| `TBLVER` | 0..9007199254740991 | the version this station **holds** |
| `TBLAGE` | 0..4294967295 | **seconds since it last COMMITTED a table** |
| `QDEPTH` | 0..65535 | unsent taps in the NVS ring |
| `SD` | 0..1 | **1 = healthy, 0 = fault** |
| `DF` | 0..1 | **1 = healthy, 0 = fault** |
| `ERR` | 0..65535 | numeric code, 0 = none |
| `RSSI` | −200..20 | signed integer |
| `VOL` | 0..30 | DFPlayer volume |
| `FW` | 0..65535 | firmware build |

```
Q1|H|0|7|316|ammzAAQdxYlZp0lgPTkpBd3YkJjRu1p1kHS2I9ThuaaP79SOGSCehSx4D8w=|Answzo0m+0k=
```

**`TBLAGE` exists because "which version do you hold" and "when did you last hear from
the hub" are different questions and staff asked for the second.** A station holding the
current version with a `TBLAGE` of nine hours is a station whose radio died shortly after
the last rebinding — on version alone it looks perfect.

**`SD` and `DF` are 1 = healthy.** Naming them after faults and setting 1 on error inverts
the entire health board, and it inverts it *quietly*.

**Slot timing:** the slot delay is `delay(slot)`, **not** `delay(slot % 1000)` (which is
always 0), and `nextHbFrame` anchors to the beacon `EPOCH`, not `millis()`. Otherwise two
stations that booted within 370 ms of each other collide on *every* heartbeat, stably,
forever — and the two that collide are exactly the two that were installed on the same
afternoon.

### `C` CMD — hub → station · `K` CMDACK — station → hub

```
VERB,ARG          VERB in { VOL, QVOL, PLAY, SYNC, PING },  ARG 0..65535
```

```
Q1|C|7|0|45|ammvGApapY0tZA==|lnbmiec5ysw=
```

**No `REBOOT` and no `WIPEQ` in v1, deliberately.** A remote command that can destroy the
tap queue is a remote command that will eventually destroy a tap queue.

### `L` LOG — station → hub, at most one per 60 s

```
LEVEL,CODE,A1,A2
```

`LEVEL` 0..7 (syslog severities), `CODE` 0..65535, `A1`/`A2` **−4294967295..4294967295**.

```
Q1|L|0|7|317|ammzAHdx4azsHfZpCyc=|MaBzx4JREbc=
```

This frame was the one free-text exception on the air and it is now a numeric code plus
two numeric arguments. **`A1`/`A2` do not fit in `int32_t`** — hold them in `int64_t`. A
firmware using `int32` clamps silently, and the one diagnostic that was supposed to
survive the wire invariant stops being trustworthy.

Codes are in `ql_proto.h` (`QL_LOG_*`) and must stay stable: the console will chart them,
and a renumbered code silently rewrites history.

---

## 5. Encrypt-then-MAC

AES-128-CTR for confidentiality, HMAC-SHA256 truncated to 8 bytes for authenticity, over
**mbedtls**, which ships inside Arduino-ESP32 — no new dependency, no library-manager step
at bench assembly.

### Key derivation

The provisioned secret is a 16-byte **per-park PSK** in NVS (`questland` / `psk`). Two
working keys are derived from it once at boot:

```
K_enc = HMAC-SHA256(PSK, "QL1-enc")[0..15]     16 bytes, the AES key
K_mac = HMAC-SHA256(PSK, "QL1-mac")            32 bytes, the HMAC key
fpr   = HMAC-SHA256(PSK, "QL1-fpr")[0..3]      printed, never secret
```

The **PSK is the HMAC key and the label is the message** — get that the wrong way round
and two implementations derive different keys while both look correct. Labels are ASCII
with no NUL included.

Using the PSK directly for both primitives would work; deriving costs three HMACs at boot
and removes a shortcut that stops being safe the moment somebody changes one of the
primitives.

> **Cross-file contract.** `questland/src/services/hubCrypto.ts` must derive identically —
> same labels, same order, same truncation. Nothing on the wire records which derivation
> was used, so a mismatch presents as *every frame fails its MAC*, with no clue which side
> is wrong. The bench check is `ql_key_fingerprint()`: eight hex characters, derived
> through HMAC so it reveals nothing, and every board in the park must print the same one.

### Nonce — byte order stated explicitly

```
byte  0      SRC        sending address
byte  1      TYPE       the frame-type letter, as its ASCII byte
bytes 2..5   SEQ        big-endian uint32
bytes 6..9   EPOCH      big-endian uint32
bytes 10..13 0x00       reserved padding
bytes 14..15 counter    big-endian block counter, starts at 0
```

**SEQ and EPOCH are big-endian (network order).** An ambiguity here is a field-only bug:
two implementations that disagree each produce a self-consistent keystream, so the bench
passes on one vendor's boards and every frame fails on the other's — and the symptom is a
MAC error, which points at the key, not at the nonce.

`mbedtls_aes_crypt_ctr` treats the whole 16-byte block as one big-endian integer and
increments from byte 15 backwards. The longest frame is 158 bytes = 10 AES blocks, so only
byte 15 ever moves; reaching the nonce would take 65536 blocks (1 MB) in one frame, which
the 255-byte radio makes impossible. **Do not shrink the reserved padding to "use the
space"** — it is what stops a long frame's counter walking into `EPOCH`.

**Why `EPOCH` is in the nonce at all.** `(SRC, SEQ)` is already unique while a board's NVS
counter survives, and the 64-ahead reservation makes it brownout-proof. `EPOCH` covers the
case the reservation cannot: a **reflash, an NVS erase, or a board swap**, after which
`SEQ` restarts near zero and the same `(SRC, SEQ)` recurs with *different* plaintext. In
CTR mode that is keystream reuse — the two plaintexts XOR to each other and both are
readable. `EPOCH` is the unix second at which the board last began a fresh `SEQ` lineage,
so a reflashed board can never collide with its own past.

### Where `EPOCH` is carried — a resolved ambiguity

The approved format has seven fields and no slot for `EPOCH`, but the receiver must know
it to rebuild the nonce and it is **not** derivable (it is the sender's key-epoch, not the
beacon's clock). Resolution:

> **The payload field is `B64(EPOCH_BE32 || ciphertext)`.** The first four base64-decoded
> bytes are the cleartext epoch, big-endian; everything after them is ciphertext.

It costs ~6 characters, keeps the line at seven fields exactly as approved, and `EPOCH` is
**authenticated**, because the MAC covers the whole line up to the MAC and the payload
field is part of that line. The alternative — trial-decrypting against a window of
candidate epochs — is slower, and a receiver that tries several keys until one "works" is
a receiver you cannot reason about.

### What the MAC covers

**The entire line up to the MAC, including the `|` immediately before it.** For

```
Q1|T|0|7|312|ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=|BdkXRO2pnJM=
```

the MAC input is the 61 bytes `Q1|T|0|7|312|ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=|`
— the separator included. Including it means the covered region ends at an unambiguous
byte, so a payload that happens to end in something pipe-like cannot be re-cut into a
different split with the same MAC.

Encrypt-then-MAC, not MAC-then-encrypt: the MAC is checked **before** anything touches the
ciphertext, so a forged frame is rejected without the decryptor ever running on
attacker-chosen bytes.

### Base64

**RFC 4648 standard alphabet (`A-Z a-z 0-9 + /`), with `=` padding.** Standard rather than
URL-safe because mbedtls implements only standard and a hand-rolled second alphabet is a
second thing to get wrong. Padded because `mbedtls_base64_encode` always pads and cannot
be told not to — and because a padded field's length is a pure function of the payload
length, which is what makes the `static_assert` in §3 a real bound.

Buffer sizes are exact: encoding *n* bytes needs `4*ceil(n/3) + 1`. The 8-byte MAC is
always **12 characters** plus NUL; the payload field is at most **216**. Neither `+` nor
`/` nor `=` is `|` and none is a newline, so a base64 field can never move a field
boundary. That property is being relied on — re-check it before changing alphabets.

### Constant-time comparison

MACs are compared with an OR-accumulating loop over a `volatile` accumulator. A
byte-by-byte compare that returns early leaks, through timing, how many leading bytes an
attacker got right — turning a 2^64 forgery into eight rounds of a 2^8 search. Over a
radio the measurement is noisy, but *noisy* is not *impossible*, and this costs eight XORs.
The `volatile` is load-bearing: without it a compiler may notice the result is a boolean
and reintroduce the early exit.

### What happens on a MAC failure

**Counted locally, reported at the endpoint, never answered on the air.**

- **Never answered**, because a reply to a bad MAC is an oracle: it tells an attacker their
  frame reached us, turning a blind guess into a feedback loop, and it converts one forged
  packet into a guaranteed transmission — free battery drain and free airtime denial.
- **Never silent either**, because "drop it and say nothing" is how a mis-provisioned board
  becomes a four-hour debugging session: a station with the wrong PSK and a station with a
  dead radio look identical from the counter. The count rides out in the heartbeat's `ERR`
  field and, rate-limited to one per minute, as a numeric `QL_LOG_MAC_FAIL` frame — both
  of which are *authenticated frames from a station we trust*, not a reply to the forger.
- **On the hub there is a third rule: a frame that fails its MAC produces no NDJSON line,
  ever.** Unauthenticated content must not reach a console tab holding a staff Firestore
  session.
- No per-frame logging. The rate limit is the flood defence.

### Replay defence

The MAC covers `SEQ`. Each receiver keeps a per-peer high-water mark on `(EPOCH, SEQ)`
compared lexicographically — `EPOCH` first, because a reflashed board restarts `SEQ` but
never restarts `EPOCH`, so its first frame after a swap is still strictly newer than
everything before it. The hub also has its own NVS `hubSeq`; stations track a
`hubHighWater`.

**The replay check runs after the MAC, never before.** If it ran first, one forged frame
could push the high-water mark to `0xFFFFFFFF` and every genuine frame after it would be
dropped as stale — a one-packet permanent denial of service.

> ⚠ **A replay rejection is not "do nothing".** A station retransmits its `T` frame
> byte-identically until the hub ACKs it, so the hub sees genuine duplicates routinely. If
> it merely drops them, the station retries four times, gives up, and the guest's check-in
> sits in NVS until closing time. **The hub must still re-send the ACK for a replayed `T`
> (when `pcReady`) while declining to process it a second time.**

### Receive order — every step is deliberate

1. length and charset on the whole line — cheapest, no crypto
2. exactly seven fields, magic, header ranges — structure, no crypto
3. `DST` filter — not our frame
4. base64 charset check, then decode both blobs
5. **MAC verify, constant time**
6. replay check — *after* the MAC
7. decrypt
8. **payload structure validation, written as though step 5 never happened**

### No plaintext fallback

A board with no PSK in NVS **refuses to transmit at all**. It logs `QL_LOG_NO_KEY` on its
service channel and stays on ambience. There is deliberately no "unencrypted if
unprovisioned" mode, because a downgrade path *is* a downgrade attack: an attacker who can
convince one station it is unprovisioned gets the whole protocol in the clear. An
unprovisioned board is a bench problem and must present as one.

### Known-answer vectors

> **The key below is fake.** `000102030405060708090A0B0C0D0E0F` is a counting pattern,
> chosen so that nobody can mistake it for a park key. The real per-park PSK is 16 random
> bytes written to NVS by `tools/provision-key.mjs` at bench assembly and is **never
> committed** — not in an example, not in a test, not in a comment.

```
PSK    000102030405060708090A0B0C0D0E0F        (FAKE — see above)
K_enc  E0929F2FC3CDF586D3F8EA2C4E875B28
K_mac  F5CDFA8D12FB920B34032952964F7A04163FE881718E66F7919B15BFE0CAB183
fpr    57841080
```

Fully worked `T` TAP, station 7 → hub, `SEQ` 312, `EPOCH` 1785312000:

```
plaintext   04D00000000001,1785312000,1,3,L                    (31 bytes)
nonce       0754000001386A69B300000000000000
              07          SRC = 7
                54        TYPE = 'T'
                  00000138  SEQ = 312, big-endian
                          6A69B300  EPOCH = 1785312000, big-endian
                                  00000000000000000  padding + counter
ciphertext  A2E2BB8D109EA244A2EB137CFA796D01E97AE476192D0A8947D18719D7B125
blob        6A69B300 || ciphertext                              (35 bytes)
payload     ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=
mac input   Q1|T|0|7|312|ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=|
mac[0..7]   05D91744EDA99C93  ->  BdkXRO2pnJM=

Q1|T|0|7|312|ammzAKLiu40QnqJEousTfPp5bQHpeuR2GS0KiUfRhxnXsSU=|BdkXRO2pnJM=
                                                                (75 bytes with \n)
```

The remaining vectors, same key, for a firmware self-test at first flash:

| Type | dst | src | seq | epoch | line |
|---|---|---|---|---|---|
| `T` unresolved | 0 | 7 | 313 | 1785312000 | `Q1\|T\|0\|7\|313\|ammzAJL7KYGRN7RPkXxi+xClI8vd6VpYvNvDVvxuzu72XRc=\|yLrPqio4LdM=` |
| `Q` | 0 | 7 | 314 | 1785312000 | `Q1\|Q\|0\|7\|314\|ammzAN4pjV90piNs9aBU/lmy\|DmzCXBK62jo=` |
| `A` | 7 | 0 | 41 | 1785311000 | `Q1\|A\|7\|0\|41\|ammvGK+B\|zTVV65oVGHo=` |
| `R` | 7 | 0 | 42 | 1785311000 | `Q1\|R\|7\|0\|42\|ammvGC9l4jT5QfKV0JL8xOZx2RM4HhELWJi9Jas=\|ZUqJ9J7UYt8=` |
| `V` | 255 | 0 | 43 | 1785311000 | `Q1\|V\|255\|0\|43\|ammvGL4eRjkGdOudE1QL41si3wr3igOL2MVkMKG4qg7E6kVpu8GJUPFR\|WeL2V9Gc9+k=` |
| `S` | 0 | 7 | 315 | 1785312000 | `Q1\|S\|0\|7\|315\|ammzAAw1eWuGs7ldT7tXz3tpiS8xzjP6qjbemb1KtR9+sw==\|fZ2UZxy0S8M=` |
| `H` | 0 | 7 | 316 | 1785312000 | `Q1\|H\|0\|7\|316\|ammzAAQdxYlZp0lgPTkpBd3YkJjRu1p1kHS2I9ThuaaP79SOGSCehSx4D8w=\|Answzo0m+0k=` |
| `C` | 7 | 0 | 45 | 1785311000 | `Q1\|C\|7\|0\|45\|ammvGApapY0tZA==\|lnbmiec5ysw=` |
| `L` | 0 | 7 | 317 | 1785312000 | `Q1\|L\|0\|7\|317\|ammzAHdx4azsHfZpCyc=\|MaBzx4JREbc=` |

Plaintexts, in the same order: `04D00000000009,1785312000,0,0,U` · `04D00000000009` ·
`OK` · `04D00000000009,2,5,0,3600` · `1785310000000,12,3B9ACA07,1785312000,0` ·
`1785309000000,1785310000000,06` · `51230,1785310000000,812,0,1,1,0,-92,22,1` ·
`VOL,22` · `3,104,-1,0`.

The `U` CHUNK vector is in §4.

---

## 6. NDJSON — hub ↔ console

One JSON object per line, `\n` terminated, **printable ASCII only**. A single trailing CR
is forgiven; CR alone or a double CR is not. Max 16384 characters. Inbound cap **120
frames per rolling second** — excess is *dropped*, not queued.

`decodeLine` never throws and never repairs. Every failure is
`{ ok:false, reason }` with `reason` one of `empty · overlong · non-ascii · bad-json ·
not-an-object · unknown-type · field-count · bad-field · bad-uid · range`.

### The UID rule

```
1. must be a JSON string
2. raw.length > 20  =>  REJECT — this test runs BEFORE trim()
3. trim(), then toUpperCase()
4. must match /^[0-9A-F]{8,20}$/
```

Step 2 is the trap: a legal 20-character UID with one leading space is rejected. Firmware
must never emit padding or surrounding whitespace. Real tags are 8 / 14 / 20 characters
(4 / 7 / 10-byte UIDs). App-minted synthetic UIDs are 16 characters with an `FF` prefix —
a length no tag can produce, so a reader will never see one, but a `table` or `row` frame
will carry them.

### Hub → console

Keys are an **exact set**, in the canonical order shown. A missing key, an extra key or a
misspelling refuses the whole line as `field-count`.

```json
{"t":"tap","st":7,"uid":"04D00000000001","seq":312,"ts":1785312000,"org":1,"ep":3,"res":"L"}
{"t":"booth","uid":"04D00000000001","ts":1785312000}
{"t":"hb","st":7,"ups":51230,"tblver":1785310000000,"tblage":812,"qd":0,"sd":1,"df":1,"err":0,"rssi":-92,"vol":22,"fw":1}
{"t":"query","st":7,"uid":"04D00000000009","seq":313}
{"t":"log","st":7,"lvl":3,"code":104,"a1":-1,"a2":0}
{"t":"hub","fw":1,"tblver":1785310000000,"stations":21,"up":48}
```

| Frame | Field bounds |
|---|---|
| `tap` | `st` 1..23 · `seq` 0..U32 · `ts` 0..U32 **seconds** · `org` 0..4 · `ep` 0..10 · `res` `L\|Q\|U` |
| `booth` | `ts` 0..U32. **No `st`, no `seq`** |
| `hb` | `ups` 0..U32 · `tblver` 0..2^53−1 · `tblage` 0..U32 · `qd` 0..65535 · `sd`/`df` 0..1 · `err` 0..65535 · `rssi` −200..20 · `vol` 0..30 · `fw` 0..65535 |
| `query` | `seq` 0..U32 |
| `log` | `lvl` 0..7 · `code` 0..65535 · `a1`/`a2` −4294967295..4294967295 |
| `hub` | `fw` 0..65535 · `tblver` 0..2^53−1 · `stations` 0..255 · `up` 0..U32 **seconds** |

### Console → hub

```json
{"t":"table","ver":1785310000000,"idx":0,"of":1,"rows":[{"uid":"04D00000000001","org":1,"ep":3,"state":0,"partySize":3}]}
{"t":"row","ver":1785310500000,"row":{"uid":"04D00000000001","org":1,"ep":3,"state":1,"partySize":3}}
{"t":"resolve","st":7,"uid":"04D00000000009","org":2,"ep":5,"state":0,"ttl":3600}
{"t":"cmd","st":7,"cmd":"VOL","arg":22}
```

`of` is 1..255 and is **validated before** `idx`, which is bounded by `of-1`. `rows` is
0..64 entries. Row keys are exactly `uid, org, ep, state, partySize` — `partySize` is the
**only camelCase key on this wire**, and `party_size` / `psize` / `n` are refusals.
`ttl` is 0..86400. `cmd` is one of `VOL QVOL PLAY SYNC PING`, uppercase, exact.

An empty table still sends exactly one chunk with `rows: []`.

### What the console actually does with a tap

`handleTap` reads only `frame.st`, `frame.seq` and `frame.uid`. **`org`, `ep`, `res` and
`ts` are validated and then ignored** — the console re-resolves everything from its own
flag table and stamps with its own clock. They still have to be in range, because an
out-of-range value drops the whole frame.

Then, in order: L1 dedupe on `` `${st}:${seq}` `` (512-entry ring, **6-hour TTL**) →
station → place → `flagService.resolveTap` → **20 s per-flag rate limit** →
impossible-travel check → holder on the roll → `checkIn`. The frame enters the dedupe ring
**only on success**, so a transient refusal deserves a second hearing if the station
retries.

`answerQuery` on an unknown UID **sends nothing, by design**.

---

## 7. Fifteen ways to get this wrong

1. **Exact key sets, not minimum key sets.** Adding a MAC, a version, an `rssi` on a tap
   or a debug string refuses the whole frame. The hub strips *all* LoRa framing before it
   prints.
2. **`ts` is epoch SECONDS.** Printing milliseconds (~1.78e12) is out of range and the
   frame is silently dropped as `range/ts`. **The single most likely first-boot bug**, and
   it presents as "taps do nothing". `0` is in range, so a clockless station still gets
   its guest checked in.
3. **`tblver` is a millisecond epoch bounded to 2^53−1, not a u32.** Carry it as
   `uint64_t` and print it with the hand-rolled decimal writer, **not** `snprintf("%llu")`:
   newlib-nano — linked by default in several ESP32 configurations — can be built without
   long-long printf support, and then `%llu` prints nonsense with no warning at compile or
   run time.
4. **`sd` and `df` are 1 = healthy, 0 = fault.**
5. **`partySize` is the only camelCase key.**
6. **`seq` is the dedupe key, per station, with a 6-hour TTL.** A new tap reusing a seq
   seen in the last 6 h is swallowed *before* `checkIn` — no presence, no progress, no leg,
   and L2 cannot recover it. Reserve the counter 64 ahead in NVS so a brownout inside a
   debounce cannot roll it back. A board swap or reflash that restarts near zero will
   collide with yesterday's keys. Conversely, **a LoRa retry must be byte-identical** or it
   is a second check-in.
7. **`booth` carries no `seq`, so nothing dedupes it.** The hub must never resend one — a
   retry is a second presentation at the pad, and the pad is where a Passage is spent.
   *(This is survivable only because the booth reader is wired to the hub itself — see §9.)*
8. **`st:0` and `st:255` are illegal on USB.** They are LoRa addresses only.
9. **A `hub` status frame is the resync trigger.** `tapService` pushes the flag table only
   when `frame.tblver < tableVersion()`. A hub that never emits `hub` **never receives the
   flag table after a reconnect**, and every station sits silent on ambience holding a
   current-looking version it got from nobody. Emit it (a) on host-open, (b) on **every
   table commit** — which is what terminates the round trip — and (c) every 30 s anyway,
   because host-open is not reliable on every USB bridge.
10. **Table chunking is stage-then-commit** on both wires, keyed by version.
11. **`ttl` on `resolve` is capped at 86400 s;** the console sends 3600.
12. **120 frames/second inbound ceiling.** Draining a large NVS tap backlog at full speed
    loses taps to `rateLimited` — it does not queue them. Throttle the drain.
13. **16384-character line ceiling, and a line with no newline kills the buffer** (the
    assembler discards its pending bytes and everything up to the next `\n`). Never emit a
    partial line and then stall.
14. **Printable ASCII only, whole line.** No NUL padding, no UTF-8, no tabs. One stray
    control byte refuses the line as `non-ascii`.
15. **Do not echo console→hub frames back on USB.** `table`/`row`/`resolve`/`cmd` decode
    successfully inbound, increment `framesIn`, and then do nothing — they look like
    traffic and make the status chip lie.

---

## 8. Media access

**CSMA-ALOHA for guest-triggered frames (`T`, `Q`):** listen-before-talk on `LoRa.rssi()`,
0–250 ms jitter, backoff `min(3200, 250 * 2^n)`, 4 attempts. **TDMA for heartbeats**, one
slot per station in a 120 s frame, anchored to the beacon `EPOCH`.

Hub-polled TDMA was **rejected**: a 21-node poll cycle is 8.4 s of a guest standing at a
plinth, every tap, forever, to solve a collision problem measured at under 0.1 %.

ACK retry is a **`retryAt` timestamp checked in `loop()`, never `delay()`**. A blocking
retry freezes the reader, BUSY sampling and radio RX for up to 4 s — precisely when three
children are pressing flags against a plinth.

`LoRa.onReceive()` is **never used**; poll from `loop()`. That, plus matched 4 MHz SPI and
10 kΩ pull-ups on GPIO 5 and GPIO 21, is the whole answer to the shared-SPI hazard between
the MFRC522 and the SX1276. **LoRa NSS is GPIO 21, not 15** — 15 is a strapping pin.

Cost of the crypto: +8 bytes of MAC, +4 bytes of epoch, +~33 % from base64, roughly 15 ms
of extra airtime at SF9. Negligible against the measured load.

---

## 9. Decisions made here, because the plan left them open

Each of these is a place the approved spec did not fully determine the wire. They are
recorded so the next reader knows they were chosen, not assumed.

1. **`EPOCH` is carried as a 4-byte cleartext prefix inside the payload field.** The
   seven-field format has no header slot for it and it is not derivable by the receiver.
   Full reasoning in §5. Costs ~6 characters; keeps the approved field layout exactly.
2. **`SEQ` is one monotonic counter per node, shared by every frame type.** With a single
   counter, `(SRC, SEQ)` alone is unique and the CTR nonce is safe regardless of `TYPE`. A
   per-type counter would make `TYPE` load-bearing for nonce uniqueness — a much sharper
   edge for no benefit. The tap's NDJSON `seq` is that same counter, which is what makes
   the console's `${st}:${seq}` dedupe key meaningful.
3. **Four flag-table entries per `U` chunk, not the plan's six.** A legal 20-hex-character
   UID overflows a six-entry chunk past the 255-byte radio frame. See §4.
4. **`RES=Q` means "resolved from a cached RESOLVE, not from a committed table".** The plan
   named the letter without defining it. This reading makes it a per-tap warning that a
   station's table sync is broken, which is information staff can act on. The alternative —
   `Q` meaning "a query is in flight" — describes a state the console cannot use.
5. **A station emits `T` once per tap, immediately, even when unresolved.** A late `R`
   starts the correct clip but does not produce a second `T`, because a second frame
   carries a new `SEQ` and is therefore a second check-in.
6. **`A` ACK carries no sequence number, so a station is stop-and-wait** — one
   unacknowledged `T` in flight at a time. The plan fixes the payload as `OK`; this is the
   consequence, and it is consistent with the 4-attempt budget.
7. **The booth pad reader is wired to the hub, not to station 23.** It is why the `booth`
   frame carries no `st` and no `seq`, and it is the only arrangement in which "the hub must
   not resend booth frames" is satisfiable — there is no radio hop underneath it to retry.
   Station 23 remains the *gate* place, addressable for arrivals.
8. **Two derived keys rather than the raw PSK for both primitives** (§5), and a derived
   fingerprint for bench verification.
9. **A MAC failure is counted and surfaced at the endpoint, never answered on the air**, and
   on the hub it produces no NDJSON line at all (§5).
10. **`QUIET` in the beacon is a suppression window in seconds for non-urgent uplinks
    (`H`, `L`, `S`) only.** Taps are guest-facing and always go — a quiet period that
    silences a check-in is a quiet period that loses a guest's walk.
11. **An empty `S` bitmap is spelled `00`, not the empty string.** A field is never allowed
    to vanish.
12. **Leading zeros are refused in every numeric field** on both wires, so each value has
    exactly one spelling and a byte-identical retry is structural rather than a convention.

---

## 10. Conformance

`hubSim` is the reference implementation of a conforming hub. `simUid(n)` → `04D0` + 10 hex
digits (14 characters, NXP `04` manufacturer byte) is the shape of a legal test UID; a
memorable string like `SIM0000001` is correctly refused, because `S`, `I` and `M` are not
hex.

**The intended conformance test is byte-for-byte comparison of firmware output against
`encodeLine` output** for the same frame. Do that before the first plinth goes in the
ground, and again after any change to either side.

`tools/sync-proto.mjs` is the standing drift guard: it parses `ql_proto.h` and
`hubProtocol.ts` and asserts that every shared bound, key set and enum still agrees.
