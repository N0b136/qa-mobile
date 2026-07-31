// Pure read-side aggregation over the booking mirrors — no writes, no Firestore
// calls, nothing async. The Manager's tab calls these directly.
//
// ── WHAT THIS COUNTS, AND WHAT IT DOES NOT ──────────────────────────────────
//
// These are PASSAGES RECORDED, not cash reconciled. The app is not a till.
//
// A booking row exists for exactly two reasons: a guest booked it in the app, or
// a Guide bound a walk-up party at the booth. NOTHING in this codebase observes
// money changing hands — there is no card capture, no drawer, no settlement
// feed — so `gross` is the sum of what the passages were PRICED at when they
// were recorded, and a booth party whose card was declined leaves the same row
// as one that paid. In the other direction, a cancelled booking is not a refund
// record: it says a passage was called off, never that money went back.
//
// So this screen answers "what did we write down today", which is a real and
// useful question, and it does not answer "what is in the drawer". Anyone
// reconciling against a payment processor must treat these as two independent
// sources that are expected to disagree. `SALES_CAVEAT` exists so the number can
// never be printed without that sentence next to it — print it.
//
// ── HOW IT REACHES EVERY BOOKING ────────────────────────────────────────────
//
// Bookings live per-guest under `ql:bookings:{userId}`, and `store.ts` exposes
// no key enumeration (`clearAll` walks localStorage internally but hands back
// nothing). So there is no way to ask "every booking key" directly. The route is
// the console's guest directory: cloudSync mirrors EVERY guest into it and
// mirrors every booking into that guest's own key, so iterating
// `listDirectory()` and calling `listBookings(g.id)` reaches all of them.
//
// The consequence, stated plainly because it will show up as a missing number:
// a guest who never made it into the directory — a phone on a local-only
// fallback account, whose id is not a uid — is invisible here, and so are their
// passages.

import type { Booking } from '../types'
import { listDirectory } from './consoleService'
import { listBookings, getTier, priceBooking } from './bookingService'

/** The one-line honesty note the UI prints beside any figure from this file. */
export const SALES_CAVEAT =
  'Passages recorded, not cash reconciled — this is not a till, and a cancellation is not a refund.'

export interface SalesLine {
  tierId: string
  tierName: string
  category: string
  count: number
  heads: number
  gross: number
}

export interface DaySales {
  /** 'yyyy-mm-dd', local. */
  day: string
  /** Keyed on createdAt — the passages written down on this day. */
  sold: { count: number; heads: number; gross: number; byTier: SalesLine[] }
  /** Keyed on booking.date — who is expected in the park on this day. */
  visiting: { count: number; heads: number; gross: number; byTier: SalesLine[] }
  /** Subset of `sold`: parties bound at the booth. */
  walkUps: { count: number; heads: number; gross: number }
  /** Subset of `sold`: everything else — booked on a guest's own phone. */
  inApp: { count: number; heads: number; gross: number }
  /**
   * Excluded from every figure above and reported here instead. A manager
   * comparing two numbers deserves to see the third, and a cancelled passage
   * that silently vanished would read as a booking that never happened.
   */
  cancelled: { count: number; gross: number }
}

// ── Day keys ────────────────────────────────────────────────────────────────
//
// Local, deliberately. `bookingService` keeps a private `localDateString` for
// its reminders; this is the same arithmetic rather than an export of theirs,
// so neither file's day handling can drift the other's by being "tidied".

function localDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayKey(now?: Date): string {
  return localDay(now ?? new Date())
}

/**
 * 'yyyy-mm-dd' -> a LOCAL midnight Date, parsed by hand.
 *
 * `new Date('2026-07-31')` is parsed as UTC midnight by spec, which in any
 * negative-offset zone is the 30th locally — so the whole strip of days slides
 * back one. The only Date this file ever builds from a day string is built here.
 */
function dayToLocalDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

// ── Collection ──────────────────────────────────────────────────────────────

interface Row {
  booking: Booking
  /** True when the passage was bound at the booth rather than in the app. */
  walkUp: boolean
}

/**
 * Every booking on this device's mirrors, once each.
 *
 * Guest ids are deduped because the directory is a merged mirror and a repeated
 * id would double that guest's whole booking history into the totals.
 */
function collect(): Row[] {
  const rows: Row[] = []
  const seen = new Set<string>()
  for (const guest of listDirectory()) {
    if (seen.has(guest.id)) continue
    seen.add(guest.id)
    // The flag is the record; the `walk-` id prefix is the backstop for a
    // directory entry mirrored before the flag was carried round-trip. Either
    // one alone is enough to call it a booth party.
    const walkUp = guest.walkUp === true || guest.id.startsWith('walk-')
    for (const booking of listBookings(guest.id)) {
      rows.push({ booking, walkUp })
    }
  }
  return rows
}

/**
 * What one booking is worth in these figures.
 *
 * The STORED total, not a re-price: `booking.total` is what the passage was sold
 * at, and re-pricing it against today's TIERS would quietly restate last month's
 * takings every time the owner edits a price. `priceBooking` is only the
 * fallback for a row that carries no usable total — a half-written record from
 * an interrupted booth bind — where a best-effort figure beats a zero that reads
 * as a free passage.
 */
function grossOf(booking: Booking): number {
  if (Number.isFinite(booking.total)) return booking.total
  const tier = getTier(booking.tierId)
  if (!tier) return 0
  return priceBooking(tier, booking.adults, booking.children, booking.addOnIds ?? []).total
}

function headsOf(booking: Booking): number {
  return (booking.adults ?? 0) + (booking.children ?? 0)
}

// ── Tallying ────────────────────────────────────────────────────────────────

interface Bucket {
  count: number
  heads: number
  gross: number
  byTier: Map<string, SalesLine>
}

function emptyBucket(): Bucket {
  return { count: 0, heads: 0, gross: 0, byTier: new Map() }
}

function addTo(bucket: Bucket, booking: Booking): void {
  const heads = headsOf(booking)
  const gross = grossOf(booking)
  bucket.count += 1
  bucket.heads += heads
  bucket.gross += gross

  // An unknown tierId still gets a line, named by its raw id. A tier retired
  // from TIERS does not un-sell the passages booked on it, and a figure that
  // quietly omits rows is worse than an ugly one — the omission is invisible,
  // the ugly id is a question somebody can answer.
  const tier = getTier(booking.tierId)
  let line = bucket.byTier.get(booking.tierId)
  if (!line) {
    line = {
      tierId: booking.tierId,
      tierName: tier?.name ?? booking.tierId,
      category: tier?.category ?? 'unknown',
      count: 0,
      heads: 0,
      gross: 0,
    }
    bucket.byTier.set(booking.tierId, line)
  }
  line.count += 1
  line.heads += heads
  line.gross += gross
}

function sealBucket(bucket: Bucket): { count: number; heads: number; gross: number; byTier: SalesLine[] } {
  const byTier = Array.from(bucket.byTier.values()).sort(
    // Gross descending; count then id break ties so the order is stable across
    // renders rather than falling out of Map insertion order.
    (a, b) => b.gross - a.gross || b.count - a.count || a.tierId.localeCompare(b.tierId)
  )
  return { count: bucket.count, heads: bucket.heads, gross: bucket.gross, byTier }
}

/** One day's figures out of an already-collected set of rows. */
function tally(rows: Row[], day: string): DaySales {
  const sold = emptyBucket()
  const visiting = emptyBucket()
  const walkUps = { count: 0, heads: 0, gross: 0 }
  const inApp = { count: 0, heads: 0, gross: 0 }
  const cancelled = { count: 0, gross: 0 }

  for (const { booking, walkUp } of rows) {
    // `booking.date` is ALREADY a local 'yyyy-mm-dd' string written by the
    // booking form. Compare it as a string — putting it through a Date drags it
    // through UTC and moves a booking a day in either direction.
    const visitingHere = booking.date === day
    const soldHere = localDay(new Date(booking.createdAt)) === day

    if (booking.status === 'cancelled') {
      // Counted once for the day it touches in EITHER sense. A cancellation is
      // excluded from both figures above, so tying it to only one of them would
      // hide it from a manager reading the other; and it is not a refund record
      // in either case, which is why it carries no head count to add up.
      if (soldHere || visitingHere) {
        cancelled.count += 1
        cancelled.gross += grossOf(booking)
      }
      continue
    }

    if (soldHere) {
      addTo(sold, booking)
      const side = walkUp ? walkUps : inApp
      side.count += 1
      side.heads += headsOf(booking)
      side.gross += grossOf(booking)
    }
    if (visitingHere) addTo(visiting, booking)
  }

  return {
    day,
    sold: sealBucket(sold),
    visiting: sealBucket(visiting),
    walkUps,
    inApp,
    cancelled,
  }
}

// ── Public reads ────────────────────────────────────────────────────────────

export function salesForDay(day: string): DaySales {
  return tally(collect(), day)
}

/**
 * The last `count` calendar days ending on `endingOn` (default today), newest
 * first — so a 7-day strip is one call.
 *
 * Rows are collected ONCE and bucketed per day rather than calling
 * `salesForDay` in a loop: every call re-walks the whole guest directory, and a
 * strip that re-read every guest's bookings seven times would do it on every
 * render of the tab.
 */
export function recentDays(count: number, endingOn?: string): DaySales[] {
  if (count <= 0) return []
  const rows = collect()
  const cursor = dayToLocalDate(endingOn ?? todayKey())
  const out: DaySales[] = []
  for (let i = 0; i < count; i++) {
    out.push(tally(rows, localDay(cursor)))
    // Step back a calendar day via the local Date, so DST-shifted days are one
    // day back and not 23 or 25 hours back.
    cursor.setDate(cursor.getDate() - 1)
  }
  return out
}
