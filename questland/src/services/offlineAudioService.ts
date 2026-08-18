// "Keep on this device" — Questland Radio's offline vault.
//
// WHY INDEXEDDB AND NOT THE SERVICE WORKER. The park runs TWO service workers
// in two scopes (workbox at the root, the push worker under fcm/) and a 4 MB
// precache ceiling; a season of songs is ~150 MB. Audio therefore never enters
// a worker, a precache manifest or Cache Storage — it lives in this origin's
// IndexedDB, addressed by track id, and is handed to the player as a Blob.
// That also keeps the owner's "not downloadable" stance true: the bytes are in
// the app's own storage, not loose files a guest can hand around.
//
// THE DOWNLOADS ARE A LEASE, NOT A PROMISE. A browser may reclaim origin
// storage whenever it likes, so this module never trusts its own memory about
// what is kept: presence is re-read from IndexedDB, and a record whose blob has
// gone is dropped and re-fetched on the next play or toggle. Copy in the UI
// must never claim permanence.
//
// IMPORTS ARE LEAF-ONLY (store, firebase, content) — radioService imports THIS
// module, never the other way round. The one thing this module needs to tell
// the player about (bytes it just deleted) travels back through the
// `onRemoved` callback below rather than through an import.

import { load, save } from './store'
import { ensureFirebase, hasRealAuth } from './firebase'
import { PLAYLISTS, getTrack, tracksFor } from '../content/soundtrack'
import type { RadioTrack } from '../content/soundtrack'

// ── IndexedDB ────────────────────────────────────────────────────────────────

const DB_NAME = 'ql-radio'
const DB_VERSION = 1
/** Blob per track id. Kept apart from META so a listing never loads audio. */
const BLOBS = 'blobs'
/** One record per kept track — the listing the UI and the storage row read. */
const META = 'meta'
/** Bumped when the record shape changes; a mismatched row is dropped, not read. */
const SCHEMA_VERSION = 1

export interface KeptTrack {
  trackId: string
  storagePath: string
  bytes: number
  contentType: string
  savedAt: number
  schemaVersion: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

/** Cached open. Resolves null (never throws) where IDB is absent or refused —
 *  private-mode Safari and locked-down browsers both do this, and the radio
 *  must still stream. */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    // EVERY FAILURE PATH CLEARS THE CACHED PROMISE. A connection can die under
    // us — another tab upgrading the database, the browser reclaiming the
    // origin — and a permanently cached dead handle turns every later
    // transaction into a swallowed throw, so downloads fail silently for the
    // rest of the session. Forgetting it means the next call simply reopens.
    const fail = () => {
      dbPromise = null
      resolve(null)
    }
    try {
      if (typeof indexedDB === 'undefined') {
        fail()
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'trackId' })
      }
      req.onsuccess = () => {
        const db = req.result
        db.onclose = () => {
          dbPromise = null
        }
        db.onversionchange = () => {
          // Another tab wants a new schema — step aside rather than block it.
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      req.onerror = fail
      req.onblocked = fail
    } catch {
      fail()
    }
  })
  return dbPromise
}

function readAllMeta(): Promise<KeptTrack[]> {
  return openDb().then(
    (db) =>
      new Promise<KeptTrack[]>((resolve) => {
        if (!db) {
          resolve([])
          return
        }
        try {
          const req = db.transaction(META, 'readonly').objectStore(META).getAll()
          req.onsuccess = () => {
            const rows = (req.result as KeptTrack[]).filter((r) => !!r)
            const current = rows.filter((r) => r.schemaVersion === SCHEMA_VERSION)
            // A row this build cannot read is not merely skipped: skipping it
            // strands its blob forever — invisible to the storage row, and
            // unreachable by "Remove all", because both work off this listing.
            // A schema bump would otherwise orphan every kept song on every
            // device. Sweep them out as they are found.
            const stale = rows.filter((r) => r.schemaVersion !== SCHEMA_VERSION).map((r) => r.trackId)
            if (stale.length > 0) {
              void deleteKept(stale).catch(() => {
                // best-effort sweep — the next read tries again
              })
            }
            resolve(current)
          }
          req.onerror = () => resolve([])
        } catch {
          resolve([])
        }
      })
  )
}

function readBlob(trackId: string): Promise<Blob | null> {
  return openDb().then(
    (db) =>
      new Promise<Blob | null>((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        try {
          const req = db.transaction(BLOBS, 'readonly').objectStore(BLOBS).get(trackId)
          req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
  )
}

/**
 * Blob and metadata in ONE transaction across both stores, resolved on
 * `oncomplete`. That is the whole guard against a half-written record: either
 * both rows land or neither does, and a failure part-way aborts the pair.
 */
/** Why a write failed. 'full' is the one the queue must not grind against. */
export type WriteOutcome = { ok: true } | { ok: false; reason: 'full' | 'refused' }

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('name' in err)) return false
  const name = String((err as { name?: unknown }).name)
  // The standard name, plus the one Firefox has always raised.
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

function writeKept(rec: KeptTrack, blob: Blob): Promise<WriteOutcome> {
  return openDb().then(
    (db) =>
      new Promise<WriteOutcome>((resolve) => {
        if (!db) {
          resolve({ ok: false, reason: 'refused' })
          return
        }
        const done = (err: unknown) =>
          resolve({ ok: false, reason: isQuotaError(err) ? 'full' : 'refused' })
        try {
          const tx = db.transaction([BLOBS, META], 'readwrite')
          tx.objectStore(BLOBS).put(blob, rec.trackId)
          tx.objectStore(META).put(rec)
          tx.oncomplete = () => resolve({ ok: true })
          tx.onerror = () => done(tx.error)
          tx.onabort = () => done(tx.error)
        } catch (err) {
          // A synchronous throw here is usually the quota too.
          done(err)
        }
      })
  )
}

/** Same pairing on the way out — a blob is never left behind by its record. */
function deleteKept(trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) return Promise.resolve()
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        // REJECTS ON FAILURE, deliberately. Resolving alike on complete and on
        // error let `forget` report a removal that never happened: the row
        // vanished from the UI while the blob stayed on the device, beyond the
        // reach of the only listing that could offer to remove it again.
        if (!db) {
          reject(new Error('This device would not open its store.'))
          return
        }
        try {
          const tx = db.transaction([BLOBS, META], 'readwrite')
          const blobs = tx.objectStore(BLOBS)
          const meta = tx.objectStore(META)
          trackIds.forEach((id) => {
            blobs.delete(id)
            meta.delete(id)
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('The removal did not finish.'))
          tx.onabort = () => reject(tx.error ?? new Error('The removal was interrupted.'))
        } catch (err) {
          reject(err)
        }
      })
  )
}

// ── State + subscription (radioService's private-listener-set style) ─────────

export interface OfflineState {
  /** True once IndexedDB has been read at least once this session. */
  ready: boolean
  /** trackId → what is actually on the device right now. */
  kept: Record<string, KeptTrack>
  totalBytes: number
  /** Playlists the member asked to keep — survives reloads. */
  keptPlaylistIds: string[]
  /** Waiting for a slot, in order. */
  queued: string[]
  /** Fetching now (never more than MAX_ACTIVE). */
  active: string[]
  /** trackId → guild-voice reason. Retryable; cleared on a new attempt. */
  failed: Record<string, string>
  /** navigator.storage.persist() answer. null until it has been asked. */
  persisted: boolean | null
  /**
   * The device refused a write for want of space. A latch, not a per-track
   * fact: every further song would fetch its whole body only to hit the same
   * wall, so the queue stops until something is removed.
   */
  storageFull: boolean
}

const EMPTY_STATE: OfflineState = {
  ready: false,
  kept: {},
  totalBytes: 0,
  keptPlaylistIds: [],
  queued: [],
  active: [],
  failed: {},
  persisted: null,
  storageFull: false,
}

const KEPT_PLAYLISTS_KEY = 'ql:radioKept'
const PERSIST_ASKED_KEY = 'ql:radioPersistAsked'
/** Two at a time: enough to keep the pipe busy, few enough to stay polite. */
const MAX_ACTIVE = 2

let state: OfflineState = { ...EMPTY_STATE, keptPlaylistIds: load<string[]>(KEPT_PLAYLISTS_KEY, []) }
const listeners = new Set<() => void>()

export function getState(): OfflineState {
  return state
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** A new object only on a real change — stable for useSyncExternalStore. */
function setState(patch: Partial<OfflineState>): void {
  let changed = false
  for (const k of Object.keys(patch) as Array<keyof OfflineState>) {
    if (state[k] !== patch[k]) {
      changed = true
      break
    }
  }
  if (!changed) return
  state = { ...state, ...patch }
  listeners.forEach((fn) => {
    try {
      fn()
    } catch {
      // a subscriber must never break the fan-out
    }
  })
}

function applyMeta(records: KeptTrack[]): void {
  const kept: Record<string, KeptTrack> = {}
  let totalBytes = 0
  for (const r of records) {
    kept[r.trackId] = r
    totalBytes += r.bytes
  }
  setState({ kept, totalBytes, ready: true })
}

// ── Removal notifications (the one thing the player must hear about) ─────────

const removalListeners = new Set<(storagePaths: string[]) => void>()

/** radioService subscribes at module load so it can revoke object URLs whose
 *  bytes have just been deleted. A callback, not an import — the dependency
 *  runs one way only. */
export function onRemoved(fn: (storagePaths: string[]) => void): () => void {
  removalListeners.add(fn)
  return () => {
    removalListeners.delete(fn)
  }
}

function announceRemoved(paths: string[]): void {
  if (paths.length === 0) return
  removalListeners.forEach((fn) => {
    try {
      fn(paths)
    } catch {
      // best-effort — a stale object URL costs memory, not correctness
    }
  })
}

// ── Content helpers ──────────────────────────────────────────────────────────

/**
 * Only cloud-hosted songs can be kept. The demo loops ship INSIDE the app
 * bundle, so they are already on the device by definition — offering to
 * "download" one would be theatre.
 */
export function isDownloadable(track: RadioTrack): boolean {
  return track.source.kind === 'storage'
}

export function downloadableTracks(playlistId: string): RadioTrack[] {
  return tracksFor(playlistId).filter(isDownloadable)
}

// Every selector below takes the snapshot to read, defaulting to the live one.
// A component rendering from useSyncExternalStore must pass ITS snapshot:
// reading module state mid-render is reading outside the value React is
// rendering, which is exactly the tear the hook exists to prevent.

export function isKept(trackId: string, s: OfflineState = state): boolean {
  return !!s.kept[trackId]
}

export function isBusy(trackId: string, s: OfflineState = state): boolean {
  return s.active.includes(trackId) || s.queued.includes(trackId)
}

export function isPlaylistKept(playlistId: string, s: OfflineState = state): boolean {
  return s.keptPlaylistIds.includes(playlistId)
}

/** "48.2 MB" — sizes a person can read, never raw bytes. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (mb < 1000) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

// ── The shared fetch ─────────────────────────────────────────────────────────
//
// ONE in-flight map for the whole app, keyed on the Storage object path. A
// download that starts while the same song is loading for playback rides the
// player's fetch, and a play that starts mid-download rides the queue's — so a
// track is never pulled over the wire twice, whichever side asked first.

const inflight = new Map<string, Promise<Blob>>()

/** A refusal is a verdict; anything else is the network. Never conflate them. */
function describeError(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return 'Your membership no longer opens the vault.'
  }
  if (code === 'storage/object-not-found') {
    return 'That song is no longer in the vault.'
  }
  // An Error WE raised (signed out, timed out, no store) already says the true
  // thing. Only an unrecognised SDK failure earns the network sentence —
  // otherwise "sign in" reaches the guest as "check your connection".
  if (!code && err instanceof Error && err.message) return err.message
  return 'The song would not come down. Check your connection and try again.'
}

async function fetchFromCloud(path: string): Promise<Blob> {
  const fb = await ensureFirebase()
  if (!fb || !hasRealAuth()) {
    throw new Error('You are signed out. Sign in and the radio comes to life.')
  }
  // Lazy, matching firebase.ts — the storage chunk is only fetched when used.
  const { getStorage, ref, getBlob } = await import('firebase/storage')
  return getBlob(ref(getStorage(fb.auth.app), path))
}

function sharedFetch(path: string): Promise<Blob> {
  const pending = inflight.get(path)
  if (pending) return pending
  const run = fetchFromCloud(path).finally(() => inflight.delete(path))
  inflight.set(path, run)
  return run
}

/**
 * Bytes for a track: what is KEPT on the device first, then whatever is already
 * in flight, then the cloud. A kept song therefore plays with the radio off,
 * and never costs a second fetch.
 *
 * Playback calls this and does NOT keep what it gets — only an explicit
 * "Keep on this device" writes to IndexedDB.
 */
export async function fetchBlob(track: RadioTrack): Promise<Blob> {
  if (track.source.kind !== 'storage') {
    throw new Error('That song is part of the app, not the vault.')
  }
  const { path } = track.source
  const local = await readBlob(track.id)
  if (local) return local
  // A record with no blob behind it means the device reclaimed the space —
  // the lease, expiring. Drop the row so the UI stops claiming it is kept.
  if (state.kept[track.id]) void forget([track.id])
  return sharedFetch(path)
}

// ── Hydration ────────────────────────────────────────────────────────────────

let hydrated: Promise<void> | null = null

/** Reads the real contents of IndexedDB once per session. */
export function ensureReady(): Promise<void> {
  if (hydrated) return hydrated
  hydrated = readAllMeta().then((records) => {
    applyMeta(records)
    reconcile()
  })
  return hydrated
}

/**
 * Re-reads what is actually on the device. Called when the Radio screen opens,
 * because the browser may have reclaimed songs since it was last looked at —
 * the lease made visible.
 */
export async function refresh(): Promise<void> {
  await ensureReady()
  applyMeta(await readAllMeta())
  reconcile()
}

/** Re-queues anything missing from a playlist the member asked to keep. */
function reconcile(): void {
  for (const playlistId of state.keptPlaylistIds) {
    const missing = downloadableTracks(playlistId).filter((t) => !isKept(t.id) && !isBusy(t.id))
    if (missing.length > 0) enqueue(missing.map((t) => t.id))
  }
}

// ── The download queue ───────────────────────────────────────────────────────
//
// CANCELLATION IS AT THE QUEUE, NOT ON THE WIRE. The Storage SDK's getBlob
// takes no abort signal, and the only cancellable alternative would need a
// public download URL, which this app never mints. So a cancel releases the
// slot AT ONCE — the row stops saying "coming down", the next playlist's songs
// start immediately — and whatever the abandoned fetch delivers later is
// discarded. The socket may run to completion behind the scenes; that is at
// most one song's bytes, and it is the honest limit of what can be stopped.
//
// Ownership is tracked by EPOCH rather than by a cancelled-id set: a track can
// be cancelled and asked for again while the first fetch is still out, and the
// stale run must not then write (or double-count) on the new one's behalf.

/** trackId → the epoch of the run that currently owns it. */
const runEpoch = new Map<string, number>()
let epochCounter = 0

/** A song is only allowed to write state while it still owns its track. */
function owns(trackId: string, epoch: number): boolean {
  return runEpoch.get(trackId) === epoch
}

/** Total from the map itself — never an accumulator, which a late or repeated
 *  write could double. */
function sumBytes(kept: Record<string, KeptTrack>): number {
  return Object.values(kept).reduce((n, r) => n + r.bytes, 0)
}

/** Slowest tolerable song. A hung fetch must release its slot, not hold it. */
const DOWNLOAD_TIMEOUT_MS = 120_000

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('That song took too long to come down. Try again.')),
      ms
    )
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function enqueue(trackIds: string[]): void {
  if (state.storageFull) return
  const queued = [...state.queued]
  // Seeded from the queue AS IT IS BUILT, not from the snapshot: a playlist
  // listing the same song twice would otherwise queue — and fetch — it twice.
  const seen = new Set(queued)
  const failed = { ...state.failed }
  let changed = false
  for (const id of trackIds) {
    if (failed[id]) {
      delete failed[id]
      changed = true
    }
    if (isKept(id) || seen.has(id) || state.active.includes(id)) continue
    queued.push(id)
    seen.add(id)
    changed = true
  }
  if (!changed) return
  setState({ queued, failed })
  pump()
}

function pump(): void {
  while (state.active.length < MAX_ACTIVE && state.queued.length > 0) {
    const [nextId, ...rest] = state.queued
    setState({ queued: rest, active: [...state.active, nextId] })
    void run(nextId)
  }
}

/** Releases a track's slot and lets the next one start. */
function release(trackId: string, patch: Partial<OfflineState> = {}): void {
  runEpoch.delete(trackId)
  setState({ active: state.active.filter((id) => id !== trackId), ...patch })
  pump()
}

async function run(trackId: string): Promise<void> {
  const track = getTrack(trackId)
  if (!track || track.source.kind !== 'storage') {
    release(trackId)
    return
  }
  const { path } = track.source
  const epoch = ++epochCounter
  runEpoch.set(trackId, epoch)

  let blob: Blob
  try {
    blob = await withTimeout(sharedFetch(path), DOWNLOAD_TIMEOUT_MS)
  } catch (err) {
    // Cancelled or superseded while it was out: the slot is already gone, and
    // this failure belongs to nobody.
    if (!owns(trackId, epoch)) return
    release(trackId, { failed: { ...state.failed, [trackId]: describeError(err) } })
    return
  }
  if (!owns(trackId, epoch)) return

  const rec: KeptTrack = {
    trackId,
    storagePath: path,
    bytes: blob.size,
    contentType: blob.type || 'audio/mp4',
    savedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  }
  const outcome = await writeKept(rec, blob)

  // A cancel can land inside that write. Ownership decides what happens to the
  // bytes: a NEWER run for this track will write them itself, so leave them
  // be; nobody at all means no playlist claims this song, so take it back out.
  if (!owns(trackId, epoch)) {
    if (outcome.ok && !runEpoch.has(trackId)) {
      void deleteKept([trackId]).catch(() => {})
    }
    return
  }

  if (!outcome.ok) {
    if (outcome.reason === 'full') {
      // STOP, do not grind. Every remaining song would pull its whole body
      // over the wire only to hit the same wall — a 40-track season fetching
      // ~160 MB to produce forty identical errors, and again on every retry.
      release(trackId, {
        queued: [],
        storageFull: true,
        failed: { ...state.failed, [trackId]: 'This device is out of space.' },
      })
      return
    }
    release(trackId, {
      failed: { ...state.failed, [trackId]: 'This device would not hold the song.' },
    })
    return
  }

  const kept = { ...state.kept, [trackId]: rec }
  release(trackId, { kept, totalBytes: sumBytes(kept) })
}

// ── Public actions ───────────────────────────────────────────────────────────

/**
 * Ask the browser to treat this origin's storage as persistent. Best-effort and
 * NEVER awaited by a caller: the answer changes nothing about what we do, it
 * only makes eviction less likely. Asked once per device.
 */
function requestPersistence(): void {
  if (load<boolean>(PERSIST_ASKED_KEY, false)) return
  save(PERSIST_ASKED_KEY, true)
  try {
    const storage = navigator.storage
    if (!storage || typeof storage.persist !== 'function') return
    void storage
      .persist()
      .then((granted) => setState({ persisted: granted }))
      .catch(() => {})
  } catch {
    // no Storage Manager here — the downloads still work, just as a weaker lease
  }
}

/** Turn a playlist's songs on for offline play. */
export function keepPlaylist(playlistId: string): void {
  const tracks = downloadableTracks(playlistId)
  if (!state.keptPlaylistIds.includes(playlistId)) {
    const keptPlaylistIds = [...state.keptPlaylistIds, playlistId]
    save(KEPT_PLAYLISTS_KEY, keptPlaylistIds)
    setState({ keptPlaylistIds })
  }
  requestPersistence()
  void ensureReady().then(() => enqueue(tracks.map((t) => t.id)))
}

/** Forgets the member's intent to keep a playlist. Touches no bytes. */
function dropIntent(playlistId: string): void {
  if (!state.keptPlaylistIds.includes(playlistId)) return
  const keptPlaylistIds = state.keptPlaylistIds.filter((id) => id !== playlistId)
  save(KEPT_PLAYLISTS_KEY, keptPlaylistIds)
  setState({ keptPlaylistIds })
}

/** Stop keeping a playlist: queue cleared, in-flight discarded, blobs deleted. */
export function unkeepPlaylist(playlistId: string): void {
  const ids = downloadableTracks(playlistId).map((t) => t.id)
  cancelPlaylist(playlistId)
  // Songs on more than one shelf stay as long as another kept playlist wants
  // them — the full playlist and an order's playlist share tracks.
  const spokenFor = new Set(
    state.keptPlaylistIds.flatMap((id) => downloadableTracks(id).map((t) => t.id))
  )
  void forget(ids.filter((id) => !spokenFor.has(id)))
}

/**
 * Empties the queue for one playlist without touching what is already kept.
 *
 * It also drops the INTENT, and that is the load-bearing half: `reconcile()`
 * re-queues whatever a kept playlist is missing every time the screen opens,
 * so a cancel that left the intent standing would quietly start the download
 * again on the next visit — a stop button that does not stop.
 */
export function cancelPlaylist(playlistId: string): void {
  // Intent first, so `spokenFor` below reads the shelves as they will STAND.
  dropIntent(playlistId)
  const mine = downloadableTracks(playlistId).map((t) => t.id)
  // A song on two shelves is still wanted by the other one. Cancelling woods
  // must not discard the track valor is mid-way through — nothing would
  // re-queue it until the screen was remounted, leaving valor one song short.
  const spokenFor = new Set(
    state.keptPlaylistIds.flatMap((id) => downloadableTracks(id).map((t) => t.id))
  )
  const drop = new Set(mine.filter((id) => !spokenFor.has(id)))
  if (drop.size === 0) return

  // Disowning the epoch is what makes a late arrival harmless: the abandoned
  // run finds it no longer owns the track and writes nothing.
  drop.forEach((id) => runEpoch.delete(id))
  const failed = { ...state.failed }
  drop.forEach((id) => delete failed[id])
  setState({
    queued: state.queued.filter((id) => !drop.has(id)),
    // Out of `active` IMMEDIATELY, not when the abandoned fetch lands: the row
    // must stop saying "coming down" on the tap, a second tap must not be a
    // no-op, and the freed slot must go to whatever is still wanted.
    active: state.active.filter((id) => !drop.has(id)),
    failed,
  })
  pump()
}

/** Re-attempts every failed song of a playlist. */
export function retryPlaylist(playlistId: string): void {
  // A full device is not a transient failure: retrying re-fetches every song
  // to hit the same wall. Removing something clears the latch.
  if (state.storageFull) return
  const ids = downloadableTracks(playlistId)
    .map((t) => t.id)
    .filter((id) => state.failed[id])
  enqueue(ids)
}

/** Deletes given tracks from the device and tells the player to let their URLs go. */
export async function forget(trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) return
  const paths = trackIds.map((id) => state.kept[id]?.storagePath).filter((p): p is string => !!p)
  try {
    await deleteKept(trackIds)
  } catch {
    // The bytes are still there. Say so — re-read the device rather than
    // pretending the removal happened, and announce nothing: revoking URLs for
    // songs that were never deleted would only cost a re-fetch.
    applyMeta(await readAllMeta())
    return
  }
  const kept = { ...state.kept }
  for (const id of trackIds) delete kept[id]
  // Space was freed, so the full-device latch is spent.
  setState({ kept, totalBytes: sumBytes(kept), storageFull: false })
  // The player revokes what it can and DEFERS the object URL of the song
  // currently sounding — a delete tidies storage, it does not cut the music off
  // mid-verse. That track simply cannot be resumed from the device afterwards.
  announceRemoved(paths)
}

/** The storage row's "Remove all downloads" — every queue stops, every song goes. */
export async function forgetAll(): Promise<void> {
  const ids = Object.keys(state.kept)
  PLAYLISTS.forEach((pl) => cancelPlaylist(pl.id))
  save(KEPT_PLAYLISTS_KEY, [])
  setState({ keptPlaylistIds: [], failed: {} })
  await forget(ids)
}

/** Progress for one playlist, as COMPLETED SONGS — never a faked byte count.
 *  getBlob reports no byte-level progress, so this is what can be told truly. */
export interface PlaylistOfflineProgress {
  /** Songs in this playlist that can be kept at all (cloud-hosted ones). */
  total: number
  kept: number
  working: number
  failed: number
  /** True once every keepable song is on the device and nothing is in flight. */
  complete: boolean
  bytes: number
}

export function playlistProgress(
  playlistId: string,
  s: OfflineState = state
): PlaylistOfflineProgress {
  const tracks = downloadableTracks(playlistId)
  let kept = 0
  let working = 0
  let failed = 0
  let bytes = 0
  for (const t of tracks) {
    const rec = s.kept[t.id]
    if (rec) {
      kept++
      bytes += rec.bytes
      continue
    }
    if (isBusy(t.id, s)) working++
    else if (s.failed[t.id]) failed++
  }
  return {
    total: tracks.length,
    kept,
    working,
    failed,
    complete: tracks.length > 0 && kept === tracks.length,
    bytes,
  }
}
