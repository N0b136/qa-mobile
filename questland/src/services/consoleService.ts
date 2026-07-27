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
import { cloudSignIn, cloudSignOut, fetchStaff } from './cloudAuth'
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
  | { ok: false; error: string }

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

  const lookup = await fetchStaff(auth.uid)
  if (!lookup.ok) {
    // Not staff: drop the session immediately rather than leaving a signed-in
    // guest sitting on the console.
    await cloudSignOut()
    return {
      ok: false,
      error:
        lookup.kind === 'not-staff'
          ? 'That account is not on the guild roll. Speak with a Warden.'
          : 'Could not reach the guild roll. Check the connection, then try again.',
    }
  }

  save<StaffDoc | null>(STAFF_KEY, lookup.staff)
  return { ok: true, staff: lookup.staff }
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
