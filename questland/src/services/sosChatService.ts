// Threads hung off a call for aid. One thread per SosRequest, keyed on its id —
// so a guest who opened a quiet 'chat' and a party whose emergency is already
// dispatched are talking through exactly the same machinery.
//
// ── WHY THIS SERVICE IS NOT LIKE THE OTHERS ──────────────────────────────────
//
// Every other local-first service in this app pushes fire-and-forget: write the
// mirror, kick a write-through, swallow whatever comes back. That is right for a
// booking (the mirror IS the guest's copy) and it is a LIE in a conversation —
// the guest reads their unsent message sitting in the thread and stops talking,
// believing a Warden has it.
//
// So a message carries `delivery`, and only the SERVER moves it off 'pending':
//   • the push promise resolves          → 'sent'
//   • it rejects with an adjudicated code → 'failed' (offer the retry)
//   • it never settles (offline)          → stays 'pending', which is the truth:
//     the SDK has it queued in IndexedDB and will send it, but nobody has
//     received it yet.
//
// That last case is why `reconcile()` exists. An offline write survives the tab
// closing, so the promise that would have resolved it is long gone by the time
// it actually lands; the thread listener seeing the message come back FROM the
// server is the authoritative acknowledgement, and the only one that survives a
// reload.

import type { SosMessage, SosMessageAuthor } from '../types'
import { load, remove, save } from './store'
import { uid } from './ids'
import * as cloudSync from './cloudSync'

/** Trimmed into SosRequest.lastMessagePreview. A preview, never the record. */
const PREVIEW_CAP = 80

/** Keeps one runaway thread from filling the origin's quota. Oldest fall off. */
const THREAD_CAP = 400

const threadKey = (sosId: string) => `ql:sosChat:${sosId}`
const READ_KEY = 'ql:sosChatRead'

/** Oldest first — a transcript reads down the page. */
export function listMessages(sosId: string): SosMessage[] {
  return load<SosMessage[]>(threadKey(sosId), [])
}

function setThread(sosId: string, messages: SosMessage[]): void {
  const trimmed =
    messages.length > THREAD_CAP ? messages.slice(messages.length - THREAD_CAP) : messages
  save(threadKey(sosId), trimmed)
}

export function lastMessage(sosId: string): SosMessage | null {
  const all = listMessages(sosId)
  return all.length ? all[all.length - 1] : null
}

export function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_CAP ? `${flat.slice(0, PREVIEW_CAP - 1)}…` : flat
}

// ── Read state ───────────────────────────────────────────────────────────────
//
// Unread is derived on the device that is reading, from a local high-water mark,
// and is deliberately NOT a counter field on the sos document. A counter would
// mean every open of a thread is a Firestore write racing the other side's
// write to the same doc — cost and contention bought for something each device
// can work out for itself from messages it already holds.

function readMarks(): Record<string, number> {
  return load<Record<string, number>>(READ_KEY, {})
}

/**
 * Keyed by VIEWER as well as thread. The guest app and the console are two
 * documents on one origin sharing one localStorage, so a single key per thread
 * would let a Warden reading the console mark the guest's own phone caught up.
 */
const markKey = (sosId: string, viewer: SosMessageAuthor) => `${sosId}:${viewer}`

export function readMark(sosId: string, viewer: SosMessageAuthor): number {
  return readMarks()[markKey(sosId, viewer)] ?? 0
}

/**
 * `floorAt` is the parent call's `lastMessageAt`, when the caller has it. The
 * board badges off that stamp while the thread's messages are not mirrored, and
 * the stamp is written a moment AFTER the message it describes — so marking read
 * from messages alone would leave the badge lit on a thread just read.
 */
export function markThreadRead(
  sosId: string,
  viewer: SosMessageAuthor,
  floorAt?: number
): void {
  // ONLY the other side's lines move the mark.
  //
  // Every timestamp here is `Date.now()` on whichever device sent, and the two
  // clocks do not agree. Taking the max across BOTH sides let the Warden's own
  // reply — stamped by the console — carry the mark past a guest message that a
  // slow phone had stamped earlier, and that guest's next question then landed
  // already-read and never badged. Counting only what the viewer has to read
  // keeps one device's clock out of the other's arithmetic entirely.
  const newestIncoming = listMessages(sosId)
    .filter((m) => m.from !== viewer)
    .reduce((max, m) => (m.createdAt > max ? m.createdAt : max), 0)

  const next = Math.max(newestIncoming, floorAt ?? 0)
  if (next === 0) return

  const marks = readMarks()
  const key = markKey(sosId, viewer)
  if ((marks[key] ?? 0) >= next) return
  save(READ_KEY, { ...marks, [key]: next })
}

/**
 * Exact count, for a thread whose messages this device actually holds.
 * The board cannot use this — see `hasUnread`.
 */
export function unreadCount(sosId: string, viewer: SosMessageAuthor): number {
  const mark = readMark(sosId, viewer)
  return listMessages(sosId).filter((m) => m.from !== viewer && m.createdAt > mark).length
}

/**
 * "There is new word here", read off the PARENT call's stamps.
 *
 * This is the only unread signal the board can honestly show. `unreadCount`
 * reads the message mirror, and that mirror is filled by the thread listener,
 * which by design runs only while the thread is OPEN — so on the board it is
 * empty for every thread that is not on screen, and the count it returns is
 * structurally zero exactly when a Warden needs it. Worse, opening the thread to
 * populate the mirror is the same gesture that marks it read.
 *
 * A boolean is the honest shape: the stamps say who spoke last and when, and
 * nothing else. An exact count needs the messages, and the messages are what the
 * board deliberately does not fetch.
 */
export function hasUnread(
  call: { id: string; lastMessageAt?: number; lastMessageFrom?: SosMessageAuthor },
  viewer: SosMessageAuthor
): boolean {
  if (!call.lastMessageAt || call.lastMessageFrom === viewer) return false
  return call.lastMessageAt > readMark(call.id, viewer)
}

// ── Sending ──────────────────────────────────────────────────────────────────

/**
 * Writes the message to the mirror as 'pending' and returns IMMEDIATELY — the
 * thread paints at once, with the message visibly not yet delivered. Delivery
 * resolves later, through `deliver()` or through `reconcile()` on a reload.
 */
export function sendMessage(
  sosId: string,
  input: { from: SosMessageAuthor; authorName: string; body: string }
): SosMessage | null {
  const body = input.body.trim()
  if (!body) return null

  const message: SosMessage = {
    id: uid(),
    sosId,
    from: input.from,
    authorName: input.authorName,
    body,
    createdAt: Date.now(),
    delivery: 'pending',
  }
  setThread(sosId, [...listMessages(sosId), message])
  void deliver(message)
  return message
}

/** Re-pushes a failed message under its ORIGINAL id, so a retry cannot double-post. */
export function retryMessage(sosId: string, messageId: string): void {
  const message = listMessages(sosId).find((m) => m.id === messageId)
  if (!message || message.delivery !== 'failed') return
  setDelivery(sosId, messageId, 'pending')
  void deliver({ ...message, delivery: 'pending' })
}

async function deliver(message: SosMessage): Promise<void> {
  const result = await cloudSync.pushSosMessage(message)
  if (result.ok) {
    setDelivery(message.sosId, message.id, 'sent')
    return
  }
  // 'unavailable' means nobody answered — the SDK still holds the write and will
  // send it. Leaving it 'pending' is the accurate report; flipping it to
  // 'failed' would invite a retry that duplicates nothing but tells the sender
  // their message is lost when it is merely queued.
  if (result.reason === 'refused') setDelivery(message.sosId, message.id, 'failed')
}

function setDelivery(sosId: string, messageId: string, state: SosMessage['delivery']): void {
  const all = listMessages(sosId)
  const idx = all.findIndex((m) => m.id === messageId)
  if (idx === -1 || all[idx].delivery === state) return
  const next = [...all]
  next[idx] = { ...next[idx], delivery: state }
  setThread(sosId, next)
}

// ── Cloud reconciliation (called by cloudSync's thread listener) ─────────────

/**
 * Merges a server view of one thread into the mirror.
 *
 * Server copy wins on content — a message is written once, so any disagreement
 * is this device holding a stale draft rather than an edit worth keeping. The
 * one thing the merge protects is a LOCAL-ONLY message that the server has not
 * seen yet: it stays in place, still 'pending', rather than being dropped by a
 * snapshot that predates it.
 *
 * A local message appearing in the snapshot is the acknowledgement that
 * survives a reload — see the note at the top of this file.
 */
export function reconcile(sosId: string, incoming: SosMessage[]): void {
  const local = listMessages(sosId)
  const localById = new Map(local.map((m) => [m.id, m] as const))
  const serverIds = new Set(incoming.map((m) => m.id))

  // Anything this device wrote that the server has not echoed back yet.
  const stillPending = local.filter((m) => !serverIds.has(m.id) && m.delivery !== undefined)

  const merged = [...incoming.map((m) => ({ ...m, ...ackOf(localById.get(m.id)) })), ...stillPending]
  merged.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))

  if (!sameThread(local, merged)) setThread(sosId, merged)
}

/**
 * A message we sent that has come back from the server is delivered, full stop —
 * so it keeps `delivery: 'sent'` rather than losing the marker entirely, because
 * the sender's own bubble should read "sent" and not silently become
 * indistinguishable from one that arrived from the other side.
 */
function ackOf(localCopy: SosMessage | undefined): { delivery?: 'sent' } {
  return localCopy?.delivery ? { delivery: 'sent' } : {}
}

function sameThread(a: SosMessage[], b: SosMessage[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].delivery !== b[i].delivery || a[i].body !== b[i].body) {
      return false
    }
  }
  return true
}

/**
 * Drops EVERY thread mirror and read mark on this device.
 *
 * Swept wholesale rather than per sos id, because a thread key is
 * `ql:sosChat:${uid()}` — it carries no `demo-` marker and no link back to the
 * row it belonged to, so a prefix sweep over the sos rows structurally cannot
 * find it and a per-id clear misses any thread whose row is already gone.
 * Called by the demo reset, which is the only thing in the app that claims to
 * put a device back to nothing.
 */
export function clearAllThreads(): void {
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('ql:sosChat:')) doomed.push(key)
  }
  doomed.forEach((k) => remove(k))
  save(READ_KEY, {})
}
