// Firebase Auth wrapper — the server-side half of account validation.
//
// Everything here returns a discriminated result instead of throwing, split into
// two failure kinds that callers treat very differently:
//   • 'rejected'    — the server looked and said no (email taken, bad password).
//                     Surface it; never fall back.
//   • 'unavailable' — we could not ask (cloud off, provider not enabled yet,
//                     offline). authService falls back to a local-only account
//                     so the app keeps working exactly as it did before.
//
// The private profile lives in accounts/{uid} (owner-only, holds the email); the
// PUBLIC half of a guest stays in guests/{uid}, which cloudSync already writes
// and which deliberately carries no email.

import type { User } from '../types'
import { ensureFirebaseWithin } from './firebase'

/** How long a guest waits on the network before we fall back to the local path. */
const AUTH_TIMEOUT_MS = 10_000

export interface AccountDoc {
  id: string
  email: string
  name: string
  avatar: string
  createdAt: number
  updatedAt: number
  orgId?: string
  partyId?: string
}

export type CloudAuthResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; kind: 'rejected'; message: string }
  | { ok: false; kind: 'unavailable' }

/** Firebase's minimum. The sign-up form enforces the same number up front. */
export const MIN_PASSWORD_LENGTH = 6

// Codes where the server has genuinely adjudicated the request. Anything not in
// this map is treated as 'unavailable' and falls back to the local path.
const REJECTIONS: Record<string, string> = {
  'auth/email-already-in-use': 'An adventurer already keeps that email. Sign in instead.',
  'auth/invalid-email': 'That email does not look right. Check it and try again.',
  'auth/weak-password': `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  'auth/missing-password': 'Enter your password.',
  'auth/invalid-credential': 'No adventurer answers to those credentials.',
  'auth/user-not-found': 'No adventurer answers to those credentials.',
  'auth/wrong-password': 'No adventurer answers to those credentials.',
  'auth/user-disabled': 'That account has been barred. Speak with a Guide.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment, then try again.',
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

function toResult(err: unknown): CloudAuthResult {
  const message = REJECTIONS[errorCode(err)]
  if (message) return { ok: false, kind: 'rejected', message }
  // Everything else is "we could not ask" — notably 'auth/operation-not-allowed'
  // (Email/Password provider still switched off in the Firebase console) and
  // 'auth/network-request-failed'. Both fall back to a local-only account.
  return { ok: false, kind: 'unavailable' }
}

export async function cloudSignUp(email: string, password: string): Promise<CloudAuthResult> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return { ok: false, kind: 'unavailable' }
  try {
    const { createUserWithEmailAndPassword } = await import('firebase/auth')
    const cred = await createUserWithEmailAndPassword(fb.auth, email, password)
    return { ok: true, uid: cred.user.uid, email: cred.user.email ?? email }
  } catch (err) {
    return toResult(err)
  }
}

export async function cloudSignIn(email: string, password: string): Promise<CloudAuthResult> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return { ok: false, kind: 'unavailable' }
  try {
    const { signInWithEmailAndPassword } = await import('firebase/auth')
    const cred = await signInWithEmailAndPassword(fb.auth, email, password)
    return { ok: true, uid: cred.user.uid, email: cred.user.email ?? email }
  } catch (err) {
    return toResult(err)
  }
}

/** Drops the guest session, then retakes an anonymous one so reads keep working. */
export async function cloudSignOut(): Promise<void> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return
  try {
    const { signOut, signInAnonymously } = await import('firebase/auth')
    await signOut(fb.auth)
    await signInAnonymously(fb.auth)
  } catch {
    // best effort — the local session is already cleared either way
  }
}

/** The signed-in guest's private profile, or null if it was never written. */
export async function fetchAccount(uid: string): Promise<AccountDoc | null> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return null
  try {
    const { doc, getDoc } = await import('firebase/firestore')
    const snap = await getDoc(doc(fb.db, 'accounts', uid))
    return snap.exists() ? (snap.data() as AccountDoc) : null
  } catch {
    return null
  }
}

export function pushAccount(user: User): void {
  if (!user.cloud) return
  void ensureFirebaseWithin(AUTH_TIMEOUT_MS).then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      const payload: AccountDoc = {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt ?? Date.now(),
      }
      if (user.orgId) payload.orgId = user.orgId
      if (user.partyId) payload.partyId = user.partyId
      await setDoc(doc(fb.db, 'accounts', user.id), payload)
    } catch {
      // fire-and-forget, same posture as every other write-through
    }
  })
}
