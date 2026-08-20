import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { hasSeenGate, markGateSeen } from '../services/gateIntroService'

// Cold-open gate video sped up to a fixed runtime, then frozen on its last
// frame as the Home backdrop. Plays the FIRST time the Home route ('/')
// loads in a session — however the guest got there, including straight off
// onboarding (which navigates to '/' and sits outside Shell, so Shell/this
// component mounts fresh there too). Shell can also mount at a restored deep
// link (e.g. reload at '/map'): that path must show the frozen final frame
// immediately (no playback, delays 0) and must NOT call markGateSeen(), so a
// later genuine Home load in the same session can still play the intro.
// The pathname is captured once at mount (not reactive) so a later route
// change can never re-trigger or re-evaluate the decision.
// See design_handoff_gate_intro/README.md.
const INTRO_SECONDS = 5

function computeSkip(pathname: string): boolean {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return pathname !== '/' || hasSeenGate() || prefersReducedMotion
}

function setVars(secs: number) {
  const root = document.documentElement.style
  root.setProperty('--intro-shield-dur', `${secs}s`)
  root.setProperty('--intro-ui-delay', `${Math.max(0, secs - 0.45)}s`)
  root.setProperty('--intro-scrim-delay', `${Math.max(0, secs - 0.8)}s`)
}

// The chrome reveal is animated on each fixed bar rather than on a shared
// wrapper (see Shell.tsx), so `--intro-ui-delay` is read by bars that mount
// LATER too — the MiniPlayer appears the moment a guest presses play. Left
// standing at 4.55s it would make those sit invisible for four and a half
// seconds, waiting out an intro that finished minutes ago. Clearing it is
// safe from this point on: the bars up since mount have already run their
// 720ms reveal, and `fill: both` holds them at the end state, so restarting
// a zero-delay animation past its own duration changes nothing on screen.
const REVEAL_SETTLED_MS = (INTRO_SECONDS + 0.5) * 1000

export default function GateIntro() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [phase, setPhase] = useState<'intro' | 'done'>('intro')
  const { pathname } = useLocation()
  // Computed once, synchronously, from the mount-time pathname and shared by
  // both effects below so the layout effect (vars) and the effect (playback)
  // can never disagree, and so a later route change can't re-trigger it.
  const [skip] = useState(() => computeSkip(pathname))

  // Runs before paint so the animations never render a frame against the
  // `, Ns` fallback — the real delay is in place before the browser paints.
  useLayoutEffect(() => {
    setVars(skip ? 0 : INTRO_SECONDS)
  }, [skip])

  // Runs off the clock, not off the video: the bars' reveal is a CSS animation
  // started at mount with a fixed delay, so it lands at the same moment however
  // the playback went.
  useEffect(() => {
    if (skip) return
    const timer = window.setTimeout(() => {
      document.documentElement.style.setProperty('--intro-ui-delay', '0s')
    }, REVEAL_SETTLED_MS)
    return () => window.clearTimeout(timer)
  }, [skip])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function freeze() {
      if (!video) return
      video.pause()
      if (isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.05)
      setPhase('done')
    }

    function start() {
      if (!video || !isFinite(video.duration) || video.duration <= 0) return
      if (skip) {
        freeze()
        return
      }
      markGateSeen()
      video.playbackRate = Math.min(16, Math.max(0.0625, video.duration / INTRO_SECONDS))
      video.currentTime = 0
      const playPromise = video.play()
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {})
      }
    }

    function handleLoadedMetadata() {
      start()
    }
    function handleEnded() {
      freeze()
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('ended', handleEnded)
    if (video.readyState >= 1) start()

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('ended', handleEnded)
    }
    // Runs once on mount — the intro/skip decision is made a single time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <video
        ref={videoRef}
        src={`${import.meta.env.BASE_URL}assets/video-gate-opening.mp4`}
        muted
        playsInline
        preload="auto"
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(480px, 100vw)',
          height: '100dvh',
          objectFit: 'cover',
          objectPosition: '50% 50%',
          zIndex: 0,
          background: 'var(--stone-950)',
        }}
      />
      <div
        data-qa-anim="scrim"
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(480px, 100vw)',
          height: '100dvh',
          zIndex: 1,
          pointerEvents: 'none',
          background:
            'linear-gradient(rgba(18, 18, 20, 0.5) 0%, rgba(18, 18, 20, 0.66) 45%, rgba(18, 18, 20, 0.78) 100%)',
          opacity: 0,
          // Fallback 4.2s = INTRO_SECONDS(5) - 0.8, matching the README offset.
          animation: 'qa-scrim-in 900ms var(--ease-out-door) var(--intro-scrim-delay, 4.2s) both',
        }}
      />
      <div
        data-qa-anim="shield"
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(480px, 100vw)',
          height: '100dvh',
          zIndex: phase === 'intro' ? 70 : -1,
          // Fallback 5s = INTRO_SECONDS, matching the README offset.
          animation: 'qa-shield-off var(--intro-shield-dur, 5s) linear both',
        }}
      />
    </>
  )
}
