# Plan — the Manager's View

A phone surface for the park owner to look in on Whispering Woods from off-site.
Handoff spec: self-contained, assumes no prior conversation.

Read `CLAUDE.md` first — its **Gotchas & failure contracts** section is binding and several
entries below will bite this feature specifically. Read `design-system/readme.md` before any
UI work.

---

## What this is

The owner's words: *"we should plan for a mobile app so I can check in even if I am not at
the park."*

Three questions, asked one-handed, usually while not at the park:

1. **Has anyone called for help?**
2. **Is the park busy, and where is everyone?**
3. **Is anything broken?**

That is the whole product. It is a **read-only** surface for a manager, not a second Back
Office.

## What this is NOT

- **Not a booth.** No flag binding, no enrolment, no passage spending, no walk-up creation.
  Those need a counter, a guest standing in front of you, and a full-size screen. The
  existing console keeps them.
- **Not a responsive reflow of `console.html`.** That console stays targeted at ~1440 on a
  monitor in the park. A separate narrow surface exists precisely so the dense booth controls
  are *absent* rather than shrunk — a mis-tap on a phone must not be able to rebind a pole.
- **Not an SOS response tool.** See *Accepted risks* — acknowledging a call from off-site is
  deliberately excluded, and the reason matters.

---

## THE BLOCKER — read this before designing anything

**Station health never leaves the booth PC.** `services/stationHealthService.ts:16` states it
plainly (*"LOCAL ONLY, never synced. The hub is a cable into one PC"*), the mirror is
`ql:stationHealth`, and `grep stationHealth questland/src/services/cloudSync.ts` returns
**zero** hits.

So question 3 — *is anything broken* — **cannot be answered off-site at all today.** Every
station condition the console draws is computed from LoRa heartbeats that arrive over a USB
cable into one browser tab and stop there.

Questions 1 and 2 are already answerable: `sos`, `presence`, `parties` and `guests` are all
synced collections with staff read access.

**This feature is therefore mostly a sync problem, not a UI problem.** Budget accordingly.

### The fix: `parkStatus/current`

One rolled-up document, not 23 per-station documents.

```ts
/** The park's operational pulse, as the console holding the hub sees it. ONE doc. */
export interface ParkStatus {
  id: 'current'
  /** When the booth console last wrote this. The manager view lives or dies on it. */
  writtenAt: number
  /** Staff uid of the console that wrote it — so two consoles can be told apart. */
  writtenBy: string
  /** The park's current flag-table version, for context on `stale`. */
  tableVersion: number
  counts: Record<StationCondition, number>
  /** ONLY the stations that are not `live`. Empty array means a well park. */
  exceptions: ParkStationStatus[]
}

export interface ParkStationStatus {
  stationNo: number
  placeId: string
  name: string
  condition: StationCondition   // 'live' | 'stale' | 'fault' | 'silent' | 'unknown'
  lastHeartbeatAt: number
  lastError?: string
}
```

**Why counts-plus-exceptions and not all 23 rows.** The question is "is anything broken", not
"show me telemetry". A well park writes a near-empty document; a sick one writes only what
needs a person. It also keeps the doc small enough that write cadence never becomes a cost
conversation. If a future full board on mobile is wanted, that is a deliberate second step.

**Who writes it.** Only a console tab whose hub transport is `live`. That gate is free and
correct: station health *comes from* hub heartbeats, so a console without the hub has nothing
to report and must not overwrite the readings of the console that does. Do not invent a
leader election — the hub is one USB cable into one PC.

**Cadence.** Write on any station's condition CHANGE, debounced ~10 s, **plus** an
unconditional heartbeat write every 5 minutes. The heartbeat is not redundant: `writtenAt` is
the only evidence the booth console is still open, and a change-only writer is indistinguishable
from a closed tab. ~288 baseline writes/day. Do **not** write per LoRa heartbeat — 23 stations
on a 120 s frame is ~16.5k writes/day for information nobody reads at that resolution. This is
the same lesson as `tableAt` vs `updatedAt` in `CLAUDE.md`: do not create a hot document.

**Rules delta** (append to `firestore.rules`; the file is at repo root, NOT inside `questland/`):

```
// The park's operational pulse: which plinths are down, written by the ONE console
// holding the hub on USB and read by a manager who is not in the park. Staff both
// ways. This is the state of the machinery, not park record — a guest has no
// business reading which stations are unattended, and a guest who could WRITE it
// could hide a dead plinth from the person whose job is to fix it.
match /parkStatus/{id} {
  allow read:  if isStaff();
  allow write: if isStaff();
}
```

### The freshness rule — the most important line in this document

The manager view **must never render station data as current when the booth console has
stopped reporting.** If `now - writtenAt` exceeds two heartbeat windows (~12 min), the
stations section shows **"The booth console is not reporting"** with the last-seen time, and
**suppresses the counts entirely** rather than showing an aging snapshot.

The failure this prevents: a manager glances at their phone at 9pm, sees *"23 live"*, and goes
to bed — from a console that was closed at 5. A surface that quietly ages into a lie is worse
than no surface, because staff stop trusting it and then stop looking. This is the same
discipline the existing board already applies with its `silent` condition, extended one hop
further up the chain.

---

## Architecture

**A third Vite entry**, mirroring how the console was added.

| New file | Role |
|---|---|
| `questland/manager.html` | entry document |
| `questland/src/manager-main.tsx` | standalone mount, no react-router |
| `questland/src/screens/manager/ManagerScreen.tsx` | the one screen |
| `questland/src/screens/manager/CallsCard.tsx` | SOS |
| `questland/src/screens/manager/PulseCard.tsx` | who is in the park |
| `questland/src/screens/manager/PlinthsCard.tsx` | station exceptions + freshness |
| `questland/src/screens/manager/manager.css` | layout only |
| `questland/src/services/parkStatusService.ts` | write side (booth) + read side (manager) |

**Modified:** `questland/vite.config.ts` (third `rollupOptions.input`, plus the manifest strip
below) · `questland/src/services/cloudSync.ts` (a narrow `startManagerSync`, and the
`parkStatus` writer hooked to the console's health updates) · `firestore.rules`.

**Reused as-is, do not fork:** `screens/console/StaffGate.tsx`, `services/consoleService.ts`,
`services/stationHealthService.ts` (`conditionOf` is the single source of condition truth —
the manager view must not re-derive conditions from raw fields), and the DS components in
`src/ui`.

### Gotchas that will bite this specifically

Restated from `CLAUDE.md` because they are non-obvious and each one has already cost a day:

- **VitePWA injects the guest manifest into EVERY html entry**, after every
  `transformIndexHtml` handler *and* after `generateBundle`. `vite.config.ts` already strips
  the duplicate from `console.html` in `closeBundle` — **extend that to `manager.html`, do not
  copy the mechanism.** Verify: `dist/manager.html` carries exactly one `rel="manifest"`.
- **A standalone entry must supply its own `ToastProvider`.** The console shipped a crash here:
  a child called `useToast()`, which throws without a provider, and the signed-out gate
  returned first and hid it. **Test the SIGNED-IN manager view**, not the gate.
- **`position: fixed` and transforms.** Never put `transform`/`filter`/`will-change` on a
  wrapper containing fixed descendants — it becomes their containing block, permanently with
  `fill: both`. Rises use `top: 10px → 0`, never `translateY`.
- **An animated `opacity` with `fill: both` creates a permanent stacking context**, which is
  how the console's fixed bars ended up painted under page content. Any fixed header here
  needs `position: relative; z-index: 50` on its wrapper.
- **`Dialog` bodies cap at `52dvh` and scroll.** On a phone this matters more, not less.
- **No emoji anywhere.** Lucide via `Icon` only. Brand marks are raster assets.

### PWA / installability

The owner wants to open this one-handed, so `manager.html` should be **installable in its own
right** — its own manifest (`name: "Questland — Manager"`, `display: "standalone"`, its own
icon set), not the guest manifest and not the absence of one. This is the point of a separate
entry rather than a console breakpoint. Confirm `dist/sw.js` precache stays under the 4 MB
ceiling; `globIgnores` already keeps the PNG masters out.

---

## The screen

One scrolling column, 390px design width. Sections in this order, because the order *is* the
triage:

**1. Calls for help.** Open `sos` rows only. Guest name, kind, zone, how long ago, message.
When there are none: a single quiet line, not an empty card with a heading. When there is one,
it is the first thing on the screen and it is unmissable — ember, which the DS reserves for
live/now states, and this is the most now thing in the park.

**2. The park right now.** Parties in the park and total heads, split three ways using the
existing helpers rather than new logic: `inVillage()`, `occupantsByPlace()`,
`enRoute()`. A manager wants "4 parties, 14 people, 2 at stations, 1 on the paths, 1 in the
village" — concrete numbers, per the DS voice guide. Party rows name the questline with the
existing track colours.

**3. The plinths.** The freshness line first (see the rule above), then counts, then one row
per exception with what is wrong and since when. A well park is one line: *"All 23 reporting,
holding the current table."*

**Voice:** staff copy, not guest copy. Plain and precise — *"A Warden reading this at 11pm
needs the fact, not the costume."* Naming canon still applies (Station, Questline, Party,
Guide/Warden), but no ceremony.

---

## Verification

- **Rules:** extend the existing REST matrix. `parkStatus` — staff read **allow**, staff write
  **allow**, guest read **deny**, guest write **deny**, unauthenticated **deny**.
  **404 is an ALLOW** when reading that matrix (403 = refused, 5xx = no verdict, retry) — a
  harness that treats "not 200" as denied reports false failures. Run it before publishing, and
  print the ENTIRE ruleset in chat for the paste, after `git fetch origin main` and a merge.
- **Freshness:** stop writing `parkStatus`, advance the clock past 12 minutes, and assert the
  stations section flips to *not reporting* and the counts disappear. **This is the test that
  matters most.**
- **Two consoles:** open a second console without the hub and assert it never writes
  `parkStatus`.
- **Signed-in render:** drive the signed-in manager view headless at 390px and assert
  `document.scrollingElement.scrollWidth <= clientWidth` — the body must never scroll
  horizontally. Harness pattern is in `CLAUDE.md` (global playwright, chromium at
  `/opt/pw-browsers/`, `waitUntil: 'domcontentloaded'` because Vite's HMR socket means
  `networkidle` never fires).
- **Build:** `npm run build` clean; `dist/manager.html` has exactly one manifest link.
- **Emoji audit** over every new string.

**Not verifiable in this sandbox** (say so, do not claim otherwise): the Firestore SDK
round-trip — headless Chromium gets `ERR_CONNECTION_RESET` through the agent proxy, which is
why the rules suites run over node's fetch against the REST API. Cross-device behaviour needs
a check on real hardware.

---

## Accepted risks and deliberate exclusions

1. **No SOS acknowledgement from this surface.** A manager tapping *acknowledge* from their
   sofa marks a call handled for everyone in the park, including staff who are closer and now
   believe someone is walking. If SOS response ever lands here it needs to say *who* is
   responding and *where they are*, which is a different feature. Read-only is the safe v1.
2. **`parkStatus` is only as honest as the booth tab.** Mitigated by the freshness rule, not
   solved. A hub relay that survives a closed tab is a server, and this project deliberately
   has none.
3. **Staff can read and write `parkStatus`.** Same posture as every other staff clause: the
   roster is hand-provisioned and `staff/{uid}` is `allow write: if false`, so there is no
   self-promotion path.
4. **`startManagerSync` must be narrower than `startConsoleSync`.** The console subscribes to a
   2000-row `legs` window, the full `guests` directory and `scheduled`. On cellular that is
   wasteful for a surface that needs `sos`, `presence`, `parties`, `parkStatus` and enough of
   `guests` to put names to ids. Start narrow; widen only with a reason.

---

## Questions for the owner before building

1. **Does the manager view need today's arrivals / bookings?** "Check in" is ambiguous — it may
   mean *is the park busy right now* (covered above) or *how did today sell* (not covered, and
   a different data shape).
2. **Should it be able to send a broadcast?** `SendWord` exists and works. Sending word to every
   guest in the park from a phone is either exactly what an owner wants at 4pm when a storm
   comes in, or exactly what should require sitting down at the console. Ask.
3. **One manager or several?** Everything above assumes any staff account may open it. If the
   view should be owner-only, that is a `role` check — and note the rules currently ignore
   `role` entirely, so it would be the first thing to read it.
