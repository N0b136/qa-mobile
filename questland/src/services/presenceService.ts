// Where everybody is, and what walk they are on.
//
// A guest is walked through checking in at the main gate when they arrive; from
// then on they are in the park and the Back Office can see them. Their location
// is the Village of Queston until they take a quest at the chief's house, which
// holds them for five minutes and then puts them on the paths. Every station
// after that holds them for fifteen. We never track precise locations, so "en
// route" — somewhere between stations — is the honest answer and the only other
// state there is.
//
// Every check-in captures the whole walk: order, episode, stations sealed, and
// the station they are heading for next. That package rides in the presence
// record itself so the console and a guest's own party can read all three
// things — where they are, where they are going, how far along they are —
// without reaching into anybody else's progress.
//
// Parties move as one. When any member checks in, every member is checked in
// with them: on this device that happens immediately (below), and on their own
// phones it happens off the presence snapshot — see `syncParty`, which the
// cloud bridge calls after every merge.

import type { Presence, PresenceKind } from '../types'
import { load, save } from './store'
import { getUser } from './authService'
import { getUserParty } from './partyService'
import { getStation } from '../content/stations'
import { ORGS, getOrg } from '../content/orgs'
import { QUEST_START, VILLAGE_PLACE } from '../content/stationMap'
import type { Station } from '../content/types'
import { creditOrgFor, creditStation, currentEpisode, stationsDone } from './progressService'
import type { StationCredit } from './progressService'
import { stationsFor } from '../content/stations'
import * as cloudSync from './cloudSync'

const PRESENCE_KEY = 'ql:presence'

/** How long a station check-in holds a guest before they read as en route. */
export const STATION_WINDOW_MS = 15 * 60 * 1000

/** The chief's house is a shorter stop — take the quest and go. */
export const START_WINDOW_MS = 5 * 60 * 1000

/**
 * After this long with no check-in a guest drops off the board entirely — they
 * have gone home, not walked the paths for four hours.
 */
export const PRESENCE_MAX_MS = 4 * 60 * 60 * 1000

export type PresenceStatus = 'village' | 'at-station' | 'en-route'

/** The walk a check-in belongs to, as the console and the party read it. */
export interface Walk {
  orgId?: string
  orgName?: string
  episodeId?: string
  episodeNumber?: number
  episodeTitle?: string
  stationsDone?: number
  stationsTotal?: number
  nextStationId?: string
  nextStationName?: string
}

/**
 * A party (or a lone guest, which is treated as a party of one) as the console
 * shows it: one marker, one place, one clock, one walk.
 */
export interface Occupant extends Walk {
  key: string
  kind: 'party' | 'solo'
  /** Party name, or the guest's name when they walk alone. */
  name: string
  memberNames: string[]
  placeId: string
  placeName: string
  placeKind: PresenceKind
  station: Station | undefined
  /** The check-in this position came from. */
  since: number
  status: PresenceStatus
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

export function placeNameFor(p: Presence): string {
  if (p.placeName) return p.placeName
  if (p.kind === 'village') return VILLAGE_PLACE.name
  if (p.stationId === QUEST_START.id) return QUEST_START.name
  return getStation(p.stationId)?.name ?? 'the trail'
}

/** How long this kind of check-in holds a guest in place. */
export function windowFor(p: Presence): number {
  return p.kind === 'start' ? START_WINDOW_MS : STATION_WINDOW_MS
}

export function statusOf(p: Presence, now: number = Date.now()): PresenceStatus {
  if (p.kind === 'village') return 'village'
  return now - p.at < windowFor(p) ? 'at-station' : 'en-route'
}

/** Milliseconds left at the place, 0 once the window has run out. */
export function windowLeft(p: Presence, now: number = Date.now()): number {
  if (p.kind === 'village') return 0
  return Math.max(0, p.at + windowFor(p) - now)
}

/**
 * Whether a guest is still on the map at all.
 *
 * A check-in that sealed the episode is the end of the walk, so once its
 * window is up that guest is checked out — no en-route tail. Everyone else
 * stays on the paths until they have been silent long enough to have gone home.
 */
export function isTracked(p: Presence, now: number = Date.now()): boolean {
  const age = now - p.at
  if (age > PRESENCE_MAX_MS) return false
  if (p.final && age >= windowFor(p)) return false
  return true
}

// ── The walk ──────────────────────────────────────────────────────────────────

/**
 * The guest's current position in a questline: which episode, how much of it is
 * sealed, and which station they are heading for. Read AFTER crediting, so a
 * check-in's own station counts and "next" is genuinely next.
 */
export function walkFor(userId: string, orgId?: string): Walk {
  if (!orgId) return {}
  const org = getOrg(orgId)
  const episode = currentEpisode(userId, orgId)
  if (!episode) {
    return { orgId, orgName: org?.name, episodeTitle: 'Questline complete' }
  }
  const rotation = stationsFor(episode.id)
  const done = stationsDone(userId, episode.id)
  const next = rotation.find((s) => !done.includes(s.id))
  return {
    orgId,
    orgName: org?.name,
    episodeId: episode.id,
    episodeNumber: episode.number,
    episodeTitle: episode.title,
    stationsDone: done.length,
    stationsTotal: rotation.length,
    nextStationId: next?.id,
    nextStationName: next?.name,
  }
}

export interface ActiveQuest extends Walk {
  /** The station the guest is standing at right now, if any. */
  atStationId?: string
}

/**
 * The quest a guest is actually walking, or null if they are not on one.
 *
 * A quest becomes active when they take it at the chief's house or check in at
 * a station — arriving at the gate is not enough, since standing in the village
 * is not yet walking anything. It stays active while any station of the episode
 * is sealed, so leaving the board (or an expired window) does not abandon a walk
 * that is genuinely half done.
 *
 * The numbers are recomputed rather than read off the record, so they are right
 * even if progress moved by some other path.
 */
export function activeQuest(userId: string, now: number = Date.now()): ActiveQuest | null {
  const user = getUser(userId)
  if (!user) return null

  const p = presenceFor(userId)
  if (p && isTracked(p, now) && p.kind !== 'village' && p.orgId) {
    return {
      ...walkFor(userId, p.orgId),
      atStationId:
        p.kind === 'station' && statusOf(p, now) === 'at-station' ? p.stationId : undefined,
    }
  }

  // Off the board, but part-way through an episode: still their active quest.
  const orgIds = [user.orgId, ...ORGS.map((o) => o.id)].filter((id): id is string => !!id)
  for (const orgId of orgIds) {
    const episode = currentEpisode(userId, orgId)
    if (episode && stationsDone(userId, episode.id).length > 0) return walkFor(userId, orgId)
  }
  return null
}

// ── Checking in ───────────────────────────────────────────────────────────────

export interface CheckInOutcome {
  placeName: string
  kind: PresenceKind
  /** Names carried in with you, excluding yourself. */
  carried: string[]
  partyName?: string
  /** Progress earned by the guest who tapped, if the station was on their episode. */
  credit: StationCredit | null
  walk: Walk
}

interface PartyRef {
  id: string
  name: string
  memberNames: string[]
}

function buildRecord(
  userId: string,
  place: { id: string; name: string; kind: PresenceKind },
  at: number,
  by: { id: string; name: string },
  walk: Walk,
  party?: PartyRef,
  final?: boolean
): Presence | null {
  const user = getUser(userId)
  if (!user) return null
  return {
    userId,
    guestName: user.name,
    kind: place.kind,
    stationId: place.id,
    placeName: place.name,
    at,
    final,
    partyId: party?.id,
    partyName: party?.name,
    partyMemberNames: party?.memberNames,
    byUserId: by.id,
    byName: by.name,
    ...walk,
  }
}

function rosterOf(memberIds: string[]): string[] {
  return memberIds
    .map((id) => getUser(id)?.name)
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b))
}

function partyRefFor(userId: string): { ref?: PartyRef; memberIds: string[] } {
  const party = getUserParty(userId)
  if (!party) return { memberIds: [userId] }
  return {
    ref: { id: party.id, name: party.name, memberNames: rosterOf(party.memberIds) },
    memberIds: party.memberIds,
  }
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
 * guest or the place is unknown.
 */
export function checkIn(
  userId: string,
  stationId: string,
  opts: CheckInOptions = {}
): CheckInOutcome | null {
  const at = opts.at ?? Date.now()
  const user = getUser(userId)
  const isStart = stationId === QUEST_START.id
  const station = isStart ? null : getStation(stationId)
  if (!user || (!station && !isStart)) return null

  const place = {
    id: stationId,
    name: isStart ? QUEST_START.name : station!.name,
    kind: (isStart ? 'start' : 'station') as PresenceKind,
  }
  const { ref: partyRef, memberIds } = partyRefFor(userId)
  const by = { id: user.id, name: user.name }

  // Credit first: whether this station sealed a member's episode is what marks
  // their row final, and the walk package below must read the progress this
  // check-in just earned.
  let credit: StationCredit | null = null
  const sealed = new Set<string>()
  const walks = new Map<string, Walk>()
  for (const id of memberIds) {
    const member = getUser(id)
    if (!member) continue
    const self = id === user.id
    // Everyone else is walking their own questline; only the guest who tapped
    // can be somewhere other than their own order.
    const orgId = creditOrgFor(stationId, self ? (opts.orgId ?? member.orgId) : member.orgId)
    if (orgId && !isStart) {
      const earned = creditStation(id, stationId, orgId, { notify: self })
      if (earned?.completion) sealed.add(id)
      if (self) credit = earned
    }
    walks.set(id, walkFor(id, orgId ?? member.orgId))
  }

  const records = memberIds
    .map((id) =>
      buildRecord(id, place, at, by, walks.get(id) ?? {}, partyRef, sealed.has(id))
    )
    .filter((r): r is Presence => r !== null)
  upsert(records)

  // Only ever our own doc: the rules let a guest write their own presence and
  // nobody else's, and every other member's phone writes its own off the
  // snapshot. On a single device the local records above already read right.
  const own = records.find((r) => r.userId === user.id)
  if (own) cloudSync.pushPresence(own)

  return {
    placeName: place.name,
    kind: place.kind,
    carried: records.filter((r) => r.userId !== user.id).map((r) => r.guestName),
    partyName: partyRef?.name,
    credit,
    walk: walks.get(user.id) ?? {},
  }
}

/**
 * Arrival at the main gate: the guest is in the park, standing in the Village of
 * Queston, and stays there until they take a quest at the chief's house. This is
 * what puts a party on the Back Office's Guests Afield list in the first place.
 */
export function checkInAtGate(userId: string, at: number = Date.now()): CheckInOutcome | null {
  const user = getUser(userId)
  if (!user) return null

  const place = { id: VILLAGE_PLACE.id, name: VILLAGE_PLACE.name, kind: 'village' as PresenceKind }
  const { ref: partyRef, memberIds } = partyRefFor(userId)
  const by = { id: user.id, name: user.name }

  const records = memberIds
    .map((id) => {
      const member = getUser(id)
      return member ? buildRecord(id, place, at, by, walkFor(id, member.orgId), partyRef) : null
    })
    .filter((r): r is Presence => r !== null)
  upsert(records)

  const own = records.find((r) => r.userId === user.id)
  if (own) cloudSync.pushPresence(own)

  return {
    placeName: place.name,
    kind: place.kind,
    carried: records.filter((r) => r.userId !== user.id).map((r) => r.guestName),
    partyName: partyRef?.name,
    credit: null,
    walk: walkFor(user.id, user.orgId),
  }
}

/** True once the guest has been walked through the gate check-in. */
export function hasArrived(userId: string, now: number = Date.now()): boolean {
  const p = presenceFor(userId)
  return !!p && isTracked(p, now)
}

/**
 * Applies a party-mate's check-in on THIS guest's device.
 *
 * Called after every presence snapshot merge. A member's phone sees a fresher
 * check-in raised by somebody else in the party and adopts it — same place,
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
  if (!isTracked(latest, now)) return
  if (mine && mine.at >= latest.at) return

  const isStart = latest.stationId === QUEST_START.id
  let earned: StationCredit | null = null
  if (latest.kind === 'station' && !isStart) {
    const orgId = creditOrgFor(latest.stationId, self.orgId)
    if (orgId) earned = creditStation(selfId, latest.stationId, orgId)
  }

  const record = buildRecord(
    selfId,
    { id: latest.stationId, name: placeNameFor(latest), kind: latest.kind },
    latest.at,
    { id: latest.byUserId ?? latest.userId, name: latest.byName ?? latest.guestName },
    walkFor(selfId, self.orgId),
    { id: party.id, name: party.name, memberNames: rosterOf(party.memberIds) },
    !!earned?.completion
  )
  if (!record) return
  upsert([record])
  cloudSync.pushPresence(record)
}

// ── Reading the board ─────────────────────────────────────────────────────────

/**
 * Collapses raw presence into what the console draws: one entry per party (or
 * lone guest), placed at that party's most recent check-in, carrying the walk
 * that check-in recorded.
 */
export function occupants(now: number = Date.now()): Occupant[] {
  const groups = new Map<string, Presence[]>()

  listPresence()
    .filter((p) => isTracked(p, now))
    .forEach((p) => {
      // Prefer the party the guest belongs to NOW: a check-in made before they
      // joined would otherwise strand them on the board as a lone traveller
      // while their party walks on without them. Falls back to the party the
      // record was written with, which is all the console has when it cannot
      // see the roster.
      const partyId = getUserParty(p.userId)?.id ?? p.partyId
      const key = partyId ? `party:${partyId}` : `solo:${p.userId}`
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
    const named = members.find((m) => m.partyMemberNames?.length)
    const roster = named?.partyMemberNames?.length ? named.partyMemberNames : seen
    const partyName = latest.partyName ?? members.find((m) => m.partyName)?.partyName
    list.push({
      key,
      kind,
      name: kind === 'party' ? (partyName ?? 'A party') : latest.guestName,
      memberNames: Array.from(new Set([...roster, ...seen])).sort((a, b) => a.localeCompare(b)),
      placeId: latest.stationId,
      placeName: placeNameFor(latest),
      placeKind: latest.kind,
      station: getStation(latest.stationId),
      since: latest.at,
      status: statusOf(latest, now),
      byName: latest.byName,
      orgId: latest.orgId,
      orgName: latest.orgName,
      episodeId: latest.episodeId,
      episodeNumber: latest.episodeNumber,
      episodeTitle: latest.episodeTitle,
      stationsDone: latest.stationsDone,
      stationsTotal: latest.stationsTotal,
      nextStationId: latest.nextStationId,
      nextStationName: latest.nextStationName,
    })
  })

  return list.sort((a, b) => b.since - a.since)
}

/** Everyone standing somewhere, keyed by place id (station, chief's house, village). */
export function occupantsByPlace(now: number = Date.now()): Record<string, Occupant[]> {
  const map: Record<string, Occupant[]> = {}
  occupants(now)
    .filter((o) => o.status !== 'en-route')
    .forEach((o) => {
      map[o.placeId] = [...(map[o.placeId] ?? []), o]
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
