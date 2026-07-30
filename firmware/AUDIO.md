# Audio

What plays, where it lives on the card, and what has to be recorded.

---

## 1. The scheme

```
folder = the order          track = the episode number
```

| Folder | Contents |
|---|---|
| `01` | Rangers of Questia |
| `02` | Hearers of the Alehiim |
| `03` | Order of the Elm |
| `04` | RAID: Brigand's Return (the season finale) |
| `08` | System announcements |
| `09` | Ambience |

Folders `05`, `06` and `07` are unallocated. **There is no fallback narrative folder and
there must never be one** — see §6.

Within an order's folder, the track number **is** the episode number. Episode 7 of the
Rangers questline is `01/007.mp3`, on every card that carries it, forever.

### Why this and not a per-station index

The wire's `ORG` and `EP` fields are the DFPlayer's arguments. Resolution is a struct copy:

```c
// station.ino, speakFor()
playClip(org, ep);   // -> df.playFolder(org, ep)
```

There is no lookup table between the radio and the speaker, so there is no lookup table to
drift, no renumbering, and no second copy of the season's shape that can disagree with the
first. `flagService.ORG_WIRE` on the TypeScript side and `QL_ORG_*` in `ql_proto.h` hold the
same three numbers, and `tools/sync-proto.mjs` asserts they match.

The folder numbers are **physical**. They are written onto twenty-one SD cards. They are not
derived from any array order, and renumbering either end means re-cutting every card in the
park.

### System, folder 08

| Track | Announcement | Played when |
|---|---|---|
| `08/004.mp3` | OUT OF SERVICE | The DFPlayer reports a file error inside the window after a speech command — the card and the clip map disagree, or a file is corrupt |
| `08/005.mp3` | RETURN TO THE BOOTH | A pole resolves, but its `STATE` is sealed (1) or returned (2) |

Tracks `001`–`003` in folder 08 are unallocated. The two numbers in use are fixed by
`QL_TRK_OUT_OF_SERVICE` and `QL_TRK_RETURN` in `ql_proto.h`; do not renumber them to "tidy
up", because the constants and twenty-one cards would have to change together.

Neither of these is a narrative fallback. See §6.

### Ambience, folder 09

`09/001.mp3` … `09/003.mp3`. Three files, matching `QL_AMBIENCE_TRACKS` in
`station/config.h`. The station cycles through them rather than looping one, so a guest
standing at a plinth for ten minutes does not hear the same four minutes three times.

**Ambience is the station's resting state, not a filler.** Whatever just ended — speech, a
system announcement, or the previous ambience file — the station returns here. That is
exactly why an unresolved tap playing nothing is not a degraded mode: it is this.

If you change the number of ambience files on the cards, change `QL_AMBIENCE_TRACKS` in the
same commit. The station cycles `(n % QL_AMBIENCE_TRACKS) + 1` and will ask for a file that
is not there otherwise.

---

## 2. Gaps are correct

Track number equals episode number **always**, so a card carries a sparse set of tracks.
Station 8, Songhollow Cave, carries exactly this in folder `01`:

```
01/007.mp3
01/010.mp3
```

Tracks 1 through 6, 8 and 9 are absent, because the Rangers questline only routes through
Songhollow Cave in episodes 7 and 10. **That is not a hole to be filled and not a numbering
to be compacted.**

Renumbering the files to `001` and `002` would break the whole scheme: `EP` on the wire
would stop being the track argument, a lookup table would have to appear, and adding a
station to a new rotation next season would become a renumber of every card that station
appears on. As it is, adding a station to a rotation is **one file drop**.

### What is actually on each card

Derived from `EPISODE_STATIONS` in `questland/src/content/stations.ts`. This is what
`tools/gen-clip-map.mjs` reads, and it writes the same information into
`sdcard-manifests/st-NN.txt`.

| # | Station | Folder 01 (Rangers) | Folder 02 (Alehiim) | Folder 03 (Elm) | Speech files |
|---|---|---|---|---|---|
| 1 | Hidden in Plain Sight | 004 006 009 | 003 007 | 001 002 005 008 010 | 10 |
| 2 | Maker's Tent | 001 004 006 009 | 003 007 | 002 005 008 010 | 10 |
| 3 | Songcircle | 001 003 004 006 009 | 002 007 | 002 005 008 010 | 11 |
| 4 | Riddlebridge | 002 004 009 | 003 006 | 001 005 007 008 010 | 10 |
| 5 | Coolcreek Stone | 003 007 | 001 002 005 006 008 010 | 004 009 | 10 |
| 6 | Brigand's Hideout | 001 003 006 010 | 004 007 009 | 002 005 008 | 10 |
| 7 | Abbey Hill Ruins | 001 004 006 009 | 008 010 | 002 003 005 007 | 10 |
| 8 | Songhollow Cave | 007 010 | 003 005 008 | 001 004 006 009 | 9 |
| 9 | Story Willow | 002 005 008 010 | 001 003 004 007 | 006 009 | 10 |
| 10 | Southfork | 004 008 | 001 002 005 010 | 003 006 007 009 | 10 |
| 11 | Hillward Outpost | 001 002 005 008 010 | 004 009 | 003 006 007 | 10 |
| 12 | Shadetree Hollow | 003 006 007 | 001 005 008 010 | 002 004 009 | 10 |
| 13 | Path's Cross | 002 005 007 009 | 003 006 008 | 001 004 010 | 10 |
| 14 | Wonder's Hut | 001 005 008 010 | 002 004 007 009 | 003 006 | 10 |
| 15 | Maker's Cave | 003 007 | 001 002 005 008 010 | 004 006 009 | 10 |
| 16 | Story Oak | 003 007 | 002 005 006 009 | 001 004 008 010 | 10 |
| 17 | Silverhoard Mine | 002 005 008 010 | 004 006 009 | 001 003 007 | 10 |
| 18 | Etzhyii Village Ruins | 002 005 008 | 001 004 006 009 010 | 003 007 | 10 |
| 19 | Ranger Camp | 001 002 003 004 005 006 007 008 009 010 | — | — | 10 |
| 20 | Hearer's Hollow | — | 001 002 003 004 005 006 007 008 009 010 | — | 10 |
| 21 | ElmRoot | — | — | 001 002 003 004 005 006 007 008 009 010 | 10 |

**210 station speech recordings**, 9 to 11 per card. No card carries more than eleven speech
files, which is the whole reason a $6 module and an 8 GB card are enough.

The three base stations (19, 20, 21) carry one order's ten episodes and nothing else,
because a base station belongs to its own order. Their folders for the other two orders are
absent entirely, which is legal — an empty run in the clip map — and means a pole from
another order tapping there plays nothing.

### Stations 22 and 23

The Chief's House and the gate have no entries in `EPISODE_STATIONS`, so the generator gives
them an **empty speech run**. Their cards carry folders `08` and `09` only. That is legal
and deliberate: the chief is a free narrative stop that has no per-episode recording yet,
and the gate is an arrival point.

If narrative audio is ever written for the chief, it goes in the rotations first — the
generator is the only thing that decides what is on a card, and hand-adding a file to a card
without regenerating means the station's compiled clip map says the file is not there and
the station will refuse to play it.

### The total

| | Distinct recordings |
|---|---|
| Station speech, derived from the rotations | 210 |
| System (folder 08, two announcements) | 2 |
| Ambience (folder 09) | 3 |
| **Today's total** | **215** |

The plan's "~280 recordings" figure includes material the rotation data does not describe
yet: the **RAID: Brigand's Return** finale (folder `04`, three phases) has an addressing slot
but no station rotation, and no chief or gate narrative exists. Those are recording work that
has not been scoped; the 215 above is what `gen-clip-map.mjs` can derive from the canon
today, and it is the number to plan the first recording session around.

---

## 3. SD card layout

FAT32. One card per station, prepared from that station's manifest.

```
/01/001.mp3
/01/004.mp3
/01/006.mp3
/01/009.mp3
/02/008.mp3
/02/010.mp3
/03/002.mp3
/03/003.mp3
/03/005.mp3
/03/007.mp3
/08/004.mp3
/08/005.mp3
/09/001.mp3
/09/002.mp3
/09/003.mp3
```

That is station 7, Abbey Hill Ruins, in full: ten speech files, two system, three ambience.
Fifteen files, a few tens of megabytes.

Rules, all of them load-bearing:

- **Folder names are exactly two digits**, `01` through `09`. Not `1`, not `Folder01`.
- **File names are exactly three digits plus `.mp3`**, `001.mp3` through `255.mp3`. A
  descriptive suffix (`007_abbey.mp3`) is tolerated by some module revisions and not by
  others; do not rely on it. Keep the human-readable name in the manifest, not on the card.
- **Nothing else on the card.** No stray folders, no `README`, and in particular no macOS
  resource forks (`._001.mp3`), `.Spotlight-V100` or `.fseventsd`. They occupy directory
  entries and some clone modules count them when resolving a folder. Run `dot_clean` on the
  card after copying from a Mac, or copy from a machine that does not write them.
- **Format the card FAT32 explicitly.** Cards over 32 GB are formatted exFAT by default and
  the DFPlayer cannot read exFAT. This is why the BOM specifies an 8 GB card — a big card is
  not a bonus here, it is a formatting trap.

### Copy order does not matter, and here is why that is worth saying

Almost every DFPlayer guide on the internet insists that you must copy files onto the card
in the order you want them numbered. That advice is about `play(n)`, which indexes files in
**FAT directory-entry order** — the order they were written — and which is a genuinely
awful API.

This firmware never calls `play(n)`. It calls `playFolder(folder, track)`, which resolves by
the **numeric name** of the folder and the file. Copy order, timestamps and defragmentation
are all irrelevant. What matters is that the names are right.

---

## 4. Recording format

| | |
|---|---|
| Container | MP3 |
| Bitrate | **Constant.** 128 kbps is a good default; anything from 64 to 192 kbps is fine |
| Sample rate | 44.1 kHz |
| Channels | Mono |
| Tags | Strip ID3v2, or keep it minimal |

**CBR, not VBR.** The DFPlayer decodes a stream, and variable-bitrate files have produced
seek and duration misbehaviour on these modules for years. There is no benefit to VBR at
this file size.

**Mono, because the speaker is mono.** A stereo file is twice the data for the same output
and gives the module more to do.

**Strip ID3v2.** A large tag block at the head of the file is data the module reads before it
reaches audio, which lengthens the seek and can push the first sound past
`QL_DF_SETTLE_MS`. Album art in particular has no business on this card.

### Levels

Every station has **one volume setting** (`QL_VOL_DEFAULT` 22 of 30, adjustable per station
over the air with `C VOL`). There is no per-clip gain.

So **normalise every recording to the same loudness** before it goes on a card. A clip cut
quiet is unusable outdoors under a canopy; a clip cut hot clips a 3 W amplifier into a
weatherproof driver and sounds like a fault. Pick a target, apply it to all 215, and check a
handful on the actual speaker in the actual enclosure before cutting the rest.

### Lead-in and tail

Give each file about 100–200 ms of digital silence at the head. The amplifier's first sample
after an idle period is otherwise an audible click, and the click is the first thing a guest
hears of the story. End with a short fade rather than a hard cut, because the module drops
BUSY the instant the file ends and the station's own gap timing takes over from there.

### Length — this is a hard constraint, not a style note

`QL_TAG_COOLDOWN_MS` in `station/config.h` is **12 000 ms**, and its stated job is to be
*longer than the longest speech clip on any card*. That is what stops a guest holding a pole
against the reader and re-triggering their own clip on top of itself.

So one of these two things has to be true:

1. **No speech clip exceeds about 12 seconds**, or
2. `QL_TAG_COOLDOWN_MS` is raised above the longest clip, in the same change that lands the
   longer clips.

Twelve seconds is short for a story beat, so option 2 is the likely answer once real scripts
exist — but it is not free. The cooldown is per-UID, so raising it to sixty seconds means a
party's own pole is ignored at that plinth for a minute. That is fine when the clip is a
minute long and irritating when it is not, which is why the two numbers have to move
together rather than one being set optimistically.

**Decide the maximum clip length before the recording session, then set the constant to
match.** Discovering it afterwards means either re-cutting audio or shipping a park where
holding a pole steady replays the story.

---

## 5. Generating the clip map and the manifests

```sh
node firmware/tools/gen-clip-map.mjs
```

Reads `EPISODE_STATIONS` from `questland/src/content/stations.ts`. Writes two things:

**`station/station_clips.h`** — compiled into every station. Format:

```c
#define QL_CLIPS_FORMAT 1
#define QL_CLIP_STATION_MAX 23
static const uint16_t QL_CLIP_KEYS[];                    // (folder << 8) | track
static const uint16_t QL_CLIP_INDEX[QL_CLIP_STATION_MAX + 2];
```

One flat key array; the keys for station N occupy the half-open range
`[QL_CLIP_INDEX[N], QL_CLIP_INDEX[N+1])`, ascending, so `clipPresent()` is a binary search
over a run. An empty run is legal and means "this card has ambience and system audio only".

**`sdcard-manifests/st-01.txt` … `st-21.txt`** — the human-facing list. Which files go on
which card, with the episode each one belongs to, so that whoever prepares twenty-one cards
has something to check against that is not a header file.

Both outputs are checked in and the generator is deterministic. **Re-running it on an
unchanged repository must produce byte-identical files.** If `git status` comes back dirty
after a run, the rotations changed and the cards in the park are now wrong — regenerate,
re-cut the affected cards, and reflash the affected stations, because the compiled clip map
and the card have to agree.

### Why the station carries a clip map at all

A DFPlayer told to play a track that is not on the card **does not reliably do nothing**.
Depending on module revision it plays the numerically next file in the folder, replays the
previous file, or reports an error several hundred milliseconds later — by which time a
guest standing at a plinth they were never routed to has already heard the opening of
somebody else's episode.

Silence for an off-rotation tap is a decision. The clip map is how that decision is
*enforced* rather than hoped for.

This is also why hand-adding a file to a card does nothing useful: the station asks its
compiled map first, the map says no, and the file is never requested.

---

## 6. There is no fallback clip

**A station that cannot resolve a tapped flag plays nothing.** It stays on its ambience
loop, asks the hub for the table, and keeps asking until it holds a current one. A wrong
story is worse than a pause.

This is a user mandate, and it shapes the audio design:

- There is **no `TRK_FALLBACK`** slot and no folder for one.
- There is **no "please wait" hold clip**. That was proposed and rejected. Ambience simply
  continues, which is the station's normal idle state — a guest hears no change at all,
  because nothing has gone wrong from where they are standing.
- The unknown-tag path is a **blocking retry loop**, not a degrade. The tap goes to the hub
  with `RES=U` so the console shows the station unresolved and staff can act.

### The complete decision table

| Situation | Plays |
|---|---|
| Resolved, `STATE` assigned, clip present on this card | The clip: folder = order, track = episode |
| Resolved, `STATE` sealed or returned | `08/005` RETURN TO THE BOOTH |
| Resolved, but the pole is racked with no binding | Nothing |
| Resolved, off-rotation — no recording on this card | Nothing |
| **Not resolved** | **Nothing.** Ambience continues; the station resyncs |
| DFPlayer reports a file error after a speech command | `08/004` OUT OF SERVICE |

### The two announcements are not exceptions

Somebody will eventually point at `08/005` and argue the mandate is already broken. It is
not, and the distinction is worth keeping straight:

**RETURN** is played for a pole that resolved *perfectly*. The table answered, the state
said sealed, and the correct thing to tell that guest is "you are finished, go back to the
booth". The clip carries no story, names no order and guesses at nothing. The mandate is
about a tag the station **cannot resolve**; this one resolved.

`STATE` riding on the wire is what makes this possible at all. Without it, a Hero party who
sealed rg-01 an hour ago walks past a plinth and hears rg-01's clips again — the pole is
still bound, the table still resolves, and the station has no way to know the episode is
behind them.

**OUT OF SERVICE** is a machine telling a guest it is broken, which is a different act from
a machine guessing at a story. It is reachable only when the card is present and a specific
file on it failed; if the card itself were missing, nothing on it could play, which is
precisely what the heartbeat's SD bit is for.

---

## 7. Preparing twenty-one cards

1. `node firmware/tools/gen-clip-map.mjs`, and confirm `git status` is clean.
2. Format each card FAT32, explicitly.
3. Create `01`, `02`, `03`, `08`, `09` as needed — only the folders that station actually
   uses, though empty folders are harmless.
4. Copy the files listed in `sdcard-manifests/st-NN.txt`, renamed to their three-digit
   numbers.
5. Clean the card of resource forks and index files.
6. Label the card physically with the station number. **A card in the wrong plinth is the
   same class of fault as a board flashed with the wrong number**: everything works, the
   audio is confidently wrong, and it surfaces days later as a guest complaint rather than
   an alarm.
7. Fit it, boot the board, and check `s` on the service channel reports `sd=1 df=1`.
8. Tap a pole bound to an episode that routes through that station and confirm the right
   clip. Tap one bound to an episode that does not, and confirm **silence**.

Step 8 is the only test that proves the card, the clip map and the firmware agree. Do it on
every card, on the bench, before the soak.
