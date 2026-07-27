// The park board: the same chart the guests carry, with parties on it.
//
// A pin shows how many parties are standing at that station right now; tapping
// one names them. Fifteen minutes after a check-in a party stops being at the
// station and joins the en-route list below the chart — we do not track precise
// locations, so "somewhere on the paths" is the whole of what we claim.

import { useEffect, useState } from 'react'
import MapCanvas from '../../components/MapCanvas'
import { DEFAULT_POSITION, MAP_LANDMARKS, QUEST_START, STATION_COORDS, VILLAGE_PLACE } from '../../content/stationMap'
import { STATIONS } from '../../content/stations'
import type { Station } from '../../content/types'
import { getOrg } from '../../content/orgs'
import { START_WINDOW_MS, STATION_WINDOW_MS, enRoute, occupantsByPlace } from '../../services/presenceService'
import type { Occupant } from '../../services/presenceService'
import { Badge, Button, Card, Dialog, Icon } from '../../ui'
import { STATION_ICON } from '../questIcons'
import { questLine } from './GuestsAfield'

function minutesLeft(o: Occupant, now: number): number {
  const window = o.placeKind === 'start' ? START_WINDOW_MS : STATION_WINDOW_MS
  return Math.max(0, Math.ceil((o.since + window - now) / 60000))
}

function elapsed(o: Occupant, now: number): string {
  const mins = Math.floor((now - o.since) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m ago`
}

export default function StationsBoard() {
  // Display-only tick: the whole board is time-derived, so it must re-read on
  // its own even when nobody checks in.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10000)
    return () => window.clearInterval(t)
  }, [])

  // A place is a station, the chief's house, or the village itself.
  const [openPlace, setOpenPlace] = useState<{ id: string; name: string } | null>(null)

  const byPlace = occupantsByPlace(now)
  const roaming = enRoute(now)
  const atStations = Object.values(byPlace).reduce((n, list) => n + list.length, 0)

  const openOccupants = openPlace ? (byPlace[openPlace.id] ?? []) : []

  return (
    <Card
      eyebrow="Live"
      title="The Park"
      style={{ gridColumn: '1 / -1' }}
    >
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="row muted" style={{ gap: 6, fontSize: 13 }}>
          <Icon name="map-pin" size={14} />
          {atStations} checked in
        </span>
        <span className="row muted" style={{ gap: 6, fontSize: 13 }}>
          <Icon name="footprints" size={14} />
          {roaming.length} en route
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
          {MAP_LANDMARKS.map((lm) => (
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

          {/* The village and the chief's house are places a party can be
              standing too — the gate check-in lands in one, every quest starts
              in the other. */}
          <PlacePin
            label={VILLAGE_PLACE.name}
            glyph="castle"
            coord={DEFAULT_POSITION}
            occupants={byPlace[VILLAGE_PLACE.id] ?? []}
            onOpen={() => setOpenPlace({ id: VILLAGE_PLACE.id, name: VILLAGE_PLACE.name })}
          />
          <PlacePin
            label={QUEST_START.name}
            glyph="house"
            coord={QUEST_START}
            occupants={byPlace[QUEST_START.id] ?? []}
            onOpen={() => setOpenPlace({ id: QUEST_START.id, name: QUEST_START.name })}
          />

          {STATIONS.map((st) => {
            const coord = STATION_COORDS[st.id]
            if (!coord) return null
            return (
              <PlacePin
                key={st.id}
                label={st.name}
                glyph={STATION_ICON[st.type] ?? 'map-pin'}
                coord={coord}
                occupants={byPlace[st.id] ?? []}
                onOpen={() => setOpenPlace({ id: st.id, name: st.name })}
              />
            )
          })}
        </MapCanvas>
      </div>

      <h3
        style={{
          margin: '18px 0 8px',
          font: '600 var(--text-sm)/1.2 var(--font-display)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-display)',
          color: 'var(--text-heading)',
        }}
      >
        On the paths
      </h3>
      {roaming.length === 0 ? (
        <p className="muted">Nobody is between places.</p>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {roaming.map((o, i) => (
            <div
              key={o.key}
              className="row row--between"
              style={{ padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)' }}
            >
              <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Icon name="footprints" size={14} />
                <strong style={{ color: 'var(--text-heading)' }}>{o.name}</strong>
                <OrgBadge orgId={o.orgId} />
              </span>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                left {o.placeName} · {elapsed(o, now)}
              </span>
            </div>
          ))}
        </div>
      )}

      {openPlace ? (
        <Dialog
          eyebrow="Who is here"
          title={openPlace.name}
          onClose={() => setOpenPlace(null)}
          footer={
            <Button variant="ghost" onClick={() => setOpenPlace(null)}>
              Close
            </Button>
          }
        >
          {openOccupants.length === 0 ? (
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
        </Dialog>
      ) : null}
    </Card>
  )
}

function OrgBadge({ orgId }: { orgId?: string }) {
  const org = orgId ? getOrg(orgId) : undefined
  if (!org) return null
  return <Badge tone={org.track}>{org.name}</Badge>
}

/**
 * An occupied place wears a filled gold marker with a head count; an empty one
 * stays a hairline glyph, so a glance at the chart reads as "where everyone is".
 * Places are the 21 stations plus the village and the chief's house.
 */
function PlacePin({
  label,
  glyph,
  coord,
  occupants,
  onOpen,
}: {
  label: string
  glyph: string
  coord: { x: number; y: number }
  occupants: Occupant[]
  onOpen: () => void
}) {
  const busy = occupants.length > 0
  const heads = occupants.reduce((n, o) => n + Math.max(1, o.memberNames.length), 0)

  return (
    <button
      onClick={onOpen}
      title={`${label} — ${busy ? `${occupants.length} here` : 'empty'}`}
      aria-label={`${label}, ${busy ? `${occupants.length} checked in` : 'nobody checked in'}`}
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
        opacity: busy ? 1 : 0.55,
        filter: busy ? 'drop-shadow(0 1px 3px rgba(0,0,0,.7))' : undefined,
      }}
    >
      <span style={{ position: 'relative', display: 'block' }}>
        <Icon name={busy ? 'map-pinned' : glyph} size={busy ? 24 : 15} />
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
      </span>
    </button>
  )
}
