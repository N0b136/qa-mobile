// Pure read-side aggregation over users/parties/progress — no side effects,
// no writes. Screens call these directly; nothing here touches storage.
import type { Party, User } from '../types'
import { listUsers, getUser } from './authService'
import { listParties } from './partyService'
import { completedCount, levelFor, totalXp } from './progressService'
import { ORGS } from '../content/orgs'

export interface PlayerStanding {
  rank: number
  user: User
  xp: number
  level: number
  completed: number
}

export interface PartyStanding {
  rank: number
  party: Party
  xp: number
  level: number
  completed: number
  memberCount: number
}

/** Completed episodes across all three orgs (max 30). */
function totalCompleted(userId: string): number {
  return ORGS.reduce((sum, org) => sum + completedCount(userId, org.id), 0)
}

/** Standard competition ranking ("1224"): ties on (xp, completed) share a
 * rank; the next distinct entry's rank is its 1-based index in the sorted
 * list. Assumes `sorted` is already ordered so ties are adjacent. */
function assignRanks<T extends { xp: number; completed: number }>(sorted: T[]): (T & { rank: number })[] {
  let prevXp: number | null = null
  let prevCompleted: number | null = null
  let prevRank = 0
  return sorted.map((entry, index) => {
    const tie = prevXp !== null && entry.xp === prevXp && entry.completed === prevCompleted
    const rank = tie ? prevRank : index + 1
    prevXp = entry.xp
    prevCompleted = entry.completed
    prevRank = rank
    return { ...entry, rank }
  })
}

export function playerStandings(): PlayerStanding[] {
  const entries = listUsers().map((user) => {
    const xp = totalXp(user.id)
    const completed = totalCompleted(user.id)
    return { user, xp, level: levelFor(xp), completed }
  })
  entries.sort((a, b) => b.xp - a.xp || b.completed - a.completed || a.user.name.localeCompare(b.user.name))
  return assignRanks(entries)
}

export function partyStandings(): PartyStanding[] {
  const entries = listParties().map((party) => {
    const members = party.memberIds.map((id) => getUser(id)).filter((u): u is User => u !== null)
    const xp = members.reduce((sum, m) => sum + totalXp(m.id), 0)
    const completed = members.reduce((sum, m) => sum + totalCompleted(m.id), 0)
    return { party, xp, level: levelFor(xp), completed, memberCount: party.memberIds.length }
  })
  entries.sort((a, b) => b.xp - a.xp || b.completed - a.completed || a.party.name.localeCompare(b.party.name))
  return assignRanks(entries)
}
