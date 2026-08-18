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
**Citizen of Questia membership** — proven against Firestore
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

## 6. Cost expectations

- **Storage**: 150 MB ≈ cents/month.
- **Egress**: ~4 MB per track-play (the app caches 3 object URLs in memory
  and prefetches one track ahead, so replays within a session are free).
- **Firestore**: 1 document read per rules evaluation (the `guests/{uid}`
  `get`), only on a cache-miss fetch of a track.

At pitch scale — a handful of demo devices — all of this sits inside the free
tier. At park scale it is dominated by egress: 500 guests × 10 tracks/day is
~20 GB/day, worth revisiting (CDN, longer client caching) before opening day.

## 7. What this protects — and what it cannot

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

## 8. Regenerating the placeholders

```
npm run radio:demo      # from questland/ — scripts/gen-demo-tracks.mjs
```

Writes the four seamless loops into `public/assets/audio/`. They are tracked
in git (they replace the old spike's `radio-spike.wav`), and
`vite.config.ts`'s `globIgnores` keeps `assets/audio/` out of the service
worker's 4 MB precache.
