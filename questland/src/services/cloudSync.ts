// The cloud bridge. Every Firestore onSnapshot writes the local mirror via
// store.save(), which lights up all subscribed screens for free. Every push is
// a fire-and-forget write-through: when Firebase is unconfigured, ensureFirebase()
// resolves null and each of these becomes a silent, network-free no-op.
//
// NOTE ON CYCLES: this module is imported (statically) by notificationService,
// sosService, authService, progressService and Shell. It must NOT statically
// import notificationService (that would be a direct cycle) — the one place it
// needs systemNotify (the remote banner) uses a lazy dynamic import instead.

import type {
  QuerySnapshot,
  DocumentData,
  DocumentReference,
} from 'firebase/firestore'
import type {
  AppNotification,
  Booking,
  NotificationType,
  Party,
  ProgressMap,
  SosRequest,
  SosStatus,
  User,
} from '../types'
import { load, save } from './store'
import { uid } from './ids'
import { ensureFirebase, ensureFirebaseWithin, setCloudState } from './firebase'
import { totalXp, levelFor } from './progressService'
import { getUserParty } from './partyService'
import { getOrg } from '../content/orgs'

/** Party writes happen behind a spinner, so they get the same deadline as auth. */
const PARTY_TIMEOUT_MS = 10_000

// ── Shared / pure types (console layer imports these from here) ───────────────

export interface GuestDoc {
  id: string
  name: string
  avatar?: string
  orgId?: string
  partyId?: string
  partyName?: string
  level: number
  updatedAt: number
}

export type Audience =
  | { kind: 'all' }
  | { kind: 'guest'; id: string }
  | { kind: 'party'; id: string }
  | { kind: 'org'; id: string }

export interface ScheduledSend {
  id: string
  type: NotificationType
  title: string
  body: string
  icon?: string
  audience: { kind: Audience['kind']; id?: string }
  audienceLabel: string
  deliverAt: number
  createdAt: number
  createdBy: string
  status: 'scheduled' | 'fired' | 'cancelled'
  firedAt?: number
  count?: number
}

/** Outcome of a party write that had to be adjudicated by the server. */
export type PartyResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'unavailable' }

// Local mirror keys
const SOS_KEY = 'ql:sos'
const SOS_META_KEY = 'ql:sosMeta'
const GUEST_DIR_KEY = 'ql:guestDirectory'
const SCHEDULED_KEY = 'ql:scheduled'
const USERS_KEY = 'ql:users'
const PARTIES_KEY = 'ql:parties'
const notifKey = (userId: string) => `ql:notifications:${userId}`
const progressKey = (userId: string) => `ql:progress:${userId}`
const bookingsKey = (userId: string) => `ql:bookings:${userId}`

function normalizePartyCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '')
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function resolveAudience(a: Audience, directory: GuestDoc[]): GuestDoc[] {
  switch (a.kind) {
    case 'all':
      return directory
    case 'guest':
      return directory.filter((g) => g.id === a.id)
    case 'party':
      return directory.filter((g) => g.partyId === a.id)
    case 'org':
      return directory.filter((g) => g.orgId === a.id)
    default:
      return []
  }
}

export function audienceLabel(a: Audience, directory: GuestDoc[]): string {
  switch (a.kind) {
    case 'all':
      return 'All guests'
    case 'guest':
      return directory.find((g) => g.id === a.id)?.name ?? 'A guest'
    case 'party':
      return directory.find((g) => g.partyId === a.id && g.partyName)?.partyName ?? 'A party'
    case 'org':
      return getOrg(a.id)?.name ?? 'An order'
    default:
      return 'All guests'
  }
}

function audienceFromDoc(a: { kind: Audience['kind']; id?: string }): Audience {
  switch (a.kind) {
    case 'guest':
      return { kind: 'guest', id: a.id ?? '' }
    case 'party':
      return { kind: 'party', id: a.id ?? '' }
    case 'org':
      return { kind: 'org', id: a.id ?? '' }
    default:
      return { kind: 'all' }
  }
}

// Strip undefined-valued keys — Firestore rejects `undefined` field values.
function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj)) {
    if (obj[k] !== undefined) out[k] = obj[k]
  }
  return out as T
}

// Order-independent structural equality (avoids notify churn when cloud docs
// come back with a different key order than the local mirror).
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

function statusRank(s: SosStatus): number {
  return s === 'open' ? 0 : s === 'acknowledged' ? 1 : 2
}

// Last-Write-Wins on updatedAt; equal timestamps tiebreak by status rank so a
// resolve never loses to a same-millisecond open. A behind (stale) clock always
// carries a smaller updatedAt and so can never resurrect a resolved call.
function sosIsNewer(incoming: SosRequest, existing: SosRequest): boolean {
  if (incoming.updatedAt > existing.updatedAt) return true
  if (incoming.updatedAt < existing.updatedAt) return false
  return statusRank(incoming.status) > statusRank(existing.status)
}

function buildGuestDoc(user: User): GuestDoc & { demo?: true } {
  const doc: GuestDoc & { demo?: true } = {
    id: user.id,
    name: user.name,
    level: levelFor(totalXp(user.id)),
    updatedAt: Date.now(),
  }
  if (user.avatar) doc.avatar = user.avatar
  if (user.orgId) doc.orgId = user.orgId
  if (user.partyId) doc.partyId = user.partyId
  const party = getUserParty(user.id)
  if (party?.name) doc.partyName = party.name
  if (user.id.startsWith('demo-')) doc.demo = true
  return doc
}

function stripNotif(data: AppNotification & { userId?: string; demo?: boolean }): AppNotification {
  const n: AppNotification = {
    id: data.id,
    type: data.type,
    title: data.title,
    body: data.body,
    read: !!data.read,
    createdAt: data.createdAt,
  }
  if (data.icon !== undefined) n.icon = data.icon
  return n
}

// Lazy — breaks the notificationService <-> cloudSync cycle.
async function banner(title: string, body: string): Promise<void> {
  try {
    const { systemNotify } = await import('./notificationService')
    void systemNotify(title, body)
  } catch {
    // best-effort side channel
  }
}

// ── Snapshot → local-mirror merges ────────────────────────────────────────────

function mergeSosSnapshot(snap: QuerySnapshot<DocumentData>): void {
  const local = load<SosRequest[]>(SOS_KEY, [])
  const localById = new Map(local.map((r) => [r.id, r] as const))

  const removedIds = new Set<string>()
  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') removedIds.add(c.doc.id)
  })

  const meta = load<Record<string, { guestName?: string; zoneName?: string }>>(SOS_META_KEY, {})
  const nextMeta = { ...meta }
  let metaChanged = false

  const winners = new Map<string, SosRequest>()
  snap.forEach((docSnap) => {
    const data = docSnap.data() as SosRequest & { guestName?: string; zoneName?: string }
    const { guestName, zoneName, ...rest } = data
    const incoming = rest as SosRequest
    const existing = localById.get(incoming.id)
    winners.set(incoming.id, existing && !sosIsNewer(incoming, existing) ? existing : incoming)

    if (guestName !== undefined || zoneName !== undefined) {
      const m: { guestName?: string; zoneName?: string } = {}
      if (guestName !== undefined) m.guestName = guestName
      if (zoneName !== undefined) m.zoneName = zoneName
      if (!deepEqual(nextMeta[incoming.id], m)) {
        nextMeta[incoming.id] = m
        metaChanged = true
      }
    }
  })

  // Preserve local order; apply winners + drop removed. New cloud docs prepend
  // newest-first (consistent with createSos prepend) — once saved they land in
  // `local` so they never move again.
  const seen = new Set<string>()
  const merged: SosRequest[] = []
  for (const r of local) {
    if (removedIds.has(r.id)) continue
    merged.push(winners.get(r.id) ?? r)
    seen.add(r.id)
  }
  const fresh: SosRequest[] = []
  winners.forEach((w, id) => {
    if (!seen.has(id) && !removedIds.has(id)) fresh.push(w)
  })
  fresh.sort((a, b) => b.createdAt - a.createdAt)
  const finalMerged = [...fresh, ...merged]

  for (const id of removedIds) {
    if (nextMeta[id]) {
      delete nextMeta[id]
      metaChanged = true
    }
  }

  if (!deepEqual(finalMerged, local)) save(SOS_KEY, finalMerged)
  if (metaChanged) save(SOS_META_KEY, nextMeta)
}

function mergeNotifSnapshot(userId: string, snap: QuerySnapshot<DocumentData>): void {
  const local = load<AppNotification[]>(notifKey(userId), [])
  const byId = new Map(local.map((n) => [n.id, n] as const))

  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') byId.delete(c.doc.id)
  })

  snap.forEach((docSnap) => {
    const n = stripNotif(docSnap.data() as AppNotification & { userId?: string; demo?: boolean })
    const existing = byId.get(n.id)
    // read is monotonic (once read, stays read) — local markRead isn't pushed.
    byId.set(n.id, existing ? { ...n, read: existing.read || n.read } : n)
  })

  const merged = Array.from(byId.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
  if (!deepEqual(merged, local)) save(notifKey(userId), merged)
}

function mergeGuestsSnapshot(snap: QuerySnapshot<DocumentData>): void {
  const dir: GuestDoc[] = []
  snap.forEach((d) => {
    const data = d.data() as GuestDoc & { demo?: boolean }
    const g: GuestDoc = {
      id: data.id ?? d.id,
      name: data.name,
      level: data.level ?? 1,
      updatedAt: data.updatedAt ?? 0,
    }
    if (data.avatar !== undefined) g.avatar = data.avatar
    if (data.orgId !== undefined) g.orgId = data.orgId
    if (data.partyId !== undefined) g.partyId = data.partyId
    if (data.partyName !== undefined) g.partyName = data.partyName
    dir.push(g)
  })
  dir.sort((a, b) => b.updatedAt - a.updatedAt)
  if (!deepEqual(dir, load<GuestDoc[]>(GUEST_DIR_KEY, []))) save(GUEST_DIR_KEY, dir)
  mergeGuestShadows(dir)
}

/**
 * Mirrors the public directory into ql:users as read-only shells, so a party
 * roster or the leaderboard can name and rank guests whose accounts were made on
 * another device. A shell never overwrites a real local account (yours, or the
 * seeded demo cast) — those records own their own id.
 */
function mergeGuestShadows(dir: GuestDoc[]): void {
  const users = load<User[]>(USERS_KEY, [])
  const byId = new Map(users.map((u) => [u.id, u] as const))
  let changed = false

  for (const g of dir) {
    const existing = byId.get(g.id)
    if (existing && !existing.remote) continue
    const shell: User = {
      id: g.id,
      email: '',
      name: g.name,
      avatar: g.avatar ?? 'shield',
      createdAt: existing?.createdAt ?? 0,
      remote: true,
      updatedAt: g.updatedAt,
    }
    if (g.orgId) shell.orgId = g.orgId
    if (g.partyId) shell.partyId = g.partyId
    if (!existing || !deepEqual(existing, shell)) {
      byId.set(g.id, shell)
      changed = true
    }
  }

  if (changed) save(USERS_KEY, Array.from(byId.values()))
}

/**
 * Announces companions who have joined a party you are already in.
 *
 * This runs on the RECIPIENT's device, off the roster change itself, because
 * the joiner is not allowed to write into anybody else's inbox — the rules see
 * to that, and it was never really theirs to write.
 */
function announceNewMembers(selfId: string, before: Party[], after: Party[]): void {
  const beforeById = new Map(before.map((p) => [p.id, p] as const))
  const arrivals: Array<{ memberId: string; party: Party }> = []

  for (const party of after) {
    if (!party.memberIds.includes(selfId)) continue
    const prior = beforeById.get(party.id)
    // No prior copy means this is the party YOU just joined — not an arrival.
    if (!prior || !prior.memberIds.includes(selfId)) continue
    const known = new Set(prior.memberIds)
    for (const memberId of party.memberIds) {
      if (memberId !== selfId && !known.has(memberId)) arrivals.push({ memberId, party })
    }
  }
  if (arrivals.length === 0) return

  const users = load<User[]>(USERS_KEY, [])
  void (async () => {
    try {
      const { add } = await import('./notificationService')
      for (const { memberId, party } of arrivals) {
        const name = users.find((u) => u.id === memberId)?.name ?? 'An adventurer'
        add(selfId, {
          type: 'system',
          title: `${name} joined your party`,
          body: `${name} answered your invite code and is now travelling with ${party.name}.`,
          icon: 'users',
        })
      }
    } catch {
      // best-effort — the roster itself is already correct on screen
    }
  })()
}

function mergePartiesSnapshot(snap: QuerySnapshot<DocumentData>, selfId: string, primed: boolean): void {
  const local = load<Party[]>(PARTIES_KEY, [])
  const byId = new Map(local.map((p) => [p.id, p] as const))

  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') byId.delete(c.doc.id)
  })

  snap.forEach((d) => {
    const data = d.data() as Party
    const party: Party = {
      id: data.id ?? d.id,
      code: data.code,
      name: data.name,
      memberIds: data.memberIds ?? [],
      cloud: true,
    }
    if (data.createdAt !== undefined) party.createdAt = data.createdAt
    if (data.updatedAt !== undefined) party.updatedAt = data.updatedAt
    byId.set(party.id, party)
  })

  const merged = Array.from(byId.values())
  if (deepEqual(merged, local)) return
  save(PARTIES_KEY, merged)
  // The first snapshot is just the mirror catching up — everyone would look new.
  if (primed) announceNewMembers(selfId, local, merged)
}

/**
 * Progress is monotonic — an episode is only ever added — so your own doc merges
 * as a UNION and a stale snapshot can never erase a completion you just earned.
 * Other guests' docs are taken as-is; this device never writes them.
 */
function mergeProgressSnapshot(snap: QuerySnapshot<DocumentData>, selfId: string): void {
  snap.forEach((d) => {
    const data = d.data() as { id?: string; map?: ProgressMap }
    const id = data.id ?? d.id
    const incoming = data.map ?? {}
    const localMap = load<ProgressMap>(progressKey(id), {})

    let next: ProgressMap
    if (id === selfId) {
      next = { ...localMap }
      for (const orgId of Object.keys(incoming)) {
        next[orgId] = Array.from(new Set([...(localMap[orgId] ?? []), ...incoming[orgId]]))
      }
    } else {
      next = incoming
    }
    if (!deepEqual(next, localMap)) save(progressKey(id), next)
  })
}

function bookingStamp(b: Booking | undefined): number {
  if (!b) return -1
  return b.updatedAt ?? b.createdAt
}

function mergeBookingsSnapshot(userId: string, snap: QuerySnapshot<DocumentData>): void {
  const local = load<Booking[]>(bookingsKey(userId), [])
  const byId = new Map(local.map((b) => [b.id, b] as const))

  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') byId.delete(c.doc.id)
  })

  snap.forEach((d) => {
    const incoming = d.data() as Booking
    const existing = byId.get(incoming.id)
    if (bookingStamp(incoming) >= bookingStamp(existing)) byId.set(incoming.id, incoming)
  })

  const merged = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
  if (!deepEqual(merged, local)) save(bookingsKey(userId), merged)
}

function mergeScheduledSnapshot(snap: QuerySnapshot<DocumentData>): void {
  const list: ScheduledSend[] = []
  snap.forEach((d) => list.push(d.data() as ScheduledSend))
  list.sort((a, b) => a.deliverAt - b.deliverAt)
  if (!deepEqual(list, load<ScheduledSend[]>(SCHEDULED_KEY, []))) save(SCHEDULED_KEY, list)
}

// ── Listener lifecycles ───────────────────────────────────────────────────────

export function startGuestSync(userId: string): () => void {
  let disposed = false
  const unsubs: Array<() => void> = []

  void ensureFirebase().then(async (fb) => {
    if (!fb || disposed) return
    try {
      const { collection, query, where, onSnapshot } = await import('firebase/firestore')

      const sosUnsub = onSnapshot(
        query(collection(fb.db, 'sos'), where('userId', '==', userId)),
        { includeMetadataChanges: true },
        (snap) => {
          mergeSosSnapshot(snap)
          setCloudState(snap.metadata.fromCache ? 'offline' : 'live')
        },
        () => setCloudState('offline')
      )
      unsubs.push(sosUnsub)

      const syncStartTs = Date.now()
      const preMergeLocalIds = new Set(
        load<AppNotification[]>(notifKey(userId), []).map((n) => n.id)
      )
      const notifUnsub = onSnapshot(
        query(collection(fb.db, 'notifications'), where('userId', '==', userId)),
        { includeMetadataChanges: true },
        (snap) => {
          mergeNotifSnapshot(userId, snap)
          snap.docChanges().forEach((change) => {
            const data = change.doc.data() as AppNotification & { userId: string }
            if (
              change.type === 'added' &&
              !change.doc.metadata.hasPendingWrites &&
              data.createdAt > syncStartTs &&
              !preMergeLocalIds.has(data.id)
            ) {
              void banner(data.title, data.body)
            }
          })
          setCloudState(snap.metadata.fromCache ? 'offline' : 'live')
        },
        () => setCloudState('offline')
      )
      unsubs.push(notifUnsub)

      // Your own passages, wherever they were booked.
      unsubs.push(
        onSnapshot(
          query(collection(fb.db, 'bookings'), where('userId', '==', userId)),
          (snap) => mergeBookingsSnapshot(userId, snap),
          () => setCloudState('offline')
        )
      )

      // Any party you belong to — the roster is authoritative in Firestore.
      let partiesPrimed = false
      unsubs.push(
        onSnapshot(
          query(collection(fb.db, 'parties'), where('memberIds', 'array-contains', userId)),
          (snap) => {
            mergePartiesSnapshot(snap, userId, partiesPrimed)
            partiesPrimed = true
          },
          () => setCloudState('offline')
        )
      )

      // The public directory + everyone's progress: what lets a party roster and
      // the leaderboard show guests who signed up on a different device.
      unsubs.push(
        onSnapshot(
          collection(fb.db, 'guests'),
          (snap) => mergeGuestsSnapshot(snap),
          () => setCloudState('offline')
        )
      )
      unsubs.push(
        onSnapshot(
          collection(fb.db, 'progress'),
          (snap) => mergeProgressSnapshot(snap, userId),
          () => setCloudState('offline')
        )
      )

      if (disposed) unsubs.forEach((u) => u())
    } catch {
      setCloudState('offline')
    }
  })

  return () => {
    disposed = true
    unsubs.forEach((u) => u())
  }
}

export function startConsoleSync(): () => void {
  let disposed = false
  const unsubs: Array<() => void> = []

  void ensureFirebase().then(async (fb) => {
    if (!fb || disposed) return
    try {
      const { collection, onSnapshot } = await import('firebase/firestore')

      unsubs.push(
        onSnapshot(
          collection(fb.db, 'sos'),
          { includeMetadataChanges: true },
          (snap) => {
            mergeSosSnapshot(snap)
            setCloudState(snap.metadata.fromCache ? 'offline' : 'live')
          },
          () => setCloudState('offline')
        )
      )
      unsubs.push(
        onSnapshot(
          collection(fb.db, 'guests'),
          (snap) => mergeGuestsSnapshot(snap),
          () => setCloudState('offline')
        )
      )
      unsubs.push(
        onSnapshot(
          collection(fb.db, 'scheduled'),
          (snap) => mergeScheduledSnapshot(snap),
          () => setCloudState('offline')
        )
      )

      if (disposed) unsubs.forEach((u) => u())
    } catch {
      setCloudState('offline')
    }
  })

  return () => {
    disposed = true
    unsubs.forEach((u) => u())
  }
}

// ── Write-through push functions (fire-and-forget, never throw) ───────────────

export function pushSos(
  r: SosRequest,
  extras: { guestName: string; zoneName?: string; demo?: boolean }
): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      const payload = clean({
        ...r,
        guestName: extras.guestName,
        zoneName: extras.zoneName,
        ...(extras.demo ? { demo: true } : {}),
      })
      await setDoc(doc(fb.db, 'sos', r.id), payload)
    } catch {
      // swallow
    }
  })
}

export function pushSosPatch(
  id: string,
  patch: { status: SosStatus; responder?: string; updatedAt: number }
): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, updateDoc } = await import('firebase/firestore')
      const fields = clean({
        status: patch.status,
        updatedAt: patch.updatedAt,
        responder: patch.responder,
      })
      await updateDoc(doc(fb.db, 'sos', id), fields)
    } catch {
      // swallow
    }
  })
}

export function pushNotification(userId: string, n: AppNotification, demo?: boolean): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      const payload = clean({ ...n, userId, ...(demo ? { demo: true } : {}) })
      await setDoc(doc(fb.db, 'notifications', n.id), payload)
    } catch {
      // swallow
    }
  })
}

export function pushGuestProfile(user: User): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      await setDoc(doc(fb.db, 'guests', user.id), buildGuestDoc(user))
    } catch {
      // swallow
    }
  })
}

/**
 * Unions local progress into progress/{userId} inside a transaction and writes
 * the result back to both sides. Because episodes are only ever added, a union
 * is always the correct resolution — this can neither lose a completion earned
 * offline on this phone nor one earned earlier on another.
 */
export function pushProgress(userId: string): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, runTransaction } = await import('firebase/firestore')
      const ref = doc(fb.db, 'progress', userId)

      const union = await runTransaction(fb.db, async (tx) => {
        const snap = await tx.get(ref)
        const remote = snap.exists() ? ((snap.data() as { map?: ProgressMap }).map ?? {}) : {}
        const localMap = load<ProgressMap>(progressKey(userId), {})
        const merged: ProgressMap = { ...remote }
        for (const orgId of Object.keys(localMap)) {
          merged[orgId] = Array.from(new Set([...(remote[orgId] ?? []), ...localMap[orgId]]))
        }
        tx.set(ref, { id: userId, map: merged, updatedAt: Date.now() })
        return merged
      })

      if (!deepEqual(union, load<ProgressMap>(progressKey(userId), {}))) {
        save(progressKey(userId), union)
      }
    } catch {
      // swallow
    }
  })
}

export function pushBooking(booking: Booking): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      await setDoc(doc(fb.db, 'bookings', booking.id), clean({ ...booking }))
    } catch {
      // swallow
    }
  })
}

/** One-shot upload of a whole local booking list — used after an account migration. */
export function pushBookings(userId: string): void {
  for (const booking of load<Booking[]>(bookingsKey(userId), [])) pushBooking(booking)
}

// ── Party writes (server-adjudicated) ────────────────────────────────────────
//
// A party's invite code is claimed in partyCodes/{CODE} inside a transaction, so
// two phones generating the same 6-character code can never both keep it, and a
// join is an O(1) lookup on that same doc rather than a scan.

function partyFromDoc(data: Party): Party {
  const party: Party = {
    id: data.id,
    code: data.code,
    name: data.name,
    memberIds: data.memberIds ?? [],
    cloud: true,
  }
  if (data.createdAt !== undefined) party.createdAt = data.createdAt
  if (data.updatedAt !== undefined) party.updatedAt = data.updatedAt
  return party
}

/** Registers a party and claims its code atomically. `not-found` means the code was taken. */
export async function createPartyDoc(party: Party): Promise<PartyResult<Party>> {
  const fb = await ensureFirebaseWithin(PARTY_TIMEOUT_MS)
  if (!fb) return { ok: false, reason: 'unavailable' }
  try {
    const { doc, runTransaction } = await import('firebase/firestore')
    const code = normalizePartyCode(party.code)
    const stored: Party = {
      ...party,
      code,
      cloud: true,
      createdAt: party.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }

    const claimed = await runTransaction(fb.db, async (tx) => {
      const codeRef = doc(fb.db, 'partyCodes', code)
      if ((await tx.get(codeRef)).exists()) return false
      tx.set(codeRef, { code, partyId: stored.id })
      tx.set(doc(fb.db, 'parties', stored.id), {
        id: stored.id,
        code: stored.code,
        name: stored.name,
        memberIds: stored.memberIds,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      })
      return true
    })
    return claimed ? { ok: true, value: stored } : { ok: false, reason: 'not-found' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Validates an invite code against Firestore and adds the guest to that party. */
export async function joinPartyDoc(code: string, userId: string): Promise<PartyResult<Party>> {
  const fb = await ensureFirebaseWithin(PARTY_TIMEOUT_MS)
  if (!fb) return { ok: false, reason: 'unavailable' }
  try {
    const { doc, runTransaction } = await import('firebase/firestore')
    const normalized = normalizePartyCode(code)

    const result = await runTransaction(fb.db, async (tx) => {
      const codeSnap = await tx.get(doc(fb.db, 'partyCodes', normalized))
      if (!codeSnap.exists()) return null
      const partyId = (codeSnap.data() as { partyId?: string }).partyId
      if (!partyId) return null

      const partyRef = doc(fb.db, 'parties', partyId)
      const partySnap = await tx.get(partyRef)
      if (!partySnap.exists()) return null

      const data = partyFromDoc(partySnap.data() as Party)
      const memberIds = data.memberIds.includes(userId) ? data.memberIds : [...data.memberIds, userId]
      const updatedAt = Date.now()
      tx.update(partyRef, { memberIds, updatedAt })
      return { ...data, memberIds, updatedAt }
    })

    return result ? { ok: true, value: result } : { ok: false, reason: 'not-found' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Removes the guest; the last one out takes the party and its code with them. */
export async function leavePartyDoc(partyId: string, userId: string): Promise<PartyResult<null>> {
  const fb = await ensureFirebaseWithin(PARTY_TIMEOUT_MS)
  if (!fb) return { ok: false, reason: 'unavailable' }
  try {
    const { doc, runTransaction } = await import('firebase/firestore')
    await runTransaction(fb.db, async (tx) => {
      const partyRef = doc(fb.db, 'parties', partyId)
      const snap = await tx.get(partyRef)
      if (!snap.exists()) return
      const data = partyFromDoc(snap.data() as Party)
      const memberIds = data.memberIds.filter((id) => id !== userId)
      if (memberIds.length === 0) {
        tx.delete(partyRef)
        tx.delete(doc(fb.db, 'partyCodes', normalizePartyCode(data.code)))
      } else {
        tx.update(partyRef, { memberIds, updatedAt: Date.now() })
      }
    })
    return { ok: true, value: null }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

export function renamePartyDoc(partyId: string, name: string): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, updateDoc } = await import('firebase/firestore')
      await updateDoc(doc(fb.db, 'parties', partyId), { name, updatedAt: Date.now() })
    } catch {
      // swallow
    }
  })
}

export async function sendWordBatch(
  targets: GuestDoc[],
  input: { type: NotificationType; title: string; body: string; icon?: string }
): Promise<number> {
  const fb = await ensureFirebase()
  if (!fb) return 0
  try {
    const { doc, writeBatch } = await import('firebase/firestore')
    let count = 0
    for (let i = 0; i < targets.length; i += 450) {
      const batch = writeBatch(fb.db)
      for (const t of targets.slice(i, i + 450)) {
        const id = uid()
        const payload = clean({
          id,
          type: input.type,
          title: input.title,
          body: input.body,
          icon: input.icon,
          read: false,
          createdAt: Date.now(),
          userId: t.id,
        })
        batch.set(doc(fb.db, 'notifications', id), payload)
        count++
      }
      await batch.commit()
    }
    return count
  } catch {
    return 0
  }
}

export function pushSchedule(s: ScheduledSend): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      const audience: Record<string, unknown> = { kind: s.audience.kind }
      if (s.audience.id !== undefined) audience.id = s.audience.id
      const payload = clean({
        id: s.id,
        type: s.type,
        title: s.title,
        body: s.body,
        icon: s.icon,
        audience,
        audienceLabel: s.audienceLabel,
        deliverAt: s.deliverAt,
        createdAt: s.createdAt,
        createdBy: s.createdBy,
        status: s.status,
        firedAt: s.firedAt,
        count: s.count,
      })
      await setDoc(doc(fb.db, 'scheduled', s.id), payload)
    } catch {
      // swallow
    }
  })
}

export function cancelSchedule(id: string): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, updateDoc } = await import('firebase/firestore')
      await updateDoc(doc(fb.db, 'scheduled', id), { status: 'cancelled' })
    } catch {
      // swallow
    }
  })
}

// Claim + deliver due schedules. runTransaction guarantees no double-fire even
// with several console tabs open. Errors are swallowed per-schedule.
export async function fireDueSchedules(): Promise<void> {
  const fb = await ensureFirebase()
  if (!fb) return
  const due = load<ScheduledSend[]>(SCHEDULED_KEY, []).filter(
    (s) => s.status === 'scheduled' && s.deliverAt <= Date.now()
  )
  if (due.length === 0) return

  const { doc, runTransaction, updateDoc } = await import('firebase/firestore')
  for (const s of due) {
    try {
      const ref = doc(fb.db, 'scheduled', s.id)
      const claimed = await runTransaction(fb.db, async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists()) return false
        if ((snap.data() as ScheduledSend).status !== 'scheduled') return false
        tx.update(ref, { status: 'fired', firedAt: Date.now() })
        return true
      })
      if (!claimed) continue
      const targets = resolveAudience(audienceFromDoc(s.audience), load<GuestDoc[]>(GUEST_DIR_KEY, []))
      const count = await sendWordBatch(targets, {
        type: s.type,
        title: s.title,
        body: s.body,
        icon: s.icon,
      })
      await updateDoc(ref, { count })
    } catch {
      // swallow per-schedule
    }
  }
}

/**
 * Clears the demo world's cloud docs. Every query here is one the presenter's
 * own (guest) account is allowed to run: their own calls and inbox, plus the
 * demo- guest shells. Scheduled sends belong to staff and are left alone — the
 * console clears its own.
 *
 * Each collection is isolated so a denial on one cannot abandon the rest.
 */
export async function deleteDemoCommDocs(currentUserId: string): Promise<void> {
  const fb = await ensureFirebase()
  if (!fb) return
  const { collection, query, where, getDocs, writeBatch } = await import('firebase/firestore')
  const refs: DocumentReference[] = []

  const gather = async (run: () => Promise<void>) => {
    try {
      await run()
    } catch {
      // one collection being out of reach must not strand the others
    }
  }

  for (const col of ['sos', 'notifications']) {
    await gather(async () => {
      const own = await getDocs(query(collection(fb.db, col), where('userId', '==', currentUserId)))
      own.forEach((d) => refs.push(d.ref))
    })
  }
  // The staged cast's calls for aid — reachable under the demo- exception.
  await gather(async () => {
    const demoSos = await getDocs(query(collection(fb.db, 'sos'), where('demo', '==', true)))
    demoSos.forEach((d) => refs.push(d.ref))
  })
  await gather(async () => {
    const guests = await getDocs(query(collection(fb.db, 'guests'), where('demo', '==', true)))
    guests.forEach((d) => refs.push(d.ref))
  })

  const seen = new Set<string>()
  const unique = refs.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)))

  for (let i = 0; i < unique.length; i += 450) {
    await gather(async () => {
      const batch = writeBatch(fb.db)
      for (const r of unique.slice(i, i + 450)) batch.delete(r)
      await batch.commit()
    })
  }
}
