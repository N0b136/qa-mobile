// The rack — flagpoles, and the parties they are bound to.
//
// A party carries a standard through the park and taps it against a reader at
// each station. The tag in the tip is a factory uid and nothing else, so this
// record is the entire binding between a pole, a party, one questline and one
// episode — and a bound pole IS the proof the Passage was paid. Every station in
// the woods runs on a cached copy of it, broadcast as a versioned table.
//
// Two invariants run through the whole file:
//
//  1. THE TABLE VERSION IS DERIVED, never incremented — `tableVersion()` is
//     `max(flag.tableAt)`, so there is no hot counter doc to contend on. Which
//     is why `updatedAt` and `tableAt` are different fields: `updatedAt` moves
//     on any write, `tableAt` only on one the stations must hear about. A tap
//     bumps `updatedAt` and NEVER `tableAt`, or every tap would mark all
//     twenty-one stations stale.
//
//  2. A UID IS REJECTED, NOT REPAIRED. `normalizeUid` is an allowlist, because
//     the uid becomes a Firestore document id and a '/' inside one silently
//     re-targets a different collection path. A uid we cannot vouch for is an
//     unknown tag, which is already a first-class outcome — the station stays on
//     its ambience loop and asks the hub for a fresh table.
//
// Reads are synchronous off the local mirror (`ql:flags`), which cloudSync keeps
// fresh from `flags/{tagUid}` — the doc id IS the uid, so a tap is an O(1)
// `doc()` read with no index. Only the writes that need a server verdict are
// async, exactly as in partyService: when `isConfigured()` is false every cloud
// path is a no-op and the booth still works, locally, on one machine.
//
// There is deliberately no `flagHolders` collection. "One party, one flag" is
// enforced by the physical rack behind the counter.

import type { Flag, FlagStatus } from '../types'
import { load, save } from './store'
import { getUser } from './authService'
import { getUserParty } from './partyService'
import { getOrg } from '../content/orgs'
import { getEpisode } from '../content/quests'
import { getStation } from '../content/stations'
import { QUEST_START, VILLAGE_PLACE } from '../content/stationMap'
import { currentEpisode } from './progressService'
import { redeem, recordCover } from './passService'
import { clearPresenceFor, detachFlag } from './presenceService'
import { ensureFirebase, ensureFirebaseWithin, isConfigured } from './firebase'
import * as cloudSync from './cloudSync'

const FLAGS_KEY = 'ql:flags'

/** Booth writes happen with an employee watching a spinner — same deadline as auth. */
const BOOTH_TIMEOUT_MS = 10_000

/** A pole out this long has not simply been slow. Derived, never stored. */
const OVERDUE_MS = 6 * 60 * 60 * 1000

// What rides on the air. The station only ever needs to know whether the pole
// is walking an episode, has finished it, or is back on the rack.
const WIRE_ASSIGNED = 0
const WIRE_SEALED = 1
const WIRE_RETURNED = 2

// Folder = order on every station's SD card, so these numbers are physical and
// are written down rather than derived from array order: renumbering them means
// re-cutting twenty-one SD cards.
const ORG_WIRE: Record<string, number> = { rangers: 1, alehiim: 2, elm: 3 }

// ── Types ─────────────────────────────────────────────────────────────────────

/** One flag as the booth reads it: where it is, how long it has been gone. */
export interface FlagState {
  flag: Flag
  /** Minutes since it left the rack. Unset for a pole that is on the rack. */
  minutesOut?: number
  overdue: boolean
  /** One line for the rack chip, in staff words. */
  note: string
}

export type FlagOutcome = { ok: true; flag: Flag } | { ok: false; error: string; conflict?: Flag }

export type TapResolution =
  | { ok: true; flag: Flag; placeId: string; placeName: string }
  | {
      ok: false
      reason: 'unknown-tag' | 'unbound' | 'sealed' | 'lost' | 'unknown-place'
      rfidUid: string
      placeId: string
    }

/** One flag as the hub holds it. NO groupId on the air — identity resolves at the hub. */
export interface FlagTableRow {
  uid: string
  org: number
  ep: number
  state: number
  partySize: number
}

export interface FlagTable {
  version: number
  builtAt: number
  rows: FlagTableRow[]
}

// ── The local mirror ──────────────────────────────────────────────────────────

export function listFlags(): Flag[] {
  return load<Flag[]>(FLAGS_KEY, [])
}

function setFlags(list: Flag[]): void {
  save(FLAGS_KEY, list)
}

function upsertLocal(flag: Flag): Flag {
  const list = listFlags()
  const idx = list.findIndex((f) => f.uid === flag.uid)
  if (idx === -1) {
    setFlags([...list, flag])
  } else {
    const next = [...list]
    next[idx] = flag
    setFlags(next)
  }
  return flag
}

/** Local write plus a fire-and-forget write-through. */
function writeFlag(flag: Flag): Flag {
  upsertLocal(flag)
  pushFlagDoc(flag)
  return flag
}

function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v
  })
  return out as T
}

/**
 * flagService is the complete and only writer of a flag document, so the write
 * itself is a whole-document `setDoc` with no `merge` — a merge would strand
 * fields from a previous binding on the record (the pushGuestProfile lesson).
 *
 * It lives in cloudSync beside `mergeFlagsSnapshot`, so the push and the merge
 * that reads it back sit in one file and can be reasoned about together.
 */
function pushFlagDoc(flag: Flag): void {
  cloudSync.pushFlag(flag)
}

/**
 * Takes a party off the board when their walk ends.
 *
 * Staff may delete a presence row, and every guest phone honours a `removed`
 * change in its snapshot, so the party leaves the console AND their own screens.
 */
function clearPresenceDocs(userIds: string[]): void {
  if (userIds.length === 0) return
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, deleteDoc } = await import('firebase/firestore')
      await Promise.all(
        userIds.map((id) => deleteDoc(doc(fb.db, 'presence', id)).catch(() => undefined))
      )
    } catch {
      // swallow
    }
  })
}

// ── Reading the rack ──────────────────────────────────────────────────────────

/**
 * Reject, do not repair.
 *
 * A UID we cannot vouch for is an unknown tag, and an unknown tag is already a
 * first-class outcome that leaves the station silent. Repairing one would mean
 * guessing, and a guessed id is either somebody else's pole or — with a '/' in
 * it — an entirely different collection path.
 */
export function normalizeUid(raw: string): string | null {
  const up = raw.trim().toUpperCase()
  return /^[0-9A-F]{8,20}$/.test(up) ? up : null
}

/** True while the pole is away from the rack with a party. */
function isOut(flag: Flag): boolean {
  return flag.status === 'bound' || flag.status === 'sealed'
}

export function flagByUid(rfidUid: string): Flag | null {
  const uid = normalizeUid(rfidUid)
  if (!uid) return null
  return listFlags().find((f) => f.uid === uid) ?? null
}

export function flagByLabel(label: string): Flag | null {
  const wanted = label.trim().toUpperCase()
  if (!wanted) return null
  return listFlags().find((f) => f.label.trim().toUpperCase() === wanted) ?? null
}

/** The standard a group is out with, if any. */
export function flagFor(groupId: string): Flag | null {
  return (
    listFlags()
      .filter((f) => isOut(f) && f.groupId === groupId)
      .sort((a, b) => (b.boundAt ?? 0) - (a.boundAt ?? 0))[0] ?? null
  )
}

/**
 * The standard this guest is walking under.
 *
 * Their party's binding answers first — a guest who joined the party after the
 * pole was bound is still walking under it — and a solo binding second.
 */
export function flagForUser(userId: string): Flag | null {
  const party = getUserParty(userId)
  if (party) {
    const byParty = flagFor(party.id)
    if (byParty) return byParty
  }
  const solo = flagFor(`solo:${userId}`)
  if (solo) return solo
  return (
    listFlags().find(
      (f) => isOut(f) && (f.holderId === userId || (f.memberIds ?? []).includes(userId))
    ) ?? null
  )
}

function outFor(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000))
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rest = mins % 60
  return rest === 0 ? `${hrs} hr` : `${hrs} hr ${rest} min`
}

function noteFor(flag: Flag, minutesOut: number | undefined, overdue: boolean): string {
  const org = flag.orgId ? getOrg(flag.orgId)?.name : undefined
  const walk = [flag.groupName, org, flag.episodeNumber ? `Episode ${flag.episodeNumber}` : undefined]
    .filter(Boolean)
    .join(' · ')
  const out = minutesOut === undefined ? '' : outFor(minutesOut * 60_000)

  switch (flag.status) {
    case 'bound':
      if (overdue) return `${walk} — not yet returned, out ${out}.`
      return walk ? `${walk} — out ${out}.` : `Out ${out}.`
    case 'sealed':
      if (overdue) return `${walk} — sealed, not yet returned, out ${out}.`
      return `${walk} — sealed, due back at the booth.`
    case 'lost':
      return walk ? `Reported lost, last bound to ${walk}.` : 'Reported lost.'
    case 'retired':
      return 'Retired from the rack.'
    default:
      if (flag.checkedOutAt) return 'Returned. On the rack.'
      if (flag.releasedAt) return 'Released. On the rack.'
      return 'On the rack.'
  }
}

/** Every pole, the ones that are out first and the overdue ones at the very top. */
export function flagStates(now: number = Date.now()): FlagState[] {
  const rank: Record<FlagStatus, number> = { bound: 0, sealed: 1, lost: 2, racked: 3, retired: 4 }
  return listFlags()
    .map((flag) => {
      const out = isOut(flag) && flag.boundAt ? now - flag.boundAt : undefined
      const overdue = out !== undefined && out > OVERDUE_MS
      const minutesOut = out === undefined ? undefined : Math.floor(out / 60_000)
      return { flag, minutesOut, overdue, note: noteFor(flag, minutesOut, overdue) }
    })
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        rank[a.flag.status] - rank[b.flag.status] ||
        a.flag.label.localeCompare(b.flag.label, undefined, { numeric: true })
    )
}

/** The lowest FLAG-NN the rack is not already using. */
export function nextLabel(): string {
  const used = new Set<number>()
  listFlags().forEach((f) => {
    const m = /^FLAG-(\d{1,3})$/.exec((f.label ?? '').trim().toUpperCase())
    if (m) used.add(Number(m[1]))
  })
  let n = 1
  while (used.has(n)) n++
  return `FLAG-${String(n).padStart(2, '0')}`
}

// ── Enrolling a pole ──────────────────────────────────────────────────────────

type ClaimResult =
  | { ok: true; flag: Flag }
  | { ok: false; reason: 'conflict'; flag: Flag }
  | { ok: false; reason: 'unavailable' }

/**
 * Bounds a promise that has no timeout of its own.
 *
 * `ensureFirebaseWithin` puts a deadline on the BOOTSTRAP, and that is not the
 * same thing as a deadline on the write. On a browser with no route to
 * Firestore the bootstrap resolves in milliseconds — `onAuthStateChanged` fires
 * with "no session" and that is a complete answer — and it is `runTransaction`
 * that then hangs, because the SDK retries a transaction indefinitely rather
 * than failing it. Without this, a Guide at the gate on dropped wifi gets a
 * button that says "Binding…" forever, with the Passage already charged and the
 * pole never bound.
 *
 * The losing promise is left running deliberately. If the transaction lands a
 * minute later it writes the very same document this function's caller already
 * wrote locally, and the snapshot merge is last-write-wins on `updatedAt`, so a
 * late commit is a no-op rather than a conflict.
 */
function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(onTimeout), ms)
    }),
  ]).then((value) => {
    clearTimeout(timer)
    return value
  })
}

/**
 * Writes `next` only if the server copy is not out with a DIFFERENT group.
 *
 * Compare-and-set rather than last-write-wins because two booth machines can be
 * reading poles at the same counter: whichever transaction commits second must
 * see the first one's binding, not overwrite it.
 */
async function claimFlagDoc(next: Flag, groupId: string | null): Promise<ClaimResult> {
  const fb = await ensureFirebaseWithin(BOOTH_TIMEOUT_MS)
  if (!fb) return { ok: false, reason: 'unavailable' }
  try {
    const { doc, runTransaction } = await import('firebase/firestore')
    const ref = doc(fb.db, 'flags', next.uid)

    const claim = runTransaction<ClaimResult>(fb.db, async (tx) => {
      const snap = await tx.get(ref)
      const server = snap.exists() ? (snap.data() as Flag) : null
      if (server && isOut(server) && server.groupId && server.groupId !== groupId) {
        return { ok: false, reason: 'conflict', flag: server }
      }
      // The label belongs to the pole, not to this binding: whatever the rack
      // already calls it beats a name minted from a stale local mirror.
      const written: Flag = { ...next, label: server?.label ?? next.label }
      tx.set(ref, clean({ ...written }))
      return { ok: true, flag: written }
    })

    // An employee is standing at a counter with a guest in front of them. A
    // server verdict is worth waiting for; it is not worth waiting for forever.
    return await withDeadline<ClaimResult>(claim, BOOTH_TIMEOUT_MS, {
      ok: false,
      reason: 'unavailable',
    })
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

export interface RegisterFlagInput {
  rfidUid: string
  /** Printed on the pole. Minted as the next free FLAG-NN when omitted. */
  label?: string
  at?: number
  demo?: true
}

/**
 * Puts a new pole on the rack.
 *
 * Transactional for one reason: the local mirror can be empty on a console that
 * has just opened, and a plain write would then clobber a pole that is out with
 * a party. `tableAt` moves — the stations must learn the tag exists, so that a
 * tap on an unbound pole reads as "known, nothing to play" instead of driving
 * every station into a resync loop for a tag the park has never heard of.
 */
export async function registerFlag(input: RegisterFlagInput): Promise<FlagOutcome> {
  const at = input.at ?? Date.now()
  const uid = normalizeUid(input.rfidUid)
  if (!uid) return { ok: false, error: 'That tag could not be read. Present it to the pad again.' }

  const known = listFlags().find((f) => f.uid === uid)
  if (known) return { ok: false, error: `That tag is already enrolled as ${known.label}.`, conflict: known }

  const label = (input.label ?? '').trim().toUpperCase() || nextLabel()
  const clash = flagByLabel(label)
  if (clash) return { ok: false, error: `${label} is already on the rack.`, conflict: clash }

  const flag: Flag = {
    uid,
    label,
    status: 'racked',
    updatedAt: at,
    tableAt: at,
    ...(input.demo ? { demo: input.demo } : {}),
  }

  if (isConfigured()) {
    const claimed = await claimFlagDoc(flag, null)
    if (claimed.ok) return { ok: true, flag: upsertLocal(claimed.flag) }
    if (claimed.reason === 'conflict') {
      upsertLocal(claimed.flag)
      return { ok: false, error: `That tag is already enrolled as ${claimed.flag.label}.`, conflict: claimed.flag }
    }
    // 'unavailable' — fall through and keep the pole on this machine's rack.
  }
  return { ok: true, flag: writeFlag(flag) }
}

// ── Binding a pole to a party ─────────────────────────────────────────────────

export interface BindFlagInput {
  /** Raw uid as the booth pad read it. */
  rfidUid: string
  /** The guest the walk is recorded as. Always one of the party. */
  holderId: string
  orgId: string
  /** Staff override. Defaults to the holder's next unsealed episode. */
  episodeId?: string
  /** The passage being spent. Omit only when this episode is already paid for. */
  passBookingId?: string
  /** Bodies under the pole, when that is more than the roster (walk-ups). */
  headcount?: number
  /** Staff uid. Deliberately never a staff NAME. */
  boundBy?: string
  /** Enrol the pole in the same gesture, when the rack has never seen this tag. */
  label?: string
  at?: number
  demo?: true
}

/**
 * Binds a pole to a party, a questline and one episode — AND spends the Passage.
 *
 * This is the ticket booth. Holding a bound standard is the proof of payment, so
 * the two halves are one action: a binding that did not charge a Quest
 * Experience would be a free walk, and a charge that did not bind would be a
 * receipt for nothing.
 *
 * Order matters. The local conflict check refuses early and cheaply; the Passage
 * is spent BEFORE the pole is claimed, because `redeem` is idempotent per
 * (guest, order, episode) — so a Guide who hits a conflict and reaches for a
 * different pole is not charged twice — whereas claiming first and failing to
 * charge would hand out a bound pole nobody paid for.
 *
 * Rebinding the SAME group is not a conflict: it is how a Hero Pass party takes
 * up their next episode without changing poles.
 */
export async function bindFlag(input: BindFlagInput): Promise<FlagOutcome> {
  const at = input.at ?? Date.now()
  const uid = normalizeUid(input.rfidUid)
  if (!uid) return { ok: false, error: 'That tag could not be read. Present it to the pad again.' }

  const holder = getUser(input.holderId)
  if (!holder) return { ok: false, error: 'That guest is not on the roll.' }
  if (!getOrg(input.orgId)) return { ok: false, error: 'That questline is not on the chart.' }

  // The episode is CONFIRMED here, never chosen.
  //
  // Nothing downstream of this binding reads `flag.episodeId`. `questTaken` asks
  // the ledger about the holder's next unsealed episode, and `creditStation`
  // credits that same one — so a binding written for any other episode is a
  // receipt for a walk the park will not honour: the chief turns the party away
  // ("take up a quest at the gate first") even though the Passage was just spent,
  // and every station they reach afterwards credits an episode they are not
  // hearing.
  //
  // Passing `episodeId` is still worth doing, as a compare-and-set: a booth form
  // can sit open while the party seals something at a plinth, and the bind must
  // refuse rather than quietly charge the wrong walk. A genuine replay or skip
  // needs the progress engine to walk a NAMED episode, which is a change to
  // progressService and explicitly out of this slice.
  const open = currentEpisode(input.holderId, input.orgId)
  if (!open) return { ok: false, error: 'There is no episode open on that questline.' }
  const episode = input.episodeId ? getEpisode(input.episodeId) : open
  if (!episode || episode.orgId !== input.orgId) {
    return { ok: false, error: 'There is no episode open on that questline.' }
  }
  if (episode.id !== open.id) {
    return {
      ok: false,
      error: `${holder.name} stands at Episode ${open.number} of that questline. The park cannot bind another.`,
    }
  }

  const party = getUserParty(input.holderId)
  const groupId = party ? party.id : `solo:${holder.id}`
  const groupName = party ? party.name : holder.name
  const memberIds = party && party.memberIds.length > 0 ? party.memberIds : [holder.id]

  const existing = listFlags().find((f) => f.uid === uid)
  if (existing) {
    if (existing.status === 'lost') {
      return { ok: false, error: `${existing.label} is marked lost. Find it or take another.`, conflict: existing }
    }
    if (existing.status === 'retired') {
      return { ok: false, error: `${existing.label} is retired. Take another from the rack.`, conflict: existing }
    }
    if (isOut(existing) && existing.groupId && existing.groupId !== groupId) {
      return {
        ok: false,
        error: `${existing.label} is out with ${existing.groupName ?? 'another party'}.`,
        conflict: existing,
      }
    }
  }

  // Spend the Passage. Already paid for this episode? `redeem` hands back the
  // existing record and charges nothing — re-reading a binding at the counter
  // costs a party nothing.
  const spent = redeem(holder.id, {
    bookingId: input.passBookingId,
    orgId: input.orgId,
    episodeId: episode.id,
    guests: input.headcount ?? memberIds.length,
    at,
  })
  if (!spent.ok) return { ok: false, error: spent.error }
  const pass = spent.use

  // One passage walks in as many guests as it was booked for. The holder is
  // always covered; the rest take the remaining seats in roster order, and
  // anybody past the count simply presents a passage of their own — they are not
  // turned away.
  //
  // The seats are seats on THE POLE'S questline, not each mate's own order. One
  // standard names one quest for the whole group and every plinth plays it to all
  // of them, so covering a mate on an order nobody is walking would pay them up
  // for the wrong quest and still leave them owing one for this walk.
  let seatsLeft = Math.max(0, pass.covers - 1)
  for (const id of memberIds) {
    if (id === holder.id || seatsLeft <= 0) continue
    if (!getUser(id)) continue
    const theirs = currentEpisode(id, input.orgId)
    if (!theirs) continue
    recordCover(
      id,
      {
        code: pass.code,
        passName: pass.passName,
        orgId: input.orgId,
        episodeId: theirs.id,
        at,
        guests: pass.guests,
        covers: pass.covers,
      },
      holder.id
    )
    seatsLeft--
  }

  // A pole enrolled in the same gesture takes the name the counter gave it; one
  // already on the rack keeps the name printed on it.
  const label = existing?.label ?? ((input.label ?? '').trim().toUpperCase() || nextLabel())

  // A fresh binding, not a patch: `releasedAt` and `checkedOutAt` belong to the
  // walk that ended, and must not survive into the one starting now.
  const next: Flag = clean({
    uid,
    label,
    status: 'bound' as FlagStatus,
    groupId,
    groupName,
    holderId: holder.id,
    memberIds,
    orgId: input.orgId,
    episodeId: episode.id,
    episodeNumber: episode.number,
    headcount: input.headcount ?? memberIds.length,
    passCode: pass.code,
    boundBy: input.boundBy,
    boundAt: at,
    lastSeenAt: existing?.lastSeenAt,
    lastPlaceId: existing?.lastPlaceId,
    updatedAt: at,
    // The broadcast changes: order, episode and state all just moved.
    tableAt: at,
    demo: input.demo ?? existing?.demo,
  })

  if (isConfigured()) {
    const claimed = await claimFlagDoc(next, groupId)
    if (claimed.ok) return { ok: true, flag: upsertLocal(claimed.flag) }
    if (claimed.reason === 'conflict') {
      upsertLocal(claimed.flag)
      return {
        ok: false,
        error: `${claimed.flag.label} is out with ${claimed.flag.groupName ?? 'another party'}.`,
        conflict: claimed.flag,
      }
    }
    // 'unavailable' — bind on this machine; the write-through catches up.
  }
  return { ok: true, flag: writeFlag(next) }
}

// ── Ending a walk ─────────────────────────────────────────────────────────────

export interface RackFlagOptions {
  at?: number
}

/**
 * Takes a binding back — an ADMINISTRATIVE UNDO.
 *
 * The wrong party, a mis-scan, a pole handed over at the counter and then
 * swapped. The binding was a mistake, so it is erased rather than recorded: the
 * group, questline, episode and receipt all come off, and `releasedAt` is
 * stamped. Nothing is said about where the party is, because as far as the
 * records are concerned this walk never began — they stay on the board, they
 * simply stop carrying this pole.
 *
 * So the LABEL comes off their presence rows, and only the label. A released
 * standard is back on the rack and can be bound to another party within the
 * minute; a row still naming it would send a Warden after the wrong group, and
 * Guests Afield would go on showing a pole nobody is carrying until the row aged
 * out four hours later. Clearing the rows outright would be worse still — these
 * guests may be halfway round the park, and a safety board must not lose them.
 *
 * This is NOT how a day ends — see `completeFlag`.
 */
export async function releaseFlag(rfidUid: string, opts: RackFlagOptions = {}): Promise<FlagOutcome> {
  const at = opts.at ?? Date.now()
  const flag = flagByUid(rfidUid)
  if (!flag) return { ok: false, error: 'That tag is not on the rack.' }

  const carried = flag.memberIds?.length ? flag.memberIds : flag.holderId ? [flag.holderId] : []

  const next: Flag = clean({
    uid: flag.uid,
    label: flag.label,
    status: 'racked' as FlagStatus,
    lastSeenAt: flag.lastSeenAt,
    lastPlaceId: flag.lastPlaceId,
    releasedAt: at,
    updatedAt: at,
    // The stations must stop resolving this pole to a party.
    tableAt: at,
    demo: flag.demo,
  })
  const written = writeFlag(next)
  detachFlag(carried)
  return { ok: true, flag: written }
}

/**
 * Closes a walk — the guest handed the pole back at the booth.
 *
 * The employee taps the returned standard on the same pad that bound it, and
 * that tap is the act of racking it: park property cannot be put away without
 * being handled, which is exactly why the check-out is the employee's and not
 * the guest's.
 *
 * It differs from `releaseFlag` in what it writes, and the difference is the
 * point. Completion KEEPS the binding — which party, which questline, which
 * episode, which passage — and stamps `checkedOutAt`, which is what says "they
 * finished and went home". Release erases the binding and stamps `releasedAt`,
 * saying "that binding should never have existed". A party that simply never came
 * back has neither stamp and ages out as before, still bound, reading `overdue` —
 * presumed gone, which must never be merged with a real check-out. A safety board
 * that quietly fills with ghosts is worse than none.
 *
 * It also clears every member's presence at ONE shared timestamp, so the whole
 * party leaves the console's board together rather than trickling off it as
 * separate windows expire.
 *
 * NOT YET SURFACED IN THE STATION RECORDS. `checkedOutAt` lives on the flag and
 * shows on the rack chip; runs in `questLogService` are DERIVED from legs and
 * carry no closing leg, so a walk that ended and a walk that is presumed gone
 * still read alike there. Closing a run needs a leg kind the log does not have
 * (`QuestLeg.kind` is a `PresenceKind`) and would move the CSV's `leg` column,
 * which the export contract pins — so it is a change of its own, not a line here.
 */
export async function completeFlag(rfidUid: string, opts: RackFlagOptions = {}): Promise<FlagOutcome> {
  const at = opts.at ?? Date.now()
  const flag = flagByUid(rfidUid)
  if (!flag) return { ok: false, error: 'That tag is not on the rack.' }
  if (!isOut(flag)) return { ok: false, error: `${flag.label} is already on the rack.` }

  const next: Flag = clean({
    ...flag,
    status: 'racked' as FlagStatus,
    checkedOutAt: at,
    updatedAt: at,
    // The wire state moves to 'returned', so this is a table write.
    tableAt: at,
  })
  writeFlag(next)

  // The roster on the binding is frozen at the counter; the party that walked may
  // have grown since. Every member is given a presence row by each check-in — the
  // rows are written against the party as it stands at that moment — so the
  // CURRENT roster is cleared alongside the bound one. Without it a guest who
  // joined mid-walk is left behind on the board, alone at the last station the
  // party reached, long after they handed the pole back.
  const bound = flag.memberIds?.length
    ? flag.memberIds
    : flag.holderId
      ? [flag.holderId]
      : []
  const walked = flag.holderId ? (getUserParty(flag.holderId)?.memberIds ?? []) : []
  const members = Array.from(new Set([...bound, ...walked]))
  clearPresenceFor(members)
  clearPresenceDocs(members)

  return { ok: true, flag: next }
}

// ── Status stamps ─────────────────────────────────────────────────────────────
//
// Small, synchronous, fire-and-forget. Each one changes what the stations must
// resolve the pole to, so each moves `tableAt`.

function stamp(rfidUid: string, status: FlagStatus, at: number): Flag | null {
  const flag = flagByUid(rfidUid)
  if (!flag) return null
  return writeFlag({ ...flag, status, updatedAt: at, tableAt: at })
}

/**
 * The party sealed the episode. The pole is still out — it has to be carried
 * back — but the stations must stop playing that episode's clips for it, which
 * is precisely why `sealed` rides on the wire rather than being derived.
 */
export function markSealed(rfidUid: string, at: number = Date.now()): Flag | null {
  const flag = flagByUid(rfidUid)
  if (!flag || flag.status !== 'bound') return null
  return stamp(rfidUid, 'sealed', at)
}

/** The pole did not come back. The binding is kept — it names who had it last. */
export function markLost(rfidUid: string, at: number = Date.now()): Flag | null {
  return stamp(rfidUid, 'lost', at)
}

/**
 * It turned up. A pole that is still bound to an unfinished walk goes back to
 * that walk; one whose walk already ended goes back on the rack, to be bound
 * again at the counter.
 */
export function markFound(rfidUid: string, at: number = Date.now()): Flag | null {
  const flag = flagByUid(rfidUid)
  if (!flag || flag.status !== 'lost') return null
  const walkStillOpen =
    !!flag.groupId && !!flag.boundAt && !flag.checkedOutAt && (flag.releasedAt ?? 0) < flag.boundAt
  return stamp(rfidUid, walkStillOpen ? 'bound' : 'racked', at)
}

/** Out of service — a cracked pole, a dead tag. It resolves to nothing, forever. */
export function retireFlag(rfidUid: string, at: number = Date.now()): Flag | null {
  return stamp(rfidUid, 'retired', at)
}

// ── Taps ──────────────────────────────────────────────────────────────────────

function placeNameOf(placeId: string): string | null {
  if (placeId === VILLAGE_PLACE.id) return VILLAGE_PLACE.name
  if (placeId === QUEST_START.id) return QUEST_START.name
  return getStation(placeId)?.name ?? null
}

/**
 * What a tap means — pure, transport-agnostic, and the only place a raw uid off
 * the air becomes a party.
 *
 * Every refusal is a first-class outcome carrying the uid and the place, because
 * a station that cannot resolve a tag must report it rather than guess: there is
 * no fallback audio anywhere in this system, and a wrong story is worse than a
 * pause.
 */
export function resolveTap(rfidUid: string, placeId: string): TapResolution {
  const uid = normalizeUid(rfidUid)
  const flag = uid ? listFlags().find((f) => f.uid === uid) ?? null : null
  if (!flag) return { ok: false, reason: 'unknown-tag', rfidUid, placeId }

  const placeName = placeNameOf(placeId)
  if (!placeName) return { ok: false, reason: 'unknown-place', rfidUid, placeId }

  if (flag.status === 'lost') return { ok: false, reason: 'lost', rfidUid, placeId }
  if (flag.status === 'sealed') return { ok: false, reason: 'sealed', rfidUid, placeId }
  if (flag.status !== 'bound' || !flag.groupId) {
    return { ok: false, reason: 'unbound', rfidUid, placeId }
  }

  return { ok: true, flag, placeId, placeName }
}

/**
 * Records that the pole was seen.
 *
 * `updatedAt` moves so the rack shows a live pole; `tableAt` deliberately does
 * NOT, because nothing about the broadcast changed. Bumping it here would mark
 * all twenty-one stations stale on every single tap.
 */
export function noteTap(rfidUid: string, placeId: string, at: number = Date.now()): Flag | null {
  const flag = flagByUid(rfidUid)
  if (!flag) return null
  return writeFlag({ ...flag, lastSeenAt: at, lastPlaceId: placeId, updatedAt: at })
}

// ── The broadcast ─────────────────────────────────────────────────────────────

/**
 * The park's current table version — DERIVED, never incremented.
 *
 * There is no counter document to contend on: the version is simply the newest
 * write that changed the broadcast, which makes "is this station current?" a
 * comparison of two numbers that no writer has to coordinate on.
 */
export function tableVersion(): number {
  return listFlags().reduce((max, f) => Math.max(max, f.tableAt ?? 0), 0)
}

/**
 * The whole table as the stations cache it.
 *
 * EVERY known pole is listed, including racked, lost and retired ones, because a
 * tag the park knows and has nothing to play for is a different thing from a tag
 * the park has never heard of: the first is silence, the second sends a station
 * into a resync loop. Rows are sorted by uid so the same rack always produces
 * the same bytes, which is what makes the firmware's table CRC meaningful.
 *
 * Nothing on the air is free text — every field here is a number or hex. The
 * first person who wants a station to greet a party by name will ask for
 * `groupName` in this table; that is the change this shape exists to prevent.
 */
export function assignmentTable(builtAt: number = Date.now()): FlagTable {
  const rows: FlagTableRow[] = listFlags()
    .map((f) => {
      const walking = f.status === 'bound' || f.status === 'sealed'
      return {
        uid: f.uid,
        org: walking ? (ORG_WIRE[f.orgId ?? ''] ?? 0) : 0,
        ep: walking ? (f.episodeNumber ?? 0) : 0,
        state: f.status === 'bound' ? WIRE_ASSIGNED : f.status === 'sealed' ? WIRE_SEALED : WIRE_RETURNED,
        partySize: Math.max(1, f.headcount ?? f.memberIds?.length ?? 1),
      }
    })
    .sort((a, b) => a.uid.localeCompare(b.uid))

  return { version: tableVersion(), builtAt, rows }
}

// ── Demo helpers ──────────────────────────────────────────────────────────────
//
// Local only, both of them. `flags` is a staff-write collection and the demo
// remote runs as the presenting guest, so a push would only be refused.

/** Straight local write — used to stage a rack for a pitch. */
export function seedFlags(flags: Flag[]): void {
  const byUid = new Map(listFlags().map((f) => [f.uid, f] as const))
  flags.forEach((f) => byUid.set(f.uid, f))
  setFlags(Array.from(byUid.values()))
}

export function clearDemoFlags(): void {
  setFlags(listFlags().filter((f) => !f.demo))
}
