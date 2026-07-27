import { useState } from 'react'

import { currentUser } from '../services/authService'
import { load } from '../services/store'
import { getOrg } from '../content/orgs'
import { episodesFor } from '../content/quests'
import { STATIONS, stationsFor } from '../content/stations'
import type { Station } from '../content/types'
import type { Presence } from '../types'
import { completedCount, creditOrgFor, currentEpisode, stationsDone } from '../services/progressService'
import {
  activeQuest,
  checkIn,
  checkInAtGate,
  hasArrived,
  presenceFor,
  statusOf,
  windowLeft,
} from '../services/presenceService'
import { DEFAULT_POSITION, MAP_LANDMARKS, QUEST_START, STATION_COORDS } from '../content/stationMap'
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

  // ---- the live pair ----
  //
  // While a quest is under way the chart lights exactly two stations: gold for
  // where the party is standing, white for where they are walking to.
  const quest = user ? activeQuest(user.id) : null

  function liveMarkerFor(stationId: string): 'here' | 'next' | null {
    if (!quest) return null
    if (quest.atStationId === stationId) return 'here'
    if (quest.nextStationId === stationId) return 'next'
    return null
  }

  // ---- where you are ----
  //
  // A check-in holds you in place — fifteen minutes at a station, five at the
  // chief's house — and after that you read as en route. The village holds you
  // until you take a quest.
  const here = user ? presenceFor(user.id) : null
  const arrived = user ? hasArrived(user.id) : false
  const standing = here && statusOf(here) !== 'en-route' ? here : null
  const hereCoord = standing
    ? standing.kind === 'village'
      ? DEFAULT_POSITION
      : standing.stationId === QUEST_START.id
        ? QUEST_START
        : STATION_COORDS[standing.stationId]
    : undefined
  const herePos = hereCoord ?? load('ql:demo:position', DEFAULT_POSITION)

  // ---- dialogs ----
  const [openStation, setOpenStation] = useState<Station | null>(null)
  const [openLandmark, setOpenLandmark] = useState<MapLandmark | null>(null)
  const [startOpen, setStartOpen] = useState(false)

  function announce(outcome: ReturnType<typeof checkIn>) {
    if (!outcome) return
    show({
      title: `Checked in — ${outcome.placeName}`,
      body: outcome.carried.length
        ? `${outcome.partyName} checked in with you.`
        : outcome.kind === 'start'
          ? 'Five minutes at the chief’s house, then the trail.'
          : outcome.kind === 'village'
            ? 'Welcome to the Village of Queston.'
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
    } else if (outcome.walk.nextStationName) {
      show({ title: `Next — ${outcome.walk.nextStationName}`, icon: 'footprints' })
    }
  }

  function handleCheckIn() {
    if (!openStation || !user) return
    const outcome = checkIn(user.id, openStation.id)
    setOpenStation(null)
    announce(outcome)
  }

  function handleQuestStart() {
    if (!user) return
    const outcome = checkIn(user.id, QUEST_START.id)
    setStartOpen(false)
    announce(outcome)
  }

  function handleGateCheckIn() {
    if (!user) return
    const outcome = checkInAtGate(user.id)
    setOpenLandmark(null)
    announce(outcome)
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
      {/* contain, not cover: the chart is far wider than a phone column, so
          fitting it whole and centring it beats pinning a band to the top with
          dead space underneath. Pinch to zoom into a station from there. */}
      <MapCanvas fit="contain">
        {MAP_LANDMARKS.map((lm) => (
          <AmenityPin key={lm.id} landmark={lm} onOpen={() => setOpenLandmark(lm)} />
        ))}

        <QuestStartPin onOpen={() => setStartOpen(true)} />

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
              live={liveMarkerFor(st.id)}
              trackColor={org?.color}
              onOpen={() => setOpenStation(st)}
            />
          )
        })}

        <HereMarker x={herePos.x} y={herePos.y} />
      </MapCanvas>

      {org ? <MapLegend trackColor={org.color} walking={!!quest} /> : null}

      {openStation ? (
        <StationCard
          station={openStation}
          onClose={() => setOpenStation(null)}
          onCheckIn={handleCheckIn}
          here={standing?.stationId === openStation.id ? standing : null}
          sealed={sealedIds.has(openStation.id)}
          checkable={!!quest && quest.nextStationId === openStation.id}
          questStarted={!!quest}
          nextName={quest?.nextStationName}
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
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setOpenLandmark(null)}>
                Close
              </Button>
              {openLandmark.id === 'gate' ? (
                <Button icon="door-open" onClick={handleGateCheckIn}>
                  {arrived ? 'Check in again' : 'We have arrived'}
                </Button>
              ) : null}
            </div>
          }
        >
          <p style={{ font: 'var(--body-base)', color: 'var(--text-muted)' }}>{openLandmark.blurb}</p>
          {openLandmark.id === 'gate' ? (
            <p style={{ marginTop: 8, font: 'var(--body-sm)', color: 'var(--text-muted)' }}>
              {arrived
                ? 'You are on the roll for today. The Wardens can see your party in the park.'
                : 'Check in as you pass the gate — a Guide will walk you through it. Your whole party is checked in with you.'}
            </p>
          ) : null}
        </Dialog>
      ) : null}

      {startOpen ? (
        <Dialog
          eyebrow="Village of Queston"
          title={QUEST_START.name}
          onClose={() => setStartOpen(false)}
          footer={
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setStartOpen(false)}>
                Close
              </Button>
              <Button icon="scroll-text" onClick={handleQuestStart}>
                Take the quest
              </Button>
            </div>
          }
        >
          <p style={{ font: 'var(--body-base)', color: 'var(--text-muted)' }}>{QUEST_START.blurb}</p>
          {ep ? (
            <p style={{ marginTop: 8, font: 'var(--body-sm)', color: 'var(--text-muted)' }}>
              {org?.name} — Episode {ep.number}, {ep.title}. First station:{' '}
              {stationsFor(ep.id).find((s) => !sealedIds.has(s.id))?.name ?? '—'}.
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  )
}

/** The chief's house — every quest starts here, so it gets its own mark. */
function QuestStartPin({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label={`${QUEST_START.name} — take the quest`}
      style={{
        position: 'absolute',
        left: `${QUEST_START.x * 100}%`,
        top: `${QUEST_START.y * 100}%`,
        transform: 'translate(-50%, -100%)',
        display: 'block',
        padding: 4,
        lineHeight: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--gold-300)',
        filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.75))',
      }}
    >
      <Icon name="house" size={22} />
    </button>
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
  checkable,
  questStarted,
  nextName,
  episodeTitle,
  progress,
}: {
  station: Station
  onClose: () => void
  onCheckIn: () => void
  /** Set when this is where the guest is standing right now. */
  here: Presence | null
  sealed: boolean
  /** True only for the next station on the rotation — the one seal that is open. */
  checkable: boolean
  questStarted: boolean
  nextName?: string
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
          ) : null}

          {/* A seal is only ever open at the station you are due at next. */}
          {!checkable && !sealed ? (
            <p
              className="row"
              style={{ gap: 6, margin: 0, font: 'var(--body-sm)', color: 'var(--text-on-media-muted)' }}
            >
              <Icon name="lock" size={14} />
              {!questStarted
                ? 'Take the quest at the Chief’s House first.'
                : nextName
                  ? `Not your next station — you are due at ${nextName}.`
                  : 'Not on your current episode.'}
            </p>
          ) : null}

          <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {checkable ? (
              <Button icon="stamp" onClick={onCheckIn}>
                Check in here
              </Button>
            ) : null}
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
  live,
  trackColor,
  onOpen,
}: {
  station: Station
  coord: { x: number; y: number }
  variant: PinVariant
  isHome: boolean
  /** Already checked in on the current episode. */
  sealed: boolean
  /** Gold for where the party stands, white for where it is headed. */
  live: 'here' | 'next' | null
  trackColor?: string
  onOpen: () => void
}) {
  const spec = PIN_SPEC[variant]
  const ringColor = variant === 'active' && trackColor ? trackColor : spec.color
  const liveColor = live === 'here' ? 'var(--gold-300)' : '#fff'
  const liveLabel = live === 'here' ? ', you are here' : live === 'next' ? ', next station' : ''
  return (
    <button
      onClick={onOpen}
      aria-label={`${station.name} — ${station.type} station${sealed ? ', sealed' : ''}${liveLabel}`}
      className={live ? (live === 'here' ? 'qa-pin-here' : 'qa-pin-next') : undefined}
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
        color: live ? liveColor : ringColor,
        opacity: live ? 1 : spec.opacity,
        filter: live || variant !== 'active' ? undefined : 'drop-shadow(0 1px 2px rgba(0,0,0,.6))',
        zIndex: live ? 2 : undefined,
      }}
    >
      <span style={{ position: 'relative', display: 'block' }}>
        <Icon name={sealed && !live ? 'map-pin-check' : 'map-pin'} size={live ? spec.size + 8 : spec.size} />
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

function MapLegend({ trackColor, walking }: { trackColor: string; walking: boolean }) {
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
      {walking ? (
        <>
          <LegendDot color="var(--gold-300)" label="You are here" />
          <LegendDot color="#fff" label="Next" />
        </>
      ) : null}
      <LegendDot color={trackColor} label="Episode" />
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
