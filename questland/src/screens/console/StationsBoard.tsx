// The park board: the same chart the guests carry, with parties on it — and
// with the plinths reporting on themselves.
//
// A pin shows how many parties are standing at that station right now; tapping
// one names them. Fifteen minutes after a check-in a party stops being at the
// station and joins the en-route list below the chart — we do not track precise
// locations, so "somewhere on the paths" is the whole of what we claim.
//
// Two lists sit under the chart, and they are the two places a party can be that
// no station pin will show you standing at for long: on the paths between
// stations, and in the village before the walk has started. The village square
// does carry a pin, but a group can sit in it for an hour — reading that off a
// head count means opening the dialog to find out who, which is exactly what
// staff at the booth are asking. So it gets a list of its own.
//
// The ring around each pin is a different fact about the same place: whether
// the reader out there is alive, and whether it is holding the flag table the
// park is actually running. Occupancy and condition have to be readable at the
// same glance, so they never share a channel — the glyph and the head count
// stay gold for occupancy, the ring and the corner mark carry the condition.

import { Children, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import MapCanvas from '../../components/MapCanvas'
import { DEFAULT_POSITION, MAP_LANDMARKS, QUEST_START, STATION_COORDS, VILLAGE_PLACE } from '../../content/stationMap'
import { STATIONS } from '../../content/stations'
import type { Station } from '../../content/types'
import { getOrg } from '../../content/orgs'
import {
  START_WINDOW_MS,
  STATION_WINDOW_MS,
  enRoute,
  inVillage,
  occupantsByPlace,
} from '../../services/presenceService'
import type { Occupant } from '../../services/presenceService'
import { tableVersion } from '../../services/flagService'
import { GATE_STATION_NO, stationNoForPlace } from '../../services/hubProtocol'
import * as hubLink from '../../services/hubLink'
import type { HubState } from '../../services/hubLink'
import { SerialTransport } from '../../services/hubSerial'
import { broadcastTable } from '../../services/tapService'
import { conditionOf, listHealth, staleStations } from '../../services/stationHealthService'
import type { StationCondition, StationHealth } from '../../services/stationHealthService'
import { useToast } from '../../components/Toast'
import { Badge, Button, Card, Dialog, Icon } from '../../ui'
import { STATION_ICON } from '../questIcons'
import { questLine } from './GuestsAfield'

interface ChartPlace {
  id: string
  name: string
  glyph: string
  coord: { x: number; y: number }
  /**
   * The LoRa address of the reader standing here, if one does. Condition is
   * keyed on THIS and never on the place id: a place id says where a guest is,
   * which is not always where the box is.
   */
  stationNo?: number
  /** False for a mark that carries only a reader — nobody checks in at the gate box. */
  occupancy: boolean
}

/** Landmark glyphs a chart pin now stands on. Drawn twice they are just noise. */
const PINNED_LANDMARKS = new Set(['village', 'gate'])

const GATE_LANDMARK = MAP_LANDMARKS.find((lm) => lm.id === 'gate')

/**
 * The chart: everywhere a party can be standing, and everywhere a reader is.
 *
 * Those are two different sets and the gate is why. All 23 LoRa addresses send
 * a heartbeat — 21 stations, the chief's house, the gate — but `placeIdForStation(23)`
 * is `village`, because a guest who taps in at the gate IS in the Village of
 * Queston. Right for presence, wrong for hardware: the box is a post at the
 * entrance and the square is a couple of hundred metres up the road. A
 * condition is a claim about a physical thing, and the Warden it sends out has
 * to walk to where that thing stands. So the square carries the arrivals and no
 * reader, and the entrance carries the reader and no arrivals.
 */
function chartPlaces(): ChartPlace[] {
  const places: ChartPlace[] = [
    { id: VILLAGE_PLACE.id, name: VILLAGE_PLACE.name, glyph: 'castle', coord: DEFAULT_POSITION, occupancy: true },
    {
      id: QUEST_START.id,
      name: QUEST_START.name,
      glyph: 'house',
      coord: { x: QUEST_START.x, y: QUEST_START.y },
      stationNo: stationNoForPlace(QUEST_START.id) ?? undefined,
      occupancy: true,
    },
  ]
  if (GATE_LANDMARK) {
    places.push({
      id: 'gate-reader',
      name: GATE_LANDMARK.label,
      glyph: GATE_LANDMARK.icon,
      coord: { x: GATE_LANDMARK.x, y: GATE_LANDMARK.y },
      stationNo: GATE_STATION_NO,
      occupancy: false,
    })
  }
  STATIONS.forEach((st: Station) => {
    const coord = STATION_COORDS[st.id]
    if (!coord) return
    places.push({
      id: st.id,
      name: st.name,
      glyph: STATION_ICON[st.type] ?? 'map-pin',
      coord,
      stationNo: stationNoForPlace(st.id) ?? undefined,
      occupancy: true,
    })
  })
  return places
}

// Staff copy: plain and precise. A Warden reading this at 11pm needs the fact,
// not the costume.
const CONDITION_LABEL: Record<StationCondition, string> = {
  live: 'live',
  stale: 'stale',
  fault: 'fault',
  silent: 'silent',
  unknown: 'no report',
}

const CONDITION_TONE: Record<StationCondition, 'gold' | 'forge' | 'locked' | 'neutral'> = {
  live: 'gold',
  // Ember is firelight — it is the park's live/now colour, and here that is
  // exactly what a condition needing a hand today is.
  stale: 'forge',
  fault: 'forge',
  // The DS locked treatment: dashed hairline, shape kept. A station we have
  // lost is absent, not dimmed.
  silent: 'locked',
  unknown: 'neutral',
}

const CONDITION_GLYPH: Record<StationCondition, string> = {
  live: 'signal',
  stale: 'refresh-cw',
  fault: 'triangle-alert',
  silent: 'wifi-off',
  unknown: 'circle-dashed',
}

const CONDITION_NOTE: Record<StationCondition, string> = {
  live: 'Reporting, and holding the current flag table.',
  stale: 'Reporting, but holding an older flag table. A table push from this board clears it.',
  // NAMES BOTH CAUSES, the same rule the hub hints follow. A plinth reports a
  // fault three ways — dead card, dead player, or a non-zero error code with
  // both of those fine — and a note that only mentions the hardware sends a
  // Warden to check two cables on a station whose trouble is in its firmware,
  // then leaves them doubting the board when it turns out both are seated.
  fault: 'Reporting, but not well — an error code, or its SD card or audio player not answering. The pin says which.',
  silent: 'Was reporting and stopped. Somebody has to walk out to it.',
  unknown: 'Nothing heard since the console opened.',
}

/** Live first, then the alarms in the order a Warden would work them. */
const CONDITION_ORDER: StationCondition[] = ['live', 'stale', 'fault', 'silent', 'unknown']

function minutesLeft(o: Occupant, now: number): number {
  const window = o.placeKind === 'start' ? START_WINDOW_MS : STATION_WINDOW_MS
  return Math.max(0, Math.ceil((o.since + window - now) / 60000))
}

function ago(at: number, now: number): string {
  const mins = Math.floor((now - at) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m ago`
}

function elapsed(o: Occupant, now: number): string {
  return ago(o.since, now)
}

function clock(at: number): string {
  if (!at) return '—'
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function duration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * Table versions are `max(flag.tableAt)` — a millisecond epoch, not a counter,
 * so "three versions behind" is not a thing that can be said. Two build times
 * can be, and that is what staff actually need: which table this plinth is
 * running and which one the park is.
 */
/**
 * ONE serial transport for the tab, not one per press.
 *
 * The browser's port picker is a one-time grant that the transport holds on to,
 * so pressing the button a second time reuses the port already chosen instead of
 * putting a dialog in front of a Warden who has already answered it. Handing
 * `hubLink.connect()` a fresh instance would swap the transport out and throw
 * that grant away. Constructing it is free — nothing opens until the click.
 */
const SERIAL = new SerialTransport()

/**
 * What the connect control says in each state, written for a Warden standing in
 * the booth: every line is either "nothing is wrong" or a thing to go and do.
 * `held` is the only one that needs a human, so it is the only one that names an
 * action — and a serial monitor left open in another program counts as a window.
 */
const HUB_CONTROL: Record<HubState, { label: string; icon: string; hint: string }> = {
  unsupported: {
    label: 'Connect the hub',
    icon: 'cable',
    hint: 'This browser cannot open a serial port.',
  },
  idle: {
    label: 'Connect the hub',
    icon: 'cable',
    hint: "Choose the hub's USB port. The cable carries every tap in the park.",
  },
  connecting: {
    label: 'Opening the port',
    icon: 'cable',
    hint: "Choose the hub in the browser's picker.",
  },
  live: {
    label: 'Hub connected',
    icon: 'plug',
    hint: 'USB serial at 115200. Taps arrive as they happen.',
  },
  reconnecting: {
    label: 'Connect again',
    icon: 'refresh-cw',
    hint: 'The hub stopped answering. Trying again on its own — check the cable and the power.',
  },
  held: {
    // NAMES BOTH CAUSES ON PURPOSE. The browser gives one error for "another
    // window holds this port" and for "that device is not on the bus", so a
    // hint that only mentions the window sends a Warden whose cable is loose
    // off hunting for a tab nobody opened while the park's taps queue up.
    label: 'Connect again',
    icon: 'triangle-alert',
    hint: 'Another window may hold the port, or the cable is out. Check both, then connect again.',
  },
  error: {
    label: 'Connect again',
    icon: 'triangle-alert',
    hint: 'The hub would not open. Check the cable, then try again.',
  },
}

function tableLine(h: StationHealth, parkVersion: number): string {
  if (!parkVersion) return 'No flag table in the rack yet'
  if (!h.tableVersion) return `None held — the park is on ${clock(parkVersion)}`
  if (h.tableVersion >= parkVersion) return `Current (${clock(h.tableVersion)})`
  return `Holding ${clock(h.tableVersion)} — the park is on ${clock(parkVersion)}`
}

export default function StationsBoard() {
  // Display-only tick: the whole board is time-derived, so it must re-read on
  // its own even when nobody checks in.
  //
  // Station health leans on this harder than presence does. A station goes
  // SILENT by nothing happening — no heartbeat, no store write, no reason to
  // repaint — so the one condition staff most need to see is the one condition
  // that could never announce itself. This interval is what makes it appear.
  // It is also why recording a heartbeat does not have to notify anybody: the
  // health map is module memory, read fresh here every ten seconds.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10000)
    return () => window.clearInterval(t)
  }, [])

  // A place is a station, the chief's house, the gate reader or the village.
  const [openPlace, setOpenPlace] = useState<ChartPlace | null>(null)
  const [filter, setFilter] = useState<StationCondition | null>(null)

  const toast = useToast()
  // The push control is only honest while the cable is up — a write made with
  // no port open queues silently, and a button that says it sent something it
  // did not is worse than no button.
  const hubState = useSyncExternalStore(hubLink.subscribe, hubLink.getState)

  const byPlace = occupantsByPlace(now)
  const roaming = enRoute(now)
  const villagers = inVillage(now)
  // The village square is a place in `byPlace` like any other, so it has to come
  // out of the station tally by hand — otherwise the strip counts every waiting
  // group twice, once as "at a station" and once as "in the village".
  const atStations = Object.entries(byPlace).reduce(
    (n, [placeId, list]) => (placeId === VILLAGE_PLACE.id ? n : n + list.length),
    0
  )

  const places = chartPlaces()
  const readers = places.filter((p) => p.stationNo !== undefined)
  const parkVersion = tableVersion()
  const health = new Map(listHealth().map((h) => [h.stationNo, h]))
  const condition = new Map<string, StationCondition>(
    readers.map((p) => [p.id, conditionOf(health.get(p.stationNo as number), parkVersion, now)])
  )
  const counts = CONDITION_ORDER.map((c) => ({
    condition: c,
    n: readers.filter((p) => condition.get(p.id) === c).length,
  })).filter((entry) => entry.n > 0)
  const stale = staleStations(parkVersion, now)

  // A chip vanishes the moment its condition empties out, and a repaired plinth
  // leaving `silent` is exactly the event staff are watching for — so a filter
  // still pointing at it would leave the chart drawing no pins at all, under a
  // strip with nothing highlighted and nothing on it to say why. Reconciled in
  // the same pass it empties (so there is no blank frame) and cleared from
  // state as well, so it cannot switch itself back on when the condition
  // returns.
  const filterEmpty = filter !== null && !counts.some((entry) => entry.condition === filter)
  const activeFilter = filterEmpty ? null : filter
  useEffect(() => {
    if (filterEmpty) setFilter(null)
  }, [filterEmpty])

  // Filtering HIDES the pins that do not match rather than fading them: a
  // half-visible pin on a photographic map is a pin nobody can read, and the
  // faded-out treatment is not one this system uses.
  const shown = activeFilter ? places.filter((p) => condition.get(p.id) === activeFilter) : places

  const openOccupants = openPlace ? (byPlace[openPlace.id] ?? []) : []
  const openHealth = openPlace?.stationNo !== undefined ? health.get(openPlace.stationNo) : undefined
  const openCondition = openPlace ? (condition.get(openPlace.id) ?? 'unknown') : 'unknown'

  // The cable's whole lifecycle lives on this board.
  //
  // `hubLink.connect()` is reference-counted, and the hold taken by the button
  // below is released when this board unmounts — which is what signing out does,
  // because ConsoleScreen swaps the whole grid for the staff gate. So the port
  // is never open one moment longer than the staff session behind the taps it
  // carries, which is the same rule the Firestore listeners follow.
  const holdsHub = useRef(false)
  useEffect(() => {
    return () => {
      if (!holdsHub.current) return
      holdsHub.current = false
      hubLink.disconnect()
    }
  }, [])

  // The simulator attaches itself from an effect; a real port cannot, because
  // `requestPort()` needs a user gesture. Hidden entirely where Web Serial is
  // absent — Firefox, Safari, the QA sandbox — rather than shown as a button
  // that could only ever fail. `?hub=sim` covers what staff do instead.
  const canAttachHub = SERIAL.supported() && !hubLink.isSimulated()
  const hubControl = HUB_CONTROL[hubState]

  function attachHub() {
    // NOTHING may be awaited above this call. `requestPort()` opens the
    // browser's port picker and the browser only allows that while the click's
    // user activation is still live; one await in front of it and Chrome throws
    // SecurityError, which reads — wrongly — as "permission refused".
    const already = holdsHub.current
    holdsHub.current = true
    const opening = hubLink.connect(SERIAL)
    // Every connect() takes a hold. This board keeps exactly one, or a few
    // impatient presses would leave a count that sign-out can never unwind.
    if (already) hubLink.disconnect()

    void opening.then((result) => {
      if (result === 'live') {
        toast.show({
          title: 'Hub connected',
          body: 'USB serial at 115200. Every tap in the park lands here now.',
          icon: 'plug',
        })
        return
      }
      if (result === 'idle') {
        // The picker was dismissed: nothing was chosen, so nothing went wrong.
        // An error toast here would be the console inventing a fault out of a
        // guide changing their mind. Give the hold back and say nothing.
        holdsHub.current = false
        hubLink.disconnect()
        return
      }
      if (result === 'reconnecting') {
        toast.show({
          title: 'The hub did not answer',
          body: "Trying again on its own. Check the cable and the hub's power.",
          icon: 'refresh-cw',
        })
        return
      }
      toast.show({
        title: result === 'held' ? 'The port did not open' : 'The hub would not open',
        // Same reason as the `held` hint above: one browser error covers both
        // "another window has this port" and "that device is not on the bus",
        // so a toast that only accuses the other window sends a Warden with a
        // loose cable hunting for a tab nobody opened.
        body:
          result === 'held'
            ? 'Another console tab or a serial monitor may have it, or the cable is out. Check both, then connect again.'
            : (hubLink.getSnapshot().error ?? 'Check the cable, then try again.'),
        icon: 'triangle-alert',
      })
    })
  }

  function pushTable() {
    const chunks = broadcastTable()
    if (chunks === 0) {
      toast.show({
        title: 'Nothing went out',
        body: 'The hub refused the table. Check the cable, then try again.',
        icon: 'triangle-alert',
      })
      return
    }
    toast.show({
      title: 'Flag table pushed',
      body: 'Every station reports the version it holds on its next heartbeat — up to two minutes.',
      icon: 'refresh-cw',
    })
  }

  return (
    <Card
      eyebrow="Live"
      title="The Park"
      style={{ gridColumn: '1 / -1' }}
    >
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="row muted" style={{ gap: 6, fontSize: 13 }}>
          <Icon name="map-pin" size={14} />
          {/* "1 at stations" is the reading on a quiet morning. The other two
              counts beside this one end in a phrase that does not turn ("en
              route", "in the village"), so only this one needs it. */}
          {atStations} at {atStations === 1 ? 'a station' : 'stations'}
        </span>
        <span className="row muted" style={{ gap: 6, fontSize: 13 }}>
          <Icon name="footprints" size={14} />
          {roaming.length} en route
        </span>
        <span className="row muted" style={{ gap: 6, fontSize: 13 }}>
          <Icon name="castle" size={14} />
          {villagers.length} in the village
        </span>
      </div>

      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 'min(56vh, 620px)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--border-hairline)',
          background: 'var(--surface-page)',
        }}
      >
        <MapCanvas fit="contain">
          {MAP_LANDMARKS.filter((lm) => !PINNED_LANDMARKS.has(lm.id)).map((lm) => (
            <span
              key={lm.id}
              title={lm.label}
              style={{
                position: 'absolute',
                left: `${lm.x * 100}%`,
                top: `${lm.y * 100}%`,
                transform: 'translate(-50%, -50%)',
                color: 'var(--text-muted)',
                opacity: 0.5,
                lineHeight: 0,
              }}
            >
              <Icon name={lm.icon} size={13} />
            </span>
          ))}

          {/* The village square and the chief's house are places a party can be
              standing — the gate check-in lands in one, every quest starts in
              the other. The entrance is the opposite case: a reader with no
              standing room. Each pin carries whichever of the two it has. */}
          {shown.map((place) => (
            <PlacePin
              key={place.id}
              label={place.name}
              glyph={place.glyph}
              coord={place.coord}
              occupancy={place.occupancy}
              occupants={place.occupancy ? (byPlace[place.id] ?? []) : []}
              condition={condition.get(place.id) ?? null}
              onOpen={() => setOpenPlace(place)}
            />
          ))}
        </MapCanvas>
      </div>

      {/* The staleness window, made visible. This strip is the reason the
          cached flag table is a defensible design at all. */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {counts.map(({ condition: c, n }) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(activeFilter === c ? null : c)}
            aria-pressed={activeFilter === c}
            title={CONDITION_NOTE[c]}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              lineHeight: 0,
              cursor: 'pointer',
              borderRadius: 'var(--radius-pill)',
              // Selection is a ring drawn on the chip's own edge; focus stays
              // the DS's 2px gold outline at 2px offset, sitting outside it.
              // They must not share the channel, and an inline `outline` here —
              // even `none` — beats every author rule in the sheet, so a focus
              // indicator given away here could never be won back.
              boxShadow: activeFilter === c ? '0 0 0 2px var(--gold-700)' : undefined,
            }}
          >
            <Badge tone={CONDITION_TONE[c]} icon={CONDITION_GLYPH[c]}>
              {n} {CONDITION_LABEL[c]}
            </Badge>
          </button>
        ))}
        {activeFilter ? (
          <button
            type="button"
            onClick={() => setFilter(null)}
            style={{ background: 'none', border: 'none', padding: 0, lineHeight: 0, cursor: 'pointer' }}
          >
            <Badge tone="neutral" icon="x">
              Show all
            </Badge>
          </button>
        ) : null}
      </div>

      {/* The cable itself, above the things that need it. Everything below this
          line — the push, the heartbeats, every tap in the park — arrives
          through the port this one button opens. */}
      {canAttachHub ? (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <Button
            size="sm"
            variant="secondary"
            icon={hubControl.icon}
            disabled={hubState === 'connecting' || hubState === 'live'}
            onClick={attachHub}
          >
            {hubControl.label}
          </Button>
          <span className="muted" style={{ fontSize: 12, fontFamily: 'var(--font-ui)' }}>
            {hubControl.hint}
          </span>
        </div>
      ) : null}

      {/* The remedy the stale note names. It is a park-wide broadcast, not a
          per-station one, so it belongs beside the count and not inside any one
          plinth's dialog. */}
      {stale.length > 0 ? (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <Button size="sm" variant="secondary" icon="refresh-cw" disabled={hubState !== 'live'} onClick={pushTable}>
            Push the flag table
          </Button>
          <span className="muted" style={{ fontSize: 12, fontFamily: 'var(--font-ui)' }}>
            {hubState === 'live'
              ? `${stale.length} ${stale.length === 1 ? 'station is' : 'stations are'} behind the park's table. One push goes to all of them.`
              : 'The hub is not connected, so nothing can go out from here yet.'}
          </span>
        </div>
      ) : null}

      {/* Two columns, side by side under the chart — the paths on the left, the
          village on the right. `auto-fit` rather than a hard `1fr 1fr`: the card
          spans the console grid, and the same component has to survive a narrow
          render (a Warden's tablet, a browser at half width) by stacking rather
          than crushing two rosters into 160px each. */}
      <div
        style={{
          display: 'grid',
          // `min(320px, 100%)` and not a bare 320px. `auto-fit` drops the
          // SECOND column when 320 will not fit twice, but it never shrinks the
          // first below the minimum it was given — so on a phone the one
          // remaining track stayed a hard 320px inside a ~292px card and each
          // row ran past the edge. The card clips rather than scrolls, so it
          // did not even show up as page overflow: it just sliced "arrived 1
          // min ago" off at the right, which is what the owner photographed.
          // Above 320px of room the `min()` resolves to 320px and this is the
          // same declaration it always was — the 1440 layout is untouched.
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
          // Wide, and load-bearing rather than decorative: each row's note is
          // right-aligned to its column's edge, so at 1440 the left list's
          // "left Riddlebridge · 26 min ago" ends a few pixels from the right
          // list's heading. The gutter is what separates the two columns —
          // there is no rule drawn in it, because a vertical hairline would
          // cross every row's own hairline and read as a table, implying a
          // row-for-row correspondence between two independently sorted lists.
          columnGap: 48,
          rowGap: 0,
          alignItems: 'start',
        }}
      >
        <BoardList title="On the paths" empty="Nobody is between places.">
          {roaming.map((o, i) => (
            <BoardRow
              key={o.key}
              first={i === 0}
              glyph="footprints"
              name={o.name}
              orgId={o.orgId}
              note={`left ${o.placeName} · ${elapsed(o, now)}`}
            />
          ))}
        </BoardList>

        {/* The waiting room. A group here is through the gate and has not called
            on the chief yet, so the one fact staff want past the name is whether
            they are holding a quest at all: an order badge means the booth has
            bound them and they are walking up the road, and no badge means the
            passage is still to be presented. */}
        <BoardList title="In the village" empty="Nobody is waiting in Queston.">
          {villagers.map((o, i) => (
            <BoardRow
              key={o.key}
              first={i === 0}
              glyph={o.kind === 'party' ? 'users' : 'user'}
              name={o.name}
              orgId={o.orgId}
              trailing={o.orgId ? null : <Badge tone="neutral">No quest yet</Badge>}
              note={`arrived ${elapsed(o, now)}`}
            />
          ))}
        </BoardList>
      </div>

      {openPlace ? (
        <Dialog
          eyebrow="Place"
          title={openPlace.name}
          onClose={() => setOpenPlace(null)}
          footer={
            <Button variant="ghost" onClick={() => setOpenPlace(null)}>
              Close
            </Button>
          }
        >
          {!openPlace.occupancy ? (
            // The reader stands here; the check-in it takes is recorded in the
            // village, and that is where the board shows the party.
            <p className="muted">Arrivals through this gate are shown at the Village of Queston.</p>
          ) : openOccupants.length === 0 ? (
            <p className="muted">Nobody is checked in here right now.</p>
          ) : (
            <div className="stack" style={{ gap: 0 }}>
              {openOccupants.map((o, i) => (
                <div
                  key={o.key}
                  style={{ padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)' }}
                >
                  <div className="row row--between">
                    <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <Icon name={o.kind === 'party' ? 'users' : 'user'} size={15} />
                      <strong style={{ color: 'var(--text-heading)' }}>{o.name}</strong>
                      <OrgBadge orgId={o.orgId} />
                    </span>
                    {o.status === 'village' ? (
                      <span className="muted row" style={{ gap: 5, fontSize: 12, whiteSpace: 'nowrap' }}>
                        <Icon name="castle" size={13} />
                        In the village
                      </span>
                    ) : (
                      <span className="muted row" style={{ gap: 5, fontSize: 12, whiteSpace: 'nowrap' }}>
                        <Icon name="timer" size={13} />
                        {minutesLeft(o, now)} min left
                      </span>
                    )}
                  </div>

                  {questLine(o) ? (
                    <p style={{ marginTop: 6, fontSize: 13, color: 'var(--text-body)' }}>
                      {questLine(o)}
                      {o.episodeTitle ? ` — ${o.episodeTitle}` : ''}
                    </p>
                  ) : null}
                  {o.nextStationName ? (
                    <p className="muted row" style={{ gap: 6, marginTop: 3, fontSize: 12 }}>
                      <Icon name="arrow-right" size={12} />
                      Next: {o.nextStationName}
                    </p>
                  ) : null}

                  {o.kind === 'party' ? (
                    <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                      {o.memberNames.join(', ')}
                    </p>
                  ) : null}
                  <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    Checked in {elapsed(o, now)}
                    {o.byName && o.kind === 'party' ? ` by ${o.byName}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* No reader, nothing to report on. The village square is a place
              guests stand, not a box on a post. */}
          {openPlace.stationNo === undefined ? null : (
            <HealthBlock health={openHealth} condition={openCondition} parkVersion={parkVersion} now={now} />
          )}
        </Dialog>
      ) : null}
    </Card>
  )
}

/**
 * One of the two columns of roster under the chart. Both answer the same shape
 * of question — "who is in this state, and how long have they been in it" — so
 * they are one component; a second hand-rolled heading would drift from the
 * first the next time either is touched.
 *
 * It owns its own element rather than returning a fragment, because it is a
 * column: a fragment's heading and rows would be laid out as separate grid
 * items and the two lists would interleave.
 */
function BoardList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return (
    <section style={{ minWidth: 0 }}>
      <h3
        style={{
          margin: '18px 0 8px',
          font: '600 var(--text-sm)/1.2 var(--font-display)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-display)',
          color: 'var(--text-heading)',
        }}
      >
        {title}
      </h3>
      {Children.count(children) === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {children}
        </div>
      )}
    </section>
  )
}

function BoardRow({
  first,
  glyph,
  name,
  orgId,
  trailing,
  note,
}: {
  /** The top row wears no rule — the heading above it already is one. */
  first: boolean
  glyph: string
  name: string
  orgId?: string
  /** Shown in place of the order badge when there is no order to name. */
  trailing?: ReactNode
  note: string
}) {
  return (
    <div
      className="row row--between"
      style={{ padding: '10px 0', gap: 10, borderTop: first ? 'none' : '1px solid var(--border-hairline)' }}
    >
      <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Icon name={glyph} size={14} />
        <strong style={{ color: 'var(--text-heading)' }}>{name}</strong>
        <OrgBadge orgId={orgId} />
        {trailing}
      </span>
      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {note}
      </span>
    </div>
  )
}

function OrgBadge({ orgId }: { orgId?: string }) {
  const org = orgId ? getOrg(orgId) : undefined
  if (!org) return null
  return <Badge tone={org.track}>{org.name}</Badge>
}

/**
 * The reader at this place, in full. Everything here comes from one heartbeat
 * frame except the park's table version, which comes from the rack.
 */
function HealthBlock({
  health,
  condition,
  parkVersion,
  now,
}: {
  health: StationHealth | undefined
  condition: StationCondition
  parkVersion: number
  now: number
}) {
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border-hairline)' }}>
      <div className="row row--between" style={{ marginBottom: 10, gap: 12 }}>
        <h4
          style={{
            margin: 0,
            font: '600 var(--text-sm)/1.2 var(--font-display)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-display)',
            color: 'var(--text-heading)',
          }}
        >
          The reader
        </h4>
        <Badge tone={CONDITION_TONE[condition]} icon={CONDITION_GLYPH[condition]}>
          {CONDITION_LABEL[condition]}
        </Badge>
      </div>

      <p className="muted" style={{ fontSize: 12, fontFamily: 'var(--font-ui)', marginBottom: 8 }}>
        {CONDITION_NOTE[condition]}
      </p>

      {!health ? null : (
        <div className="stack" style={{ gap: 0, fontFamily: 'var(--font-ui)' }}>
          <Reading label="Heartbeat" value={`${ago(health.lastHeartbeatAt, now)} · ${clock(health.lastHeartbeatAt)}`} />
          <Reading
            label="Flag table synced"
            value={
              health.lastTableSyncAt
                ? `${ago(health.lastTableSyncAt, now)} · ${clock(health.lastTableSyncAt)}`
                : // Two different absences, and they are not the same fact: a
                  // station holding no table has never committed one, while a
                  // station holding one whose age we refused is a counter we do
                  // not believe. Neither is a time.
                  health.tableVersion
                  ? 'Not reported'
                  : 'Never'
            }
          />
          <Reading label="Version held" value={tableLine(health, parkVersion)} alarm={condition === 'stale'} />
          <Reading label="Unsent taps" value={String(health.queueDepth)} alarm={health.queueDepth > 0} />
          <Reading label="SD card" value={health.sdOk ? 'OK' : 'Not answering'} alarm={!health.sdOk} />
          <Reading label="Audio player" value={health.playerOk ? 'OK' : 'Not answering'} alarm={!health.playerOk} />
          {/* THE THIRD FAULT CAUSE, AND IT SITS WITH THE OTHER TWO. These three
              lines are the whole of what an ember fault ring can mean, and the
              dialog is the only place a Warden can tell "the card is dead" from
              "the board is throwing 5s" — the difference between a spare SD in
              a pocket and a reflash. Left at the foot of the block, four
              unchanging readings below Volume and Firmware, it reads as trivia
              and gets scrolled past on exactly the plinth somebody was sent
              out to fix. */}
          {health.lastError ? <Reading label="Reported fault" value={health.lastError} alarm /> : null}
          <Reading label="Signal" value={`${health.rssi} dBm`} />
          <Reading label="Volume" value={`${health.volume} of 30`} />
          <Reading label="Uptime" value={duration(health.uptimeS)} />
          <Reading label="Firmware" value={`build ${health.fwBuild}`} />
        </div>
      )}
    </div>
  )
}

function Reading({ label, value, alarm = false }: { label: string; value: string; alarm?: boolean }) {
  return (
    <div
      className="row row--between"
      style={{ gap: 16, padding: '6px 0', borderTop: '1px solid var(--border-hairline)' }}
    >
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, textAlign: 'right', color: alarm ? 'var(--ember-300)' : 'var(--text-body)' }}>
        {value}
      </span>
    </div>
  )
}

interface RingSpec {
  border: string
  mark: string | null
  /** The corner mark's own colours — ember for a live thing wanting a hand, locked for a place we have lost. */
  markColor: string
  markBorder: string
}

const RING: Record<StationCondition, RingSpec> = {
  live: { border: '1px solid var(--gold-700)', mark: null, markColor: '', markBorder: '' },
  stale: {
    border: '1px solid var(--ember-500)',
    mark: 'refresh-cw',
    markColor: 'var(--ember-300)',
    markBorder: '1px solid var(--ember-700)',
  },
  fault: {
    border: '1px solid var(--ember-500)',
    mark: 'triangle-alert',
    markColor: 'var(--ember-300)',
    markBorder: '1px solid var(--ember-700)',
  },
  // Dashed hairline, full shape, no fade — the system's absent treatment.
  //
  // It carries a mark as well, and it is the one deviation from the ring recipe
  // worth making: the chart is drawn to FIT the panel, and at that scale a 1px
  // dash on a 24px ring is sub-pixel — a dead plinth was indistinguishable from
  // a well one until you zoomed in, which is the exact failure this board is
  // built to prevent. The mark keeps the absent palette rather than borrowing
  // ember, because a station we have lost is not a live thing wanting a hand.
  silent: {
    border: '1px dashed var(--stone-600)',
    mark: 'wifi-off',
    markColor: 'var(--status-locked)',
    markBorder: '1px dashed var(--stone-600)',
  },
  unknown: { border: '1px solid var(--border-hairline)', mark: null, markColor: '', markBorder: '' },
}

/** A mark with no reader behind it. Plain hairline: nothing is being claimed. */
const NO_READER_RING: RingSpec = {
  border: '1px solid var(--border-hairline)',
  mark: null,
  markColor: '',
  markBorder: '',
}

/**
 * An occupied place wears a filled gold marker with a head count; an empty one
 * stays a hairline glyph, so a glance at the chart reads as "where everyone is".
 * Places are the 21 stations, the village square, the chief's house and the
 * entrance — the last two of those carry only one of the two readings each.
 *
 * The ring is the second reading: the condition of the reader standing there.
 * It never touches the glyph colour or the head count, because a Warden has to
 * be able to see a full station on a stale plinth — that combination is the
 * whole reason this board exists.
 */
function PlacePin({
  label,
  glyph,
  coord,
  occupancy,
  occupants,
  condition,
  onOpen,
}: {
  label: string
  glyph: string
  coord: { x: number; y: number }
  /** Whether guests can stand here at all — false for the gate reader. */
  occupancy: boolean
  occupants: Occupant[]
  /** Null where there is no reader: the village square is a place, not a plinth. */
  condition: StationCondition | null
  onOpen: () => void
}) {
  const busy = occupants.length > 0
  const heads = occupants.reduce((n, o) => n + Math.max(1, o.memberNames.length), 0)
  const ring = condition ? RING[condition] : NO_READER_RING
  // A plinth wanting attention is never the faint one on the chart, empty or not.
  const attention = condition === 'stale' || condition === 'fault' || condition === 'silent'

  const occupancyPhrase = occupancy ? (busy ? `${occupants.length} checked in` : 'nobody checked in') : null
  const readerPhrase = condition ? `reader ${CONDITION_LABEL[condition]}` : null
  const detail = [occupancy ? (busy ? `${occupants.length} here` : 'empty') : null, condition ? CONDITION_NOTE[condition] : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      onClick={onOpen}
      title={detail ? `${label} — ${detail}` : label}
      aria-label={[label, occupancyPhrase, readerPhrase].filter(Boolean).join(', ')}
      style={{
        position: 'absolute',
        left: `${coord.x * 100}%`,
        top: `${coord.y * 100}%`,
        transform: 'translate(-50%, -100%)',
        display: 'block',
        padding: 4,
        lineHeight: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: busy ? 'var(--gold-300)' : 'var(--text-muted)',
        opacity: busy || attention ? 1 : 0.55,
        filter: busy ? 'drop-shadow(0 1px 3px rgba(0,0,0,.7))' : undefined,
      }}
    >
      <span style={{ position: 'relative', display: 'block' }}>
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: busy ? 32 : 24,
            height: busy ? 32 : 24,
            borderRadius: 'var(--radius-pill)',
            border: ring.border,
            background: 'var(--surface-overlay)',
          }}
        >
          <Icon name={busy ? 'map-pinned' : glyph} size={busy ? 20 : 14} />
        </span>
        {busy ? (
          <span
            style={{
              position: 'absolute',
              top: -7,
              right: -9,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: 'var(--gold-500)',
              color: 'var(--stone-950)',
              font: '700 10px/16px var(--font-ui)',
              textAlign: 'center',
            }}
          >
            {heads}
          </span>
        ) : null}
        {ring.mark ? (
          <span
            style={{
              position: 'absolute',
              bottom: -6,
              right: -7,
              display: 'grid',
              placeItems: 'center',
              width: 16,
              height: 16,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--stone-950)',
              border: ring.markBorder,
              color: ring.markColor,
            }}
          >
            <Icon name={ring.mark} size={10} />
          </span>
        ) : null}
      </span>
    </button>
  )
}
