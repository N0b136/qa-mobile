// Where everybody is, coarsely.
//
// A guest taps a station on the map and is AT that station for fifteen minutes;
// after that they read as EN ROUTE — somewhere on the paths between stations.
// We never track precise locations, so "en route" is the honest answer and the
// only other state there is.
//
// Parties move as one. When any member checks in, every member is checked in
// with them: on this device that happens immediately (below), and on their own
// phones it happens off the presence snapshot — see `syncParty`, which the
// cloud bridge calls after every merge. Progress is credited the same way, so a
// party that walks the trail together seals its episodes together.

import type { Presence } from '../types'
import { load, save } from './store'
import { getUser } from './authService'
import { getUserParty } from './partyService'
import { getStation } from '../content/stations'
import type { Station } from '../content/types'
import { creditOrgFor, creditStation } from './progressService'
import type { StationCredit } from './progressService'
import * as cloudSync from './cloudSync'

const PRESENCE_KEY = 'ql:presence'

/** How long a check-in holds a guest at a station before they read as en route. */
export const STATION_WINDOW_MS = 15 * 60 * 1000

/**
 * After this long with no check-in a guest drops off the board entirely — they
 * have gone home, not walked the paths for six hours.
 */
export const PRESENCE_MAX_MS = 4 * 60 * 60 * 1000

export type PresenceStatus = 'at-station' | 'en-route'

/**
 * A party (or a lone guest, which is treated as a party of one) as the console
 * shows it: one marker, one place, one clock.
 */
export interface Occupant {
  key: string
  kind: 'party' | 'solo'
  /** Party name, or the guest's name when they walk alone. */
  name: string
  memberNames: string[]
  stationId: string
  station: Station | undefined
  /** The check-in this position came from. */
  since: number
  status: PresenceStatus
  orgId?: string
  /** Who tapped in, when it was not everybody. */
  byName?: string
}

export function listPresence(): Presence[] {
  return load<Presence[]>(PRESENCE_KEY, [])
}

function setPresence(list: Presence[]): void {
  save(PRESENCE_KEY, list)
}

export function presenceFor(userId: string): Presence | null {
  return listPresence().find((p) => p.userId === userId) ?? null
}

/** One record per guest — a new check-in replaces the old one. */
function upsert(records: Presence[]): void {
  const byUser = new Map(listPresence().map((p) => [p.userId, p] as const))
  records.forEach((r) => {
    const existing = byUser.get(r.userId)
    if (!existing || r.at >= existing.at) byUser.set(r.userId, r)
  })
  setPresence(Array.from(byUser.values()))
}

export function statusOf(p: Presence, now: number = Date.now()): PresenceStatus {
  return now - p.at < STATION_WINDOW_MS ? 'at-station' : 'en-route'
}

/** Milliseconds left at the station, 0 once the window has run out. */
export function windowLeft(p: Presence, now: number = Date.now()): number {
  return Math.max(0, p.at + STATION_WINDOW_MS - now)
}

// ── Checking in ───────────────────────────────────────────────────────────────

export interface CheckInOutcome {
  station: Station
  /** Names carried in with you, excluding yourself. */
  carried: string[]
  partyName?: string
  /** Progress earned by the guest who tapped, if the station was on their episode. */
  credit: StationCredit | null
}

function buildRecord(
  userId: string,
  stationId: string,
  at: number,
  by: { id: string; name: string },
  party?: { id: string; name: string; memberNames: string[] }
): Presence | null {
  const user = getUser(userId)
  if (!user) return null
  return {
    userId,
    guestName: user.name,
    stationId,
    at,
    partyId: party?.id,
    partyName: party?.name,
    partyMemberNames: party?.memberNames,
    orgId: user.orgId,
    byUserId: by.id,
    byName: by.name,
  }
}

function rosterOf(memberIds: string[]): string[] {
  return memberIds
    .map((id) => getUser(id)?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b))
}

export interface CheckInOptions {
  at?: number
  /**
   * The questline this check-in counts toward, when the guest is walking one
   * that is not their own order — the check-in screen knows it from the route.
   * A base station always overrules it and keeps its own order.
   */
  orgId?: string
}

/**
 * Records `userId` (and their whole party) at `stationId` and credits the
 * station toward each member's current episode. Returns null only when the
 * guest or the station is unknown.
 */
export function checkIn(
  userId: string,
  stationId: string,
  opts: CheckInOptions = {}
): CheckInOutcome | null {
  const at = opts.at ?? Date.now()
  const user = getUser(userId)
  const station = getStation(stationId)
  if (!user || !station) return null

  const party = getUserParty(userId)
  const by = { id: user.id, name: user.name }
  const memberIds = party ? party.memberIds : [user.id]

  const partyRef = party
    ? { id: party.id, name: party.name, memberNames: rosterOf(party.memberIds) }
    : undefined
  const records = memberIds
    .map((id) => buildRecord(id, stationId, at, by, partyRef))
    .filter((r): r is Presence => r !== null)
  upsert(records)

  // Only ever our own doc: the rules let a guest write their own presence and
  // nobody else's, and every other member's phone writes its own off the
  // snapshot. On a single device the local records above already read right.
  const own = records.find((r) => r.userId === user.id)
  if (own) cloudSync.pushPresence(own)

  let credit: StationCredit | null = null
  for (const id of memberIds) {
    const member = getUser(id)
    if (!member) continue
    const self = id === user.id
    // Everyone else is walking their own questline; only the guest who tapped
    // can be somewhere other than their own order.
    const orgId = creditOrgFor(stationId, self ? (opts.orgId ?? member.orgId) : member.orgId)
    if (!orgId) continue
    const earned = creditStation(id, stationId, orgId, { notify: self })
    if (self) credit = earned
  }

  return {
    station,
    carried: records.filter((r) => r.userId !== user.id).map((r) => r.guestName),
    partyName: party?.name,
    credit,
  }
}

/**
 * Applies a party-mate's check-in on THIS guest's device.
 *
 * Called after every presence snapshot merge. A member's phone sees a fresher
 * check-in raised by somebody else in the party and adopts it — same station,
 * same timestamp — which both writes its own presence doc and credits its own
 * progress. Re-using the original timestamp is what stops the two phones from
 * volleying: once adopted, neither record is newer than the other.
 */
export function syncParty(selfId: string): void {
  const self = getUser(selfId)
  if (!self) return
  const party = getUserParty(selfId)
  if (!party) return

  const now = Date.now()
  const mine = presenceFor(selfId)
  const mates = listPresence().filter(
    (p) => p.userId !== selfId && party.memberIds.includes(p.userId)
  )
  if (mates.length === 0) return

  const latest = mates.reduce((a, b) => (b.at > a.at ? b : a))
  if (now - latest.at > STATION_WINDOW_MS) return
  if (mine && mine.at >= latest.at) return

  const record = buildRecord(
    selfId,
    latest.stationId,
    latest.at,
    { id: latest.byUserId ?? latest.userId, name: latest.byName ?? latest.guestName },
    { id: party.id, name: party.name, memberNames: rosterOf(party.memberIds) }
  )
  if (!record) return
  upsert([record])
  cloudSync.pushPresence(record)

  const orgId = creditOrgFor(latest.stationId, self.orgId)
  if (orgId) creditStation(selfId, latest.stationId, orgId)
}

// ── Reading the board ─────────────────────────────────────────────────────────

/**
 * Collapses raw presence into what the console draws: one entry per party (or
 * lone guest), placed at that party's most recent check-in.
 */
export function occupants(now: number = Date.now()): Occupant[] {
  const groups = new Map<string, Presence[]>()

  listPresence()
    .filter((p) => now - p.at <= PRESENCE_MAX_MS)
    .forEach((p) => {
      const key = p.partyId ? `party:${p.partyId}` : `solo:${p.userId}`
      const bucket = groups.get(key)
      if (bucket) bucket.push(p)
      else groups.set(key, [p])
    })

  const list: Occupant[] = []
  groups.forEach((members, key) => {
    const latest = members.reduce((a, b) => (b.at > a.at ? b : a))
    const kind: Occupant['kind'] = key.startsWith('party:') ? 'party' : 'solo'
    // Prefer the roster carried in the record: on a two-phone party only the
    // member who tapped has reported in yet, and the party is still all of them.
    const seen = members.map((m) => m.guestName)
    const roster = latest.partyMemberNames?.length ? latest.partyMemberNames : seen
    list.push({
      key,
      kind,
      name: kind === 'party' ? (latest.partyName ?? 'A party') : latest.guestName,
      memberNames: Array.from(new Set([...roster, ...seen])).sort((a, b) => a.localeCompare(b)),
      stationId: latest.stationId,
      station: getStation(latest.stationId),
      since: latest.at,
      status: statusOf(latest, now),
      orgId: latest.orgId,
      byName: latest.byName,
    })
  })

  return list.sort((a, b) => b.since - a.since)
}

export function occupantsByStation(now: number = Date.now()): Record<string, Occupant[]> {
  const map: Record<string, Occupant[]> = {}
  occupants(now)
    .filter((o) => o.status === 'at-station')
    .forEach((o) => {
      map[o.stationId] = [...(map[o.stationId] ?? []), o]
    })
  return map
}

export function enRoute(now: number = Date.now()): Occupant[] {
  return occupants(now).filter((o) => o.status === 'en-route')
}

// ── Demo helpers ──────────────────────────────────────────────────────────────

/** Straight write, no party fan-out and no progress — used to stage a world. */
export function seedPresence(records: Presence[]): void {
  upsert(records)
}

export function clearPresenceFor(userIds: string[]): void {
  const drop = new Set(userIds)
  setPresence(listPresence().filter((p) => !drop.has(p.userId)))
}
