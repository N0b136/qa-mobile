import { useLayoutEffect } from 'react'
import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRadio } from '../hooks/useRadio'
import type { RadioState } from '../services/radioService'
import { toggle, next } from '../services/radioService'
import { useCatalogue } from '../hooks/useCatalogue'
import { getPlaylist, getTrack } from '../content/soundtrack'
import type { RadioTrack } from '../content/soundtrack'
import { IconButton } from '../ui'

const BAR_HEIGHT = 56

/**
 * The strip above the BottomNav while a radio session exists. Fixed and
 * centered via inset + auto margins — NEVER translateX: a transform here would
 * become the containing block for any fixed descendant and puts a transform
 * inside the fixed-bars band (the MapScreen scar).
 */
function MiniPlayerBar({ radio, track }: { radio: RadioState; track: RadioTrack }) {
  const navigate = useNavigate()
  const playlist = radio.playlistId ? getPlaylist(radio.playlistId) : undefined

  // Reserve room above the BottomNav for as long as the bar is up, so screen
  // content can scroll clear of it (InstallBanner precedent). The parent only
  // mounts this once the track has resolved, so the reservation can never
  // outlive a bar that declined to render.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--miniplayer-height', `${BAR_HEIGHT}px`)
    return () => {
      root.style.removeProperty('--miniplayer-height')
    }
  }, [])

  const art = track.art ?? playlist?.art ?? 'assets/logo-questland-primary.png'
  const progress = radio.duration > 0 ? Math.min(1, radio.position / radio.duration) : 0

  function control(e: MouseEvent, action: () => void) {
    e.stopPropagation() // the bar itself navigates; the buttons must not
    action()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open Questland Radio"
      onClick={() => navigate('/radio')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault() // Space would otherwise scroll the page underneath
          navigate('/radio')
        }
      }}
      style={{
        position: 'fixed',
        bottom: 'calc(var(--nav-height) + var(--safe-bottom))',
        left: 0,
        right: 0,
        marginInline: 'auto',
        width: '100%',
        maxWidth: 480,
        height: BAR_HEIGHT,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 8px 0 12px',
        background: 'var(--stone-950)',
        borderTop: '1px solid var(--border-hairline)',
        cursor: 'pointer',
        // Fade + bottom nudge only — margin-bottom, never transform. The
        // delay is the gate intro's: this bar can be up at app start (a
        // restored session mounts it paused), and GateIntro returns the var to
        // 0s once the reveal is over, so a bar that appears when a guest
        // presses play still slides straight in.
        animation:
          'qa-miniplayer-in var(--dur-fast) var(--ease-standard) var(--intro-ui-delay, 4.55s) both',
      }}
    >
      {/* 2px gold progress hairline along the top edge. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: 2,
          width: `${progress * 100}%`,
          background: 'var(--gold-500)',
        }}
      />
      <img
        src={import.meta.env.BASE_URL + art}
        alt=""
        width={40}
        height={40}
        style={{
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-hairline)',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 700,
            fontSize: 14,
            color: 'var(--text-body)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {track.title}
        </div>
        <div
          className="muted"
          style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {playlist?.name ?? 'Questland Radio'}
        </div>
      </div>
      <IconButton
        icon={radio.status === 'playing' ? 'pause' : 'play'}
        label={radio.status === 'playing' ? 'Pause' : 'Play'}
        onClick={(e) => control(e, toggle)}
      />
      <IconButton icon="skip-forward" label="Next track" onClick={(e) => control(e, () => void next())} />
    </div>
  )
}

/**
 * Mounted in Shell's fixed-bars band; renders nothing while the radio is idle.
 * The track is resolved HERE, before the bar (and its height reservation)
 * mounts — a stale trackId must not reserve 56px of dead padding.
 */
export default function MiniPlayer() {
  const radio = useRadio()
  // Before the early return — a hook cannot be called conditionally, and the
  // playing track's title must follow a catalogue correction without a reload.
  useCatalogue()
  if (radio.status === 'idle') return null
  const track = radio.trackId ? getTrack(radio.trackId) : undefined
  if (!track) return null
  return <MiniPlayerBar radio={radio} track={track} />
}
