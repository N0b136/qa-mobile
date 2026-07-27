import { useState } from 'react'

import { currentUser } from '../services/authService'
import { load } from '../services/store'
import { getOrg } from '../content/orgs'
import { episodesFor } from '../content/quests'
import { STATIONS, stationsFor } from '../content/stations'
import type { Station } from '../content/types'
import type { Presence } from '../types'
import { completedCount, creditOrgFor, currentEpisode, stationsDone } from '../services/progressService'
import { checkIn, presenceFor, statusOf, windowLeft } from '../services/presenceService'
import { DEFAULT_POSITION, MAP_LANDMARKS, STATION_COORDS } from '../content/stationMap'
import type { MapLandmark } from '../content/stationMap'
import { useAppTick } from '../hooks/useAppTick'
import { useToast } from '../components/Toast'
import MapCanvas from '../components/MapCanvas'
import { Button, Dialog, Icon, IconButton, Tag } from '../ui'
import { STATION_ICON, STATION_NOTE } from './questIcons'

type PinVariant = 'active' | 'home' | 'visited' | 'neutral'

export default function MapScreen() {
  useAppTick()
  const { show } = useToast()
  const user = currentUser()
  const org = user?.orgId ? getOrg(user.orgId) : undefined

  // ---- progression lenses ----
  const ep = user && org ? currentEpisode(user.id, org.id) : null
  const activeIds = new Set((ep ? stationsFor(ep.id) : []).map((s) => s.id))
  const homeId = org?.homeZoneId
  const visitedIds = new Set<string>()
  if (user && org) {
    const done = completedCount(user.id, org.id)
    episodesFor(org.id)
      .slice(0, done)
      .forEach((e) => stationsFor(e.id).forEach((s) => visitedIds.add(s.id)))
  }

  // Stations of the current episode already walked — the pin wears a seal.
  const sealedIds = new Set(user && ep ? stationsDone(user.id, ep.id) : [])

  /** The episode a check-in here would count toward (base stations keep their own order). */
  function creditEpisodeFor(st: Station) {
    if (!user) return null
    const orgId = creditOrgFor(st.id, user.orgId)
    return orgId ? currentEpisode(user.id, orgId) : null
  }

  /** "3 of 7" for a station on your current rotation, null for one that is not. */
  function progressLine(st: Station): { done: number; total: number } | null {
    const episode = creditEpisodeFor(st)
    if (!episode || !user) return null
    const rotation = stationsFor(episode.id).map((s) => s.id)
    if (!rotation.includes(st.id)) return null
    return { done: stationsDone(user.id, episode.id).length, total: rotation.length }
  }

  // ---- where you are ----
  //
  // A check-in holds you at a station for fifteen minutes; after that you read
  // as en route and the marker falls back to the demo position.
  const here = user ? presenceFor(user.id) : null
  const atStation = here && statusOf(here) === 'at-station' ? here : null
  const hereCoord = atStation ? STATION_COORDS[atStation.stationId] : undefined
  const herePos = hereCoord ?? load('ql:demo:position', DEFAULT_POSITION)

  // ---- dialogs ----
  const [openStation, setOpenStation] = useState<Station | null>(null)
  const [openLandmark, setOpenLandmark] = useState<MapLandmark | null>(null)

  function handleCheckIn() {
    if (!openStation || !user) return
    const outcome = checkIn(user.id, openStation.id)
    setOpenStation(null)
    if (!outcome) return

    show({
      title: `Checked in — ${outcome.station.name}`,
      body: outcome.carried.length
        ? `${outcome.partyName} checked in with you.`
        : 'Fifteen minutes at this station.',
      icon: 'stamp',
    })

    const credit = outcome.credit
    if (credit?.completion?.ok) {
      show({ title: `${credit.completion.episode.title} — sealed`, icon: 'scroll-text' })
      if (credit.completion.rankUp) {
        show({ title: `New rank — ${credit.completion.rankUp.name}`, icon: 'award' })
      }
    } else if (credit && !credit.repeat) {
      show({
        title: `${credit.done} of ${credit.total} stations`,
        body: credit.episode.title,
        icon: 'map-pin',
      })
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(var(--install-banner-height) + var(--topbar-height))',
        bottom: 'calc(var(--nav-height) + var(--safe-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        overflow: 'hidden',
        background: 'var(--surface-page)',
      }}
    >
      <MapCanvas>
        {MAP_LANDMARKS.map((lm) => (
          <AmenityPin key={lm.id} landmark={lm} onOpen={() => setOpenLandmark(lm)} />
        ))}

        {STATIONS.map((st) => {
          const coord = STATION_COORDS[st.id]
          if (!coord) return null
          const variant: PinVariant = activeIds.has(st.id)
            ? 'active'
            : st.id === homeId
              ? 'home'
              : visitedIds.has(st.id)
                ? 'visited'
                : 'neutral'
          return (
            <StationPin
              key={st.id}
              station={st}
              coord={coord}
              variant={variant}
              isHome={st.id === homeId}
              sealed={sealedIds.has(st.id)}
              trackColor={org?.color}
              onOpen={() => setOpenStation(st)}
            />
          )
        })}

        <HereMarker x={herePos.x} y={herePos.y} />
      </MapCanvas>

      {org ? <MapLegend trackColor={org.color} /> : null}

      {openStation ? (
        <StationCard
          station={openStation}
          onClose={() => setOpenStation(null)}
          onCheckIn={handleCheckIn}
          here={atStation?.stationId === openStation.id ? atStation : null}
          sealed={sealedIds.has(openStation.id)}
          episodeTitle={creditEpisodeFor(openStation)?.title}
          progress={progressLine(openStation)}
        />
      ) : null}

      {openLandmark ? (
        <Dialog
          eyebrow="Waypoint"
          title={openLandmark.label}
          onClose={() => setOpenLandmark(null)}
          footer={
            <Button variant="ghost" onClick={() => setOpenLandmark(null)}>
              Close
            </Button>
          }
        >
          <p style={{ font: 'var(--body-base)', color: 'var(--text-muted)' }}>{openLandmark.blurb}</p>
        </Dialog>
      ) : null}
    </div>
  )
}

/**
 * Photographic station popup: the station image is the full-bleed card
 * background, a `--scrim-bottom` protection scrim rides over it, and the text
 * sits bottom-left in on-media colours. Missing images leave the stone base.
 */
function StationCard({
  station,
  onClose,
  onCheckIn,
  here,
  sealed,
  episodeTitle,
  progress,
}: {
  station: Station
  onClose: () => void
  onCheckIn: () => void
  /** Set when this is where the guest is standing right now. */
  here: Presence | null
  sealed: boolean
  episodeTitle?: string
  progress: { done: number; total: number } | null
}) {
  const minutesLeft = here ? Math.max(1, Math.ceil(windowLeft(here) / 60000)) : 0
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-lg)',
        background: 'var(--surface-overlay)',
        backdropFilter: 'var(--blur-veil)',
        WebkitBackdropFilter: 'var(--blur-veil)',
        animation: 'qa-fade var(--dur-base) var(--ease-standard)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={station.name}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 420,
          minHeight: 320,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--border-strong)',
          background: 'var(--surface-card)',
          boxShadow: 'var(--shadow-lg)',
          animation: 'qa-rise var(--dur-slow) var(--ease-out-door)',
        }}
      >
        <img
          src={`${import.meta.env.BASE_URL}assets/stations/${station.id}.webp`}
          alt={station.name}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'var(--scrim-bottom)', pointerEvents: 'none' }} />

        <div style={{ position: 'absolute', top: 'var(--space-sm)', right: 'var(--space-sm)', zIndex: 1 }}>
          <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
        </div>

        <div
          style={{
            position: 'relative',
            padding: 'var(--space-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-xs)',
          }}
        >
          <div className="qa-label" style={{ color: 'var(--text-on-media-muted)' }}>
            Station
          </div>
          <h2
            style={{
              margin: 0,
              font: '700 var(--text-2xl)/var(--leading-snug) var(--font-display)',
              letterSpacing: 'var(--tracking-display-tight)',
              textTransform: 'uppercase',
              color: 'var(--text-on-media)',
            }}
          >
            {station.name}
          </h2>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Tag icon={STATION_ICON[station.type] ?? 'map-pin'}>{station.type}</Tag>
            {sealed ? <Tag icon="stamp">Sealed</Tag> : null}
          </div>
          <p style={{ margin: 0, font: 'var(--body-base)', color: 'var(--text-on-media-muted)' }}>
            {STATION_NOTE[station.type] ?? 'A station on the trail.'}
          </p>

          {here ? (
            <p
              className="row"
              style={{ gap: 6, margin: 0, font: 'var(--body-base)', color: 'var(--text-on-media)' }}
            >
              <Icon name="timer" size={15} />
              {here.partyName ? `${here.partyName} is here` : 'You are here'} — {minutesLeft} min left
            </p>
          ) : null}

          {progress ? (
            <p style={{ margin: 0, font: 'var(--body-sm)', color: 'var(--text-on-media-muted)' }}>
              {progress.done} of {progress.total} stations
              {episodeTitle ? ` — ${episodeTitle}` : ''}
            </p>
          ) : (
            <p style={{ margin: 0, font: 'var(--body-sm)', color: 'var(--text-on-media-muted)' }}>
              Not on your current episode — checking in only marks where you are.
            </p>
          )}

          <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button icon="stamp" onClick={onCheckIn}>
              {here ? 'Check in again' : 'Check in here'}
            </Button>
          </div>
        </div>
      </div>
      <style>{'@keyframes qa-fade{from{opacity:0}to{opacity:1}}@keyframes qa-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'}</style>
    </div>
  )
}

const PIN_SPEC: Record<PinVariant, { size: number; color: string; opacity: number }> = {
  neutral: { size: 16, color: 'var(--text-muted)', opacity: 0.6 },
  visited: { size: 16, color: 'var(--gold-600)', opacity: 0.8 },
  home: { size: 18, color: 'var(--gold-400)', opacity: 0.8 },
  active: { size: 22, color: 'var(--gold-300)', opacity: 0.95 },
}

function StationPin({
  station,
  coord,
  variant,
  isHome,
  sealed,
  trackColor,
  onOpen,
}: {
  station: Station
  coord: { x: number; y: number }
  variant: PinVariant
  isHome: boolean
  /** Already checked in on the current episode. */
  sealed: boolean
  trackColor?: string
  onOpen: () => void
}) {
  const spec = PIN_SPEC[variant]
  const ringColor = variant === 'active' && trackColor ? trackColor : spec.color
  return (
    <button
      onClick={onOpen}
      aria-label={`${station.name} — ${station.type} station${sealed ? ', sealed' : ''}`}
      style={{
        position: 'absolute',
        left: `${coord.x * 100}%`,
        top: `${coord.y * 100}%`,
        transform: 'translate(-50%, -100%)',
        display: 'block',
        padding: 6,
        lineHeight: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: ringColor,
        opacity: spec.opacity,
        filter: variant === 'active' ? 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' : undefined,
      }}
    >
      <span style={{ position: 'relative', display: 'block' }}>
        <Icon name={sealed ? 'map-pin-check' : 'map-pin'} size={spec.size} />
        {isHome ? (
          <span
            style={{
              position: 'absolute',
              top: '18%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: 'currentColor',
            }}
          />
        ) : null}
      </span>
    </button>
  )
}

function AmenityPin({ landmark, onOpen }: { landmark: MapLandmark; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label={landmark.label}
      style={{
        position: 'absolute',
        left: `${landmark.x * 100}%`,
        top: `${landmark.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        display: 'block',
        padding: 6,
        lineHeight: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text-muted)',
        opacity: 0.5,
      }}
    >
      <Icon name={landmark.icon} size={13} />
    </button>
  )
}

function HereMarker({ x, y }: { x: number; y: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: 'translate(-50%, -50%)',
        width: 0,
        height: 0,
        pointerEvents: 'none',
      }}
      role="img"
      aria-label="You are here"
    >
      <span
        style={{
          position: 'absolute',
          left: -14,
          top: -14,
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '2px solid var(--gold-400)',
          animation: 'qa-here-pulse var(--dur-ambient) var(--ease-lantern) infinite',
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: -6,
          top: -6,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: 'var(--gold-500)',
          boxShadow: '0 0 0 2px var(--stone-950), var(--shadow-gold-glow)',
        }}
      />
      <style>{'@keyframes qa-here-pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.6);opacity:.15}}'}</style>
    </div>
  )
}

function MapLegend({ trackColor }: { trackColor: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 16,
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '6px 10px',
        borderRadius: 'var(--radius-sm)',
        background: 'rgba(18,18,20,.78)',
        border: '1px solid var(--border-hairline)',
        font: '700 9px/1 var(--font-ui)',
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}
    >
      <LegendDot color={trackColor} label="Active" />
      <LegendDot color="var(--gold-500)" label="Home" />
      <LegendDot color="var(--gold-700)" label="Visited" />
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {label}
    </span>
  )
}
