import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { currentUser } from '../services/authService'
import { load } from '../services/store'
import { getOrg } from '../content/orgs'
import { episodesFor } from '../content/quests'
import { STATIONS, stationsFor } from '../content/stations'
import type { Station } from '../content/types'
import { currentEpisode, completedCount } from '../services/progressService'
import { DEFAULT_POSITION, MAP_LANDMARKS, MAP_META, STATION_COORDS } from '../content/stationMap'
import type { MapLandmark } from '../content/stationMap'
import { useAppTick } from '../hooks/useAppTick'
import { Button, Dialog, Icon, IconButton, Tag } from '../ui'
import { STATION_ICON, STATION_NOTE } from './questIcons'

const ASPECT = MAP_META.width / MAP_META.height
const MIN_SCALE = 1
const MAX_SCALE = 3
const DRAG_THRESHOLD = 6

type Transform = { scale: number; tx: number; ty: number }
type PinVariant = 'active' | 'home' | 'visited' | 'neutral'

function clampTransform(scale: number, tx: number, ty: number, w: number, h: number) {
  const baseH = w / ASPECT
  const dispW = w * scale
  const dispH = baseH * scale
  const clampedTx = dispW <= w ? (w - dispW) / 2 : Math.min(0, Math.max(w - dispW, tx))
  const clampedTy = dispH <= h ? (h - dispH) / 2 : Math.min(0, Math.max(h - dispH, ty))
  return { tx: clampedTx, ty: clampedTy }
}

function computeZoom(prev: Transform, w: number, h: number, px: number, py: number, newScaleRaw: number): Transform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScaleRaw))
  const wx = (px - prev.tx) / prev.scale
  const wy = (py - prev.ty) / prev.scale
  const rawTx = px - wx * scale
  const rawTy = py - wy * scale
  const { tx, ty } = clampTransform(scale, rawTx, rawTy, w, h)
  return { scale, tx, ty }
}

export default function MapScreen() {
  useAppTick()
  const navigate = useNavigate()
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

  const herePos = load('ql:demo:position', DEFAULT_POSITION)

  // ---- pan/zoom ----
  const viewportRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const sizeRef = useRef(size)
  const [transform, setTransform] = useState<Transform>({ scale: MIN_SCALE, tx: 0, ty: 0 })

  useEffect(() => {
    sizeRef.current = size
  }, [size])

  useEffect(() => {
    function measure() {
      const el = viewportRef.current
      if (!el) return
      const w = el.clientWidth
      const h = el.clientHeight
      setSize({ w, h })
      setTransform((prev) => {
        const { tx, ty } = clampTransform(prev.scale, prev.tx, prev.ty, w, h)
        return { ...prev, tx, ty }
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Wheel listener attached natively (not passive) so preventDefault actually
  // stops page scroll — React's onWheel prop is passive by default.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el!.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const s = sizeRef.current
      setTransform((prev) => computeZoom(prev, s.w, s.h, px, py, prev.scale * factor))
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const pinchStart = useRef<{ dist: number; scale: number; tx: number; ty: number } | null>(null)
  const draggedRef = useRef(false)

  function localPoint(e: ReactPointerEvent) {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: ReactPointerEvent) {
    const p = localPoint(e)
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 1) {
      draggedRef.current = false
      dragStart.current = { x: p.x, y: p.y, tx: transform.tx, ty: transform.ty }
    } else if (pointers.current.size === 2) {
      draggedRef.current = true
      dragStart.current = null
      const pts = Array.from(pointers.current.values())
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      pinchStart.current = { dist, scale: transform.scale, tx: transform.tx, ty: transform.ty }
    }
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    const p = localPoint(e)
    pointers.current.set(e.pointerId, p)

    if (pointers.current.size >= 2 && pinchStart.current) {
      const pts = Array.from(pointers.current.values())
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const start = pinchStart.current
      const ratio = dist / (start.dist || 1)
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.scale * ratio))
      const wx = (midX - start.tx) / start.scale
      const wy = (midY - start.ty) / start.scale
      const rawTx = midX - wx * newScale
      const rawTy = midY - wy * newScale
      const { tx, ty } = clampTransform(newScale, rawTx, rawTy, size.w, size.h)
      setTransform({ scale: newScale, tx, ty })
    } else if (pointers.current.size === 1 && dragStart.current) {
      const d = dragStart.current
      if (Math.hypot(p.x - d.x, p.y - d.y) > DRAG_THRESHOLD) draggedRef.current = true
      const rawTx = d.tx + (p.x - d.x)
      const rawTy = d.ty + (p.y - d.y)
      const { tx, ty } = clampTransform(transform.scale, rawTx, rawTy, size.w, size.h)
      setTransform({ scale: transform.scale, tx, ty })
    }
  }

  function handlePointerUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId)
    pinchStart.current = null
    if (pointers.current.size === 1) {
      const [[, p]] = Array.from(pointers.current.entries())
      dragStart.current = { x: p.x, y: p.y, tx: transform.tx, ty: transform.ty }
    } else {
      dragStart.current = null
    }
  }

  // A pan/pinch that moved past the threshold shouldn't also register as a
  // tap on whatever pin the finger happened to lift over.
  function handleClickCapture(e: ReactMouseEvent) {
    if (draggedRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function zoomBy(factor: number) {
    setTransform((prev) => computeZoom(prev, size.w, size.h, size.w / 2, size.h / 2, prev.scale * factor))
  }

  function handleRecenter() {
    const { tx, ty } = clampTransform(MIN_SCALE, 0, 0, size.w, size.h)
    setTransform({ scale: MIN_SCALE, tx, ty })
  }

  // ---- dialogs ----
  const [openStation, setOpenStation] = useState<Station | null>(null)
  const [openLandmark, setOpenLandmark] = useState<MapLandmark | null>(null)

  function handleCheckIn() {
    if (!openStation) return
    const targetOrg = openStation.orgId ?? user?.orgId
    setOpenStation(null)
    navigate(targetOrg ? `/quests/${targetOrg}/check-in` : '/quests')
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 'var(--topbar-height)',
        bottom: 'calc(var(--nav-height) + var(--safe-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        overflow: 'hidden',
        background: 'var(--surface-page)',
      }}
    >
      <div
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none', overscrollBehavior: 'contain' }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: size.w || '100%',
            height: size.w ? size.w / ASPECT : '100%',
            transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          }}
        >
          <img
            src={MAP_META.src}
            alt="Chart of the Wilds of Questia"
            draggable={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />

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
                trackColor={org?.color}
                onOpen={() => setOpenStation(st)}
              />
            )
          })}

          <HereMarker x={herePos.x} y={herePos.y} />
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <IconButton icon="plus" label="Zoom in" variant="solid" onClick={() => zoomBy(1.4)} />
        <IconButton icon="minus" label="Zoom out" variant="solid" onClick={() => zoomBy(1 / 1.4)} />
        <IconButton icon="compass" label="Recentre the chart" variant="solid" onClick={handleRecenter} />
      </div>

      {org ? <MapLegend trackColor={org.color} /> : null}

      {openStation ? (
        <Dialog
          eyebrow="Station"
          title={openStation.name}
          onClose={() => setOpenStation(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpenStation(null)}>
                Close
              </Button>
              <Button icon="stamp" onClick={handleCheckIn}>
                Check in here
              </Button>
            </>
          }
        >
          <img
            src={`${import.meta.env.BASE_URL}assets/stations/${openStation.id}.webp`}
            alt={openStation.name}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
            style={{
              display: 'block',
              width: '100%',
              aspectRatio: '16 / 9',
              objectFit: 'cover',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-hairline)',
              marginBottom: 'var(--space-sm)',
            }}
          />
          <Tag icon={STATION_ICON[openStation.type] ?? 'map-pin'} style={{ marginBottom: 'var(--space-sm)' }}>
            {openStation.type}
          </Tag>
          <p style={{ font: 'var(--body-base)', color: 'var(--text-muted)' }}>
            {STATION_NOTE[openStation.type] ?? 'A station on the trail.'}
          </p>
        </Dialog>
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
  trackColor,
  onOpen,
}: {
  station: Station
  coord: { x: number; y: number }
  variant: PinVariant
  isHome: boolean
  trackColor?: string
  onOpen: () => void
}) {
  const spec = PIN_SPEC[variant]
  const ringColor = variant === 'active' && trackColor ? trackColor : spec.color
  return (
    <button
      onClick={onOpen}
      aria-label={`${station.name} — ${station.type} station`}
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
        <Icon name="map-pin" size={spec.size} />
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
