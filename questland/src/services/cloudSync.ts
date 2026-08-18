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
  Announcement,
  AppNotification,
  Booking,
  Flag,
  NotificationType,
  ParkStatus,
  Party,
  Presence,
  ProgressMap,
  QuestLeg,
  SosMessage,
  SosMessageAuthor,
  SosRequest,
  SosStatus,
  StationMap,
  User,
} from '../types'
import { load, save } from './store'
import { uid } from './ids'
import type { PassUse } from './passService'
import type { FirebaseHandle } from './firebase'
import { ensureFirebase, ensureFirebaseWithin, isConfigured, setCloudState } from './firebase'
import { totalXp, levelFor } from './progressService'
import { getUserParty } from './partyService'
// The mirror write for parkStatus/current. parkStatusService imports this module
// back (for pushParkStatus) — the same two-way shape progressService and
// partyService already have with it, and safe for the same reason: neither side
// calls across the cycle at module scope.
import { applyParkStatus } from './parkStatusService'
import { getOrg } from '../content/orgs'

/** Party writes happen behind a spinner, so they get the same deadline as auth. */
const PARTY_TIMEOUT_MS = 10_000

/**
 * How many of a guest's own threads stay live at once. A guest can have an
 * emergency, a hint and a chat open together and no more; the cap is a backstop
 * against a device that has somehow accumulated open calls, not a real limit.
 */
const GUEST_THREAD_CAP = 4

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
  /**
   * Enrolled at the booth, with no phone behind it. Carried through the round
   * trip on purpose — unlike `demo`, which is dropped on the way back down —
   * because every OTHER device shadows this directory into its own ql:users and
   * ranks what it finds there. A marker that only the enrolling console held
   * would put the walk-up back on every other phone's leaderboard.
   */
  walkUp?: true
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

/**
 * Outcome of a write whose sender is WAITING ON THE VERDICT — currently only a
 * chat message. Every other push in this module is fire-and-forget on purpose;
 * see the header of `sosChatService` for why a conversation cannot be.
 */
export type PushResult =
  | { ok: true }
  | { ok: false; reason: 'refused' }
  | { ok: false; reason: 'unavailable' }

/**
 * Codes where the request was ADJUDICATED rather than never answered. Mirrored
 * from flagService's CLAIM_REFUSALS — same reasoning, same fail-soft rule:
 * anything unreadable is 'unavailable', because calling a wifi blip a refusal
 * tells a guest their message is lost when the SDK still has it queued.
 */
const PUSH_REFUSALS = new Set([
  'permission-denied',
  'unauthenticated',
  'user-token-expired',
  'user-disabled',
  'user-not-found',
  'invalid-user-token',
])

function pushError(err: unknown): PushResult {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string' && PUSH_REFUSALS.has(code.split('/').pop() ?? '')) {
      return { ok: false, reason: 'refused' }
    }
  }
  return { ok: false, reason: 'unavailable' }
}

// Local mirror keys
const SOS_KEY = 'ql:sos'
const SOS_META_KEY = 'ql:sosMeta'
const GUEST_DIR_KEY = 'ql:guestDirectory'
const SCHEDULED_KEY = 'ql:scheduled'
const USERS_KEY = 'ql:users'
const PARTIES_KEY = 'ql:parties'
const PRESENCE_KEY = 'ql:presence'
const FLAGS_KEY = 'ql:flags'

/** The tag-uid allowlist, mirrored from `flagService.normalizeUid`. See mergeFlagsSnapshot. */
const FLAG_UID_RE = /^[0-9A-F]{8,20}$/
/** Mirrored from `flagService`'s STRUCK_KEY / STRUCK_TTL_MS. See mergeFlagsSnapshot. */
const FLAGS_STRUCK_KEY = 'ql:flagsStruck'
const FLAGS_STRUCK_TTL_MS = 5 * 60 * 1000
const ANNOUNCE_KEY = 'ql:announcements'
/** Matches announcementService's BOARD_CAP — heroes ride inside the documents. */
const ANNOUNCE_CAP = 40
const LOG_KEY = 'ql:questLog'
/** Matches questLogService's cap — the mirror is a working window, not an archive. */
const LOG_CAP = 2000
const notifKey = (userId: string) => `ql:notifications:${userId}`
const progressKey = (userId: string) => `ql:progress:${userId}`
const stationKey = (userId: string) => `ql:stations:${userId}`
const bookingsKey = (userId: string) => `ql:bookings:${userId}`
const passUsesKey = (userId: string) => `ql:passUses:${userId}`

function normalizePartyCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '')
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Walk-ups are excluded from the BROADCASTS — everyone, and a whole order —
 * because there is no phone behind the record: a notification counted against
 * one is a line in the send receipt saying somebody was reached who was not.
 * The count the console reports comes straight off this list, so dropping them
 * here is what keeps that number honest.
 *
 * A direct send to one guest stays allowed even when it lands on a walk-up. It
 * reaches nobody either, but staff chose that row by name and the receipt still
 * says one — nothing is being overstated.
 */
export function resolveAudience(a: Audience, directory: GuestDoc[]): GuestDoc[] {
  switch (a.kind) {
    case 'all':
      return directory.filter((g) => !g.walkUp)
    case 'guest':
      return directory.filter((g) => g.id === a.id)
    case 'party':
      return directory.filter((g) => g.partyId === a.id)
    case 'org':
      return directory.filter((g) => g.orgId === a.id && !g.walkUp)
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

function buildGuestDoc(user: User): GuestDoc & { demo?: true; passage?: true } {
  const doc: GuestDoc & { demo?: true; passage?: true } = {
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
  if (user.walkUp) doc.walkUp = true
  if (user.id.startsWith('demo-')) doc.demo = true
  // The Questland Radio entitlement stamp, read by storage.rules holdsPassage().
  // Derived HERE and nowhere else, because pushGuestProfile writes the doc
  // WHOLE (the anti-merge scar): a stamp written anywhere else would be erased
  // by the very next profile push. Absent — not false — when nothing is held,
  // so a cancelled booking clears it on the next push.
  const passage =
    load<Booking[]>(bookingsKey(user.id), []).some((b) => b.status === 'confirmed') ||
    load<PassUse[]>(passUsesKey(user.id), []).length > 0
  if (passage) doc.passage = true
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
    // Everything except the two denormalized display fields rides through
    // untouched — there is no allowlist here, so the manager counters
    // (`messageCount`, `wardenReplies`, the `replyBy` map, `acknowledgedAt`,
    // `resolvedAt`) arrive without this function knowing they exist. The merge
    // below is whole-object last-write-wins on `updatedAt`, which is the right
    // shape for a map field: a call is a small document written by two devices,
    // and every write that touches a counter also moves `updatedAt`, so the
    // loser of a race is a strictly older view of the same document rather
    // than a half-merged one.
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
    if (data.walkUp === true) g.walkUp = true
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
    // Load-bearing: this shell is what the leaderboard on THIS device ranks, and
    // leaderboardService filters on the flag. Drop it here and a walk-up enrolled
    // at the booth reappears on every phone in the park.
    if (g.walkUp) shell.walkUp = true
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

function mergePartiesSnapshot(
  snap: QuerySnapshot<DocumentData>,
  selfId: string | null,
  primed: boolean
): void {
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
  // No self id means the console, which belongs to nobody's party.
  if (primed && selfId) announceNewMembers(selfId, local, merged)
}

function unionLists<T extends Record<string, string[]>>(local: T, incoming: T): T {
  const next = { ...local } as T
  for (const k of Object.keys(incoming)) {
    ;(next as Record<string, string[]>)[k] = Array.from(
      new Set([...(local[k] ?? []), ...incoming[k]])
    )
  }
  return next
}

/**
 * Progress is monotonic — an episode, and a station within an episode, is only
 * ever added — so EVERY doc merges as a union and no snapshot can erase work.
 *
 * Other guests' docs used to be taken as-is, on the grounds that this device
 * never writes them. That is no longer true on either side: the console credits
 * a guest whose phone never saw the tap, and a guest's own device credits their
 * party-mates as it carries them along. A clobber there would drop whichever
 * writer was a snapshot behind.
 */
function mergeProgressSnapshot(snap: QuerySnapshot<DocumentData>): void {
  snap.docChanges().forEach((c) => {
    // A deleted progress doc cannot un-walk an episode, so a removal is left to
    // fall off the cloud copy alone rather than mirrored into the local one.
    if (c.type === 'removed') return

    const data = c.doc.data() as { id?: string; map?: ProgressMap; stations?: StationMap }
    const id = data.id ?? c.doc.id

    const localMap = load<ProgressMap>(progressKey(id), {})
    const next = unionLists(localMap, data.map ?? {})
    if (!deepEqual(next, localMap)) save(progressKey(id), next)

    // Station check-ins ride in the same doc and merge the same way.
    const localStations = load<StationMap>(stationKey(id), {})
    const nextStations = unionLists(localStations, data.stations ?? {})
    if (!deepEqual(nextStations, localStations)) save(stationKey(id), nextStations)
  })
}

/**
 * Presence is a straight last-write-wins by `at` — a guest is only ever in one
 * place, and the newest check-in is the truth. After merging, this device asks
 * the presence layer whether a party-mate's check-in should carry it along too.
 */
function mergePresenceSnapshot(snap: QuerySnapshot<DocumentData>, selfId: string | null): void {
  const local = load<Presence[]>(PRESENCE_KEY, [])
  const byUser = new Map(local.map((p) => [p.userId, p] as const))

  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') byUser.delete(c.doc.id)
  })

  snap.forEach((d) => {
    const incoming = d.data() as Presence
    if (!incoming?.userId || typeof incoming.at !== 'number') return
    const existing = byUser.get(incoming.userId)
    if (!existing || incoming.at >= existing.at) byUser.set(incoming.userId, incoming)
  })

  const merged = Array.from(byUser.values()).sort((a, b) => b.at - a.at)
  if (!deepEqual(merged, local)) save(PRESENCE_KEY, merged)

  // Lazy import for the same reason as banner(): presenceService imports this
  // module for its write-throughs, so a static import here would be a cycle.
  if (selfId) {
    void import('./presenceService')
      .then((m) => m.syncParty(selfId))
      .catch(() => {})
  }
}

/**
 * The rack.
 *
 * Last-write-wins on `updatedAt`, which is exactly right for a flag: a binding
 * is decided at one counter at one moment, and a later write is a later fact.
 * (The write that MATTERS — claiming a pole for a party — is a compare-and-set
 * transaction in flagService, so this merge never has to adjudicate a conflict;
 * it only has to not lose the answer.)
 *
 * This function TERMINATES IN store.save() and calls nothing back into a
 * service. That is what makes an echo loop structurally impossible: a merge can
 * only ever write the local mirror, never push, so a snapshot cannot provoke the
 * write that provokes the next snapshot.
 */
function mergeFlagsSnapshot(snap: QuerySnapshot<DocumentData>): void {
  const local = load<Flag[]>(FLAGS_KEY, [])
  const byUid = new Map(local.map((f) => [f.uid, f] as const))

  // A retired pole struck from the rack must leave every console's mirror too,
  // or it goes on being offered at the counter.
  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') byUid.delete(c.doc.id)
  })

  // A pole given its tag moves onto a new id, which is a create plus a delete —
  // and the create's own snapshot still carries the struck document, because the
  // delete has not reached the server yet. Without this the union below would
  // write it back into the mirror it was just taken out of: one physical pole as
  // two chips under one label, an `assignmentTable` row for a uid no tag carries,
  // and no way for an employee to tell which chip is the ghost. `flagService`
  // tombstones a uid the moment it strikes it; the tombstone ages out, so a
  // delete that never landed still resurfaces as the visible, retirable
  // duplicate that a half-finished attach is documented to leave.
  const now = Date.now()
  const struck = load<Record<string, number>>(FLAGS_STRUCK_KEY, {})

  snap.forEach((d) => {
    const incoming = d.data() as Flag
    if (!incoming || typeof incoming.updatedAt !== 'number') return
    // Reject, do not repair — at this boundary too. The uid becomes a document
    // id on the very next write (`doc(db,'flags', flag.uid)`), so a document
    // whose `uid` field disagrees with its own id, or carries a '/', would
    // re-target a different collection path. The rule is the same one
    // `flagService.normalizeUid` enforces on the air; it is spelled out again
    // here rather than imported, because flagService imports this module and a
    // static import back would close a cycle.
    if (incoming.uid !== d.id || !FLAG_UID_RE.test(d.id)) return
    // A row with no label cannot be shown on the rack, and it used to take the
    // whole listener down: `localeCompare` on undefined throws inside the
    // snapshot callback, which kills every merge after it.
    if (typeof incoming.label !== 'string' || incoming.label === '') return
    // After the allowlist, never before it: a document id is outside data, and
    // it must not index anything until it has been vouched for.
    const strickenAt = struck[d.id]
    if (typeof strickenAt === 'number' && now - strickenAt < FLAGS_STRUCK_TTL_MS) return
    const existing = byUid.get(incoming.uid)
    if (!existing || incoming.updatedAt >= existing.updatedAt) byUid.set(incoming.uid, incoming)
  })

  const merged = Array.from(byUid.values()).sort((a, b) =>
    (a.label ?? '').localeCompare(b.label ?? '', undefined, { numeric: true })
  )
  if (!deepEqual(merged, local)) save(FLAGS_KEY, merged)
}

/**
 * The station records. A leg is written once and never revised, so the merge is
 * a plain union by id — there is no conflict a log entry can have with itself.
 */
function mergeLegsSnapshot(snap: QuerySnapshot<DocumentData>): void {
  const local = load<QuestLeg[]>(LOG_KEY, [])
  const byId = new Map(local.map((l) => [l.id, l] as const))

  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') byId.delete(c.doc.id)
  })

  snap.forEach((d) => {
    const leg = d.data() as QuestLeg
    if (!leg?.id || typeof leg.at !== 'number') return
    byId.set(leg.id, leg)
  })

  const merged = Array.from(byId.values())
    .sort((a, b) => b.at - a.at)
    .slice(0, LOG_CAP)
  if (!deepEqual(merged, local)) save(LOG_KEY, merged)
}

/**
 * The notice board. One staff console writes a notice and every phone reads it,
 * so there is no local edit to protect — last write on `updatedAt` wins, and a
 * struck notice leaves by the `removed` change like any other.
 */
function mergeAnnouncementsSnapshot(snap: QuerySnapshot<DocumentData>): void {
  const local = load<Announcement[]>(ANNOUNCE_KEY, [])
  const byId = new Map(local.map((a) => [a.id, a] as const))

  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') byId.delete(c.doc.id)
  })

  snap.forEach((d) => {
    const incoming = d.data() as Announcement
    if (!incoming?.id || typeof incoming.updatedAt !== 'number') return
    const existing = byId.get(incoming.id)
    if (!existing || incoming.updatedAt >= existing.updatedAt) byId.set(incoming.id, incoming)
  })

  const merged = Array.from(byId.values())
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return b.publishAt - a.publishAt
    })
    .slice(0, ANNOUNCE_CAP)
  if (!deepEqual(merged, local)) save(ANNOUNCE_KEY, merged)
}

function bookingStamp(b: Booking | undefined): number {
  if (!b) return -1
  return b.updatedAt ?? b.createdAt
}

function applyBookings(userId: string, incoming: Booking[], removedIds: Set<string>): void {
  const local = load<Booking[]>(bookingsKey(userId), [])
  const byId = new Map(local.map((b) => [b.id, b] as const))

  removedIds.forEach((id) => byId.delete(id))
  incoming.forEach((b) => {
    if (bookingStamp(b) >= bookingStamp(byId.get(b.id))) byId.set(b.id, b)
  })

  const merged = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
  if (!deepEqual(merged, local)) save(bookingsKey(userId), merged)
}

function mergeBookingsSnapshot(userId: string, snap: QuerySnapshot<DocumentData>): void {
  const removed = new Set<string>()
  snap.docChanges().forEach((c) => {
    if (c.type === 'removed') removed.add(c.doc.id)
  })
  const incoming: Booking[] = []
  snap.forEach((d) => incoming.push(d.data() as Booking))
  applyBookings(userId, incoming, removed)
}

/**
 * The booth's view of every passage sold. It spends against a passage bought in
 * the app, so it has to be able to read one. Bookings are filed per guest
 * locally, so the whole-collection snapshot is bucketed by owner and each bucket
 * gets the same merge a phone's own list gets.
 */
function mergeAllBookingsSnapshot(snap: QuerySnapshot<DocumentData>): void {
  const incoming = new Map<string, Booking[]>()
  const removed = new Map<string, Set<string>>()

  snap.docChanges().forEach((c) => {
    if (c.type !== 'removed') return
    const owner = (c.doc.data() as Booking).userId
    if (!owner) return
    const ids = removed.get(owner) ?? new Set<string>()
    ids.add(c.doc.id)
    removed.set(owner, ids)
  })

  snap.forEach((d) => {
    const b = d.data() as Booking
    if (!b?.userId) return
    const bucket = incoming.get(b.userId)
    if (bucket) bucket.push(b)
    else incoming.set(b.userId, [b])
  })

  new Set([...incoming.keys(), ...removed.keys()]).forEach((userId) => {
    applyBookings(userId, incoming.get(userId) ?? [], removed.get(userId) ?? new Set())
  })
}

/**
 * The passage ledger. A use is written once and never revised, so the merge is a
 * union by id: the booth spends a Quest Experience on behalf of a guest whose
 * phone never saw it, that phone spends one the booth never saw, and a union is
 * the only resolution under which neither loses.
 */
function unionUses(local: PassUse[], incoming: PassUse[]): PassUse[] {
  const byId = new Map(local.map((u) => [u.id, u] as const))
  incoming.forEach((u) => {
    if (u?.id && !byId.has(u.id)) byId.set(u.id, u)
  })
  return Array.from(byId.values()).sort((a, b) => a.at - b.at)
}

function applyPassUses(userId: string, incoming: PassUse[]): void {
  const local = load<PassUse[]>(passUsesKey(userId), [])
  const merged = unionUses(local, incoming)
  if (!deepEqual(merged, local)) save(passUsesKey(userId), merged)
}

function usesOf(data: DocumentData | undefined): PassUse[] {
  return (data as { uses?: PassUse[] } | undefined)?.uses ?? []
}

function mergeScheduledSnapshot(snap: QuerySnapshot<DocumentData>): void {
  const list: ScheduledSend[] = []
  snap.forEach((d) => list.push(d.data() as ScheduledSend))
  list.sort((a, b) => a.deliverAt - b.deliverAt)
  if (!deepEqual(list, load<ScheduledSend[]>(SCHEDULED_KEY, []))) save(SCHEDULED_KEY, list)
}

// ── Listener lifecycles ───────────────────────────────────────────────────────

type FirestoreApi = typeof import('firebase/firestore')

/**
 * Attaches listeners only once Firebase vouches for a REAL (non-anonymous)
 * session, and re-attaches whenever that session changes.
 *
 * This gate is load-bearing now that the rules are closed. An anonymous session
 * is refused the calls board and the schedule queue, and Firestore never retries
 * a listener it was refused — so subscribing on mount and signing in afterwards
 * left a permanently dead listener behind, which looks exactly like being
 * offline. Waiting for the session rather than racing it is the whole fix.
 *
 * It also means a local-only fallback account subscribes to nothing, which is
 * correct: its id is not a uid, so every owner-scoped query would be refused.
 */
function subscribeWhenAuthed(
  attach: (fb: FirebaseHandle, fs: FirestoreApi) => Array<() => void>
): () => void {
  let disposed = false
  let inner: Array<() => void> = []
  let stopAuth: (() => void) | null = null

  const detach = () => {
    inner.forEach((u) => u())
    inner = []
  }

  void ensureFirebase().then(async (fb) => {
    if (!fb || disposed) return
    try {
      const fs = await import('firebase/firestore')
      const { onAuthStateChanged } = await import('firebase/auth')

      stopAuth = onAuthStateChanged(fb.auth, (account) => {
        detach()
        if (disposed) return
        if (!account || account.isAnonymous) {
          // Nothing we are allowed to read yet — say so rather than claim live.
          setCloudState('offline')
          return
        }
        try {
          inner = attach(fb, fs)
        } catch {
          setCloudState('offline')
        }
      })

      if (disposed) stopAuth()
    } catch {
      setCloudState('offline')
    }
  })

  return () => {
    disposed = true
    detach()
    stopAuth?.()
  }
}

export function startGuestSync(userId: string): () => void {
  return subscribeWhenAuthed((fb, fs) => {
    const { collection, doc, query, where, onSnapshot } = fs
    const unsubs: Array<() => void> = []

    // ── THE GUEST'S OWN THREADS LISTEN FOR THE LIFE OF THE APP ──────────────
    //
    // Not per screen, which is how the console does it. Three reasons, and the
    // first is the one that matters:
    //
    // 1. A reply must land in the mirror wherever the guest happens to be. Tied
    //    to a mounted ChatThread, the only live view of a conversation existed
    //    while that one screen was open — so a guest reading the map missed
    //    every word until they walked back to it, and the thread then filled in
    //    a beat later rather than being already current.
    // 2. Attaching is ASYNCHRONOUS (ensureFirebase, two dynamic imports, an auth
    //    callback). Per mount, a screen can be on display with no listener
    //    behind it yet; done once at sign-in, that window happens once.
    // 3. It is what makes a push-woken tap honest: the banner says a Warden
    //    replied, so the thread it opens onto had better already say so.
    //
    // A guest has at most a couple of open calls, so this costs about what
    // their own sos listener costs — nothing like the park-wide fan-out the
    // console would incur doing the same.
    const threads = new Map<string, () => void>()
    const syncThreads = () => {
      const wanted = new Set(
        load<SosRequest[]>(SOS_KEY, [])
          .filter((r) => r.userId === userId && r.status !== 'resolved')
          .slice(0, GUEST_THREAD_CAP)
          .map((r) => r.id)
      )
      threads.forEach((stop, id) => {
        if (wanted.has(id)) return
        stop()
        threads.delete(id)
      })
      wanted.forEach((id) => {
        if (!threads.has(id)) threads.set(id, attachThread(fb, fs, id))
      })
    }
    unsubs.push(() => {
      threads.forEach((stop) => stop())
      threads.clear()
    })

    const sosUnsub = onSnapshot(
      query(collection(fb.db, 'sos'), where('userId', '==', userId)),
      { includeMetadataChanges: true },
      (snap) => {
        mergeSosSnapshot(snap)
        // The guest's calls just moved, so the set of threads worth listening to
        // may have changed — a chat opened, an old one stood down.
        syncThreads()
        setCloudState(snap.metadata.fromCache ? 'offline' : 'live')
      },
      () => setCloudState('offline')
    )
    unsubs.push(sosUnsub)
    // Calls already in the mirror from a previous session get their listener now
    // rather than waiting for the first sos snapshot to come back.
    syncThreads()

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

    // Your own passages, wherever they were booked, and what has been spent off
    // them — the booth spends a Quest Experience at the gate, on this guest's
    // behalf, while their phone is in a pocket.
    //
    // ── HEALING THE RADIO'S PASSAGE STAMP ───────────────────────────────────
    // The sign-in profile push runs BEFORE these two mirrors hydrate on a
    // fresh device, and pushGuestProfile writes guests/{uid} WHOLE — so a
    // `passage: true` standing in the cloud is erased by that first push, and
    // nothing rewrites it until the guest books or cancels. Once BOTH mirrors
    // have reported, re-derive the stamp; if it differs from what the mirrors
    // said when this attach began (which is what that sign-in push can have
    // carried), re-push the profile ONCE. At most one re-push per sync start:
    // the guard is against churn, not a loop — a profile push moves neither
    // of these listeners, so there is nothing here to echo.
    const derivePassage = () =>
      load<Booking[]>(bookingsKey(userId), []).some((b) => b.status === 'confirmed') ||
      load<PassUse[]>(passUsesKey(userId), []).length > 0
    const stampAtAttach = derivePassage()
    let bookingsPrimed = false
    let usesPrimed = false
    let stampHealed = false
    const healPassageStamp = () => {
      if (stampHealed || !bookingsPrimed || !usesPrimed) return
      if (derivePassage() === stampAtAttach) return
      stampHealed = true
      // The mirrored local record, never authService (cycle) — same pattern as
      // announceNewMembers above.
      const self = load<User[]>(USERS_KEY, []).find((u) => u.id === userId)
      if (self) pushGuestProfile(self)
    }
    unsubs.push(
      onSnapshot(
        query(collection(fb.db, 'bookings'), where('userId', '==', userId)),
        (snap) => {
          mergeBookingsSnapshot(userId, snap)
          bookingsPrimed = true
          healPassageStamp()
        },
        () => setCloudState('offline')
      )
    )
    unsubs.push(
      onSnapshot(
        doc(fb.db, 'passUses', userId),
        (snap) => {
          applyPassUses(userId, usesOf(snap.data()))
          usesPrimed = true
          healPassageStamp()
        },
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

    // The standard this guest is carrying. Bound at a counter, on a machine this
    // phone has no other contact with, so without this listener the guest never
    // learns which pole is theirs or when it has gone stale.
    //
    // THE FILTER IS THE WHOLE REASON THIS QUERY IS LEGAL. `flags` is read by any
    // real user and its read rule touches no field of the document — deliberately,
    // and there is a long comment in firestore.rules saying why. A rule that read
    // `resource.data` would refuse this QUERY outright rather than filter it, and
    // Firestore never retries a listener it was refused: the standard would simply
    // never appear, on every phone, permanently. Verified live against the project
    // (rules matrix case 18). Do not tighten either half.
    unsubs.push(
      onSnapshot(
        query(collection(fb.db, 'flags'), where('memberIds', 'array-contains', userId)),
        // The same merge the console runs. It is a union keyed on uid that honours
        // `removed`, so a narrower result set can only ever add to this mirror or
        // drop a pole that stopped being the guest's — which is exactly what
        // `releaseFlag` does when it takes the roster off a binding.
        (snap) => mergeFlagsSnapshot(snap),
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
        (snap) => mergeProgressSnapshot(snap),
        () => setCloudState('offline')
      )
    )

    // Where everybody is. A guest needs the whole board, not just their own
    // row: a party-mate's check-in is what carries this phone along with it.
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'presence'),
        (snap) => mergePresenceSnapshot(snap, userId),
        () => setCloudState('offline')
      )
    )

    // The notice board — the same notices for everybody, which is why this one
    // is read whole rather than scoped to the guest.
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'announcements'),
        (snap) => mergeAnnouncementsSnapshot(snap),
        () => setCloudState('offline')
      )
    )

    return unsubs
  })
}

export function startConsoleSync(): () => void {
  return subscribeWhenAuthed((fb, { collection, doc, limit, onSnapshot, orderBy, query }) => {
    const unsubs: Array<() => void> = []

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
    // The rosters. Without them the console reads every party-mate as a lone
    // traveller, because occupants() groups on a party it has never heard of.
    // Self id is null both because the console belongs to no party and because
    // that is what keeps announceNewMembers from ever firing here.
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'parties'),
        (snap) => mergePartiesSnapshot(snap, null, false),
        () => setCloudState('offline')
      )
    )
    // Everyone's progress. Without it every guest reads as episode one forever —
    // the console would name the wrong quest on the board and, once it starts
    // crediting check-ins itself, credit the wrong episode.
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'progress'),
        (snap) => mergeProgressSnapshot(snap),
        () => setCloudState('offline')
      )
    )
    // What every guest bought, and what they have spent off it. The booth reads
    // both to say "Hero Pass, 3 adults, unlimited today" before it spends one.
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'bookings'),
        (snap) => mergeAllBookingsSnapshot(snap),
        () => setCloudState('offline')
      )
    )
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'passUses'),
        (snap) =>
          snap.docChanges().forEach((c) => {
            // A removal cannot un-spend a Quest Experience, so it is left alone
            // rather than mirrored — the same reasoning as progress above.
            if (c.type === 'removed') return
            const data = c.doc.data()
            applyPassUses((data.id as string | undefined) ?? c.doc.id, usesOf(data))
          }),
        () => setCloudState('offline')
      )
    )
    // The stations board. The console watches only — it never carries anybody
    // along, so it passes no self id.
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'presence'),
        (snap) => mergePresenceSnapshot(snap, null),
        () => setCloudState('offline')
      )
    )
    // The rack. Every pole the park owns, so the booth panel opens with the
    // whole of it and a bind made at the other counter shows up here.
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'flags'),
        (snap) => mergeFlagsSnapshot(snap),
        () => setCloudState('offline')
      )
    )
    // The notice board the console posts to.
    unsubs.push(
      onSnapshot(
        collection(fb.db, 'announcements'),
        (snap) => mergeAnnouncementsSnapshot(snap),
        () => setCloudState('offline')
      )
    )
    // The station records. Bounded to the most recent legs rather than the whole
    // history: the console is a working board, and a day is exported and then
    // read in a spreadsheet, not scrolled here forever.
    unsubs.push(
      onSnapshot(
        query(collection(fb.db, 'legs'), orderBy('at', 'desc'), limit(LOG_CAP)),
        (snap) => mergeLegsSnapshot(snap),
        () => setCloudState('offline')
      )
    )
    // What the booth console with the hub cable says about the plinths. Read by
    // every console, including the ones that will never write it — a manager
    // opening this on a phone has no serial port and no readings of their own.
    //
    // The console that WRITES this document also receives its own write back
    // here, so the handler must terminate: applyParkStatus writes the local
    // mirror and calls nothing, which is what keeps the echo from arming another
    // write. A missing document is applied as null rather than ignored — a park
    // that has never reported is a real answer, and a stale mirror is not.
    unsubs.push(
      onSnapshot(
        doc(fb.db, 'parkStatus', 'current'),
        (snap) => applyParkStatus(snap.exists() ? (snap.data() as ParkStatus) : null),
        () => setCloudState('offline')
      )
    )

    return unsubs
  })
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
  patch: {
    status: SosStatus
    responder?: string
    updatedAt: number
    /** Both optional and both stripped by clean() when absent — a patch that
     *  does not carry one must not blank the field the other side already
     *  wrote, and `undefined` is how updateDoc is told to leave it alone. */
    acknowledgedAt?: number
    resolvedAt?: number
  }
): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, updateDoc } = await import('firebase/firestore')
      const fields = clean({
        status: patch.status,
        updatedAt: patch.updatedAt,
        responder: patch.responder,
        acknowledgedAt: patch.acknowledgedAt,
        resolvedAt: patch.resolvedAt,
      })
      await updateDoc(doc(fb.db, 'sos', id), fields)
    } catch {
      // swallow
    }
  })
}

/**
 * The one push in this module that its caller AWAITS. Resolves only when the
 * server has the message; see `sosChatService` for the contract.
 *
 * With the cloud switched off entirely there is no Warden to reach and no
 * server that could ever acknowledge this, so the local write IS the delivery
 * and it reports ok — otherwise a local-only build shows every message stuck
 * pending forever. That is a different thing from configured-but-unreachable,
 * which must stay honest and stay pending.
 */
export async function pushSosMessage(m: SosMessage): Promise<PushResult> {
  if (!isConfigured()) return { ok: true }
  const fb = await ensureFirebase()
  if (!fb) return { ok: false, reason: 'unavailable' }
  try {
    const { collection, doc, setDoc } = await import('firebase/firestore')
    // `delivery` is this device's private bookkeeping and must never be written:
    // it would come straight back down on the snapshot and overwrite the real
    // state of every OTHER reader of the thread.
    const { delivery: _delivery, ...wire } = m
    await setDoc(doc(collection(fb.db, 'sos', m.sosId, 'messages'), m.id), clean(wire))
    return { ok: true }
  } catch (err) {
    return pushError(err)
  }
}

/**
 * Stamps the PARENT call with what was just said, so the console can order and
 * badge the board without a listener on every thread's messages. Fire-and-forget
 * on purpose: the message itself is the record, and this is only the board's
 * summary of it — a stamp that fails to land costs a sort order, not a word.
 *
 * It also carries the manager counters, as `increment()`s rather than as read
 * numbers: two devices stamping the same call in the same second must both be
 * counted, and a client that computed `count + 1` from its own mirror would
 * overwrite the other's line instead. This is the only place in the module that
 * needs a server-side operator, which is why `increment` joins the existing
 * dynamic import rather than getting one of its own.
 */

/**
 * A staff uid, as Firebase mints them. Anything outside this alphabet is not a
 * uid we issued and does not get built into a field path — see below.
 */
const UID_PATH_SAFE = /^[A-Za-z0-9_-]{1,128}$/

export function pushSosStamp(
  sosId: string,
  stamp: { lastMessageAt: number; lastMessageFrom: SosMessageAuthor; lastMessagePreview: string },
  byUid?: string
): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, updateDoc, increment } = await import('firebase/firestore')
      const warden = stamp.lastMessageFrom === 'warden'
      const fields: Record<string, unknown> = {
        ...stamp,
        updatedAt: stamp.lastMessageAt,
        messageCount: increment(1),
      }
      if (warden) {
        fields.wardenReplies = increment(1)
        // ── THE DOTTED KEY IS A PATH, NOT A NAME ──────────────────────────
        //
        // `updateDoc` reads a `.` in a key as a descent into nested fields and
        // a `/` as a segment break, so a uid carrying either does not write
        // `replyBy['a.b']` — it writes `replyBy.a.b`, quietly landing the
        // count on a field nobody asked for and, with the right string,
        // somewhere outside `replyBy` altogether. Only a value matching the
        // uid alphabet is allowed to become a path.
        //
        // Rejected, never repaired: this codebase does not sanitise an id into
        // something that looks close enough, because the repaired string would
        // then be attributed to a Warden who does not exist. If it is not a
        // uid, the reply is counted in the total and against nobody.
        if (byUid && UID_PATH_SAFE.test(byUid)) fields[`replyBy.${byUid}`] = increment(1)
      }
      await updateDoc(doc(fb.db, 'sos', sosId), fields)
    } catch {
      // swallow — see the note above
    }
  })
}

/**
 * Live view of ONE thread, for exactly as long as it is on screen.
 *
 * Scope is the whole cost model of this feature. A `collectionGroup('messages')`
 * listener would give the console every thread at once and charge every warden's
 * screen a read for every message in the park, forever, to render a board that
 * shows one line per call. The board reads the parent's `lastMessage*` stamps
 * instead, and messages are only ever fetched for the thread somebody opened.
 *
 * The rule on the subcollection gates on the PARENT document rather than on
 * these documents' own fields, which is what makes this listener legal: an
 * unfiltered collection query cannot be refused for failing to prove something
 * about each match (the sos/legs trap in the rules), because it is not being
 * asked to.
 */
/** One thread's live view. Assumes the caller is already inside an authed attach. */
function attachThread(fb: FirebaseHandle, fs: FirestoreApi, sosId: string): () => void {
  const { collection, onSnapshot, orderBy, query } = fs
  return onSnapshot(
    query(collection(fb.db, 'sos', sosId, 'messages'), orderBy('createdAt', 'asc')),
    { includeMetadataChanges: true },
    (snap) => {
      void (async () => {
        const { reconcile } = await import('./sosChatService')
        reconcile(
          sosId,
          snap.docs
            // A local echo has not been acknowledged yet, so it is not proof of
            // anything — dropping it here leaves the local 'pending' copy
            // standing until the server's own version arrives.
            .filter((d) => !d.metadata.hasPendingWrites)
            .map((d) => d.data() as SosMessage)
        )
      })()
      setCloudState(snap.metadata.fromCache ? 'offline' : 'live')
    },
    () => setCloudState('offline')
  )
}

/**
 * A thread listener for the lifetime of ONE SCREEN. The console's, because a
 * Warden may have dozens of calls on the board and listening to every thread in
 * the park is the one way to make this feature expensive.
 *
 * The guest does NOT use this — see `startGuestSync`.
 */
export function subscribeSosThread(sosId: string): () => void {
  return subscribeWhenAuthed((fb, fs) => [attachThread(fb, fs, sosId)])
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

/**
 * Own row only. The rules let a guest write presence/{their own uid} and no
 * other, which is exactly right: a party member's phone adopts the check-in off
 * the snapshot and writes its own row itself.
 */
export function pushPresence(p: Presence): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      await setDoc(doc(fb.db, 'presence', p.userId), clean({ ...p }))
    } catch {
      // swallow
    }
  })
}

/**
 * Appends one leg to the station records. Written once, never updated — the id
 * is derived from the check-in itself, so a retry lands on the same document
 * instead of doubling the row.
 */
export function pushLeg(leg: QuestLeg): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      await setDoc(doc(fb.db, 'legs', leg.id), clean({ ...leg }))
    } catch {
      // swallow
    }
  })
}

/**
 * Writes a flag document WHOLE — `setDoc` with no `merge`.
 *
 * flagService is the complete and only writer of this document, so the object it
 * hands over is the entire truth about that pole. A merge would leave fields
 * from a previous binding stranded on the record: rack a pole and the party name
 * would still be sitting there, because a merge has no way to express "this
 * field is gone now". That is the pushGuestProfile scar, and this is the shape
 * that avoids it.
 */
export function pushFlag(flag: Flag): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      await setDoc(doc(fb.db, 'flags', flag.uid), clean({ ...flag }))
    } catch {
      // swallow — the local mirror is already correct
    }
  })
}

/**
 * The park's station-health summary, written WHOLE — `setDoc` with no `merge`.
 *
 * One document, and parkStatusService is its complete and only writer, so the
 * object handed over is the entire truth about the park at that moment. A merge
 * would strand yesterday's exceptions on the record: a plinth that was silent
 * and has been fixed leaves no key behind to overwrite, so the manager's phone
 * would keep reporting a fault that somebody already walked out and cleared.
 * Same lesson as pushFlag, same scar as pushGuestProfile.
 */
export function pushParkStatus(status: ParkStatus): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      await setDoc(doc(fb.db, 'parkStatus', 'current'), clean({ ...status }))
    } catch {
      // swallow — the booth's own board is already correct, and the next
      // heartbeat write is five minutes away at the outside.
    }
  })
}

/**
 * Posts (or revises) a notice. Staff-only by the rules — a guest device calling
 * this is refused, which is exactly what should happen, and the local board it
 * already saved is left alone.
 */
export function pushAnnouncement(a: Announcement): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, setDoc } = await import('firebase/firestore')
      await setDoc(doc(fb.db, 'announcements', a.id), clean({ ...a }))
    } catch {
      // swallow
    }
  })
}

export function deleteAnnouncementDoc(id: string): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, deleteDoc } = await import('firebase/firestore')
      await deleteDoc(doc(fb.db, 'announcements', id))
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
        const data = snap.exists() ? (snap.data() as { map?: ProgressMap; stations?: StationMap }) : {}
        const merged = unionLists(data.map ?? {}, load<ProgressMap>(progressKey(userId), {}))
        const stations = unionLists(data.stations ?? {}, load<StationMap>(stationKey(userId), {}))
        tx.set(ref, { id: userId, map: merged, stations, updatedAt: Date.now() })
        return { merged, stations }
      })

      // Unioned again on the way back, not saved verbatim: the transaction's
      // answer was computed from a read taken before it committed, and anything
      // walked on this device while it was in flight is only in the local copy.
      const localMap = load<ProgressMap>(progressKey(userId), {})
      const map = unionLists(localMap, union.merged)
      if (!deepEqual(map, localMap)) save(progressKey(userId), map)

      const localStations = load<StationMap>(stationKey(userId), {})
      const stations = unionLists(localStations, union.stations)
      if (!deepEqual(stations, localStations)) save(stationKey(userId), stations)
    } catch {
      // swallow
    }
  })
}

/**
 * Unions the local pass ledger into passUses/{userId} inside a transaction and
 * writes the result back to both sides — pushProgress's shape, for the same
 * reason: two writers (this phone and the ticket booth) spend against the same
 * ledger, and a use is immutable once written, so a union can never lose one.
 */
export function pushPassUses(userId: string): void {
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, runTransaction } = await import('firebase/firestore')
      const ref = doc(fb.db, 'passUses', userId)

      const uses = await runTransaction(fb.db, async (tx) => {
        const snap = await tx.get(ref)
        const merged = unionUses(usesOf(snap.data()), load<PassUse[]>(passUsesKey(userId), []))
        tx.set(ref, { id: userId, uses: merged, updatedAt: Date.now() })
        return merged
      })

      // Unioned against the ledger as it stands NOW rather than saved verbatim:
      // a second quest taken while this push was in flight is only in the local
      // copy, and writing the transaction's answer over it would spend that
      // guest's allowance twice.
      applyPassUses(userId, uses)
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
 * Clears the demo world's cloud docs. Every read here is one the presenter's
 * own (guest) account is allowed to run: their own calls and inbox, plus the
 * demo- guest shells. Scheduled sends belong to staff and are left alone — the
 * console clears its own.
 *
 * WHY THE CAST'S DOCS ARE DELETED BY ID rather than found by a `demo == true`
 * query: where a rule gates reads on the document's own fields (sos and legs
 * both do — `demoExisting()` reads `resource.data.userId`), a QUERY is refused
 * outright, because that filter alone does not prove every match belongs to a
 * demo- id. A delete addressed at one document IS checked against that
 * document, so it passes. The local mirrors already hold exactly those ids.
 * (`guests` reads open to any signed-in client, so its query is fine.)
 *
 * Each step is isolated so a denial on one cannot abandon the rest.
 */
export async function deleteDemoCommDocs(currentUserId: string): Promise<void> {
  const fb = await ensureFirebase()
  if (!fb) return
  const { collection, doc, query, where, getDocs, writeBatch } = await import('firebase/firestore')
  const refs: DocumentReference[] = []

  const gather = async (run: () => Promise<void>) => {
    try {
      await run()
    } catch {
      // one collection being out of reach must not strand the others
    }
  }

  for (const col of ['sos', 'notifications', 'legs']) {
    await gather(async () => {
      const own = await getDocs(query(collection(fb.db, col), where('userId', '==', currentUserId)))
      own.forEach((d) => refs.push(d.ref))
    })
  }
  // The staged cast's calls for aid and station records, addressed by id.
  for (const r of load<SosRequest[]>(SOS_KEY, [])) {
    if (r.userId?.startsWith('demo-')) refs.push(doc(fb.db, 'sos', r.id))
  }
  for (const l of load<QuestLeg[]>(LOG_KEY, [])) {
    if (l.userId?.startsWith('demo-')) refs.push(doc(fb.db, 'legs', l.id))
  }
  await gather(async () => {
    const guests = await getDocs(query(collection(fb.db, 'guests'), where('demo', '==', true)))
    guests.forEach((d) => refs.push(d.ref))
  })
  // Take the cast off the stations board. Presence rows are keyed by user id,
  // so the staged ones are exactly the demo- documents.
  await gather(async () => {
    const staged = await getDocs(collection(fb.db, 'presence'))
    staged.forEach((d) => {
      if (d.id.startsWith('demo-') || d.id === currentUserId) refs.push(d.ref)
    })
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
