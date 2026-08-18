// Questland Radio — the park's soundtrack, wherever the guest is.
//
// ONE module-singleton HTMLAudioElement owns all playback. It is created
// lazily inside the first play*() call — a user tap, which is what satisfies
// iOS's gesture requirement — and never recreated: later track changes swap
// `src` on the same element and call play() again, including the auto-advance
// inside the `ended` handler. The element is never put in the DOM.
//
// Media Session (lock screen / control center) belongs to this service
// app-wide. The wiring is migrated from the proven RadioSpikeScreen spike:
// metadata per track, play/pause/seekto/previoustrack/nexttrack (+seekbackward/
// seekforward) handlers, setPositionState throttled to one push a second off
// timeupdate, playbackState mirrored, and a full teardown in stop().
//
// IMPORTS ARE DELIBERATELY LEAF-ONLY (store, firebase, content) — authService
// calls radioService.stop() on sign-out, so a static import back into
// authService/notificationService would close a cycle.

import type { Booking } from '../types'
import type { PassUse } from './passService'
import { load, save } from './store'
import { ensureFirebase, hasRealAuth } from './firebase'
import { getPlaylist, getTrack, tracksFor } from '../content/soundtrack'
import type { RadioTrack } from '../content/soundtrack'

export type RadioStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface RadioState {
  status: RadioStatus
  playlistId: string | null
  queue: string[]
  index: number // -1 when idle
  trackId: string | null
  position: number // seconds, ≤1/s updates
  duration: number
  error: string | null // guild-voice
}

const IDLE_STATE: RadioState = {
  status: 'idle',
  playlistId: null,
  queue: [],
  index: -1,
  trackId: null,
  position: 0,
  duration: 0,
  error: null,
}

// ── Persistence (selection only — playback never auto-starts) ────────────────

const RADIO_KEY = 'ql:radio'

interface RadioResume {
  playlistId: string | null
  trackId: string | null
  position: number
  updatedAt: number
}

/** Written only on pause / track change / stop / app-hidden — never on timeupdate. */
function persist(): void {
  save<RadioResume>(RADIO_KEY, {
    playlistId: state.playlistId,
    trackId: state.trackId,
    position: Math.floor(state.position),
    updatedAt: Date.now(),
  })
}

/** Startup restores the SELECTION as a paused session; the tape never rolls on its own. */
function restore(): RadioState {
  const saved = load<RadioResume | null>(RADIO_KEY, null)
  if (!saved?.playlistId || !saved.trackId) return IDLE_STATE
  const pl = getPlaylist(saved.playlistId)
  const track = getTrack(saved.trackId)
  if (!pl || !track || !pl.trackIds.includes(track.id)) return IDLE_STATE
  return {
    status: 'paused',
    playlistId: pl.id,
    queue: pl.trackIds,
    index: pl.trackIds.indexOf(track.id),
    trackId: track.id,
    position: saved.position || 0,
    duration: track.duration,
    error: null,
  }
}

// ── State + subscription (onCloudState precedent: private listeners, cached
// snapshot — a NEW object only on change, stable for useSyncExternalStore) ───

let state: RadioState = restore()
const listeners = new Set<() => void>()

export function getState(): RadioState {
  return state
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function setState(patch: Partial<RadioState>): void {
  let changed = false
  for (const k of Object.keys(patch) as Array<keyof RadioState>) {
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

// ── The element ──────────────────────────────────────────────────────────────

let audio: HTMLAudioElement | null = null
/** Which track the element's src currently holds — null after stop(). */
let loadedTrackId: string | null = null
/** Guards a stale async load against clobbering a newer request. */
let loadSeq = 0
/** Resume point applied once metadata arrives (currentTime is unreliable before). */
let pendingSeek = 0

function ms(): MediaSession | null {
  return 'mediaSession' in navigator ? navigator.mediaSession : null
}

function syncPosition(): void {
  const session = ms()
  if (!session || !audio || !Number.isFinite(audio.duration)) return
  session.setPositionState({
    duration: audio.duration,
    playbackRate: audio.playbackRate,
    position: audio.currentTime,
  })
}

function ensureElement(): HTMLAudioElement {
  if (audio) return audio
  const el = new Audio()
  el.preload = 'auto'
  audio = el

  let lastTick = 0
  el.addEventListener('timeupdate', () => {
    // timeupdate fires ~4x/s; one state write and one lock-screen position push
    // a second is plenty — the lock screen interpolates on its own.
    const now = Date.now()
    if (now - lastTick < 1000) return
    lastTick = now
    setState({ position: el.currentTime })
    syncPosition()
  })
  el.addEventListener('play', () => {
    setState({ status: 'playing' })
    const session = ms()
    if (session) session.playbackState = 'playing'
  })
  el.addEventListener('pause', () => {
    // `ended` fires without a `pause` and is handled below — this covers every
    // real pause, so the lock screen never shows a playing ghost.
    if (el.ended) return
    setState({ status: 'paused', position: el.currentTime })
    persist()
    const session = ms()
    if (session) session.playbackState = 'paused'
  })
  el.addEventListener('ended', () => {
    const session = ms()
    if (session) session.playbackState = 'paused'
    void next()
  })
  el.addEventListener('loadedmetadata', () => {
    if (pendingSeek > 0 && pendingSeek < el.duration) el.currentTime = pendingSeek
    pendingSeek = 0
    setState({ duration: el.duration })
    syncPosition()
  })
  return el
}

// ── Media Session ────────────────────────────────────────────────────────────

function artUrl(track: RadioTrack): string {
  const pl = state.playlistId ? getPlaylist(state.playlistId) : undefined
  const art = track.art ?? pl?.art ?? 'assets/logo-questland-primary.png'
  return import.meta.env.BASE_URL + art
}

/** Idempotent — re-run on every load, torn down whole in stop(). */
function wireMediaSession(track: RadioTrack): void {
  const session = ms()
  if (!session) return
  const pl = state.playlistId ? getPlaylist(state.playlistId) : undefined
  session.metadata = new MediaMetadata({
    title: track.title,
    artist: 'Questland Adventures',
    album: pl?.name ?? 'Questland Radio',
    artwork: [{ src: artUrl(track), type: 'image/png' }],
  })
  // Playback still only ever STARTS from an on-screen tap; these serve the
  // lock screen / control center once the guest has begun it.
  session.setActionHandler('play', () => void play())
  session.setActionHandler('pause', () => pause())
  session.setActionHandler('previoustrack', () => void prev())
  session.setActionHandler('nexttrack', () => void next())
  session.setActionHandler('seekbackward', () => seekBy(-10))
  session.setActionHandler('seekforward', () => seekBy(10))
  session.setActionHandler('seekto', (details) => {
    if (details.seekTime == null) return
    seekTo(details.seekTime)
  })
}

const MS_ACTIONS: MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekbackward',
  'seekforward',
  'seekto',
]

function teardownMediaSession(): void {
  const session = ms()
  if (!session) return
  MS_ACTIONS.forEach((a) => session.setActionHandler(a, null))
  session.metadata = null
  session.playbackState = 'none'
}

// ── Source resolution ────────────────────────────────────────────────────────
//
// Storage tracks are fetched as BYTES over the SDK's own auth (getBlob) and
// played from an object URL — getDownloadURL is never called anywhere, so no
// public/shareable URL ever exists. The rules in storage.rules are the gate.

/** Object-URL cache: storage path → URL. Map order is the LRU order. */
const blobCache = new Map<string, string>()
const BLOB_CACHE_CAP = 3

function cacheGet(path: string): string | undefined {
  const url = blobCache.get(path)
  if (url !== undefined) {
    // Refresh recency so the playing track is never the eviction victim.
    blobCache.delete(path)
    blobCache.set(path, url)
  }
  return url
}

function cachePut(path: string, url: string): void {
  blobCache.set(path, url)
  while (blobCache.size > BLOB_CACHE_CAP) {
    const [oldest] = blobCache.keys()
    const evicted = blobCache.get(oldest)
    blobCache.delete(oldest)
    if (evicted) URL.revokeObjectURL(evicted)
  }
}

function clearBlobCache(): void {
  blobCache.forEach((url) => URL.revokeObjectURL(url))
  blobCache.clear()
}

/** A refusal is a verdict, not a network failure — never conflate the two. */
function storageError(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return 'This song is kept for passage-holders. Book a visit and the vault opens.'
  }
  return 'The song would not load. Check your connection and try again.'
}

async function resolveSource(track: RadioTrack): Promise<string> {
  if (track.source.kind === 'asset') return import.meta.env.BASE_URL + track.source.path

  const cached = cacheGet(track.source.path)
  if (cached) return cached

  const fb = await ensureFirebase()
  if (!fb || !hasRealAuth()) {
    throw new Error('The radio needs your account signed in to the cloud.')
  }
  try {
    // Lazy, matching firebase.ts — the storage chunk is only ever fetched here.
    const { getStorage, ref, getBlob } = await import('firebase/storage')
    const blob = await getBlob(ref(getStorage(fb.auth.app), track.source.path))
    const url = URL.createObjectURL(blob)
    cachePut(track.source.path, url)
    return url
  } catch (err) {
    throw new Error(storageError(err))
  }
}

/** Warm the NEXT queue entry's bytes once the current track is rolling. */
function prefetchNext(): void {
  const nextId = state.queue[state.index + 1]
  const track = nextId ? getTrack(nextId) : undefined
  if (!track || track.source.kind !== 'storage') return
  if (blobCache.has(track.source.path)) return
  void resolveSource(track).catch(() => {
    // best-effort — the real load will surface any error when it matters
  })
}

// ── Loading + playback ───────────────────────────────────────────────────────

async function loadAndPlay(track: RadioTrack, startAt: number): Promise<void> {
  const seq = ++loadSeq
  setState({ status: 'loading', error: null })
  const el = ensureElement()
  let src: string
  try {
    src = await resolveSource(track)
  } catch (err) {
    if (seq !== loadSeq) return
    setState({ status: 'paused', error: err instanceof Error ? err.message : String(err) })
    return
  }
  if (seq !== loadSeq) return

  pendingSeek = startAt
  loadedTrackId = track.id
  el.src = src
  wireMediaSession(track)
  try {
    await el.play()
    if (seq === loadSeq) prefetchNext()
  } catch {
    if (seq !== loadSeq) return
    setState({ status: 'paused', error: 'The song would not start. Tap play to try again.' })
  }
}

/** Builds the queue from the playlist and starts it (first call mints the element). */
export function playPlaylist(playlistId: string, trackId?: string): void {
  const queue = tracksFor(playlistId).map((t) => t.id)
  if (queue.length === 0) return
  const index = Math.max(0, trackId ? queue.indexOf(trackId) : 0)
  const track = getTrack(queue[index])
  if (!track) return
  setState({
    playlistId,
    queue,
    index,
    trackId: track.id,
    position: 0,
    duration: track.duration,
    error: null,
  })
  persist()
  void loadAndPlay(track, 0)
}

export function play(): void {
  if (!state.trackId) return
  const track = getTrack(state.trackId)
  if (!track) return
  // A restored or advanced-past-the-end selection has no bytes behind it yet —
  // load them now (this tap is the gesture iOS wants) and resume in place.
  if (!audio || loadedTrackId !== track.id) {
    void loadAndPlay(track, state.position)
    return
  }
  void audio.play().catch(() => {
    setState({ status: 'paused', error: 'The song would not start. Tap play to try again.' })
  })
}

export function pause(): void {
  audio?.pause()
}

export function toggle(): void {
  if (state.status === 'playing') pause()
  else play()
}

/** Steps to the given queue index and plays it. */
function step(index: number): void {
  const track = getTrack(state.queue[index])
  if (!track) return
  setState({ index, trackId: track.id, position: 0, duration: track.duration, error: null })
  persist()
  void loadAndPlay(track, 0)
}

/**
 * Past the queue's end the radio STOPS PLAYING but KEEPS THE SELECTION —
 * paused at track 0, so the MiniPlayer still offers a play affordance.
 */
export async function next(): Promise<void> {
  if (state.index < 0) return
  if (state.index + 1 < state.queue.length) {
    step(state.index + 1)
    return
  }
  audio?.pause()
  const first = getTrack(state.queue[0])
  loadedTrackId = null // force a reload when play() comes back around
  setState({
    status: 'paused',
    index: 0,
    trackId: first?.id ?? null,
    position: 0,
    duration: first?.duration ?? 0,
  })
  persist()
}

/** Restarts the current track when it is already rolling; steps back otherwise. */
export async function prev(): Promise<void> {
  if (state.index < 0) return
  if (state.position > 3 || state.index === 0) {
    seekTo(0)
    return
  }
  step(state.index - 1)
}

export function seekTo(seconds: number): void {
  const clamped = Math.max(0, Math.min(state.duration || 0, seconds))
  if (audio && loadedTrackId === state.trackId) {
    audio.currentTime = clamped
    syncPosition()
  }
  setState({ position: clamped })
}

function seekBy(delta: number): void {
  seekTo((audio && loadedTrackId === state.trackId ? audio.currentTime : state.position) + delta)
}

/**
 * Full teardown: element silenced and emptied (kept for reuse — it holds the
 * iOS gesture blessing), Media Session cleared, object URLs revoked, state and
 * the persisted selection both back to idle. authService.signOut() calls this.
 */
export function stop(): void {
  loadSeq++
  if (audio) {
    audio.pause()
    // Drop the src and re-load so the element releases its buffer.
    audio.src = ''
    audio.load()
  }
  loadedTrackId = null
  pendingSeek = 0
  teardownMediaSession()
  clearBlobCache()
  setState({ ...IDLE_STATE })
  persist()
}

// ── Entitlement ──────────────────────────────────────────────────────────────

/**
 * The radio rides with a passage: any confirmed booking, or any line in the
 * pass ledger (the booth spends on a guest's behalf, so a use can exist with
 * no booking on this phone). Reads the cloudSync mirrors directly — the keys
 * match its bookingsKey/passUsesKey — rather than importing the services.
 */
export function isEntitled(userId: string): boolean {
  return (
    load<Booking[]>(`ql:bookings:${userId}`, []).some((b) => b.status === 'confirmed') ||
    load<PassUse[]>(`ql:passUses:${userId}`, []).length > 0
  )
}

// Module-scope, store.ts precedent: the resume point is captured as the app is
// backgrounded — the one moment iOS reliably grants before suspending a PWA.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.playlistId) persist()
  })
}
