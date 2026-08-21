# Questland Radio — getting the real songs into the vault

How the radio's audio moves from a finished mix to a guest's lock screen. The
app side is done; this is the operator's half.

## 1. What ships where

- **Placeholder loops** (`questland/public/assets/audio/demo-*.wav`) are
  bundled with the app and served as plain public files. That is fine — they
  are generated filler, there is nothing to protect, and they keep the radio
  demonstrable with no cloud at all.
- **Real songs** go in the project's Cloud Storage bucket
  (`qa-mobile-36a9c.firebasestorage.app`, from
  `questland/src/services/firebaseConfig.ts`), under the `radio/` prefix —
  **never in the repo**. They are licensed material behind an entitlement, and
  a file in the repo (or in `public/`) is a file anyone can fetch.

## 2. Encoding

~128 kbps AAC in an `.m4a` container — the sweet spot for music on phone
speakers and universally decodable (Safari included):

```
ffmpeg -i in.wav -c:a aac -b:a 128k radio/NN-slug.m4a
```

Name files `NN-slug.m4a` (`01-under-the-boughs.m4a`) so the bucket lists in
track order. Budget: ~1 MB per minute, so a 3–4 minute song is ~4 MB and a
full season of ~40 songs lands around **150 MB total**.

## 3. Upload

Firebase console → **Storage** → the bucket above → create/open the `radio/`
folder → upload. Or from a shell:

```
gsutil cp radio/*.m4a gs://qa-mobile-36a9c.firebasestorage.app/radio/
```

Ignore the "download token" the console shows per file — the app never uses
tokened URLs. The rules are the gate (see step 5), nothing else.

### 3a. CORS on the bucket — REQUIRED, and silent when missing

**`getBlob()` is an XHR, so the bucket must allow this origin by CORS. A
Firebase Storage bucket ships with NO CORS configuration, so a brand-new
bucket refuses every browser read and the songs simply never play.** Nothing
in the Firebase console hints at this, the rules are not involved, and the
failure does not look like a permissions problem: the browser blocks the
request before any Firebase error can be formed, so the SDK reports
`storage/unknown` or `storage/retry-limit-exceeded` — which reads as "check
your connection" and sends you hunting through auth and rules instead.

This is the price of the `getBlob` design. `getDownloadURL` needs no CORS,
but minting a public shareable URL for every song is exactly what this
feature refuses to do, so the CORS step stands.

Apply `storage-cors.json` (repo root) ONCE per bucket:

```
gcloud storage buckets update gs://qa-mobile-36a9c.firebasestorage.app \
  --cors-file=storage-cors.json
```

or with the older tool:

```
gsutil cors set storage-cors.json gs://qa-mobile-36a9c.firebasestorage.app
```

Neither the Firebase CLI nor the Firebase console can set CORS — it is a
Cloud Storage property. With nothing installed locally, **Google Cloud Shell**
(console.cloud.google.com, the `>_` icon) has `gcloud` and `gsutil` ready and
runs in the browser.

Read it back to confirm:

```
gcloud storage buckets describe gs://qa-mobile-36a9c.firebasestorage.app \
  --format="default(cors_config)"
```

**Every origin the app is served from needs a line in that file** — the Pages
origin ships in it, and a custom domain later means editing it and re-applying.

## 3b. THE AUTOMATED WORKFLOW — drop a song, it appears

Everything below steps 3a and 5 is the ONE-TIME setup. Once it is done, adding
a song is this and nothing else:

**Drop the file into `inbox/<shelf>/` in the Firebase console. That is the
whole workflow.** No encode, no upload, no code change, no deploy.

| Drop it in | It lands on |
| --- | --- |
| `inbox/valor/` (or `rangers/`) | Songs of Valor + the full shelf |
| `inbox/wilds/` (or `alehiim/`, `hearers/`) | Airs of the Wilds + the full shelf |
| `inbox/lore/` (or `realm/`) | Hymns of Lore + the full shelf |
| `inbox/kingdom/` | the full shelf only, deliberately |
| `inbox/` root, or any other folder | the full shelf, flagged `unsorted` |

**Folder is the playlist. Filename is the title.** `Aldric's Way.mp3` becomes
"Aldric's Way" — the filename is used verbatim, apostrophes and all, and only
slugified for the object path. Nothing re-derives a title from a slug, which is
what turned "Aldric's Way" into "Aldric S Way" when the first 43 were done in
bulk. Name the file exactly as the song should read.

`onRadioDrop` (`functions/src/radioIngest.ts`) then: encodes two-pass to the
same loudness as every existing song, writes `radio/<slug>.m4a`, registers
`radioTracks/<trackId>`, and moves the source to `inbox/_done/`. The app is
listening, so the song appears for members within seconds — no app restart.

### What it refuses, and where to look

Every drop writes a `radioIngestLog` entry (Firebase console → Firestore). The
`outcome` field is the whole story: `added`, `replaced`, `duplicate`, `skipped`,
`failed`.

- **`duplicate`** — byte-identical to a song already in the catalogue. Filed to
  `inbox/_done/duplicate/`, not encoded. This is the check the original 43
  needed and did not have.
- **`skipped`** — not audio, over 500 MB, over 30 minutes, or a filename with
  no usable characters.
- **`failed`** — the encode broke. **The source is deliberately LEFT IN THE
  INBOX.** It is the only copy the pipeline holds, and a song swept into
  `_done/` after a failed encode is a song nobody knows is missing.

### Two things it does not do

- **Deleting.** Removing a song means deleting its `radioTracks` document and
  its `radio/` object by hand. There is no delete trigger on purpose: a rule
  that removed songs automatically is one bad drop away from removing the wrong
  one.
- **Cleaning up after a rename.** Re-dropping a song under a different filename
  writes a NEW object and a NEW document; the old pair is orphaned, not
  replaced. Re-drop under the SAME filename to overwrite in place.

### Editing after the fact

Titles, `playlistIds` and `sortIndex` can be edited straight in the Firestore
console and the app follows within seconds. A re-drop uses `merge`, so a
hand-corrected title survives a remaster of the same file.

### One-time setup: deploying the pipeline

Nothing below is ever needed again. From **Google Cloud Shell**
(console.cloud.google.com, the `>_` icon) — it has node, git and gcloud ready,
so there is nothing to install on a laptop:

```
git clone https://github.com/N0b136/qa-mobile.git
cd qa-mobile/functions && npm install
npx firebase-tools login --no-localhost
npx firebase-tools deploy --only functions,firestore:rules,storage --project qa-mobile-36a9c
```

That one deploy ships the ingest function AND both rulesets, which is why the
rules never need pasting into a console — a partial paste cannot happen if
nobody is pasting.

**It is `storage`, not `storage:rules`.** Firestore has `rules` and `indexes`
sub-targets so `firestore:rules` is real, but the part after `storage:` means a
deploy TARGET — a named bucket alias from `firebase target:apply` — and this
project has none. `--only storage:rules` sends the CLI hunting for a target
called "rules" and it fails with "Could not find rules for the following storage
targets: rules". The symmetry is a trap; the two products do not parse `--only`
the same way.

**If the deploy complains the trigger region does not match the bucket**, set
`region` in the `onObjectFinalized` options in `functions/src/radioIngest.ts`
to the bucket's location (Firebase console → Storage, shown beside the bucket
name), then deploy again.

### Seeding the original 43 — done once, on 2026-08-21

The catalogue was seeded by a one-shot `seedRadioCatalogue` HTTP function that
wrote the 43 songs predating the pipeline, with the curated titles and shelves.
**That function has been removed and is no longer deployed**, which is why the
steps below are history rather than instructions.

It refused to run against a non-empty collection, so it could not double-write.
That guard was the only thing making an open endpoint acceptable, and it is a
thin one: an unauthenticated endpoint that writes Firestore has no business
outliving its single job, so it did not.

`functions/src/radioSeed.json` is deliberately KEPT even though nothing imports
it. It is the recovery copy of the original 43 — the hand-fixed apostrophes and
the shelf assignments — and re-deriving it from filenames would undo that work.
If `radioTracks` ever has to be rebuilt from scratch, restore the seeder from
git history (`git log -- functions/src/radioIngest.ts`), deploy it, call it
once, and remove it again.

Last, create the inbox folders in the Firebase console under Storage:
`inbox/valor/`, `inbox/wilds/`, `inbox/lore/`, `inbox/kingdom/`.

### Proving it locally

`cd functions && npm run radio:test` runs the encode core against real ffmpeg
with no project, no bucket and no deploy: the naming rules, the loop guard, the
shelf mapping, and a genuine two-pass encode checked for codec, sample rate,
channels and duration. The guard is in there because its failure mode is a
runaway bill rather than a bad song.

## 4. Wire up — only for a song added by hand

**The automated path (3b) needs none of this.** It writes the catalogue itself.

The catalogue lives in Firestore `radioTracks`, one document per song. What
ships in `questland/src/content/soundtrack.ts` is the FALLBACK, consulted only
when the live catalogue is empty — the un-seeded state, a refused read, or a
first run with no network. The moment Firestore returns one track, it wins.

PLAYLISTS stay in code: their names, blurbs, order colours and art are design
decisions, and there are four. Membership rides on each track's `playlistIds`.

**No other code changes are needed for a new song**: `radioService` resolves a
`storage` source by fetching bytes over the SDK (`getBlob`) on the signed-in
user's own token and playing them from an object URL. `getDownloadURL` is
never called anywhere in the app, so no shareable URL ever exists.

## 5. Deploy the rules

`storage.rules` (repo root, wired in `firebase.json`) closes the whole bucket
and opens `radio/` reads only to a real signed-in account that holds a
**Citizen of the Kingdom membership** — proven against Firestore
(`guests/{uid}.member == true`, the stamp the booking sync derives from a
confirmed membership booking). A day, group or birthday passage does NOT
entitle, and neither does a spent/covered pass.

```
firebase deploy --only storage
```

First deploy only: Storage rules that read Firestore need a one-time
cross-service permission grant; the CLI (or console) prompts for it — accept.

Smoke test after deploying:

- Signed-in account **with** a confirmed membership booking → tracks play.
- An account holding only a day/group/birthday booking → locked copy, and a
  direct REST fetch of an object gets 403.
- Signed out, or an account with no booking at all → same: locked copy, 403.

## 6. "Keep on this device" — offline downloads

A member can keep a whole playlist for the road. What that means concretely:

**Where the bytes live.** IndexedDB on the guest's own device — database
`ql-radio`, one store holding a Blob per track id and a second holding one
metadata record each (`storagePath`, `bytes`, `contentType`, `savedAt`,
`schemaVersion`). Blob and record are written in a SINGLE transaction across
both stores, so a failed download can never leave half a song behind.

**Never the service worker.** Audio does not enter Cache Storage, a precache
manifest, or either worker. The park's two-worker arrangement (workbox at the
root, the push worker under `fcm/`) and the 4 MB precache ceiling are
untouched; `vite.config.ts`'s `globIgnores` still keeps `assets/audio/` out.

**Playback resolution order** (`radioService`): this session's object-URL memo
→ IndexedDB → the cloud, with one shared in-flight fetch per object path. So a
kept song plays with the radio off and is never pulled twice, and a download
already running for a song the guest just tapped is ridden rather than
duplicated (and vice versa).

**Downloads are a LEASE, not a promise.** `navigator.storage.persist()` is
requested once, best-effort, the first time a member keeps a playlist — it
makes eviction less likely and guarantees nothing. A browser may reclaim the
space at any time, so the UI reads real per-track presence from IndexedDB
rather than trusting a remembered answer: an evicted song simply shows as not
kept and is fetched again on the next play, or re-queued the next time the
Radio screen opens. Nothing in the copy claims permanence.

**Progress is counted in songs, not bytes.** The Storage SDK's `getBlob` gives
no byte-level progress, so the UI reports "N of M songs" plus the number
currently coming down. A percentage bar would be invented, so there is not one.

**Cancellation is at the queue, not on the wire.** `getBlob` takes no abort
signal, and the only cancellable alternative would need a public download URL,
which this app never mints. "Stop keeping" therefore empties the queue at once
and DISCARDS whatever lands afterwards — nothing is written and the member
sees the state they asked for immediately, while at most one song's bytes may
still finish arriving in the background.

**Bundled tracks are not downloadable.** The placeholder loops ship inside the
app, so the UI shows them as "always with you" — no progress, no delete. Only
`{ kind: 'storage' }` tracks can be kept, which is what real songs will be.

**Egress math.** Streamed, a track costs ~4 MB of egress *per play*. Kept, it
costs ~4 MB *once* and every later play is free — so a member who listens to a
40-song season five times over a month goes from ~800 MB to ~160 MB. The
saving is a side effect; the point is music in the car with no signal.

**A lapsed membership keeps its cached songs until the app syncs.** The
Storage rules gate the FETCH, not the bytes already on the device: a member
whose membership ends can still play what they kept until those downloads are
removed. Accepted deliberately — it is the same trust level as the
client-minted booking model in §8, and the alternative (re-checking
entitlement on every local play) would break exactly the offline case the
feature exists for.

## 7. Cost expectations

- **Storage**: 150 MB ≈ cents/month.
- **Egress**: ~4 MB per track-play (the app caches 3 object URLs in memory
  and prefetches one track ahead, so replays within a session are free).
- **Firestore**: 1 document read per rules evaluation (the `guests/{uid}`
  `get`), only on a cache-miss fetch of a track.

At pitch scale — a handful of demo devices — all of this sits inside the free
tier. At park scale it is dominated by egress: 500 guests × 10 tracks/day is
~20 GB/day, worth revisiting (CDN, longer client caching) before opening day.

## 8. What this protects — and what it cannot

This is **access control, not DRM**. An entitled, signed-in guest can open
devtools and extract the bytes their own browser fetched — nothing prevents
that, and nothing reasonably can. What IS prevented:

- public or shareable URLs (no tokens, no `getDownloadURL`),
- anonymous access of any kind,
- accounts without a membership reading a single byte.

Honest caveat: under the current `firestore.rules`, `guests/{uid}` is
self-writable, so a determined user could stamp their own `member: true` via
REST. That is exactly as strong as the app's client-minted booking model
itself — the membership booking that grants entitlement is also
client-written. Tightening both is a production task, not a radio task.

## 9. Regenerating the placeholders

```
npm run radio:demo      # from questland/ — scripts/gen-demo-tracks.mjs
```

Writes the four seamless loops into `public/assets/audio/`. They are tracked
in git (they replace the old spike's `radio-spike.wav`), and
`vite.config.ts`'s `globIgnores` keeps `assets/audio/` out of the service
worker's 4 MB precache.
