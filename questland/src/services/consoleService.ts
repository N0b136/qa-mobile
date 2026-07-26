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
import { load, save } from './store'
import { uid } from './ids'

const PERSONA_KEY = 'ql:staffPersona'
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

// ── Staff persona (LOCAL only, never synced) ──────────────────────────────────

export function getStaffPersonaId(): string | null {
  return load<string | null>(PERSONA_KEY, null)
}

export function setStaffPersonaId(id: string): void {
  save<string>(PERSONA_KEY, id)
}

export function clearStaffPersonaId(): void {
  save<string | null>(PERSONA_KEY, null)
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
