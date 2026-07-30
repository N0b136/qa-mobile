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

/**
 * Walk-ups are kept off both boards.
 *
 * A walk-up is one record standing in for a whole family who arrived with no
 * phone. Nobody can sign into it, so nobody can ever see the standing it earned
 * — and a party of five walking on one record would sit above five friends who
 * each keep their own. It is an accounting row, not an adventurer.
 *
 * BOTH filters run at the SOURCE, before the sort and before `assignRanks`.
 * Ranks are `index + 1` into the array they are handed, so filtering afterwards
 * leaves holes (strip the #3 of four and the board reads 1, 2, 4), and the
 * screens read `.length` off these results as the "#N of M" denominator — an M
 * counting guests who are not on the board is a wrong number in the guest's face.
 *
 * The deliberate asymmetry: the seeded `demo-` cast is NOT filtered. The pitch
 * wants a populated board and the cast is exactly what populates it. Do not
 * "fix" that to match this.
 */
export function playerStandings(): PlayerStanding[] {
  const entries = listUsers()
    .filter((u) => !u.walkUp)
    .map((user) => {
      const xp = totalXp(user.id)
      const completed = totalCompleted(user.id)
      return { user, xp, level: levelFor(xp), completed }
    })
  entries.sort((a, b) => b.xp - a.xp || b.completed - a.completed || a.user.name.localeCompare(b.user.name))
  return assignRanks(entries)
}

export function partyStandings(): PartyStanding[] {
  const entries = listParties()
    .map((party) => {
      const members = party.memberIds
        .map((id) => getUser(id))
        .filter((u): u is User => u !== null && !u.walkUp)
      const xp = members.reduce((sum, m) => sum + totalXp(m.id), 0)
      const completed = members.reduce((sum, m) => sum + totalCompleted(m.id), 0)
      // Counted from the members who survived the filter, not from memberIds:
      // a walk-up party is entirely walk-ups, so it falls to zero and is dropped
      // below rather than sitting on the board as an empty row scoring nothing.
      // A mixed party — one phone between friends who were bound at the booth —
      // keeps its place, ranked on the guests who can actually see it.
      return { party, xp, level: levelFor(xp), completed, memberCount: members.length }
    })
    .filter((e) => e.memberCount > 0)
  entries.sort((a, b) => b.xp - a.xp || b.completed - a.completed || a.party.name.localeCompare(b.party.name))
  return assignRanks(entries)
}
