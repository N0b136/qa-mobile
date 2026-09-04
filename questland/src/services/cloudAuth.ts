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
 * Sign in with Google — POPUP everywhere, redirect only if the popup is refused.
 *
 * THE HISTORY MATTERS, because this file has now held two wrong explanations of
 * the same symptom and the second one was mine.
 *
 * The installed console first failed with "The requested action is invalid" on
 * a handler URL carrying `authType=signInViaPopup`. I read that as the popup
 * having no `window.opener` to post the credential back through, and switched
 * installed apps to redirect. That was a guess dressed as a diagnosis. The
 * authorised-domains entry for this host was wrong at the time — a lowercase
 * `o` where the hostname carries a zero — and an unauthorised domain produces
 * that exact page. The popup was almost certainly never the problem.
 *
 * The redirect then failed for a real and structural reason: the auth handler
 * is served from `firebaseapp.com` while this app is served from another
 * origin, and a browser partitioning third-party storage does not let the
 * returning session out of that partition. Confirmed in the field, not guessed
 * — `googleRedirectResult` reported it.
 *
 * So: popup, on every surface, now that the domain it needs is spelled
 * correctly. Redirect stays only as the fallback for a genuinely refused popup,
 * where it is the sole remaining option even though we now know it does not
 * survive this deployment — and it reports itself clearly when it does not.
 *
 * If the popup fails again in an installed app, THEN the opener theory was
 * right after all, and the cure is not in this file: it is serving the auth
 * handler from this app's own origin.
 */
export async function cloudSignInWithGoogle(): Promise<GoogleSignIn> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return { ok: false, kind: 'unavailable', code: 'firebase-unreachable' }
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth')
  const provider = new GoogleAuthProvider()

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
        markRedirectStarted()
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
    console.error('[console] Google sign-in failed', code, 'standalone:', isStandalone(), err)
    const message = rejection(code)
    if (message) return { ok: false, kind: 'rejected', message }
    // A popup failure in an INSTALLED app is the one case where the answer is
    // not in this codebase, so say so rather than offering a retry that cannot
    // work: it means the popup really cannot post its credential back, and the
    // cure is serving the auth handler from this app's own origin.
    if (isStandalone()) {
      return {
        ok: false,
        kind: 'rejected',
        message:
          `Google sign-in cannot complete inside the installed app (${code || 'no code'}). ` +
          'Open the console in a browser tab instead, and tell Ryan the sign-in handler needs to move to the app’s own domain.',
      }
    }
    return { ok: false, kind: 'unavailable', code: code || 'unknown' }
  }
}

/**
 * A breadcrumb saying "this document sent someone to Google and expects them
 * back", written before the redirect and read once on the next load.
 *
 * It exists so the return leg can tell three situations apart that otherwise
 * all look like an ordinary page load: nobody signed in, somebody came back
 * signed in, and somebody came back with nothing to show for it. Without it the
 * third case — the interesting one — is silent.
 *
 * sessionStorage, not localStorage: it is scoped to this tab and dies with it,
 * so a stale breadcrumb cannot outlive the attempt that wrote it.
 */
const REDIRECT_FLAG = 'ql:console:googleRedirect'

function markRedirectStarted(): void {
  try {
    sessionStorage.setItem(REDIRECT_FLAG, '1')
  } catch {
    // Private mode, storage disabled — the flow still works, the return leg is
    // just back to being unable to explain itself.
  }
}

function takeRedirectStarted(): boolean {
  try {
    const started = sessionStorage.getItem(REDIRECT_FLAG) === '1'
    sessionStorage.removeItem(REDIRECT_FLAG)
    return started
  } catch {
    return false
  }
}

export type RedirectOutcome =
  /** This load is not the tail of a redirect. The ordinary case. */
  | { kind: 'none' }
  | { kind: 'signed-in'; uid: string; email: string }
  /** We sent them to Google and they came back with no session. */
  | { kind: 'lost'; code: string }

/**
 * The answer to a redirect started on the previous page load.
 *
 * getRedirectResult is NOT sufficient on its own, and relying on it alone was a
 * bug: it returns null in several ordinary situations where the person IS
 * signed in — the SDK having already consumed the result being the usual one —
 * and a gate that trusts it blindly shows the sign-in form to somebody who just
 * signed in. So the credential is preferred when offered, and the live auth
 * session is the fallback, which is what actually decides whether sign-in
 * worked.
 *
 * The live session is only consulted when THIS gate started a redirect. A guest
 * signed into the phone app on this same origin must never be picked up here
 * and run through the staff roll, because failing that check signs them out —
 * out of the guest app too. The breadcrumb keeps this to people who asked.
 */
export async function googleRedirectResult(): Promise<RedirectOutcome> {
  const started = takeRedirectStarted()
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return started ? { kind: 'lost', code: 'firebase-unreachable' } : { kind: 'none' }

  let code = ''
  try {
    const { getRedirectResult } = await import('firebase/auth')
    const cred = await getRedirectResult(fb.auth)
    if (cred) return { kind: 'signed-in', uid: cred.user.uid, email: cred.user.email ?? '' }
  } catch (err) {
    code = errorCode(err) || 'unknown'
    console.error('[console] Google redirect result failed', code, err)
  }

  // No credential handed back. If Firebase nonetheless holds a real session,
  // the sign-in worked and only the reporting of it did not.
  const user = fb.auth.currentUser
  if (started && user && !user.isAnonymous) {
    return { kind: 'signed-in', uid: user.uid, email: user.email ?? '' }
  }

  if (!started) return { kind: 'none' }

  // Sent to Google, came back with nothing. On this deployment the likeliest
  // cause is structural rather than a mistake: the auth handler lives on
  // firebaseapp.com while the app is served from another origin, and a browser
  // partitioning third-party storage will not let the returning session out of
  // that partition. Serving the auth handler from this app's own origin is the
  // only real cure. Say it rather than showing an empty sign-in form.
  console.error('[console] Google redirect returned with no session', code || 'no-code')
  return { kind: 'lost', code: code || 'no-session-returned' }
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
  | { ok: false; kind: 'unavailable'; code: string }

/**
 * Reads staff/{uid}. Missing doc means "signed in, but not on the roster" —
 * distinct from a read we could not perform at all, which must not be reported
 * to someone as being off the roster.
 *
 * `fresh` asks the SERVER and refuses to answer from the local cache, and the
 * sign-in path passes it. Two reasons:
 *
 * · This console keeps a persistent Firestore cache, which remembers that a
 *   document does NOT exist just as firmly as that it does. Someone signing in
 *   with Google before a Warden has added them caches a negative for their own
 *   staff doc — and then the roll is updated and the app goes on reading its own
 *   stale "no". That is not hypothetical; it is the shape of the migration this
 *   change is part of, where every person tries once BEFORE being added.
 * · More generally: whether you are staff is an authorisation input, and an
 *   authorisation input should not be answered out of a cache the client holds.
 *
 * revalidateStaff deliberately does NOT pass it. That path exists to keep a
 * signed-in console working on its warm mirrors in a dead spot, and demanding
 * the server there would sign people out for being underground.
 */
export async function fetchStaff(uid: string, opts?: { fresh?: boolean }): Promise<StaffLookup> {
  const fb = await ensureFirebaseWithin(AUTH_TIMEOUT_MS)
  if (!fb) return { ok: false, kind: 'unavailable', code: 'firebase-unreachable' }
  try {
    const { doc, getDoc, getDocFromServer } = await import('firebase/firestore')
    const ref = doc(fb.db, 'staff', uid)
    let snap
    if (opts?.fresh) {
      try {
        snap = await getDocFromServer(ref)
      } catch (serverErr) {
        // Genuinely offline is not the same as refused. Fall back to whatever
        // the cache knows and let the caller treat a miss as "could not ask".
        console.warn('[console] staff roll: server read failed, falling back to cache', serverErr)
        snap = await getDoc(ref)
      }
    } else {
      snap = await getDoc(ref)
    }
    if (!snap.exists()) return { ok: false, kind: 'not-staff' }
    const data = snap.data() as Partial<StaffDoc>
    const staff: StaffDoc = {
      uid,
      name: data.name?.trim() || 'Guild staff',
      role: data.role === 'guide' ? 'guide' : 'warden',
    }
    if (data.personaId) staff.personaId = data.personaId
    return { ok: true, staff }
  } catch (err) {
    // Swallowing this is what turned a permission or connectivity failure into
    // an unexplained "could not reach the guild roll" three times over. The
    // code travels with the result now.
    const code = errorCode(err) || 'unknown'
    console.error('[console] staff roll read failed', code, err)
    return { ok: false, kind: 'unavailable', code }
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
