# Security

The threat model for the radio link and the tags, what the crypto covers, what it
deliberately does not, and how the key is handled.

This document covers the firmware half of the chain: the RFID layer, the LoRa link, the hub,
and the USB cable to the console. The cloud half — Firestore rules, staff accounts, the
guest app's own auth — is documented at the repository root in `firestore.rules` and
`staff-accounts.md`, and is not restated here.

---

## 1. What there is to protect

Being honest about this shortens the rest of the document considerably.

| Asset | Worth | Exposure on this link |
|---|---|---|
| A day's admission | The price of a ticket | High. A cloned tag is a free walk |
| The park record — progress, legs, presence | Operational and pitch value; nobody's livelihood | Medium. A forged tap writes into it |
| Guest identity and PII | Genuinely sensitive | **Almost none.** See the wire invariant |
| Availability of the audio | The guest experience, which is the product | High, and jamming is unsolvable here |
| Staff Firestore credentials | The whole back office | Not on this link at all — they live in the console tab |

**The wire invariant is the reason the PII row is nearly empty.** Nothing on the air is free
text. A flag table row is `uid:org:ep:state` — all hex and numeric. No name, no email, no
party name, no group id. An attacker with a perfect decrypt of every frame in the park
learns that pole `04D0…` is walking Rangers episode 7, and nothing that identifies a person.

That property is not an accident and it is not free. The first person who wants a station to
greet a party by name will propose putting `groupName` in the table, and **that is the change
this invariant exists to stop.** The `L` LOG frame was the one exception and was converted to
a numeric code plus numeric arguments for exactly this reason.

---

## 2. Who is attacking

**The passer-by with an SDR.** A $30 receiver in the car park. Can hear every frame. Without
encryption they would get a live map of the park's bindings; with it they get frame headers
and timing. Addressed.

**Someone who wants a free day.** The realistic adversary. Their cheapest attack is not on
this link at all — it is a $5 tag clone. Accepted, see §6.

**A jammer.** A kid with a cheap 915 MHz transmitter, or an accidental one. Unsolvable at
this layer. Degrades correctly, see §6.

**Someone who opens a plinth.** Four screws in a public wood. This is the attacker the
crypto cannot survive, and §4 is about them.

**A staff insider.** Out of scope for the firmware; the console holds a real staff Firestore
session and that trust is documented in `staff-accounts.md`. Noted here only because a
forged tap that survives everything in this document becomes a *staff-authenticated*
Firestore write, which is why `tapService` sanity-checks independently of the radio.

---

## 3. What the crypto covers

```
Q1|<TYPE>|<DST>|<SRC>|<SEQ>|<B64(EPOCH || AES-128-CTR(payload))>|<B64(HMAC-SHA256[0..7])>
```

Encrypt-then-MAC. The MAC covers the **entire line up to and including the final `|`** before
the MAC field, so the header is authenticated even though it is in the clear.

**Confidentiality of the payload.** AES-128-CTR under `K_enc`. Everything that carries
meaning — uids, orders, episodes, states, heartbeat contents, table chunks — is encrypted.

**Authenticity and integrity.** Truncated HMAC-SHA256 under `K_mac`, 8 bytes. 64 bits of
forgery resistance on a link carrying a few frames a minute, which is a comfortable margin:
an attacker gets one guess per transmission and the park has no oracle to tell them whether
a guess landed (§5).

**Replay resistance.** Each receiver keeps a per-peer high-water mark on `(EPOCH, SEQ)`,
compared lexicographically. `EPOCH` leads because a reflashed board restarts `SEQ` but never
restarts `EPOCH`, so its first frame after a swap is still strictly newer than everything
before it. The uplink counter is brownout-safe via a 64-ahead NVS reservation, which is
exactly what makes the high-water mark sound — without it a brownout rolls `SEQ` back and a
genuine tap is dropped as a replay, with nothing anywhere logging a problem.

**Nonce uniqueness across reflashes.** `SRC || TYPE || SEQ || EPOCH`, zero-padded to 16, with
the CTR block counter in the last two bytes. `(SRC, SEQ)` alone is unique while a board's NVS
survives; `EPOCH` covers the case the reservation cannot — a reflash, an NVS erase, or a
board swap, after which `SEQ` restarts near zero and the same `(SRC, SEQ)` would recur with
different plaintext. In CTR mode that is keystream reuse and the confidentiality of both
frames is gone.

**Key separation.** `K_enc` and `K_mac` are derived from the PSK by HMAC with distinct
labels rather than the PSK being used directly for both. Three lines and one HMAC each, done
once at boot, and it removes a class of mistake that only shows up when somebody changes one
of the two primitives.

---

## 4. What the crypto does NOT cover

### It does not say whether a frame is well-formed

**The MAC answers exactly one question: who sent this.** It says nothing about whether the
content makes sense.

A station is a $66 board on a post in a public wood, held shut by four screws, holding the
PSK in its flash. A station that has been opened — or one that is simply *buggy* — produces
perfectly authentic garbage.

Therefore: **every parser in `ql_proto.h` validates as though the MAC did not exist.** Exact
field counts, per-field charset allowlists, per-field length bounds, and numeric range checks
*before* any array indexing. `stationNo` indexes `STATION_COORDS`; it is bounded to 1..23 or
the frame is dropped.

Authentication and validation are **orthogonal**. If a future change relaxes a bound because
"it is authenticated anyway", that is the bug this section exists to prevent. The receive
order in `PROTOCOL.md` §5 puts payload validation at step 8, after the MAC at step 5,
deliberately — it happens *after*, not *instead of*.

The same discipline applies on the other side of the hub. `hubProtocol.ts`'s `decodeLine`
validates exact key sets, per-field charsets, lengths and ranges, never throws, never
repairs, and counts every refusal. `hubLink` caps lines at 16 384 characters and frames at
120 per second. The hub is the crypto boundary; the USB cable carries cleartext.

### It does not survive a physically-opened station

**The PSK is shared park-wide.** One extracted key is the whole protocol:

- Every frame in the park becomes readable.
- The attacker can forge authentic frames **from any address**, including the hub's. They can
  beacon, they can push table chunks, they can send `C` commands, they can inject taps.
- Replay protection does not help, because a forger with the key generates fresh `SEQ`s.

This is the single largest consequence in this document and it has no cryptographic
mitigation at this design point. Per-board keys would contain it, at the cost of a key
distribution problem the hub would have to solve, and that trade was not taken for v1.

What *does* contain it is everything downstream: `tapService` refuses unknown uids,
rate-limits a flag to one tap per 20 seconds, checks impossible travel against
`STATION_COORDS`, and **logs every refusal to `ql:tapLog` rather than dropping it silently**.
A forger with the PSK can make a plinth play a clip; making the park believe a walk happened
is a separate fight.

The practical mitigations are physical and operational: enclosures that show tampering,
plinths that are visible from a path, and a reprovisioning procedure cheap enough that a
suspected compromise actually gets acted on rather than argued about (§5).

### It does not touch the RFID layer

A MIFARE or NTAG213 uid is a factory number, read in the clear at 13.56 MHz, from a tag
carrying nothing else. The LoRa crypto begins one hop later and has no bearing on it. See
§6.

### It does not hide metadata

`TYPE`, `DST`, `SRC` and `SEQ` are cleartext. They have to be: they are needed for routing
before a receiver knows whether the frame is for it, and they are the nonce.

An observer therefore learns which station is active, when, and roughly how busy the park is
— a traffic-analysis channel that is accepted as the price of a workable protocol. What they
do not learn is *who*, because the payload is encrypted and the payload is the only place
identity appears.

The sync word `0x5A` is **not a security feature.** It is in the clear in every packet and
anyone can set it. It exists so the park's radios ignore other people's LoRa traffic in
hardware, before a byte reaches the MAC check.

### It does not provide availability

See §6 on jamming.

---

## 5. Key handling

**The per-park PSK is 16 random bytes.** It lives in NVS, namespace `questland`, key `psk`,
on all twenty-three stations and the hub.

### Provisioning

Written at bench assembly by `tools/provision-key.mjs` over USB. It is not compiled in, not
in a header, not in a build flag, and not in the repository.

```sh
node firmware/tools/provision-key.mjs --new --out ~/questland-park.key   # once, per park
node firmware/tools/provision-key.mjs --key ~/questland-park.key --port /dev/ttyUSB0
```

The key file lives outside the repository, on media the park controls, backed up somewhere
that is not a laptop. Losing it does not lock anybody out — you can generate a new one and
reprovision — but it does mean reprovisioning, which is a day.

### Never committed. Not even as an example

No key material in any tracked file. Not in a test, not in a fixture, not in a comment,
not as "an obviously fake example that happens to be the right length and looks plausible".

The known-answer vectors in `PROTOCOL.md` §5 use `000102030405060708090A0B0C0D0E0F` — a
counting pattern, chosen so nobody can mistake it for a park key, with a warning on the line
above it. That is the only key-shaped string that belongs in this repository.

If you find anything else that looks like key material in a tracked file, treat it as a leak
and reprovision the park. The cost of being wrong about that is a bench day; the cost of
being wrong the other way is the whole protocol.

### Derivation

```
K_enc = HMAC-SHA256(PSK, "QL1-enc")[0..15]
K_mac = HMAC-SHA256(PSK, "QL1-mac")          (all 32 bytes)
fpr   = HMAC-SHA256(PSK, "QL1-fpr")[0..3]    (printed; not secret)
```

The **PSK is the HMAC key** and the label is the message. Getting that the wrong way round
produces two implementations that derive different keys while both look correct. Nothing on
the wire records which derivation was used, so a mismatch presents as "every frame fails its
MAC" with no clue which side is wrong.

The PSK is zeroed from the stack after derivation with `mbedtls_platform_zeroize`, not
`memset` — a plain `memset` to a buffer that is never read again is dead-store-eliminated by
any optimising compiler, and the key stays in the stack frame.

### The fingerprint

Eight uppercase hex characters, derived through HMAC, revealing nothing about the key.
Printed at boot and in the service-channel status line.

**Bench rule: every board shows the same fingerprint.** It is the only cheap way to catch a
board provisioned from the wrong file, and it matters because a station with the wrong PSK
and a station with a dead radio look identical from the counter.

### No plaintext fallback

A board with no PSK **refuses to transmit at all.** It logs `QL_LOG_NO_KEY` on its service
channel, the hub's LED stays dark, and the station stays on ambience.

There is deliberately no "unencrypted if unprovisioned" mode, because a downgrade path *is* a
downgrade attack: an attacker who can convince one station it is unprovisioned gets the whole
protocol in the clear. An unprovisioned board is a bench problem and must present as one.

### No key rotation protocol in v1

There is no way to roll a key over the air. **Reprovisioning is a bench operation on every
board at once.**

This is a real cost and it should be planned for rather than discovered. There is no key
version field on the wire, so a park with two keys in it is a park where roughly half the
frames fail their MAC and nothing says why. Rotation means: collect twenty-four boards,
provision them all, redeploy. A day, plus the park being shut or running on the phone app.

Consequences for how the park is built:
- Keep the plinths openable without destroying the enclosure seal.
- Keep the provisioning rig assembled and the procedure documented, not reconstructed from
  memory eighteen months later.
- Decide *in advance* what triggers a rotation, because in the moment the argument will be
  "we do not know that it was compromised" and the answer needs to have been agreed already.

### MAC failures are counted, reported at the endpoint, and never answered on the air

A frame that fails its MAC is dropped and a counter increments. It is never replied to and
never produces a per-frame log frame.

**Not answered**, because a reply to a bad MAC is an oracle: it tells an attacker their frame
reached us, which turns a blind guess into a feedback loop, and it turns one forged packet
into a guaranteed transmission — free airtime denial and free battery drain for the cost of
noise.

**Not silent either**, because "drop it and say nothing" is how a mis-provisioned board
becomes a four-hour debugging session. The count rides out in the heartbeat's `ERR` field and,
rate-limited to one per minute, as a numeric `QL_LOG_MAC_FAIL` frame — both of which are
authenticated frames from a station we do trust, not a reply to the forger.

**On the hub there is a third rule: a frame that fails its MAC produces no NDJSON line,
ever.** Unauthenticated content must not reach a browser tab holding a staff Firestore
session.

The replay check runs **after** the MAC, never before. If it ran first, one forged frame
could push the high-water mark to `0xFFFFFFFF` and every genuine frame afterwards would be
dropped as stale — a one-packet permanent denial of service.

### The service channel is unauthenticated

Each station exposes a Bluetooth Classic serial channel (`Questland-ST<NN>`) with no pairing
credential beyond Bluetooth's own. Anyone standing near a plinth with a laptop can connect
to it and read its status line.

The status line is deliberately non-sensitive: station number, firmware build, key
*fingerprint*, table version and counters. None of it is key material and none of it is
guest identity.

**Verbose tracing is a different matter, and that is why it is off by default.** With verbose
on, the channel prints decrypted frames — which is to say a live stream of flag bindings on
an unauthenticated link. Turn it on for a session with `v`, turn it off before you walk away,
and do not change `QL_VERBOSE_DEFAULT` to 1 "so it is ready next time".

If a park needs this closed properly, the answer is to build with `QL_SERVICE_BT 0` on
production boards and keep one service board for the bench — at the cost described in
`README.md` §4, which is that a plinth you cannot interrogate in the field gets driven back
to the workshop.

---

## 6. Accepted risks

These are decisions, not oversights. Each one was taken with its cost understood.

### A cloned tag is a free walk

**Roughly $5 clones a MIFARE 1K uid**, and NTAG213's uid is equally readable. The tag carries
nothing but a factory number, by design — the binding is a database record, which is what
makes a tap resolve locally and instantly at a plinth with no network.

The LoRa crypto does not touch this layer and cannot.

**What a clone actually gets you:** a walk. The Passage is spent **at the booth**, when a
Guide binds a party to a pole, so a cloned pole never spends anything and never buys
anything. It steals admission to the woods, not money out of the till, and it steals it in a
way that shows up on the console — two poles with the same uid tapping in two places is
exactly what the impossible-travel check is looking for.

**The upgrade if it ever matters** is NTAG424 DNA: same price line, and it does a per-tap
CMAC so a cloned uid is worthless without the tag's key. That is a swap of the tag and a
change to the reader path, not a redesign, and it is the right answer if the park ever
measures real losses.

**The mitigation that ships today** is console-side: unknown-uid rejection, a 20-second
per-flag rate limit, and impossible-travel detection against `STATION_COORDS`, each refusal
logged rather than dropped.

### Jamming is unsolvable at this layer

915 MHz is an unlicensed band. Anyone can transmit in it, deliberately or by accident, and
no amount of cryptography makes a jammed channel work. Frequency hopping and higher spreading
factors raise the cost of jamming; they do not remove it.

**What matters is that it degrades correctly, and it does:**

- **Audio keeps working.** Every station resolves a tapped pole from a table it already holds
  in NVS. The radio is not in the path between a tap and a clip. A guest in a jammed park
  hears exactly what they would have heard otherwise.
- **Taps queue in flash.** Each station holds up to `QL_TAP_RING` (48) unsent taps in NVS,
  reboot-safe. Roughly four hours of a busy plinth.
- **Staff can see it.** The console health map shows stations flipping `silent` as heartbeats
  stop arriving. That is the visible mitigation the whole station-health surface exists for.

**Where it stops degrading gracefully:** a jam longer than the queue depth. When a ring
fills, `QL_LOG_QUEUE_FULL` fires and the oldest taps are discarded — check-ins that happened
and were never recorded. Bench-soak evidence of the real tap rate is what tells you whether
48 is the right number for your park.

### A forged tap becomes a staff-authenticated Firestore write

If somebody gets past the crypto — with an extracted PSK, most plausibly — their frame
arrives at a console tab holding a real staff session, and that session may write any guest's
`presence`, `progress`, `legs` and `passUses`.

That is why `tapService` sanity-checks **independently of the radio**, and why every refusal
is logged. The radio's verdict on a frame is "this came from a board holding the park key",
which is a weaker claim than "this describes something that physically happened".

### Staff can write any guest's record

Staff are a hand-provisioned Firestore allowlist with `allow write: if false` on
`staff/{uid}` — there is no self-promotion path. The merges are unions and transactions, so
accidental destruction is not possible. A determined staff actor with direct REST access
could still zero a season. Accepted; documented at the repository root.

### The hub forgets the park on a power cycle

The hub's flag table is RAM-only, because the default NVS partition is 20 kB and a 12 kB blob
rewritten on every binding would fill it, wear it, and eventually fail a write at the worst
moment.

A freshly booted hub therefore beacons `TABLEVER 0`, `COUNT 0` and the CRC of the empty
table, honestly, until a console attaches and pushes. This is safe **only** because of a
contract the station firmware must honour:

> A station must never adopt a beacon whose `TABLEVER` is not greater than the version it
> already holds, and must never wipe its table because the beacon advertises a lower one.

If a station treated a fresh hub's beacon as "the park has no bindings", **one hub power
cycle would silence twenty-one plinths with guests standing in front of them.** This is an
availability property rather than a confidentiality one, but it belongs in this document
because it is a rule that a well-meaning simplification would delete.

---

## 7. What to watch, and what it means

The heartbeat carries `ERR`, and the service channel's `s` command prints the counters. On a
healthy park all three are zero.

| Signal | Reading |
|---|---|
| `macfail` non-zero on **one** board | That board's PSK is wrong. Check its fingerprint |
| `macfail` non-zero on **every** board | Somebody is transmitting on our frequency and sync word — or the hub was reprovisioned and the stations were not |
| `macfail` climbing steadily with no other symptom | Active forgery attempts, or a neighbouring system that happens to share the sync word |
| `replay` non-zero | Usually benign: a station retransmitted a tap the hub had already taken. Persistent and large means a board is rolling its `SEQ` back, which means brownouts, which means the supply |
| `bad` (malformed) non-zero | A board is producing frames that pass the MAC and fail validation. That is a firmware bug or an opened station, and it is the one counter that should never move |
| A station `silent` while its neighbours are `live` | Radio, antenna, power, or a heartbeat slot collision. The bench soak exists to eliminate the last one before deployment |
| A station `stale` after a rebinding, and staying stale | Resync is failing. `QL_LOG_RESYNC_GAVE_UP` will say how many chunks it is missing |
| Console malformed-frame counter climbing | Something is writing non-JSON to the serial port. Most often: hub verbose tracing accidentally routed to the console wire instead of `Serial1` |

None of these produce an alert on their own. They are read off the console health board by a
person, which is the design: the park is twenty-one plinths and one counter, and the
mitigation for an invisible staleness window is making it visible.
