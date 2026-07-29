// Lazy, cached Firebase bootstrap. Firebase modules are pulled in via dynamic
// import() so Vite code-splits them into their own chunk — with placeholder
// config (isConfigured() === false) the firebase chunk is never fetched and
// every cloud path is a silent no-op.
//
// One kind of session lives on this Auth instance: a REAL email/password
// account — a guest (uid === User.id) or a staff member — created by cloudAuth.
// There is deliberately NO anonymous fallback. It existed back when the console
// had no account of its own and the comm lanes were open to any authenticated
// caller; since staff accounts arrived, an anonymous session could read nothing
// and own nothing, while being an identity anybody could mint from the public
// web config. ensureFirebase() therefore resolves once Firebase has said
// whether a session was restored — possibly none at all.

import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import { FIREBASE_CONFIG } from './firebaseConfig'

export type CloudState = 'disabled' | 'connecting' | 'live' | 'offline'

export interface FirebaseHandle {
  db: Firestore
  auth: Auth
}

/** true iff no config value still contains the PASTE_ME sentinel and projectId is set. */
export function isConfigured(): boolean {
  const values = Object.values(FIREBASE_CONFIG)
  if (values.some((v) => typeof v !== 'string' || v.includes('PASTE_ME'))) return false
  return typeof FIREBASE_CONFIG.projectId === 'string' && FIREBASE_CONFIG.projectId.length > 0
}

let currentState: CloudState = isConfigured() ? 'connecting' : 'disabled'
const stateListeners = new Set<(s: CloudState) => void>()

export function cloudState(): CloudState {
  return currentState
}

export function onCloudState(fn: (s: CloudState) => void): () => void {
  stateListeners.add(fn)
  return () => {
    stateListeners.delete(fn)
  }
}

/** Internal — driven by cloudSync listeners as snapshots/errors arrive. */
export function setCloudState(s: CloudState): void {
  if (s === currentState) return
  currentState = s
  stateListeners.forEach((fn) => {
    try {
      fn(s)
    } catch {
      // a listener must never break the state fan-out
    }
  })
}

let fbPromise: Promise<FirebaseHandle | null> | null = null

// Mirrors the Auth instance once bootstrapped, so authUid()/hasRealAuth() can
// stay synchronous. Both are cheap checks, never a gate — they read null until
// something has actually called ensureFirebase().
let currentAuth: Auth | null = null

/**
 * Lazy cached singleton. Returns null (never throws) when unconfigured or on any
 * bootstrap error — callers treat null as "cloud disabled / offline".
 *
 * Resolves only once Firebase has restored any persisted session, so a page
 * reload never races a write against an unauthenticated Auth instance.
 */
export function ensureFirebase(): Promise<FirebaseHandle | null> {
  if (!isConfigured()) return Promise.resolve(null)
  if (fbPromise) return fbPromise
  fbPromise = (async () => {
    try {
      const { initializeApp } = await import('firebase/app')
      const { getAuth, onAuthStateChanged } = await import('firebase/auth')
      const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } =
        await import('firebase/firestore')

      const app = initializeApp(FIREBASE_CONFIG)
      const auth = getAuth(app)
      currentAuth = auth

      // Wait only for Firebase to say whether a session was restored. There is
      // no anonymous fallback: every identity in this app is an email/password
      // account, and an anonymous one — which anybody could mint from the
      // public web config — would be an identity that owns nothing and is
      // allowed nothing. Signed out simply means signed out.
      await new Promise<void>((resolve, reject) => {
        const unsub = onAuthStateChanged(
          auth,
          () => {
            unsub()
            resolve()
          },
          reject
        )
      })

      // Persistent cache, not the default in-memory one: a check-in made in a
      // dead spot is queued in IndexedDB and survives the tab being closed —
      // with the memory cache it died with the page and the walk was simply
      // lost. The multi-tab manager is not optional either, because the guest
      // app and the console are two documents on one origin and single-tab
      // persistence would leave whichever opened second without a cache.
      const db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      })
      return { db, auth }
    } catch {
      setCloudState('offline')
      return null
    }
  })()
  return fbPromise
}

/**
 * ensureFirebase() with a deadline, for the paths where a guest is watching a
 * spinner. On a blocked or crawling network the SDK's own retries can leave the
 * bootstrap pending for half a minute; past `ms` we hand back null so the caller
 * takes its offline branch instead.
 *
 * The underlying promise is left running and still cached, so once the network
 * recovers the very next call gets a live handle with no further delay.
 */
export function ensureFirebaseWithin(ms: number): Promise<FirebaseHandle | null> {
  if (!isConfigured()) return Promise.resolve(null)
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    ensureFirebase(),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms)
    }),
  ]).then((handle) => {
    clearTimeout(timer)
    return handle
  })
}

/** uid of the signed-in account, or null. */
export function authUid(): string | null {
  return currentAuth?.currentUser?.uid ?? null
}

/**
 * True when a real account is signed in. The anonymous check is belt and
 * braces: this app never mints an anonymous session, and the rules would
 * refuse one anyway.
 */
export function hasRealAuth(): boolean {
  const u = currentAuth?.currentUser
  return !!u && !u.isAnonymous
}
