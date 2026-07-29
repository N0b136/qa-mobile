// Where everybody is, and what walk they are on.
//
// A guest is walked through checking in at the main gate when they arrive; from
// then on they are in the park and the Back Office can see them. Their location
// is the Village of Queston — where they take up a quest, and where they stay
// until they call on the chief, who holds them for five minutes and then puts
// them on the paths. Every station after that holds them for fifteen. We never
// track precise locations, so "en route" — somewhere between stations — is the
// honest answer and the only other state there is.
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
//
// Every check-in is also written to the permanent log (questLogService), which
// is what presence cannot be: a position is overwritten, a record is kept.
//
// TAKING UP A QUEST is the one act that COSTS something, and it happens at the
// gate — which is where the ticket booth stands in the real park, and where a
// Guide binds a party to a questline. A Quest Experience is what a passage
// buys, so `takeUpQuest` must present a valid one and spends a use of it (see
// passService). Everything downstream is free: standing in the village, calling
// on the chief, and the seven stations of the episode are all the walk you
// already paid for.

import type { Presence, PresenceKind, User } from '../types'
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
import { recordCover, redeem as redeemPass, useForEpisode } from './passService'
import type { PassUse } from './passService'
import { recordLeg } from './questLogService'
import * as cloudSync from './cloudSync'

const PRESENCE_KEY = 'ql:presence'

/** How long a station check-in holds a guest before they read as en route. */
export const STATION_WINDOW_MS = 15 * 60 * 1000

/** The chief's house is a shorter stop — hear the brief and go. */
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
  /** The passage this walk was taken on — what a Warden asks to see. */
  passCode?: string
  passName?: string
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
  const pass = useForEpisode(userId, orgId, episode.id)
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
    passCode: pass?.code,
    passName: pass?.passName,
  }
}

export interface ActiveQuest extends Walk {
  /** The station the guest is standing at right now, if any. */
  atStationId?: string
}

/**
 * Whether the questline's CURRENT episode has been taken.
 *
 * The ledger is the truth: a quest starts by spending a Quest Experience at the
 * gate, so a redemption for this episode means it is paid for and underway.
 * Sealed stations count too, for progress that arrived by some other path — a
 * Guide's staff code, or a party-mate carrying the walk.
 *
 * Reading the ledger rather than a position is exactly what let the choke point
 * move to the gate without disturbing anything that asks this question.
 *
 * Note this reads the CURRENT episode. Sealing one moves the questline on to
 * the next, which nobody has taken yet — so finishing a quest ends it, and the
 * next one must be taken up at the gate.
 */
export function questTaken(userId: string, orgId: string): boolean {
  const episode = currentEpisode(userId, orgId)
  if (!episode) return false
  return !!useForEpisode(userId, orgId, episode.id) || stationsDone(userId, episode.id).length > 0
}

/**
 * The quest a guest is actually walking, or null if they are not on one.
 *
 * A quest becomes active when it is taken up at the gate. It stays active until
 * the episode is sealed, so leaving the board (or an expired window) does not
 * abandon a walk that is genuinely half done.
 *
 * The numbers are recomputed rather than read off the record, so they are right
 * even if progress moved by some other path.
 */
export function activeQuest(userId: string, now: number = Date.now()): ActiveQuest | null {
  const user = getUser(userId)
  if (!user) return null

  // Where they were last seen decides WHICH questline, but only the ledger
  // decides whether one is open: a presence row outlives the quest that made it
  // by up to its window, and a sealed episode is a finished quest. A village
  // record counts here — taking a quest up at the gate leaves the party
  // standing in Queston, and that record names the questline they paid for.
  const p = presenceFor(userId)
  if (p && isTracked(p, now) && p.orgId && questTaken(userId, p.orgId)) {
    return {
      ...walkFor(userId, p.orgId),
      atStationId:
        p.kind === 'station' && statusOf(p, now) === 'at-station' ? p.stationId : undefined,
    }
  }

  // Off the board, but part-way through an episode: still their active quest.
  const orgIds = [user.orgId, ...ORGS.map((o) => o.id)].filter((id): id is string => !!id)
  for (const orgId of orgIds) {
    if (questTaken(userId, orgId)) return walkFor(userId, orgId)
  }
  return null
}

/**
 * The questline to stamp a check-in with when nothing else names one.
 *
 * Not the order the guest was sworn into: all three questlines stay open to
 * everybody, so a guest walking for the Order of the Elm must not read on the
 * Back Office's board as standing at episode one of their own order — the walk
 * package exists precisely so the console and the app never diverge.
 */
function openOrgFor(userId: string, now: number): string | undefined {
  return activeQuest(userId, now)?.orgId ?? getUser(userId)?.orgId
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
  /** The passage spent, when this was a quest taken up at the gate. */
  pass?: PassUse
}

/**
 * A check-in either happened or it was turned away.
 *
 * `needPass` is the one refusal a screen can act on: it means a passage must be
 * presented before the quest can be taken up.
 */
export type CheckInResult =
  | ({ ok: true } & CheckInOutcome)
  | { ok: false; error: string; needPass?: boolean }

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

/**
 * The chief's house opens the walk at 0; a station's ordinal is how many are
 * sealed once it has been credited. A gate arrival is not a leg of any one
 * quest, so it is numbered not at all.
 */
function legNumberFor(kind: PresenceKind, walk: Walk): number | undefined {
  if (kind === 'village') return undefined
  return kind === 'start' ? 0 : walk.stationsDone
}

/**
 * Writes the check-in to the permanent log (questLogService).
 *
 * Presence is overwritten on the next check-in, so nothing above this line
 * survives the walk. One leg per check-in EVENT, raised by the device that
 * tapped and carrying the party it walked in with — a party is one row in the
 * records, not one per member, and `syncParty` deliberately does not log again.
 *
 * `leg` overrides what the entry IS when that differs from where the guest is
 * standing. Taking a quest up leaves the party in the village, but the entry is
 * the head of the walk rather than another arrival — and only an entry that is
 * not an arrival carries the run id every later leg is grouped by.
 */
function logLeg(
  user: User,
  place: { id: string; name: string; kind: PresenceKind },
  at: number,
  walk: Walk,
  party: PartyRef | undefined,
  sealed: boolean,
  leg?: { kind: PresenceKind; legNumber?: number }
): void {
  recordLeg({
    at,
    userId: user.id,
    byName: user.name,
    group: party
      ? { kind: 'party', id: party.id, name: party.name, memberNames: party.memberNames }
      : { kind: 'solo', id: user.id, name: user.name, memberNames: [user.name] },
    kind: leg?.kind ?? place.kind,
    placeId: place.id,
    placeName: place.name,
    orgId: walk.orgId,
    orgName: walk.orgName,
    episodeId: walk.episodeId,
    episodeNumber: walk.episodeNumber,
    episodeTitle: walk.episodeTitle,
    legNumber: leg ? leg.legNumber : legNumberFor(place.kind, walk),
    stationsTotal: walk.stationsTotal,
    sealed,
    passCode: walk.passCode,
    passName: walk.passName,
  })
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
 * station toward each member's current episode.
 *
 * Free, all of it. The Passage is spent at the gate (`takeUpQuest`), so the
 * chief's house and the seven stations are the walk it already bought. The one
 * refusal left at the chief's door is having no quest to hear about.
 */
export function checkIn(
  userId: string,
  stationId: string,
  opts: CheckInOptions = {}
): CheckInResult {
  const at = opts.at ?? Date.now()
  const user = getUser(userId)
  const isStart = stationId === QUEST_START.id
  const station = isStart ? null : getStation(stationId)
  if (!user) return { ok: false, error: 'We could not find you on the roll.' }
  if (!station && !isStart) return { ok: false, error: 'That place is not on the chart.' }

  const place = {
    id: stationId,
    name: isStart ? QUEST_START.name : station!.name,
    kind: (isStart ? 'start' : 'station') as PresenceKind,
  }
  const { ref: partyRef, memberIds } = partyRefFor(userId)
  const by = { id: user.id, name: user.name }

  // The chief's house costs nothing, but it is a stop on a WALK: there is no
  // brief for him to give until a quest has been taken up at the gate.
  if (isStart) {
    const questOrgId = opts.orgId ?? user.orgId
    if (!questOrgId || !questTaken(userId, questOrgId)) {
      return { ok: false, error: 'Take up a quest at the gate first — then the chief will be expecting you.' }
    }
  }

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

  const walk = walks.get(user.id) ?? {}
  logLeg(user, place, at, walk, partyRef, sealed.has(user.id))

  return {
    ok: true,
    placeName: place.name,
    kind: place.kind,
    carried: records.filter((r) => r.userId !== user.id).map((r) => r.guestName),
    partyName: partyRef?.name,
    credit,
    walk,
  }
}

/**
 * Arrival at the main gate: the guest is in the park, standing in the Village of
 * Queston, and stays there until they take a quest at the chief's house. This is
 * what puts a party on the Back Office's Guests Afield list in the first place.
 */
export function checkInAtGate(userId: string, at: number = Date.now()): CheckInResult {
  const user = getUser(userId)
  if (!user) return { ok: false, error: 'We could not find you on the roll.' }

  const place = { id: VILLAGE_PLACE.id, name: VILLAGE_PLACE.name, kind: 'village' as PresenceKind }
  const { ref: partyRef, memberIds } = partyRefFor(userId)
  const by = { id: user.id, name: user.name }

  const records = memberIds
    .map((id) => {
      const member = getUser(id)
      return member ? buildRecord(id, place, at, by, walkFor(id, openOrgFor(id, at)), partyRef) : null
    })
    .filter((r): r is Presence => r !== null)
  upsert(records)

  const own = records.find((r) => r.userId === user.id)
  if (own) cloudSync.pushPresence(own)

  const walk = walkFor(user.id, openOrgFor(user.id, at))
  logLeg(user, place, at, walk, partyRef, false)

  return {
    ok: true,
    placeName: place.name,
    kind: place.kind,
    carried: records.filter((r) => r.userId !== user.id).map((r) => r.guestName),
    partyName: partyRef?.name,
    credit: null,
    walk,
  }
}

export interface TakeUpQuestOptions {
  at?: number
  /** The passage presented. Required unless this episode is already paid for. */
  passBookingId?: string
}

/**
 * Takes up a quest at the gate — the one act in the park that costs anything.
 *
 * This is the app's half of the ticket booth, and it is deliberately the same
 * function a Guide will call when they bind a party to a questline: name the
 * order, spend a Quest Experience off a passage, and the episode is theirs. The
 * party is left standing in the Village of Queston, because paying for a quest
 * is not yet walking one — the chief's house is the first leg of the walk, and
 * it is free.
 *
 * One passage walks in as many guests as it was booked for. Whoever presents it
 * is always covered; the rest of the party take the remaining seats in roster
 * order, each on THEIR OWN questline. Anybody past the count is not turned away
 * — they present a passage of their own from their own phone.
 */
export function takeUpQuest(
  userId: string,
  orgId: string,
  opts: TakeUpQuestOptions = {}
): CheckInResult {
  const at = opts.at ?? Date.now()
  const user = getUser(userId)
  if (!user) return { ok: false, error: 'We could not find you on the roll.' }

  const episode = currentEpisode(userId, orgId)
  if (!episode) return { ok: false, error: 'There is no quest open for you to take.' }

  const { ref: partyRef, memberIds } = partyRefFor(userId)
  const by = { id: user.id, name: user.name }

  const spent = redeemPass(userId, {
    bookingId: opts.passBookingId,
    orgId,
    episodeId: episode.id,
    guests: memberIds.length,
    at,
  })
  if (!spent.ok) return { ok: false, error: spent.error, needPass: spent.needPass }
  const pass = spent.use

  // Nothing was charged because the quest is already in hand — so nothing should
  // move either. A party four stations into the walk this passage paid for is
  // standing at a station, and rewriting their position would put them back in
  // the village on the board a Warden dispatches from. A party who have not left
  // the village yet fall through and are simply recorded again.
  const here = presenceFor(userId)
  if (!spent.charged && here && here.kind !== 'village' && isTracked(here, at)) {
    return {
      ok: true,
      placeName: placeNameFor(here),
      kind: here.kind,
      carried: [],
      partyName: partyRef?.name,
      credit: null,
      walk: walkFor(userId, orgId),
      pass,
    }
  }

  // Seats left on the presented passage after the guest who presented it.
  let seatsLeft = Math.max(0, pass.covers - 1)
  const covered = [user.id]
  const walks = new Map<string, Walk>()
  for (const id of memberIds) {
    const member = getUser(id)
    if (!member) continue
    const self = id === user.id
    const memberOrgId = self ? orgId : member.orgId
    if (!self && memberOrgId && seatsLeft > 0) {
      const theirs = currentEpisode(id, memberOrgId)
      if (theirs) {
        recordCover(
          id,
          {
            code: pass.code,
            passName: pass.passName,
            orgId: memberOrgId,
            episodeId: theirs.id,
            at,
            guests: pass.guests,
            covers: pass.covers,
          },
          user.id
        )
        seatsLeft--
        covered.push(id)
      }
    }
    walks.set(id, walkFor(id, memberOrgId))
  }

  const place = { id: VILLAGE_PLACE.id, name: VILLAGE_PLACE.name, kind: 'village' as PresenceKind }
  const records = memberIds
    .map((id) => buildRecord(id, place, at, by, walks.get(id) ?? {}, partyRef))
    .filter((r): r is Presence => r !== null)
    // Who the presented passage paid for rides in the record, so a party-mate's
    // phone can tell whether it was carried in or still owes one of its own.
    .map((r) => ({ ...r, passCovers: covered }))
  upsert(records)

  const own = records.find((r) => r.userId === user.id)
  if (own) cloudSync.pushPresence(own)

  const walk = walks.get(user.id) ?? {}
  logLeg(user, place, at, walk, partyRef, false, { kind: 'start' })

  return {
    ok: true,
    placeName: place.name,
    kind: place.kind,
    carried: records.filter((r) => r.userId !== user.id).map((r) => r.guestName),
    partyName: partyRef?.name,
    credit: null,
    walk,
    pass,
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

  let earned: StationCredit | null = null
  if (latest.kind === 'station') {
    const orgId = creditOrgFor(latest.stationId, self.orgId)
    if (orgId) earned = creditStation(selfId, latest.stationId, orgId)
  }

  // The mate who took the quest up presented one passage. If it reached far
  // enough to cover this guest, their phone records that their episode is paid
  // for, so the gate never asks them twice for the same walk. If it did not,
  // nothing is recorded and they will be asked for their own. `passCovers` is
  // written by takeUpQuest alone, which is why no check on the place is needed.
  if (latest.passCode && latest.passCovers?.includes(selfId) && self.orgId) {
    const episode = currentEpisode(selfId, self.orgId)
    if (episode) {
      recordCover(
        selfId,
        {
          code: latest.passCode,
          passName: latest.passName ?? 'Passage',
          orgId: self.orgId,
          episodeId: episode.id,
          at: latest.at,
          guests: latest.partyMemberNames?.length ?? party.memberIds.length,
          covers: latest.partyMemberNames?.length ?? party.memberIds.length,
        },
        latest.byUserId ?? latest.userId
      )
    }
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
  // The covered list rides on. A third member's phone may read THIS adopted row
  // rather than the one the passage was presented on — two rows share a
  // timestamp, and the guard above keeps whichever it saw first — so dropping it
  // here would leave them owing a passage for a walk already paid for.
  const adopted = latest.passCovers ? { ...record, passCovers: latest.passCovers } : record
  upsert([adopted])
  cloudSync.pushPresence(adopted)
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
      passCode: latest.passCode,
      passName: latest.passName,
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
