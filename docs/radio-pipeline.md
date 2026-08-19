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

## 4. Wire up

Edit **only** `questland/src/content/soundtrack.ts`: flip each track's source
from the bundled asset to its Storage object path —

```ts
source: { kind: 'storage', path: 'radio/01-under-the-boughs.m4a' },
```

— and fix `duration` to the real length. Add/extend tracks and playlists in
the same file. **No other code changes**: `radioService` resolves a
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
