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

/**
 * The result of asking Google who someone is. Deliberately NOT CloudAuthResult:
 * the guest email/password path has two outcomes, and this one has four — a
 * cancelled popup and a redirect in flight are neither success nor failure, and
 * folding them into 'unavailable' would make the console say something went
 * wrong when nothing did.
 */
export type GoogleSignIn =
  | { ok: true; uid: string; email: string }
  | { ok: false; kind: 'cancelled' }
  | { ok: false; kind: 'redirecting' }
  | { ok: false; kind: 'rejected'; message: string }
  /**
   * `code` is the raw `auth/...` string, and it is carried rather than dropped
   * on purpose. The first version of this mapped every unrecognised failure to
   * one friendly sentence, which is exactly the wrong trade for a sign-in that
   * is failing in the field: the person can see it is broken, and the only
   * thing that would say WHY has been thrown away before it reaches them.
   * A friendly sentence AND the code — the code is what gets diagnosed.
   */
  | { ok: false; kind: 'unavailable'; code: string }

const GOOGLE_REJECTIONS: Record<string, string> = {
  'auth/account-exists-with-different-credential':
    'This email already has a password account here. Sign in with your password below, and ask a Warden to move you across.',
  'auth/operation-not-allowed':
    'Google sign-in is not switched on for this project yet. Use your password below.',
  // 'auth/unauthorized-domain' is filled in at throw time — see below. It needs
  // the hostname, and a static table cannot know it.
}

/**
 * The exact string that must appear in Firebase → Authentication → Settings →
 * Authorised domains.
 *
 * Named in the message rather than described, because this is a failure people
 * diagnose by eye against a list in another tab, and the eye is exactly what
 * cannot be trusted here: `n0b136.github.io` carries a ZERO, and in most UI
 * fonts a zero and a letter o are one pixel apart. An entry typed with the
 * wrong one looks correct, sits in the list, and never matches. So the app
 * prints the string to compare against instead of asking someone to squint.
 */
function unauthorizedDomainMessage(): string {
  const host = typeof window === 'undefined' ? '(unknown)' : window.location.hostname
  return `“${host}” is not on the project’s authorised domains — check it character by character, then use your password below.`
}

/** A friendly sentence for a code we recognise, or '' for one we do not. */
function rejection(code: string): string {
  if (code === 'auth/unauthorized-domain') return unauthorizedDomainMessage()
  return GOOGLE_REJECTIONS[code] ?? ''
}

/**
 * True when this document is running as an installed app rather than in a
 * browser tab. iOS Safari answers with a non-standard `navigator.standalone`;
 * everyone else answers the display-mode media query. `minimal-ui` and
 * `fullscreen` count: all three are launched-from-the-home-screen contexts with
 * no browser window around them.
 */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const legacy = (window.navigator as Navigator & { standalone?: boolean }).standalone
  if (legacy === true) return true
  const modes = ['standalone', 'minimal-ui', 'fullscreen']
  return modes.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`)?.matches === true)
}

/**
 * Sign in with Google — REDIRECT when installed, popup only in a browser tab.
 *
 * The first version tried the popup everywhere and fell back to a redirect on
 * `auth/popup-blocked`. That fallback never fired, because the popup is not
 * blocked in an installed app: it OPENS. What it cannot do is talk back. The
 * auth handler finishes by posting the credential to `window.opener`, and a
 * window opened from a standalone PWA has no opener, so the handler renders as
 * an ordinary top-level page and says "The requested action is invalid." No
 * error is ever thrown, nothing falls back, and the person is left staring at
 * a white page on firebaseapp.com carrying `authType=signInViaPopup`.
 *
 * So the surface decides the method up front instead of waiting for a failure
 * that does not arrive. Installed → redirect, and the answer comes back on the
 * next page load through `googleRedirectResult`. In a tab → popup, which keeps
 * the person on the page they started from.
 */
export async function cloudSignInWithGoogle(): Promise<GoogleSignIn> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return { ok: false, kind: 'unavailable', code: 'firebase-unreachable' }
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth')
  const provider = new GoogleAuthProvider()

  if (isStandalone()) {
    try {
      await signInWithRedirect(fb.auth, provider)
      return { ok: false, kind: 'redirecting' }
    } catch (err) {
      const code = errorCode(err)
      console.error('[console] Google redirect failed', code, err)
      const message = rejection(code)
      return message
        ? { ok: false, kind: 'rejected', message }
        : { ok: false, kind: 'unavailable', code: code || 'unknown' }
    }
  }

  try {
    const cred = await signInWithPopup(fb.auth, provider)
    return { ok: true, uid: cred.user.uid, email: cred.user.email ?? '' }
  } catch (err) {
    const code = errorCode(err)
    // Closing the chooser is a decision, not a failure. Saying "sign-in failed"
    // to someone who changed their mind is how a gate teaches distrust.
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return { ok: false, kind: 'cancelled' }
    }
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      try {
        await signInWithRedirect(fb.auth, provider)
        return { ok: false, kind: 'redirecting' }
      } catch (redirectErr) {
        const redirectCode = errorCode(redirectErr)
        console.error('[console] Google redirect failed', redirectCode, redirectErr)
        const message = rejection(redirectCode)
        return message
          ? { ok: false, kind: 'rejected', message }
          : { ok: false, kind: 'unavailable', code: redirectCode || 'unknown' }
      }
    }
    console.error('[console] Google sign-in failed', code, err)
    const message = rejection(code)
    return message ? { ok: false, kind: 'rejected', message } : { ok: false, kind: 'unavailable', code: code || 'unknown' }
  }
}

/**
 * The answer to a redirect started on the previous page load, or null when this
 * load is not the tail of one. Safe to call on every mount — Firebase returns
 * null rather than throwing when there is no redirect in flight.
 */
export async function googleRedirectResult(): Promise<{ uid: string; email: string } | null> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return null
  try {
    const { getRedirectResult } = await import('firebase/auth')
    const cred = await getRedirectResult(fb.auth)
    return cred ? { uid: cred.user.uid, email: cred.user.email ?? '' } : null
  } catch (err) {
    // A redirect that comes back broken is the hardest of these to see: the
    // page simply reloads signed out, with nothing on screen to say a sign-in
    // was ever attempted. At minimum it must leave a trace.
    console.error('[console] Google redirect result failed', errorCode(err), err)
    return null
  }
}

/** Drops the Firebase session. Signed out means signed out — nothing replaces it. */
export async function cloudSignOut(): Promise<void> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return
  try {
    const { signOut } = await import('firebase/auth')
    await signOut(fb.auth)
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

// ── Staff ─────────────────────────────────────────────────────────────────────
//
// Staff are a Firestore allowlist, never a client-side claim: a staff/{uid} doc
// created BY HAND in the Firebase console is the whole authorisation model, and
// the rules refuse writes to that collection from any client. Signing in as
// staff is an ordinary email/password sign-in that happens to have such a doc.

export interface StaffDoc {
  uid: string
  name: string
  role: 'warden' | 'guide'
  /** Optional link to a STAFF_PERSONAS entry, purely for its icon and blurb. */
  personaId?: string
}

export type StaffLookup =
  | { ok: true; staff: StaffDoc }
  | { ok: false; kind: 'not-staff' }
  | { ok: false; kind: 'unavailable' }

/**
 * Reads staff/{uid}. Missing doc means "signed in, but not on the roster" —
 * distinct from a read we could not perform at all, which must not be reported
 * to someone as being off the roster.
 */
export async function fetchStaff(uid: string): Promise<StaffLookup> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return { ok: false, kind: 'unavailable' }
  try {
    const { doc, getDoc } = await import('firebase/firestore')
    const snap = await getDoc(doc(fb.db, 'staff', uid))
    if (!snap.exists()) return { ok: false, kind: 'not-staff' }
    const data = snap.data() as Partial<StaffDoc>
    const staff: StaffDoc = {
      uid,
      name: data.name?.trim() || 'Guild staff',
      role: data.role === 'guide' ? 'guide' : 'warden',
    }
    if (data.personaId) staff.personaId = data.personaId
    return { ok: true, staff }
  } catch {
    return { ok: false, kind: 'unavailable' }
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
