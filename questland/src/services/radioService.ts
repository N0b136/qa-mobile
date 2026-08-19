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
// IMPORTS ARE DELIBERATELY LEAF-ONLY (store, firebase, content, and the
// offline vault) — authService calls radioService.stop() on sign-out, so a
// static import back into authService/notificationService would close a cycle.
// offlineAudioService is imported one way only; what it needs to tell this
// module (bytes it deleted) comes back through its onRemoved callback.

import type { Booking } from '../types'
import { load, save } from './store'
import { isMembershipTier } from '../content/bookingTiers'
import { getPlaylist, getTrack, tracksFor } from '../content/soundtrack'
import type { RadioTrack } from '../content/soundtrack'
import * as offlineAudio from './offlineAudioService'

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
  if (!pl || !track) return IDLE_STATE
  // Built from the catalogue in hand at startup, which is the bundled one until
  // the cloud's arrives. A song added since is simply not in this restored
  // queue; picking the playlist again rebuilds it. The alternative — deferring
  // the whole restore on a network read — would leave the bar blank on launch.
  const queue = tracksFor(pl.id).map((t) => t.id)
  const index = queue.indexOf(track.id)
  if (index < 0) return IDLE_STATE
  return {
    status: 'paused',
    playlistId: pl.id,
    queue,
    index,
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
    // Mid track-change the element still speaks for the OLD track — its clock
    // must not be written against the new selection's duration.
    if (loadedTrackId === null || loadedTrackId !== state.trackId) return
    // timeupdate fires ~4x/s; one state write and one lock-screen position push
    // a second is plenty — the lock screen interpolates on its own.
    const now = Date.now()
    if (now - lastTick < 1000) return
    lastTick = now
    setState({ position: el.currentTime })
    syncPosition()
  })
  el.addEventListener('play', () => {
    // A resume is a success — any standing error line has been outlived.
    setState({ status: 'playing', error: null })
    const session = ms()
    if (session) session.playbackState = 'playing'
  })
  el.addEventListener('pause', () => {
    // `ended` fires without a `pause` and is handled below — this covers every
    // real pause, so the lock screen never shows a playing ghost.
    if (el.ended) return
    const session = ms()
    if (session) session.playbackState = 'paused'
    // The pause EVENT is queued, not synchronous, so one can land after a
    // track change (or the past-the-end reset) has already rewritten the
    // selection. A pause speaking for a superseded track mirrors the lock
    // screen above and touches nothing else — writing its clock here is how
    // the old track's position once corrupted the new selection.
    if (state.status === 'idle' || loadedTrackId === null || loadedTrackId !== state.trackId) return
    setState({ status: 'paused', position: el.currentTime })
    persist()
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
  try {
    // No arguments clears the position readout; some engines throw on it.
    session.setPositionState()
  } catch {
    // best-effort — the metadata/playbackState clears below still land
  }
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
/** getBlob in flight per path — a skip landing mid-prefetch reuses the same
 *  fetch instead of minting (and leaking) a second object URL. */
const inflight = new Map<string, Promise<string>>()
/** An evicted URL the element was still playing — revoked on the next src swap. */
let deferredRevoke: string | null = null

/** Revoke, unless the element is still sounding from this very URL. */
function safeRevoke(url: string): void {
  if (audio && audio.src === url) {
    deferredRevoke = url
    return
  }
  URL.revokeObjectURL(url)
}

/** Settle a deferred revoke once the element has moved off the URL. */
function flushDeferredRevoke(): void {
  if (!deferredRevoke) return
  if (audio && audio.src === deferredRevoke) return
  URL.revokeObjectURL(deferredRevoke)
  deferredRevoke = null
}

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
  // Belt-and-braces: overwriting an entry must not strand its old URL.
  const existing = blobCache.get(path)
  if (existing !== undefined && existing !== url) safeRevoke(existing)
  blobCache.delete(path)
  blobCache.set(path, url)
  while (blobCache.size > BLOB_CACHE_CAP) {
    const [oldest] = blobCache.keys()
    const evicted = blobCache.get(oldest)
    blobCache.delete(oldest)
    if (evicted) safeRevoke(evicted)
  }
}

function clearBlobCache(): void {
  blobCache.forEach((url) => safeRevoke(url))
  blobCache.clear()
  flushDeferredRevoke()
}

/** A refusal is a verdict, not a network failure — never conflate the two. */
function storageError(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return 'This song is kept for Citizens. A membership opens the vault.'
  }
  // The bucket has no object at the path this track names — an upload that
  // never landed, or an object renamed after the fact. Nothing is wrong with
  // the guest's membership or their connection, so neither of those lines
  // would be true, and both would send them hunting in the wrong place.
  if (code === 'storage/object-not-found') {
    return 'This song has not reached the vault yet. Nothing is wrong on your end.'
  }
  // An Error raised by our own layers — signed out, timed out, not in the
  // vault — already says the true thing, and it carries no SDK `code` to
  // recognise it by. Passing it through is what keeps a REFUSAL from reaching
  // the guest dressed as an outage: "sign in" must never read "check your
  // connection".
  if (!code && err instanceof Error && err.message) return err.message
  // Everything left: retry-limit-exceeded, a real outage, and storage/unknown
  // — which is also what a bucket missing its CORS rule looks like from in
  // here, because the browser refuses the XHR before any Firebase error can be
  // formed. The code rides along precisely because those cases are NOT all the
  // same fix, and "check your connection" alone would misdirect every one of
  // them that is not actually the connection.
  const tail = code ? ` (${code})` : ''
  return `The song stumbled during playback. Check your connection and try again.${tail}`
}

/**
 * A playable src for a track. Three layers, in this order:
 *
 *   1. this session's object-URL memo (below) — bytes already materialized,
 *      so a repeat play never mints a second URL for the same song;
 *   2. the offline vault — IndexedDB first, which is what lets a KEPT song
 *      play with the radio off and guarantees it is never re-fetched;
 *   3. the cloud, through the vault's ONE shared in-flight map, so a download
 *      already running for this song is ridden rather than duplicated.
 *
 * Layers 2 and 3 both live in offlineAudioService.fetchBlob — this module only
 * turns the bytes it hands back into an object URL and manages that URL's life.
 */
async function resolveSource(track: RadioTrack): Promise<string> {
  if (track.source.kind === 'asset') return import.meta.env.BASE_URL + track.source.path

  const { path } = track.source
  const cached = cacheGet(path)
  if (cached) return cached

  // One URL per path at a time — the second caller rides the first's promise.
  const pending = inflight.get(path)
  if (pending) return pending
  const fetching = materialize(track, path).finally(() => inflight.delete(path))
  inflight.set(path, fetching)
  return fetching
}

async function materialize(track: RadioTrack, path: string): Promise<string> {
  try {
    const blob = await offlineAudio.fetchBlob(track)
    const url = URL.createObjectURL(blob)
    cachePut(path, url)
    return url
  } catch (err) {
    throw new Error(storageError(err))
  }
}

// A song deleted from the vault must not go on being served from a stale object
// URL. The one currently sounding is spared by safeRevoke's deferral, which is
// deliberate: a delete tidies storage, it does not cut the music off mid-verse.
offlineAudio.onRemoved((paths) => {
  for (const path of paths) {
    // A path still being materialized is one whose URL is about to be created
    // from bytes already in hand — including the lease-expiry case, where
    // fetchBlob deletes the stale record and re-fetches the same song in the
    // same breath. Revoking there would kill a URL minted AFTER the delete and
    // send the player back for bytes it is already holding.
    if (inflight.has(path)) continue
    const url = blobCache.get(path)
    if (!url) continue
    blobCache.delete(path)
    safeRevoke(url)
  }
})

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
  // Silence the OLD track before anything async: if the new source stalls or
  // refuses, nothing may keep rolling behind a UI that says otherwise. (The
  // queued pause event this fires is guarded in the handler, and flushed
  // entirely when the src swap below invokes the load algorithm.)
  if (!el.paused) el.pause()
  let src: string
  try {
    src = await resolveSource(track)
  } catch (err) {
    if (seq !== loadSeq) return
    // The element still holds the superseded track's src — disown it, so a
    // retry goes back through this loader instead of resuming the wrong song.
    loadedTrackId = null
    setState({ status: 'paused', error: err instanceof Error ? err.message : String(err) })
    const session = ms()
    if (session) session.playbackState = 'paused'
    return
  }
  if (seq !== loadSeq) return

  pendingSeek = startAt
  loadedTrackId = track.id
  el.src = src
  flushDeferredRevoke() // the element just moved off any evicted-but-playing URL
  wireMediaSession(track)
  try {
    await el.play()
    if (seq === loadSeq) prefetchNext()
  } catch {
    if (seq !== loadSeq) return
    setState({ status: 'paused', error: 'The song stumbled at the start. Tap play when you are ready.' })
    const session = ms()
    if (session) session.playbackState = 'paused'
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
    setState({ status: 'paused', error: 'The song stumbled at the start. Tap play when you are ready.' })
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
  if (audio) {
    audio.pause()
    // Empty + load, the stop() trick: the load algorithm FLUSHES the pause
    // event pause() just queued, which would otherwise land after the reset
    // below and write the old track's clock over position 0. (A skip mid-track
    // arrives here with ended false, so the handler's guard alone is not
    // enough to keep persist() from stamping the corrupted value.)
    audio.src = ''
    audio.load()
    flushDeferredRevoke()
  }
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
  // The flushed pause event can no longer mirror the lock screen — do it here.
  const session = ms()
  if (session) session.playbackState = 'paused'
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
 * The radio is a MEMBER'S perk: only a confirmed Citizen of the Kingdom
 * membership booking entitles. A day, group or birthday passage does not, and
 * neither does the pass ledger — a walk-in covered on somebody's passage is
 * definitely not a member. Reads the cloudSync mirror directly — the key
 * matches its bookingsKey — rather than importing the services.
 */
export function isEntitled(userId: string): boolean {
  return load<Booking[]>(`ql:bookings:${userId}`, []).some(
    (b) => b.status === 'confirmed' && isMembershipTier(b.tierId)
  )
}

// Module-scope, store.ts precedent: the resume point is captured as the app is
// backgrounded — the one moment iOS reliably grants before suspending a PWA.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && state.playlistId) persist()
  })
}
