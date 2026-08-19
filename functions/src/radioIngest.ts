/**
 * Questland Radio — the ingest pipeline.
 *
 * Drop a song into the bucket's `inbox/<shelf>/` and this encodes it, files it
 * under `radio/`, and registers it in `radioTracks` so every member's app picks
 * it up live. No deploy, no local tooling, no hand-edited catalogue.
 *
 * FOLDER IS THE PLAYLIST, FILENAME IS THE TITLE. `inbox/valor/Aldric's Way.mp3`
 * becomes "Aldric's Way" on Songs of Valor. The filename is used verbatim for
 * the title — apostrophes and all — and only slugified for the object path,
 * which is why nothing here re-derives a title from a slug. That round trip is
 * what turned "Aldric's Way" into "Aldric S Way" when the 43 were done in bulk.
 *
 * THE LOOP GUARD IS LOAD-BEARING. This triggers on object writes to the bucket
 * it also WRITES to. Without the inbox/ prefix check, every encode would fire
 * another encode, and a runaway would be discovered on a bill rather than in a
 * log. Both the source move and the encoded output land outside inbox/, so the
 * guard is the only thing standing between here and that.
 *
 * Runs under the Admin SDK, which bypasses both rulesets — so `radioTracks` can
 * stay `allow write: if false` for every client while this writes it freely.
 */

import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { onObjectFinalized } from 'firebase-functions/v2/storage'
import { onRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

import {
  DONE,
  encode,
  measure,
  probeDuration,
  routeDrop,
  sha256,
} from './radioEncode'
import seed from './radioSeed.json'

// ── Caps. Every one of these exists so a bad drop fails fast and cheap ───────

/** 500 MB. A lossless master of a long piece fits; a video does not. */
const MAX_SOURCE_BYTES = 500 * 1024 * 1024
/** 30 minutes. Past this, a two-pass encode starts flirting with the timeout. */
const MAX_DURATION_SECONDS = 30 * 60

// Lazy: index.ts calls initializeApp(), and a module-scope getFirestore() here
// would run at import time — before that call — and throw.
const db = () => getFirestore()
const bucket = () => getStorage().bucket()

type Outcome = 'added' | 'replaced' | 'duplicate' | 'skipped' | 'failed'

async function note(
  outcome: Outcome,
  source: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await db().collection('radioIngestLog').add({
      outcome,
      source,
      at: FieldValue.serverTimestamp(),
      ...detail,
    })
  } catch (err) {
    // The log is a courtesy; failing to write it must never fail the ingest.
    logger.warn('radio ingest: could not write log entry', err)
  }
}

// ── The trigger ──────────────────────────────────────────────────────────────
//
// If deploy complains the trigger region does not match the bucket, set
// `region` here to the bucket's location (Firebase console → Storage → Files,
// the location is shown beside the bucket name).

export const onRadioDrop = onObjectFinalized(
  { memory: '2GiB', timeoutSeconds: 540, cpu: 2, retry: false },
  async (event) => {
    const name = event.data.name

    // THE LOOP GUARD lives in routeDrop — see radioEncode.ts. Everything this
    // function writes lands outside inbox/, and _done/ is where its own source
    // moves go; both are refused there before any byte is read.
    const plan = routeDrop(name)
    if (!plan.take) {
      if (plan.quiet) return
      logger.info(`radio ingest: skipping ${name} — ${plan.reason}`)
      await note('skipped', name, { reason: plan.reason })
      return
    }
    const { fileName, ext, title, trackId, outPath, playlistIds, unsorted } = plan

    const size = Number(event.data.size ?? 0)
    if (size > MAX_SOURCE_BYTES) {
      await note('skipped', name, { reason: `source is ${size} bytes, over the cap`, size })
      return
    }

    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'radio-'))
    const localIn = path.join(tmp, `in${ext}`)
    const localOut = path.join(tmp, 'out.m4a')

    try {
      await bucket().file(name).download({ destination: localIn })

      const hash = await sha256(localIn)

      // Same bytes already in the catalogue under a DIFFERENT id: the four
      // duplicate pairs in the original 43 are exactly this, and catching it at
      // the door is cheaper than finding it months later on a shuffle.
      const dupe = await db()
        .collection('radioTracks')
        .where('sourceHash', '==', hash)
        .limit(1)
        .get()
      const clash = dupe.docs.find((d) => d.id !== trackId)
      if (clash) {
        logger.warn(`radio ingest: ${name} is byte-identical to ${clash.id}`)
        await note('duplicate', name, { existingTrackId: clash.id, sourceHash: hash })
        await bucket().file(name).move(`${DONE}duplicate/${fileName}`)
        return
      }

      const measured = await measure(localIn)
      await encode(localIn, localOut, measured)

      const duration = await probeDuration(localOut)
      if (duration <= 0) throw new Error('encoded file reports no duration')
      if (duration > MAX_DURATION_SECONDS) {
        await note('skipped', name, { reason: `duration ${duration}s is over the cap`, duration })
        await bucket().file(name).move(`${DONE}rejected/${fileName}`)
        return
      }

      await bucket().upload(localOut, {
        destination: outPath,
        metadata: { contentType: 'audio/mp4', cacheControl: 'private, max-age=3600' },
      })

      const existing = await db().collection('radioTracks').doc(trackId).get()
      const bytes = (await fsp.stat(localOut)).size

      // merge:true so a title or shelf corrected by hand in the console is not
      // undone by re-dropping the same song after a remaster.
      await db().collection('radioTracks').doc(trackId).set(
        {
          title,
          duration,
          path: outPath,
          playlistIds,
          unsorted,
          bytes,
          sourceHash: hash,
          sourceName: fileName,
          updatedAt: FieldValue.serverTimestamp(),
          ...(existing.exists ? {} : { addedAt: FieldValue.serverTimestamp() }),
        },
        { merge: true }
      )

      await bucket().file(name).move(`${DONE}${fileName}`)

      const outcome: Outcome = existing.exists ? 'replaced' : 'added'
      logger.info(`radio ingest: ${outcome} ${trackId} (${duration}s, ${bytes} bytes)`)
      await note(outcome, name, { trackId, title, duration, bytes, playlistIds, unsorted })
    } catch (err) {
      // The source is deliberately LEFT IN THE INBOX on failure. It is the only
      // copy the pipeline has, and a song silently swept into _done/ after a
      // failed encode is a song nobody knows is missing.
      logger.error(`radio ingest: ${name} failed`, err)
      await note('failed', name, { error: err instanceof Error ? err.message : String(err) })
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
    }
  }
)

// ── One-shot seeder ──────────────────────────────────────────────────────────
//
// Writes the 43 songs that predate this pipeline, with the titles and shelf
// assignments as curated — re-deriving them from filenames would undo every
// apostrophe fixed by hand.
//
// It REFUSES once the collection has anything in it, which is what makes an
// open endpoint acceptable here: it can only ever write one known, fixed set of
// documents, exactly once. Delete this export after it has run.

export const seedRadioCatalogue = onRequest(async (req, res) => {
  const existing = await db().collection('radioTracks').limit(1).get()
  if (!existing.empty) {
    res.status(409).send('Catalogue is not empty — refusing to seed. Delete this function.\n')
    return
  }
  const entries = Object.entries(seed as Record<string, {
    title: string
    duration: number
    path: string
    playlistIds: string[]
  }>)
  const batch = db().batch()
  for (const [id, t] of entries) {
    batch.set(db().collection('radioTracks').doc(id), {
      ...t,
      unsorted: t.playlistIds.length === 1,
      addedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
  logger.info(`radio seed: wrote ${entries.length} tracks`)
  res.status(200).send(`Seeded ${entries.length} tracks. Now delete this function.\n`)
})
