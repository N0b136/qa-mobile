// Passages, and what they buy you.
//
// A booking is a receipt; a PASSAGE is the right it carries into the park. That
// right is spent in exactly one place: taking up a quest at the gate. Calling on
// the Village Chief and walking the seven stations of the episode afterwards
// costs nothing — the ticket sells "Quest Experiences", and one Quest Experience
// is one episode.
//
// The rules come off the tickets themselves (`content/bookingTiers.ts`, in turn
// from content-intake/ticketing.json), so nothing here hard-codes a tier:
//
//   Adventurer Pass       1 Quest Experience, on the booked day
//   Hero Pass             unlimited, all day
//   Group passes          the same terms, for everyone the group covers
//   Adventurer Membership 1 Quest Experience per week, for a month
//   Hero / Family Hero    unlimited, for a month
//   Birthday packages     1 Quest Experience, on the day of the party
//
// An allowance belongs to the passage, not to each head on it: a passage booked
// for five walks five guests through the gate on ONE Quest Experience.
// Headcount buys a bigger party, never more quests — so an Adventurer Pass is
// spent the moment it is presented, whoever it came in with, while a Hero Pass
// stays good for the rest of the day.
//
// The ledger (`ql:passUses:${userId}`) is per guest. Two shapes live in it:
// a redemption, which names the booking it was charged to and counts against
// that passage's allowance, and a COVER, which records that somebody else's
// passage paid for this guest's walk — a party moves as one and only the guest
// who taps is charged. A cover counts against nothing.
//
// The ledger stopped being device-local when the gate became the place a
// Passage is spent: the ticket booth spends on behalf of a guest whose phone is
// in their pocket, and that guest's app has to know about it. So every write
// here pushes to passUses/{userId}, and the merge on the way back is a union by
// use id — a use is written once and never revised, which means neither the
// phone nor the booth can erase the other's spend.

import type { BookingTier } from '../content/types'
import type { Booking } from '../types'
import { load, save } from './store'
import { uid } from './ids'
import { getTier, listBookings } from './bookingService'
import * as cloudSync from './cloudSync'

function key(userId: string): string {
  return `ql:passUses:${userId}`
}

/** One Quest Experience drawn against a passage — or carried by somebody else's. */
export interface PassUse {
  id: string
  /** The passage charged. Unset on a cover: a party-mate's passage paid. */
  bookingId?: string
  /** Confirmation code of the passage that covered this walk. */
  code: string
  /** Tier name, kept in the record so a reader never needs the content tables. */
  passName: string
  orgId: string
  episodeId: string
  at: number
  /** How many guests the redemption walked in with. */
  guests: number
  /**
   * How many of them the passage actually covers — its booked headcount.
   * A party larger than that is not turned away; the guests beyond the count
   * simply present their own passage when they call on the chief themselves.
   */
  covers: number
  /** The guest whose passage paid, when it was not this one's. */
  coveredBy?: string
}

export type PassStatus = 'valid' | 'upcoming' | 'expired' | 'spent' | 'cancelled'

/** A passage as the guest is asked to present it. */
export interface PassState {
  booking: Booking
  tier: BookingTier
  status: PassStatus
  /** Quest Experiences left in the current period. null = unlimited. */
  remaining: number | null
  /** The allowance those remaining are drawn from. null = unlimited. */
  allowance: number | null
  /** Guests the passage covers. */
  guests: number
  /** One line saying where the passage stands, in the app's voice. */
  note: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

// ── Dates ─────────────────────────────────────────────────────────────────────
//
// Booking dates are local calendar days ('yyyy-mm-dd'), so every boundary here
// is computed in local time. A guest standing in the park at 11pm still holds
// today's passage.

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local midnight opening the given 'yyyy-mm-dd'. NaN if the string is junk. */
function dateStart(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return NaN
  return new Date(y, m - 1, d).getTime()
}

function addMonth(ms: number): number {
  const d = new Date(ms)
  d.setMonth(d.getMonth() + 1)
  return d.getTime()
}

/** [from, to) the passage is good between. */
export function validityOf(booking: Booking, tier: BookingTier): { from: number; to: number } {
  const from = dateStart(booking.date)
  if (Number.isNaN(from)) return { from: 0, to: 0 }
  return { from, to: tier.pass.validFor === 'month' ? addMonth(from) : from + DAY_MS }
}

/**
 * [from, to) the current allowance is counted over.
 *
 * Weekly and monthly allowances run from the passage's own start date rather
 * than the calendar — a membership taken out on a Thursday refreshes on
 * Thursdays.
 */
function periodBounds(booking: Booking, tier: BookingTier, at: number): { from: number; to: number } {
  const validity = validityOf(booking, tier)
  if (tier.pass.per === 'day') {
    const from = startOfDay(at)
    return { from, to: from + DAY_MS }
  }
  if (tier.pass.per === 'week') {
    const elapsed = Math.max(0, at - validity.from)
    const from = validity.from + Math.floor(elapsed / WEEK_MS) * WEEK_MS
    return { from, to: from + WEEK_MS }
  }
  return validity
}

// ── The ledger ────────────────────────────────────────────────────────────────

export function listUses(userId: string): PassUse[] {
  return load<PassUse[]>(key(userId), [])
}

function setUses(userId: string, uses: PassUse[]): void {
  save(key(userId), uses)
}

/**
 * The passage already presented for this episode, if any.
 *
 * One episode is one Quest Experience, so taking the same quest up a second
 * time — a guest tapping the gate again mid-walk, or a Guide re-reading the
 * binding at the booth — is the same quest and costs nothing more.
 */
export function useForEpisode(userId: string, orgId: string, episodeId: string): PassUse | null {
  return (
    listUses(userId).find((u) => u.orgId === orgId && u.episodeId === episodeId) ?? null
  )
}

/** Guests a passage was bought for — how many it walks in on one quest. */
export function guestsOf(booking: Booking): number {
  return Math.max(1, booking.adults + booking.children)
}

// ── Reading a passage ─────────────────────────────────────────────────────────

function noteFor(state: Omit<PassState, 'note'>, at: number): string {
  const { booking, tier, status, remaining, guests } = state
  switch (status) {
    case 'cancelled':
      return 'This passage was cancelled.'
    case 'upcoming': {
      const days = Math.max(1, Math.ceil((validityOf(booking, tier).from - startOfDay(at)) / DAY_MS))
      return `Good from ${booking.date} — ${days} day${days === 1 ? '' : 's'} yet.`
    }
    case 'expired':
      return tier.pass.validFor === 'month' ? 'This membership has run out.' : `Good for ${booking.date} only.`
    case 'spent':
      return tier.pass.per === 'week'
        ? 'This week’s quest is claimed. The next one opens in a few days.'
        : 'Every Quest Experience on this passage is claimed.'
    default: {
      // The headcount is the part a guest at the gate needs to hear — it is
      // what the passage carries in, now that it is not what it buys.
      const covers = guests > 1 ? ` Walks in ${guests} guests.` : ''
      if (remaining === null) {
        return `Unlimited Quest Experiences ${tier.pass.validFor === 'month' ? 'this month' : 'today'}.${covers}`
      }
      return `${remaining} Quest Experience${remaining === 1 ? '' : 's'} left.${covers}`
    }
  }
}

/** Where one passage stands right now: good to present, or why not. */
export function passStateFor(userId: string, booking: Booking, at: number = Date.now()): PassState | null {
  const tier = getTier(booking.tierId)
  if (!tier) return null

  const guests = guestsOf(booking)
  // The allowance is the PASSAGE's, not each head's. A passage booked for five
  // walks all five through the gate on one Quest Experience — booking for a
  // crowd buys a bigger party, never a longer season.
  const allowance = tier.pass.quests

  const validity = validityOf(booking, tier)
  const period = periodBounds(booking, tier, at)
  const spent =
    allowance === null
      ? 0
      : listUses(userId).filter(
          (u) => u.bookingId === booking.id && u.at >= period.from && u.at < period.to
        ).length
  const remaining = allowance === null ? null : Math.max(0, allowance - spent)

  let status: PassStatus
  if (booking.status === 'cancelled') status = 'cancelled'
  else if (at < validity.from) status = 'upcoming'
  else if (at >= validity.to) status = 'expired'
  else if (remaining !== null && remaining <= 0) status = 'spent'
  else status = 'valid'

  const partial = { booking, tier, status, remaining, allowance, guests }
  return { ...partial, note: noteFor(partial, at) }
}

/** Every passage the guest holds, the ones they can present first. */
export function passStates(userId: string, at: number = Date.now()): PassState[] {
  const order: Record<PassStatus, number> = { valid: 0, upcoming: 1, spent: 2, expired: 3, cancelled: 4 }
  return listBookings(userId)
    .map((b) => passStateFor(userId, b, at))
    .filter((s): s is PassState => s !== null)
    .sort((a, b) => order[a.status] - order[b.status] || a.booking.date.localeCompare(b.booking.date))
}

export function validPasses(userId: string, at: number = Date.now()): PassState[] {
  return passStates(userId, at).filter((s) => s.status === 'valid')
}

export function hasValidPass(userId: string, at: number = Date.now()): boolean {
  return validPasses(userId, at).length > 0
}

// ── Spending a passage ────────────────────────────────────────────────────────

export interface RedeemInput {
  bookingId?: string
  orgId: string
  episodeId: string
  /** Guests walking in on this passage — the party standing at the gate. */
  guests?: number
  at?: number
}

export type RedeemResult =
  | { ok: true; use: PassUse; charged: boolean }
  | { ok: false; error: string; needPass: boolean }

/**
 * Spends one Quest Experience so a quest can be taken.
 *
 * Returns the existing record untouched when this episode was already paid for
 * — one episode is one quest, however many times it is asked for.
 */
export function redeem(userId: string, input: RedeemInput): RedeemResult {
  const at = input.at ?? Date.now()

  const already = useForEpisode(userId, input.orgId, input.episodeId)
  if (already) return { ok: true, use: already, charged: false }

  if (!input.bookingId) {
    return {
      ok: false,
      needPass: true,
      error: hasValidPass(userId, at)
        ? 'Present a passage to take this quest.'
        : 'You need a passage to take a quest. Book one at the gate.',
    }
  }

  const booking = listBookings(userId).find((b) => b.id === input.bookingId)
  if (!booking) return { ok: false, needPass: true, error: 'That passage is not on the roll.' }

  const state = passStateFor(userId, booking, at)
  if (!state) return { ok: false, needPass: true, error: 'That passage is not on the roll.' }
  if (state.status !== 'valid') return { ok: false, needPass: true, error: state.note }

  const use: PassUse = {
    id: uid(),
    bookingId: booking.id,
    code: booking.code,
    passName: state.tier.name,
    orgId: input.orgId,
    episodeId: input.episodeId,
    at,
    guests: Math.max(1, input.guests ?? 1),
    covers: state.guests,
  }
  setUses(userId, [...listUses(userId), use])
  cloudSync.pushPassUses(userId)

  return { ok: true, use, charged: true }
}

/**
 * Records that a party-mate's passage covered this guest's walk.
 *
 * Charged to nobody: the tapper's passage was already debited for the whole
 * party, and this is only how the covered guest's own device knows the episode
 * is paid for.
 */
export function recordCover(
  userId: string,
  source: Pick<PassUse, 'code' | 'passName' | 'orgId' | 'episodeId' | 'at' | 'guests' | 'covers'>,
  coveredBy: string
): PassUse | null {
  if (useForEpisode(userId, source.orgId, source.episodeId)) return null
  const use: PassUse = { id: uid(), ...source, coveredBy }
  setUses(userId, [...listUses(userId), use])
  cloudSync.pushPassUses(userId)
  return use
}

/** Demo reset — takes a cast's redemptions off the ledger. */
export function clearUsesFor(userIds: string[]): void {
  userIds.forEach((id) => setUses(id, []))
}
