// The park chart, pannable and zoomable, with whatever pins the caller draws on
// top. Extracted from MapScreen so the Back Office console can chart the same
// ground without importing a guest screen (the console has no router).
//
// Children are laid out inside the image layer, so a pin positions itself with
// plain percentages — left: `${x * 100}%` — and tracks the art under any
// transform. The layer is sized in CSS pixels rather than scaled by a parent, so
// pins keep their size as the chart zooms.

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { MAP_META } from '../content/stationMap'
import { IconButton } from '../ui'

const ASPECT = MAP_META.width / MAP_META.height
const DRAG_THRESHOLD = 6

type Transform = { scale: number; tx: number; ty: number }

/**
 * Rest size of the chart inside a viewport: `cover` fills the width (the phone,
 * where the chart is taller than the column and pans vertically), `contain` fits
 * the whole chart in view (the console, where the panel is wider than it is
 * tall and a cropped chart would hide half the park).
 */
function baseWidth(w: number, h: number, fit: 'cover' | 'contain'): number {
  return fit === 'contain' ? Math.min(w, h * ASPECT) : w
}

function clampTransform(scale: number, tx: number, ty: number, w: number, h: number, baseW: number) {
  const dispW = baseW * scale
  const dispH = (baseW / ASPECT) * scale
  const clampedTx = dispW <= w ? (w - dispW) / 2 : Math.min(0, Math.max(w - dispW, tx))
  const clampedTy = dispH <= h ? (h - dispH) / 2 : Math.min(0, Math.max(h - dispH, ty))
  return { tx: clampedTx, ty: clampedTy }
}

interface Props {
  children?: ReactNode
  /** Smallest zoom, also the resting scale. */
  minScale?: number
  maxScale?: number
  /** Zoom / recentre buttons, bottom-right. */
  controls?: boolean
  fit?: 'cover' | 'contain'
  style?: CSSProperties
}

export default function MapCanvas({
  children,
  minScale = 1,
  maxScale = 3,
  controls = true,
  fit = 'cover',
  style,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const sizeRef = useRef(size)
  const [transform, setTransform] = useState<Transform>({ scale: minScale, tx: 0, ty: 0 })
  const baseW = baseWidth(size.w, size.h, fit)

  function computeZoom(prev: Transform, w: number, h: number, px: number, py: number, raw: number): Transform {
    const scale = Math.min(maxScale, Math.max(minScale, raw))
    const wx = (px - prev.tx) / prev.scale
    const wy = (py - prev.ty) / prev.scale
    const { tx, ty } = clampTransform(scale, px - wx * scale, py - wy * scale, w, h, baseWidth(w, h, fit))
    return { scale, tx, ty }
  }

  useEffect(() => {
    sizeRef.current = size
  }, [size])

  // Watch the container itself, not the window.
  //
  // Measuring once on mount is not enough: a child's effects run before its
  // parent's, so on the console the chart would measure while the page was
  // still clamped to the guest app's 480px column — ConsoleScreen lifts that
  // clamp from its own effect, one tick later — and a chart sized for a phone
  // would sit pinned to the left of a desktop panel until something happened to
  // fire a window resize. A ResizeObserver catches that and every other reflow
  // (panel growth, a scrollbar appearing, browser zoom) for free.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function measure() {
      const w = el!.clientWidth
      const h = el!.clientHeight
      if (w === 0 || h === 0) return
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
      setTransform((prev) => {
        const { tx, ty } = clampTransform(prev.scale, prev.tx, prev.ty, w, h, baseWidth(w, h, fit))
        return prev.tx === tx && prev.ty === ty ? prev : { ...prev, tx, ty }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [fit])

  // Attached natively (not passive) so preventDefault actually stops the page
  // scrolling — React's onWheel is passive by default.
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
      const newScale = Math.min(maxScale, Math.max(minScale, start.scale * ratio))
      const wx = (midX - start.tx) / start.scale
      const wy = (midY - start.ty) / start.scale
      const { tx, ty } = clampTransform(newScale, midX - wx * newScale, midY - wy * newScale, size.w, size.h, baseW)
      setTransform({ scale: newScale, tx, ty })
    } else if (pointers.current.size === 1 && dragStart.current) {
      const d = dragStart.current
      if (Math.hypot(p.x - d.x, p.y - d.y) > DRAG_THRESHOLD) draggedRef.current = true
      const { tx, ty } = clampTransform(
        transform.scale,
        d.tx + (p.x - d.x),
        d.ty + (p.y - d.y),
        size.w,
        size.h,
        baseW
      )
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

  // A pan or pinch that moved past the threshold must not also register as a tap
  // on whatever pin the finger happened to lift over.
  function handleClickCapture(e: ReactMouseEvent) {
    if (draggedRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function zoomBy(factor: number) {
    setTransform((prev) => computeZoom(prev, size.w, size.h, size.w / 2, size.h / 2, prev.scale * factor))
  }

  function recentre() {
    const { tx, ty } = clampTransform(minScale, 0, 0, size.w, size.h, baseW)
    setTransform({ scale: minScale, tx, ty })
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...style }}>
      <div
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          touchAction: 'none',
          overscrollBehavior: 'contain',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: baseW || '100%',
            height: baseW ? baseW / ASPECT : '100%',
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
          {children}
        </div>
      </div>

      {controls ? (
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
          <IconButton icon="compass" label="Recentre the chart" variant="solid" onClick={recentre} />
        </div>
      ) : null}
    </div>
  )
}
