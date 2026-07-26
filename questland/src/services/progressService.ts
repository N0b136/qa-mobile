import type { Episode, Rank } from '../content/types'
import { episodesFor, getEpisode } from '../content/quests'
import { getOrg } from '../content/orgs'
import type { ProgressMap } from '../types'
import { load, save } from './store'
import * as notificationService from './notificationService'

export const XP_PER_LEVEL = 100

type CompleteResult =
  | { ok: true; episode: Episode; orgId: string; rankUp: Rank | null }
  | { ok: false; error: string }

function key(userId: string): string {
  return `ql:progress:${userId}`
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

export function completeEpisode(userId: string, episodeId: string): CompleteResult {
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
  const afterCount = nextDone.length

  const org = getOrg(orgId)
  let rankUp: Rank | null = null

  if (org) {
    const beforeRank = rankFor(orgId, beforeCount)
    const afterRank = rankFor(orgId, afterCount)
    if (afterRank.name !== beforeRank.name) rankUp = afterRank

    notificationService.add(userId, {
      type: 'lore',
      title: `${episode.title} — complete`,
      body: episode.loreOnComplete,
      icon: 'scroll-text',
    })

    if (rankUp) {
      notificationService.add(userId, {
        type: 'lore',
        title: `Rank up — ${rankUp.name}`,
        body: `The ${org.name} recognizes your deeds. You now bear the rank of ${rankUp.name}.`,
        icon: 'award',
      })
    }
  }

  return { ok: true, episode, orgId, rankUp }
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
