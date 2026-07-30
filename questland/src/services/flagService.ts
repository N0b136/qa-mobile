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

/**
 * Uids whose documents this console has struck, and when.
 *
 * `mergeFlagsSnapshot` seeds itself from the local mirror and then unions the
 * WHOLE snapshot over it, honouring only the `removed` changes. So between the
 * create and the delete of an `attachTag` the struck document is still in the
 * server's result set, and the union would write it straight back into the
 * mirror it was just taken out of: one physical pole showing as two chips under
 * one label, with nothing on either to say which is the ghost. Retiring the
 * wrong one takes a good pole out of service.
 *
 * cloudSync READS this key rather than importing anything from here, because
 * flagService imports cloudSync and the arrow only goes one way. It is mirrored
 * there beside `FLAGS_KEY` and the uid allowlist, which are duplicated for the
 * same reason.
 *
 * It is deliberately local. A second booth machine holds no tombstone and sees
 * the pair for that one round trip, until the `removed` change reaches it —
 * which is the right trade: this guards the console an employee is looking at
 * while they act on the pole in their hand, and costs no coordination.
 */
const STRUCK_KEY = 'ql:flagsStruck'

/**
 * Long enough to cover a slow round trip; short enough that a delete which never
 * landed still resurfaces as a duplicate an employee can see and retire — which
 * is the documented outcome of a half-finished attach, not a state to hide
 * forever.
 */
const STRUCK_TTL_MS = 5 * 60 * 1000

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

/**
 * Moves a pole onto a new id in ONE local write.
 *
 * `attachTag` is the only caller, and this is deliberately not two calls: the
 * mirror is a single `save`, so it cannot half-change. The ordering that has to
 * be got right is the CLOUD one — see `attachTag`.
 */
function swapLocal(oldUid: string, flag: Flag): Flag {
  setFlags([...listFlags().filter((f) => f.uid !== oldUid && f.uid !== flag.uid), flag])
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
 * Strikes a pole's document.
 *
 * Only `attachTag` needs this — nothing else in the rack ever changes a pole's
 * id, and every other write is a whole-document `setDoc`. It lives here rather
 * than beside `pushFlag` in cloudSync because it is one half of an operation
 * whose ORDERING is the whole point, and both halves belong where that can be
 * read in one place.
 */
function deleteFlagDoc(uid: string): void {
  // Before the delete is even attempted, because the snapshot that would
  // resurrect the document can arrive before the delete does — it is fired by
  // the CREATE that preceded this call.
  markStruck(uid)
  void ensureFirebase().then(async (fb) => {
    if (!fb) return
    try {
      const { doc, deleteDoc } = await import('firebase/firestore')
      await deleteDoc(doc(fb.db, 'flags', uid))
    } catch {
      // Swallowed on purpose. The new document is already written, so the worst
      // this leaves is a duplicate: the stale doc comes back through the next
      // snapshot as a second chip carrying the same label, which an employee can
      // see and retire. A pole that vanished from every console would not be
      // visible at all — which is why the create is the half that goes first.
    }
  })
}

/**
 * Tombstones a uid so the snapshot merge cannot put it back.
 *
 * Expired entries are dropped on every strike, so the record never grows: the
 * only writer is `attachTag`, and it is a counter operation, not a loop.
 */
function markStruck(uid: string): void {
  const now = Date.now()
  const struck = load<Record<string, number>>(STRUCK_KEY, {})
  const next: Record<string, number> = {}
  Object.entries(struck).forEach(([k, at]) => {
    if (typeof at === 'number' && now - at < STRUCK_TTL_MS) next[k] = at
  })
  next[uid] = now
  save(STRUCK_KEY, next)
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

// ── A pole enrolled ahead of its tag ─────────────────────────────────────────
//
// Poles are printed, numbered and racked before opening day; the tags are potted
// into the tips afterwards, and one occasionally dies under a standard that is
// otherwise perfectly good. So a pole exists on the rack with no tag on it, and
// it still has to bind, spend a Passage and walk — the tag is only how a plinth
// recognises it, not what the park sells.
//
// The record's id IS the tag uid (`flags/{tagUid}`), so a pole with no tag still
// needs one. It is minted here and must satisfy `normalizeUid` unchanged,
// because from that moment it flows through every path a real uid does.
//
// COLLISION-SAFETY IS BY LENGTH, NOT BY LUCK. ISO/IEC 14443-3 defines exactly
// three UID sizes — single 4 bytes, double 7, triple 10 — so a uid read off a
// reader and hex-encoded is always 8, 14 or 20 characters. Nothing else can come
// off a pad. A synthetic uid is 16, a length no tag in the world can produce, so
// it cannot shadow a factory uid however many tags the park buys, and a tag
// presented at the counter can never be refused as "already enrolled" against a
// pole that has none. The random half exists only so two consoles enrolling
// pending poles on separate machines cannot mint the same id; the guarantee
// against real hardware is the length alone. The 'FF' prefix is cosmetic — it
// makes a synthetic id obvious in a log — and carries no part of the argument.
const PENDING_UID_LEN = 16
const PENDING_UID_PREFIX = 'FF'
const HEX = '0123456789ABCDEF'

/**
 * Hex, from the CSPRNG.
 *
 * Not `ids.shortCode`: its alphabet is deliberately not hex (it drops the
 * letters that misread when said aloud), and `ids.uid`'s own fallback is
 * base-36 — neither would survive `normalizeUid`. 256 % 16 === 0, so indexing
 * this alphabet with a raw byte carries none of the modulo bias `shortCode` has
 * to reject-sample away.
 */
function randomHex(len: number): string {
  let out = ''
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(len)
    crypto.getRandomValues(bytes)
    for (let i = 0; i < len; i++) out += HEX[bytes[i] & 0x0f]
    return out
  }
  // Every browser this console runs in has WebCrypto; this only keeps a bare
  // test runner from making enrolment throw.
  for (let i = 0; i < len; i++) out += HEX[Math.floor(Math.random() * 16)]
  return out
}

/** An id for a pole that has no tag yet. Distinct from every real uid by length. */
function mintPendingUid(): string {
  const taken = new Set(listFlags().map((f) => f.uid))
  let uid: string
  // Fifty-six random bits: a repeat is not a real possibility. The loop is here
  // so that "impossible" can never quietly mean "overwrote a pole on the rack".
  do {
    uid = PENDING_UID_PREFIX + randomHex(PENDING_UID_LEN - PENDING_UID_PREFIX.length)
  } while (taken.has(uid))
  return uid
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
  // A missing tag is said AFTER the status, never instead of it: a pending pole
  // can be bound and out with a party, and where that party is matters more at
  // the counter than what is potted in the tip.
  const tag = flag.tagPending ? ' No tag attached yet.' : ''
  return `${statusNote(flag, minutesOut, overdue)}${tag}`
}

function statusNote(flag: Flag, minutesOut: number | undefined, overdue: boolean): string {
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
 *
 * `requireFree` tightens that to "nothing whatever may be filed under this id".
 * The same-group exemption exists for ONE case — a Hero party rebinding the pole
 * they are already carrying — and it is only safe because a rebind writes over
 * the very record it read. `attachTag` is not a rebind: it writes a pole onto an
 * id that belonged to a DIFFERENT pole, so any document already there is another
 * standard and overwriting it would lose one of two physical poles from the
 * rack. This is the whole server-side defence for that path, because the local
 * clash check runs against a mirror that can be stale or still filling — which
 * is precisely the condition this transaction exists for.
 */
async function claimFlagDoc(
  next: Flag,
  groupId: string | null,
  requireFree = false
): Promise<ClaimResult> {
  const fb = await ensureFirebaseWithin(BOOTH_TIMEOUT_MS)
  if (!fb) return { ok: false, reason: 'unavailable' }
  try {
    const { doc, runTransaction } = await import('firebase/firestore')
    const ref = doc(fb.db, 'flags', next.uid)

    const claim = runTransaction<ClaimResult>(fb.db, async (tx) => {
      const snap = await tx.get(ref)
      const server = snap.exists() ? (snap.data() as Flag) : null
      if (server && requireFree) return { ok: false, reason: 'conflict', flag: server }
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
  /**
   * The uid as the pad read it. OMITTED OR BLANK enrols the pole ahead of its
   * tag: it goes on the rack under a synthetic id, ready to bind, and takes a
   * real tag later through `attachTag`.
   */
  rfidUid?: string
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
  const raw = (input.rfidUid ?? '').trim()

  // No tag on the counter is not an error — it is a pole made ahead of its tag,
  // which is the ordinary state of a rack before opening day. It is enrolled
  // under a minted id and is a real pole in every other respect.
  const pending = raw === ''
  const uid = pending ? mintPendingUid() : normalizeUid(raw)
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
    ...(pending ? { tagPending: true as const } : {}),
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

/**
 * Gives a pole that was enrolled ahead of its tag the tag it was waiting for.
 *
 * Without this, pre-enrolment is a dead end: a park that racks FLAG-01..12 in
 * March and tags them in May would have `registerFlag` mint FLAG-13.. beside the
 * twelve poles it already owns, and the printed numbers would stop meaning
 * anything.
 *
 * ── THE ID CHANGES, SO THIS IS A CREATE PLUS A DELETE ────────────────────────
 *
 * A document id cannot be edited, and the id here IS the uid. The ORDER decides
 * what a half-finished attach leaves behind, so the new document is written
 * FIRST and the old one struck only once it has landed. Fail on the create and
 * the pole is exactly where it was — on the rack, under its pending id, still
 * bindable, nothing lost. Fail on the delete and the rack carries a duplicate
 * for a while: two chips, one label, visible to the employee and retirable.
 * Delete first and a failure between the two halves loses the pole from every
 * console in the park, which is not a state anybody can see, let alone fix.
 *
 * ── A POLE THAT IS OUT WITH A PARTY MAY BE ATTACHED, AND HERE IS WHY ─────────
 *
 * It is allowed precisely BECAUSE only a tag-pending pole can reach this
 * function. No tag anywhere in the world carries the old uid, so no tap can be
 * in flight against it and no station holds a row that resolves it — the id
 * being replaced is one nothing but this rack has ever seen. The binding rides
 * across untouched (party, questline, episode, passage, label), so the walk is
 * undisturbed; the party simply gains the ability to tap at the next plinth,
 * which is the whole point of walking up to the counter mid-day with a tag.
 *
 * `tableAt` moves, like every write that changes what a station must resolve.
 * The caller must broadcast the WHOLE table rather than a row: a row can add or
 * revise one uid, but it has no way to say that a uid is gone.
 */
export async function attachTag(
  currentUid: string,
  rfidUid: string,
  opts: RackFlagOptions = {}
): Promise<FlagOutcome> {
  const at = opts.at ?? Date.now()
  const target = normalizeUid(rfidUid)
  if (!target) return { ok: false, error: 'That tag could not be read. Present it to the pad again.' }

  const pole = flagByUid(currentUid)
  if (!pole) return { ok: false, error: 'That pole is not on the rack.' }
  // A pole that already answers to a tag is left alone. Re-tagging a live pole
  // would mean retiring its old uid from the park's table as well as adding the
  // new one — a station holding the stale row would go on resolving a tag that
  // is no longer on any pole — and that is a rack operation of its own, not a
  // side effect of this one.
  if (!pole.tagPending) {
    return { ok: false, error: `${pole.label} already answers to a tag.`, conflict: pole }
  }
  const clash = listFlags().find((f) => f.uid === target)
  if (clash) {
    return { ok: false, error: `That tag is already enrolled as ${clash.label}.`, conflict: clash }
  }

  const next: Flag = clean({ ...pole, uid: target, updatedAt: at, tableAt: at })
  // The pole has its tag now, so the field that said it had none must not ride
  // across. Deleted rather than set to undefined: this object is written whole
  // by `setDoc`, and a key that is merely undefined is a key Firestore rejects.
  delete next.tagPending

  if (isConfigured()) {
    // The tag must answer to NOBODY, so the claim is `requireFree` and the group
    // is `null`. Passing this pole's own group would hand the transaction the
    // rebind exemption: a tag already out with this very party — two poles on the
    // counter, one uid mistyped for the other — would satisfy `server.groupId ===
    // groupId`, and the other pole's document would be overwritten under this
    // pole's binding while keeping ITS label, then struck by the delete below.
    const claimed = await claimFlagDoc(next, null, true)
    if (claimed.ok) {
      const written = swapLocal(pole.uid, claimed.flag)
      deleteFlagDoc(pole.uid)
      return { ok: true, flag: written }
    }
    if (claimed.reason === 'conflict') {
      upsertLocal(claimed.flag)
      return {
        ok: false,
        error: `That tag is already enrolled as ${claimed.flag.label}.`,
        conflict: claimed.flag,
      }
    }
    // 'unavailable' — attach on this machine; the write-through catches up.
  }
  const written = swapLocal(pole.uid, next)
  pushFlagDoc(next)
  deleteFlagDoc(pole.uid)
  return { ok: true, flag: written }
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
    // Carried, not dropped. This object is built from scratch rather than
    // patched, and a pole enrolled ahead of its tag is still waiting for one
    // after it has been bound — losing the flag here would make a pole that
    // cannot be tapped look like one that can.
    tagPending: existing?.tagPending,
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
    // Belongs to the pole, not to the binding being taken back.
    tagPending: flag.tagPending,
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
 * A pole enrolled ahead of its tag is listed on the same terms — one more known
 * pole with nothing to play. It costs a row that can never be tapped, and buys a
 * table builder with no special cases in it. Attaching the tag then REPLACES
 * that row with one under the real uid, which is the single rack change a row
 * broadcast cannot express: `attachTag`'s caller has to send the whole table.
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
