// Lazy, cached Firebase bootstrap. Firebase modules are pulled in via dynamic
// import() so Vite code-splits them into their own chunk — with placeholder
// config (isConfigured() === false) the firebase chunk is never fetched and
// every cloud path is a silent no-op.

import type { Firestore } from 'firebase/firestore'
import { FIREBASE_CONFIG } from './firebaseConfig'

export type CloudState = 'disabled' | 'connecting' | 'live' | 'offline'

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

let fbPromise: Promise<{ db: Firestore; authUid: string } | null> | null = null

/**
 * Lazy cached singleton. Returns null (never throws) when unconfigured or on any
 * bootstrap error — callers treat null as "cloud disabled / offline".
 */
export function ensureFirebase(): Promise<{ db: Firestore; authUid: string } | null> {
  if (!isConfigured()) return Promise.resolve(null)
  if (fbPromise) return fbPromise
  fbPromise = (async () => {
    try {
      const { initializeApp } = await import('firebase/app')
      const { getAuth, onAuthStateChanged, signInAnonymously } = await import('firebase/auth')
      const { getFirestore } = await import('firebase/firestore')

      const app = initializeApp(FIREBASE_CONFIG)
      const auth = getAuth(app)

      const authUid = await new Promise<string>((resolve, reject) => {
        const unsub = onAuthStateChanged(
          auth,
          (u) => {
            unsub()
            if (u) {
              resolve(u.uid)
            } else {
              signInAnonymously(auth)
                .then((cred) => resolve(cred.user.uid))
                .catch(reject)
            }
          },
          reject
        )
      })

      const db = getFirestore(app)
      return { db, authUid }
    } catch {
      setCloudState('offline')
      return null
    }
  })()
  return fbPromise
}
