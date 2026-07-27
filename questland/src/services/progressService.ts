import type { Episode, Rank, Station } from '../content/types'
import { episodesFor, getEpisode } from '../content/quests'
import { getOrg } from '../content/orgs'
import { getStation, stationsFor } from '../content/stations'
import type { ProgressMap, StationMap } from '../types'
import { load, save } from './store'
import { getUser } from './authService'
import * as notificationService from './notificationService'
import * as cloudSync from './cloudSync'

export const XP_PER_LEVEL = 100

type CompleteResult =
  | { ok: true; episode: Episode; orgId: string; rankUp: Rank | null }
  | { ok: false; error: string }

function key(userId: string): string {
  return `ql:progress:${userId}`
}

function stationKey(userId: string): string {
  return `ql:stations:${userId}`
}

export function getProgress(userId: string): ProgressMap {
  return load<ProgressMap>(key(userId), {})
}

function setProgress(userId: string, progress: ProgressMap): void {
  save(key(userId), progress)
}

export function completedCount(userId: string, orgId: string): number {
  return (getProgress(userId)[orgId] ?? []).length
}

export function currentEpisode(userId: string, orgId: string): Episode | null {
  const done = new Set(getProgress(userId)[orgId] ?? [])
  return episodesFor(orgId).find((e) => !done.has(e.id)) ?? null
}

/** Highest rank whose atEpisodes threshold has been reached. Assumes ranks are ascending. */
export function rankFor(orgId: string, completed: number): Rank {
  const org = getOrg(orgId)
  if (!org || org.ranks.length === 0) return { name: '', atEpisodes: 0 }
  let best = org.ranks[0]
  for (const rank of org.ranks) {
    if (rank.atEpisodes <= completed) best = rank
  }
  return best
}

export function totalXp(userId: string): number {
  const progress = getProgress(userId)
  let xp = 0
  for (const orgId of Object.keys(progress)) {
    for (const episodeId of progress[orgId]) {
      const episode = getEpisode(episodeId)
      if (episode) xp += episode.xp
    }
  }
  return xp
}

export function levelFor(xp: number): number {
  return 1 + Math.floor(xp / XP_PER_LEVEL)
}

export function xpIntoLevel(xp: number): number {
  return xp % XP_PER_LEVEL
}

/**
 * Seals an episode.
 *
 * `notify` is only ever false for a party member being carried along by
 * somebody else's check-in on THIS device: their own phone credits the same
 * station off the presence snapshot and tells them itself, so announcing it
 * here would either double up or, worse, try to write into their inbox — which
 * the Firestore rules refuse (a guest may only address themselves).
 */
export function completeEpisode(
  userId: string,
  episodeId: string,
  opts: { notify?: boolean } = {}
): CompleteResult {
  const notify = opts.notify !== false
  const episode = getEpisode(episodeId)
  if (!episode) return { ok: false, error: 'That chapter is not yet open to you.' }

  const orgId = episode.orgId
  const progress = getProgress(userId)
  const done = progress[orgId] ?? []

  if (done.includes(episodeId)) {
    return { ok: false, error: 'You have already completed that chapter.' }
  }

  const current = currentEpisode(userId, orgId)
  if (!current || current.id !== episodeId) {
    return { ok: false, error: 'That chapter is not yet open to you.' }
  }

  const beforeCount = done.length
  const nextDone = [...done, episodeId]
  setProgress(userId, { ...progress, [orgId]: nextDone })
  // A sealed episode counts as every one of its stations walked, whichever path
  // got you here (station taps, a Guide's code, or a scanned marker).
  setStationMap(userId, {
    ...getStationMap(userId),
    [episodeId]: stationsFor(episodeId).map((s) => s.id),
  })
  cloudSync.pushProgress(userId)
  const afterCount = nextDone.length

  const org = getOrg(orgId)
  let rankUp: Rank | null = null

  if (org) {
    const beforeRank = rankFor(orgId, beforeCount)
    const afterRank = rankFor(orgId, afterCount)
    if (afterRank.name !== beforeRank.name) rankUp = afterRank

    if (notify) {
      notificationService.add(userId, {
        type: 'lore',
        title: `${episode.title} — complete`,
        body: episode.loreOnComplete,
        icon: 'scroll-text',
      })
    }

    if (rankUp && notify) {
      notificationService.add(userId, {
        type: 'lore',
        title: `Rank up — ${rankUp.name}`,
        body: `The ${org.name} recognizes your deeds. You now bear the rank of ${rankUp.name}.`,
        icon: 'award',
      })
    }
  }

  const fresh = getUser(userId)
  if (fresh) cloudSync.pushGuestProfile(fresh)

  return { ok: true, episode, orgId, rankUp }
}

// ── Station check-ins ─────────────────────────────────────────────────────────
//
// An episode is sealed by walking its seven stations, not by one code. The map
// records which of the current episode's stations a guest has stood at; the
// seventh one seals the episode through completeEpisode above, so ranks, XP,
// lore and notifications all keep working exactly as they did.

export function getStationMap(userId: string): StationMap {
  return load<StationMap>(stationKey(userId), {})
}

function setStationMap(userId: string, map: StationMap): void {
  save(stationKey(userId), map)
}

export function stationsDone(userId: string, episodeId: string): string[] {
  return getStationMap(userId)[episodeId] ?? []
}

export interface StationCredit {
  station: Station
  orgId: string
  episode: Episode
  /** Stations of this episode now walked, and how many it takes. */
  done: number
  total: number
  /** True when the guest had already checked in here on this episode. */
  repeat: boolean
  /** Set only when this check-in was the one that sealed the episode. */
  completion: CompleteResult | null
}

/**
 * Which questline a station tap counts toward: a base station always belongs to
 * its own order, anything else counts toward the order the guest is walking.
 */
export function creditOrgFor(stationId: string, userOrgId?: string): string | null {
  return getStation(stationId)?.orgId ?? userOrgId ?? null
}

/**
 * Credits one station toward the guest's current episode in `orgId`. Returns
 * null when the station is not on that episode's rotation — the guest still
 * stood there (presence records it), it just earns nothing.
 */
export function creditStation(
  userId: string,
  stationId: string,
  orgId: string,
  opts: { notify?: boolean } = {}
): StationCredit | null {
  const station = getStation(stationId)
  if (!station) return null

  const episode = currentEpisode(userId, orgId)
  if (!episode) return null

  const rotation = stationsFor(episode.id).map((s) => s.id)
  if (!rotation.includes(stationId)) return null

  const already = stationsDone(userId, episode.id)
  const repeat = already.includes(stationId)
  const next = repeat ? already : [...already, stationId]

  if (!repeat) setStationMap(userId, { ...getStationMap(userId), [episode.id]: next })

  const sealed = next.length >= rotation.length
  // completeEpisode rewrites the station set for the episode itself, so this
  // stays correct whichever of the two paths sealed it.
  const completion = sealed && !repeat ? completeEpisode(userId, episode.id, opts) : null

  return {
    station,
    orgId,
    episode,
    done: next.length,
    total: rotation.length,
    repeat,
    completion: completion && completion.ok ? completion : null,
  }
}

function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, '')
}

export function validateStaffCode(userId: string, orgId: string, code: string): CompleteResult {
  const episode = currentEpisode(userId, orgId)
  if (!episode || normalizeCode(episode.staffCode) !== normalizeCode(code)) {
    return { ok: false, error: 'That code fizzles… check it with your Quest Guide.' }
  }
  return completeEpisode(userId, episode.id)
}

export function validateQrText(userId: string, text: string): CompleteResult {
  const parts = text.split(':')
  if (parts.length !== 3 || parts[0] !== 'QL') {
    return { ok: false, error: 'That marker is not a Questland sigil.' }
  }
  const [, orgId, episodeId] = parts
  const episode = currentEpisode(userId, orgId)
  if (!episode || episode.id !== episodeId) {
    return { ok: false, error: 'That marker is not a Questland sigil.' }
  }
  return completeEpisode(userId, episode.id)
}
