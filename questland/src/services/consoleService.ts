// Thin console layer over the cloud bridge (cloudSync) + the local mirror
// (store). The Back Office console reads guests/SOS/scheduled from the mirrors
// that cloudSync keeps in sync, and writes through cloudSync's push functions.
// The staff persona is LOCAL only — it identifies the presenter, never a guest,
// and is never synced to Firestore.

import type { Audience, GuestDoc, ScheduledSend } from './cloudSync'
import {
  resolveAudience,
  audienceLabel,
  sendWordBatch,
  pushSchedule,
  cancelSchedule,
  fireDueSchedules,
} from './cloudSync'
import type { NotificationType } from '../types'
import type { StaffDoc } from './cloudAuth'
import {
  cloudSignIn,
  cloudSignInWithGoogle,
  cloudSignOut,
  fetchStaff,
  googleRedirectResult,
} from './cloudAuth'
import { ensureFirebaseWithin, hasRealAuth } from './firebase'
import { load, save } from './store'
import { uid } from './ids'

const STAFF_KEY = 'ql:staffSession'
const GUEST_DIR_KEY = 'ql:guestDirectory'
const SOS_META_KEY = 'ql:sosMeta'
const SCHEDULED_KEY = 'ql:scheduled'
const SENT_KEY = 'ql:console:sent'

export interface WordInput {
  type: NotificationType
  title: string
  body: string
  icon?: string
}

export interface SentEntry {
  id: string
  title: string
  audienceLabel: string
  count: number
  at: number
}

// ── Staff session ─────────────────────────────────────────────────────────────
//
// The console no longer trusts a locally-picked persona. Whoever opens it signs
// in with a real Firebase account, and only an account carrying a staff/{uid}
// doc gets in — the same doc the Firestore rules gate every staff power on. The
// cached copy below is for rendering only; it grants nothing on its own.

export type StaffSignIn =
  | { ok: true; staff: StaffDoc }
  /**
   * `error: ''` means say nothing: the person cancelled, or the page is
   * navigating away to Google. A gate that reports an error for a decision
   * somebody made on purpose teaches them to distrust it.
   *
   * `uid` is present only when Firebase knows who this is but the roll does
   * not. It is that person's own identifier, shown back to them, and it is the
   * one thing a Warden needs to put them on the roll — without it, migrating an
   * account means digging through the Firebase console for a uid you cannot see
   * from the app that just refused you.
   */
  | { ok: false; error: string; uid?: string }

export function currentStaff(): StaffDoc | null {
  return load<StaffDoc | null>(STAFF_KEY, null)
}

export async function signInStaff(email: string, password: string): Promise<StaffSignIn> {
  const auth = await cloudSignIn(email.trim().toLowerCase(), password)
  if (!auth.ok) {
    return {
      ok: false,
      error:
        auth.kind === 'rejected'
          ? auth.message
          : 'Could not reach the guild roll. Check the connection, then try again.',
    }
  }

  return admit(auth.uid)
}

/**
 * The roll check, and the ONLY door into a staff session.
 *
 * Both providers land here on purpose. Which credential proved who you are is
 * Firebase's business; whether you may open the Back Office is one question with
 * one answer — does staff/{uid} exist — and it is asked in exactly one place so
 * that adding a provider can never accidentally add a way around it.
 */
async function admit(uid: string): Promise<StaffSignIn> {
  const lookup = await fetchStaff(uid)
  if (!lookup.ok) {
    // Not staff: drop the session immediately rather than leaving a signed-in
    // guest sitting on the console.
    await cloudSignOut()
    if (lookup.kind !== 'not-staff') {
      return { ok: false, error: 'Could not reach the guild roll. Check the connection, then try again.' }
    }
    return {
      ok: false,
      error: 'That account is not on the guild roll. Speak with a Warden.',
      uid,
    }
  }

  save<StaffDoc | null>(STAFF_KEY, lookup.staff)
  return { ok: true, staff: lookup.staff }
}

/**
 * Google sign-in, alongside email and password — NOT instead of it.
 *
 * This console and the QAios vault are two apps on one Firebase project, and a
 * person signing into each with a different credential is two uids: the vault
 * roster cannot recognise the console's account and the console cannot recognise
 * the vault's. One Google account everywhere fixes that.
 *
 * It is added BESIDE the password form rather than replacing it, and that is the
 * whole safety of this change. A Google account with no staff/{uid} doc is
 * refused here exactly as any other stranger is — so until a Warden puts the
 * Google uid on the roll, the password path is still the way in and nobody can
 * lock themselves out by trying. Removing the password form is a separate
 * decision for a day when every staff account has been moved across.
 */
export async function signInStaffWithGoogle(): Promise<StaffSignIn> {
  const auth = await cloudSignInWithGoogle()
  if (!auth.ok) {
    if (auth.kind === 'cancelled' || auth.kind === 'redirecting') return { ok: false, error: '' }
    if (auth.kind === 'rejected') return { ok: false, error: auth.message }
    return { ok: false, error: 'Could not reach Google sign-in. Check the connection, then try again.' }
  }
  return admit(auth.uid)
}

/**
 * Finishes a Google sign-in that went the redirect route on the previous page
 * load. Returns null when this load is not the tail of one, which is the normal
 * case — so the gate can call it on every mount without pretending something
 * happened.
 */
export async function completeGoogleSignIn(): Promise<StaffSignIn | null> {
  const result = await googleRedirectResult()
  if (!result) return null
  return admit(result.uid)
}

export async function signOutStaff(): Promise<void> {
  save<StaffDoc | null>(STAFF_KEY, null)
  await cloudSignOut()
}

/**
 * Re-checks the cached session against Firebase on console open. Only a
 * definitive "you are not staff" clears it — an unreachable roll leaves the
 * console usable on its warm mirrors.
 */
export async function revalidateStaff(): Promise<void> {
  const cached = currentStaff()
  if (!cached) return
  // Must wait for the bootstrap: hasRealAuth() reads false until Firebase has
  // restored its session, and checking too early would sign out valid staff.
  const fb = await ensureFirebaseWithin(10_000)
  if (fb && !hasRealAuth()) {
    save<StaffDoc | null>(STAFF_KEY, null)
    return
  }
  const lookup = await fetchStaff(cached.uid)
  if (!lookup.ok && lookup.kind === 'not-staff') {
    save<StaffDoc | null>(STAFF_KEY, null)
    return
  }
  if (lookup.ok) save<StaffDoc | null>(STAFF_KEY, lookup.staff)
}

// ── Local-mirror reads ────────────────────────────────────────────────────────

export function listDirectory(): GuestDoc[] {
  return load<GuestDoc[]>(GUEST_DIR_KEY, [])
}

export function sosMeta(): Record<string, { guestName?: string; zoneName?: string }> {
  return load<Record<string, { guestName?: string; zoneName?: string }>>(SOS_META_KEY, {})
}

export function listScheduled(): ScheduledSend[] {
  return load<ScheduledSend[]>(SCHEDULED_KEY, [])
}

// ── Recent sends (LOCAL log so the presenter sees immediate feedback) ──────────

export function recentSends(): SentEntry[] {
  return load<SentEntry[]>(SENT_KEY, [])
}

export function recordSend(entry: SentEntry): void {
  save<SentEntry[]>(SENT_KEY, [entry, ...recentSends()].slice(0, 20))
}

// ── Send / schedule ───────────────────────────────────────────────────────────

export async function sendWord(audience: Audience, input: WordInput): Promise<number> {
  const directory = listDirectory()
  const targets = resolveAudience(audience, directory)
  const count = await sendWordBatch(targets, input)
  recordSend({
    id: uid(),
    title: input.title,
    audienceLabel: audienceLabel(audience, directory),
    count,
    at: Date.now(),
  })
  return count
}

export function scheduleWord(
  audience: Audience,
  input: WordInput,
  deliverAt: number,
  createdBy: string
): ScheduledSend {
  const id = audience.kind === 'all' ? undefined : audience.id
  const scheduled: ScheduledSend = {
    id: uid(),
    type: input.type,
    title: input.title,
    body: input.body,
    icon: input.icon,
    audience: { kind: audience.kind, id },
    audienceLabel: audienceLabel(audience, listDirectory()),
    deliverAt,
    createdAt: Date.now(),
    createdBy,
    status: 'scheduled',
  }
  pushSchedule(scheduled)
  return scheduled
}

export function cancelScheduled(id: string): void {
  cancelSchedule(id)
}

export { fireDueSchedules }
