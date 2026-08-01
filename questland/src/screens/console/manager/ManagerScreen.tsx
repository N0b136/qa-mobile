// The Manager's tab — the park in one scrolling column, built to be read on a
// phone from a car park or a kitchen table.
//
// ── THIS SURFACE IS READ-ONLY, ON PURPOSE ───────────────────────────────────
//
// Nothing here writes. No flag binding, no enrolment, no passage spending, no
// walk-up creation, no acknowledging a call for aid, no broadcast. Two separate
// reasons, and both of them matter:
//
// · Every one of those acts belongs at a counter with a guest standing at it. A
//   passage is spent against a party who is present; a pole is bound to the
//   party carrying it. Performed from somewhere else they are guesses about a
//   room nobody is in.
// · A mis-tap on a phone must not be able to rebind a pole, spend somebody's
//   Quest Experience, or tell the whole park that a call is being answered. The
//   Back Office board has the room for confirmation steps that a thumb-sized
//   column does not.
//
// So this tab answers questions and the Back Office does the work. Anything that
// needs doing from here is done by opening the console proper.
//
// The four sections are ordered as the triage, not by importance in the
// abstract: somebody calling for help, then the day's money, then who is in the
// park, then whether the hardware is well.

import { useEffect, useState } from 'react'
import { managerFor } from '../../../services/managerAuth'
import { Card } from '../../../ui'
import CallsCard from './CallsCard'
import TakingsCard from './TakingsCard'
import PulseCard from './PulseCard'
import PlinthsCard from './PlinthsCard'
import './manager.css'

export default function ManagerScreen({ staffUid }: { staffUid: string }) {
  // KEYED TO THE SIGNED-IN uid, and that is what makes the guard below its own
  // opinion. The mirror is one un-keyed slot on a booth several people sign into
  // in a day, so an un-keyed read here would answer the same question the gate
  // upstream already answered off the same byte — an echo, not a second check,
  // worth nothing more than the upstream clear that may never have run.
  const manager = managerFor(staffUid)

  // ── THE SURFACE'S CLOCK, AND IT IS NOT DECORATION ──────────────────────────
  //
  // DO NOT DELETE THIS TIMER because nothing appears to depend on it. Everything
  // on this tab is time-derived — how old the booth's report is, how long a call
  // for aid has waited, how long a party has been walking — and NONE of it has
  // an event behind it. `useAppTick()` bumps only when the local store is
  // written, and a booth console that has closed writes nothing at all. So
  // without this interval the tab renders once and then sits there, aging.
  //
  // That is precisely the failure parkStatusService's freshness rule exists to
  // prevent, and the rule cannot fire if nobody re-reads it: a manager glances
  // at their phone at nine in the evening, sees "23 live", and goes to bed —
  // from a card whose console closed at five and whose staleness was never
  // re-evaluated because the tab had been open since lunchtime.
  //
  // ONE tick for the whole surface rather than one per card: the cards' age
  // strings are all describing the same instant, and two timers drifting a few
  // hundred milliseconds apart would let two cards print the same event at two
  // different ages. 30s is ample — the freshness window is twelve minutes and
  // every string here is printed to the minute.
  //
  // AND THE INTERVAL ALONE CANNOT BE TRUSTED. A backgrounded tab has its timers
  // clamped to a minute or worse, and a frozen or discarded one stops them
  // outright — so an installed console that spent the evening in a pocket comes
  // back showing the LAST FRAME IT PAINTED, which may be the counts from before
  // a suppression, presented as current. Backgrounding and foregrounding is how
  // a phone app is used, so that is the common path and not an edge. This whole
  // surface is worth having only because it never shows a stale reading as
  // current, so the return to visibility re-reads the clock immediately rather
  // than waiting out a throttled tick.
  //
  // `visibilitychange` and nothing else: every way this surface comes back in
  // front of a manager — app switcher, unlock, tab switch — passes through it,
  // and a 'focus' listener would only add repaints for window activations that
  // never hid the document in the first place.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    // Both cleared on unmount: the console's tabs mount and unmount all day, and
    // a leaked interval — or a leaked document listener firing on every tab
    // switch for the rest of the session — is its own bug.
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Defence in depth. ConsoleScreen does not draw the tab without a grant, so
  // reaching this branch means something upstream is wrong rather than that a
  // Guide has wandered in — but a screen that renders the day's takings should
  // check for itself rather than trust that it was only mounted correctly.
  //
  // This is a UI gate over data staff can already read; managerAuth says so
  // plainly at its top. It keeps the takings off a Guide's screen. It does not
  // make them unreachable to somebody holding a staff credential.
  if (!manager) {
    return (
      <div className="manager">
        <Card eyebrow="Manager" title="Not Your Tab">
          <p>This tab is for park managers.</p>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            Managers are added by hand in the Firebase console, like staff.
          </p>
        </Card>
      </div>
    )
  }

  return (
    // `now` goes to the two cards that print ages off a stored timestamp. The
    // other two read their own clock at render, which is correct BECAUSE this
    // component re-renders them every tick — they do not need the instant, only
    // the repaint.
    <div className="manager">
      <CallsCard now={now} />
      <TakingsCard />
      <PulseCard />
      <PlinthsCard now={now} />
    </div>
  )
}
