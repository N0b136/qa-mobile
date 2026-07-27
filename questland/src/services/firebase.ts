// Lazy, cached Firebase bootstrap. Firebase modules are pulled in via dynamic
// import() so Vite code-splits them into their own chunk — with placeholder
// config (isConfigured() === false) the firebase chunk is never fetched and
// every cloud path is a silent no-op.
//
// Two kinds of session live on this Auth instance:
//   • a REAL guest — email/password, uid === User.id, created by cloudAuth
//   • an ANONYMOUS session — the fallback so the Back Office console (which has
//     no guest account) and a signed-out phone can still read the comm lanes.
// ensureFirebase() guarantees one or the other is present before it resolves.

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
      const { getAuth, onAuthStateChanged, signInAnonymously } = await import('firebase/auth')
      const { getFirestore } = await import('firebase/firestore')

      const app = initializeApp(FIREBASE_CONFIG)
      const auth = getAuth(app)
      currentAuth = auth

      await new Promise<void>((resolve, reject) => {
        const unsub = onAuthStateChanged(
          auth,
          (u) => {
            unsub()
            if (u) {
              resolve()
            } else {
              // No persisted session — take an anonymous one so reads still work.
              signInAnonymously(auth)
                .then(() => resolve())
                .catch(reject)
            }
          },
          reject
        )
      })

      const db = getFirestore(app)
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

/** uid of whoever is signed in right now (anonymous included), or null. */
export function authUid(): string | null {
  return currentAuth?.currentUser?.uid ?? null
}

/** true when the live Firebase session belongs to a real (non-anonymous) guest. */
export function hasRealAuth(): boolean {
  const u = currentAuth?.currentUser
  return !!u && !u.isAnonymous
}
