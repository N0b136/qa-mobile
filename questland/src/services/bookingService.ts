import type { BookingTier, AddOn } from '../content/types'
import { TIERS, ADD_ONS } from '../content/bookingTiers'
import type { Booking } from '../types'
import { load, save } from './store'
import { uid, shortCode } from './ids'
import * as notificationService from './notificationService'
import * as cloudSync from './cloudSync'
import { getUser } from './authService'

function key(userId: string): string {
  return `ql:bookings:${userId}`
}

export interface PriceBreakdown {
  base: number
  addOns: number
  total: number
  overCount: number
}

/** PURE — no reads/writes. Mirrors the four ticket-category pricing rules in ticketing.json. */
export function priceBooking(
  tier: BookingTier,
  adults: number,
  children: number,
  addOnIds: string[]
): PriceBreakdown {
  let base = 0
  let overCount = 0

  if (tier.category === 'day') {
    base = (tier.priceAdult ?? 0) * adults + (tier.priceChild ?? 0) * children
  } else if (tier.category === 'day-group' || (tier.category === 'membership' && tier.perPersonOver)) {
    const flat = tier.flatPrice ?? 0
    if (tier.perPersonOver) {
      overCount = Math.max(0, adults + children - tier.perPersonOver.included)
      base = flat + overCount * tier.perPersonOver.price
    } else {
      base = flat
    }
  } else {
    // non-family membership, birthday — flat price
    base = tier.flatPrice ?? 0
  }

  const addOns = addOnIds.reduce((sum, id) => {
    const addOn = ADD_ONS.find((a) => a.id === id)
    return sum + (addOn?.price ?? 0)
  }, 0)

  return { base, addOns, total: base + addOns, overCount }
}

function generateCode(): string {
  return `QST-${shortCode(6)}`
}

export interface CreateBookingInput {
  tierId: string
  date: string
  slot: string
  adults: number
  children: number
  addOnIds: string[]
}

export function createBooking(userId: string, input: CreateBookingInput): Booking {
  const tier = TIERS.find((t) => t.id === input.tierId)
  if (!tier) throw new Error('That passage no longer exists.')

  const { total } = priceBooking(tier, input.adults, input.children, input.addOnIds)

  const booking: Booking = {
    id: uid(),
    userId,
    tierId: input.tierId,
    date: input.date,
    slot: input.slot,
    adults: input.adults,
    children: input.children,
    addOnIds: input.addOnIds,
    total,
    status: 'confirmed',
    code: generateCode(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  save(key(userId), [...listBookings(userId), booking])
  cloudSync.pushBooking(booking)
  // Re-push the profile so the radio's passage stamp (derived inside
  // buildGuestDoc from the mirrors just written) lands immediately.
  const owner = getUser(userId)
  if (owner) cloudSync.pushGuestProfile(owner)

  notificationService.add(userId, {
    type: 'booking',
    title: `Passage booked — ${tier.name}`,
    body: `${booking.date} · confirmation ${booking.code}`,
    icon: 'ticket',
  })

  return booking
}

export function listBookings(userId: string): Booking[] {
  return load<Booking[]>(key(userId), [])
}

export function cancelBooking(userId: string, bookingId: string): void {
  const next = listBookings(userId).map((b) =>
    b.id === bookingId ? { ...b, status: 'cancelled' as const, updatedAt: Date.now() } : b
  )
  save(key(userId), next)
  const cancelled = next.find((b) => b.id === bookingId)
  if (cancelled) cloudSync.pushBooking(cancelled)
  // A cancellation can take the last passage with it — re-derive the stamp.
  const owner = getUser(userId)
  if (owner) cloudSync.pushGuestProfile(owner)
}

export function getTier(tierId: string): BookingTier | undefined {
  return TIERS.find((t) => t.id === tierId)
}

export function getAddOn(addOnId: string): AddOn | undefined {
  return ADD_ONS.find((a) => a.id === addOnId)
}

function remindersKey(userId: string): string {
  return `ql:reminders:${userId}`
}

function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Fires "today"/"tomorrow" booking reminders once each, deduped via ql:reminders:${userId}. Safe to call repeatedly. */
export function syncBookingReminders(userId: string): void {
  const now = new Date()
  const today = localDateString(now)
  const tomorrowDate = new Date(now)
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = localDateString(tomorrowDate)

  const markers = load<string[]>(remindersKey(userId), [])
  const markerSet = new Set(markers)
  let changed = false

  for (const booking of listBookings(userId)) {
    if (booking.status !== 'confirmed') continue

    if (booking.date === today) {
      const marker = `${booking.id}:today`
      if (!markerSet.has(marker)) {
        notificationService.add(userId, {
          type: 'booking',
          title: 'Your visit is today',
          body: `Today's the day — your ${getTier(booking.tierId)?.name ?? 'passage'} awaits. Gates open at nine.`,
          icon: 'ticket',
        })
        markerSet.add(marker)
        changed = true
      }
    } else if (booking.date === tomorrow) {
      const marker = `${booking.id}:tomorrow`
      if (!markerSet.has(marker)) {
        notificationService.add(userId, {
          type: 'booking',
          title: 'Your visit is tomorrow',
          body: `Your ${getTier(booking.tierId)?.name ?? 'passage'} is booked for ${booking.date}. Arrive by your chosen hour.`,
          icon: 'calendar',
        })
        markerSet.add(marker)
        changed = true
      }
    }
  }

  if (changed) {
    save(remindersKey(userId), Array.from(markerSet))
  }
}
