// What the park wrote down today, and the six days before it.
//
// Every figure here comes straight out of salesService, which is where the
// counting rules and their limits are documented. Nothing on this card
// re-derives a total — it formats what it is handed and prints the caveat.

import { Fragment } from 'react'
import { recentDays, salesForDay, todayKey, SALES_CAVEAT } from '../../../services/salesService'
import type { DaySales } from '../../../services/salesService'
import { Card } from '../../../ui'

// Built once at module scope. Whole dollars: a manager glancing at a phone is
// reading the shape of the day, and cents on a figure that is explicitly not
// reconciled against a till would claim a precision this number does not have.
const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function money(n: number): string {
  return MONEY.format(n)
}

function passages(n: number): string {
  return `${n} ${n === 1 ? 'passage' : 'passages'}`
}

function heads(n: number): string {
  return `${n} ${n === 1 ? 'traveller' : 'travellers'}`
}

/**
 * 'yyyy-mm-dd' -> 'Fri 31', parsed by hand.
 *
 * `new Date('2026-07-31')` is UTC midnight by spec, which in any negative-offset
 * zone prints as the 30th — the whole strip would be labelled a day early.
 * salesService parses its own day strings the same way for the same reason.
 *
 * The two parts are composed here rather than asked for together: a single
 * `{ weekday, day }` format is ordered by the runtime's locale data, and this
 * one prints "31 Fri" — a strip of dates that reads backwards down the column.
 */
function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' })
  return `${weekday} ${date.getDate()}`
}

export default function TakingsCard() {
  const today = todayKey()
  const day: DaySales = salesForDay(today)
  const week = recentDays(7)

  // The bar track is a share of the week's best day, not of a fixed ceiling: a
  // quiet week should still read as a shape rather than seven empty tracks.
  const peak = week.reduce((max, d) => Math.max(max, d.sold.gross), 0)

  return (
    <Card eyebrow="Today" title="Takings">
      <div className="manager-line">
        <span style={{ color: 'var(--text-heading)' }}>Recorded today</span>
        <strong className="manager-line__value" style={{ color: 'var(--text-heading)' }}>
          {passages(day.sold.count)} · {money(day.sold.gross)}
        </strong>
      </div>

      <div className="manager-line muted" style={{ marginTop: 6, fontSize: 13 }}>
        <span>Expected in the park today</span>
        <span className="manager-line__value">
          {passages(day.visiting.count)} · {heads(day.visiting.heads)}
        </span>
      </div>

      <div className="manager-line muted" style={{ marginTop: 4, fontSize: 13 }}>
        <span>Booth walk-ups</span>
        <span className="manager-line__value">
          {passages(day.walkUps.count)} · {money(day.walkUps.gross)}
        </span>
      </div>

      <div className="manager-line muted" style={{ marginTop: 4, fontSize: 13 }}>
        <span>Booked in the app</span>
        <span className="manager-line__value">
          {passages(day.inApp.count)} · {money(day.inApp.gross)}
        </span>
      </div>

      {/* Only when there are any. A permanent "0 cancelled" line is a row a
          manager learns to skip, and then misses on the day it is not zero. */}
      {day.cancelled.count > 0 ? (
        <div className="manager-line muted" style={{ marginTop: 4, fontSize: 13 }}>
          <span>Cancelled</span>
          <span className="manager-line__value">
            {passages(day.cancelled.count)} · {money(day.cancelled.gross)}
          </span>
        </div>
      ) : null}

      <div style={{ marginTop: 'var(--space-md)' }}>
        <div className="qa-label" style={{ marginBottom: 'var(--space-xs)' }}>
          Last seven days
        </div>
        <div className="manager-strip">
          {week.map((d) => (
            // Two grid cells' worth of content per day, keyed on the day itself —
            // a Fragment rather than a wrapper div, so each cell lands in the
            // grid's own columns instead of in a nested box.
            <Fragment key={d.day}>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {dayLabel(d.day)}
              </span>
              <span className="manager-strip__bar" aria-hidden="true">
                <span
                  className="manager-strip__fill"
                  style={{
                    display: 'block',
                    width: peak > 0 ? `${Math.round((d.sold.gross / peak) * 100)}%` : '0%',
                  }}
                />
              </span>
              <span className="manager-strip__figure" style={{ fontSize: 12 }}>
                {d.sold.count} · {money(d.sold.gross)}
              </span>
            </Fragment>
          ))}
        </div>
      </div>

      {/* Verbatim, and never optional. The figures above are passages recorded
          and this sentence is the whole difference between them and a till. */}
      <p className="muted" style={{ marginTop: 'var(--space-md)', fontSize: 12 }}>
        {SALES_CAVEAT}
      </p>
    </Card>
  )
}
