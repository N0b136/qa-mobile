import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Card, Icon, Switch } from '../ui'

// DISPOSABLE SPIKE — lock-screen audio trial for the coming Questland Radio.
// Routed at /radio-test with no nav link anywhere; delete when the real radio
// feature lands. The point is the Media Session wiring below, not the UI.

const TRACK_URL = `${import.meta.env.BASE_URL}assets/audio/radio-spike.wav`
const ART_URL = `${import.meta.env.BASE_URL}assets/logo-questland-primary.png`

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const CHECKLIST: Array<{ icon: string; text: string }> = [
  { icon: 'lock', text: 'Start the track, then lock your phone. The music should carry on unbroken.' },
  {
    icon: 'image',
    text: 'On the lock screen, look for the title and the Questland mark. Its play and pause must obey you.',
  },
  { icon: 'app-window', text: 'Step into another app. The track should follow you there.' },
  {
    icon: 'sliders-horizontal',
    text: "Drag the lock screen's scrubber. The track should land where you set it.",
  },
]

export default function RadioSpikeScreen() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Set inside the mount effect; lets the slider/seek handlers below push a
  // fresh position to the lock screen without re-wiring the effect.
  const syncPositionRef = useRef<() => void>(() => {})
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loop, setLoop] = useState(true)

  useEffect(() => {
    const audio = new Audio(TRACK_URL)
    audio.preload = 'auto'
    audio.loop = true
    audioRef.current = audio

    const ms = 'mediaSession' in navigator ? navigator.mediaSession : null

    const syncPosition = () => {
      if (!ms || !Number.isFinite(audio.duration)) return
      ms.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: audio.currentTime,
      })
    }
    syncPositionRef.current = syncPosition

    let lastSync = 0
    const onTime = () => {
      setTime(audio.currentTime)
      // timeupdate fires ~4x/s; the lock screen interpolates on its own, so
      // one position push a second is plenty.
      const now = Date.now()
      if (now - lastSync >= 1000) {
        lastSync = now
        syncPosition()
      }
    }
    const onPlay = () => {
      setPlaying(true)
      if (ms) ms.playbackState = 'playing'
    }
    // Natural end (loop off) fires `ended` without a `pause` event — treat both
    // as stopped so the lock screen never shows a playing ghost.
    const onStop = () => {
      setPlaying(false)
      if (ms) ms.playbackState = 'paused'
    }
    const onMeta = () => {
      setDuration(audio.duration)
      syncPosition()
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onStop)
    audio.addEventListener('ended', onStop)
    audio.addEventListener('loadedmetadata', onMeta)

    const seekBy = (delta: number) => {
      audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta))
      syncPosition()
    }
    if (ms) {
      ms.metadata = new MediaMetadata({
        title: "The Bard's Placeholder",
        artist: 'Questland Adventures',
        album: 'Whispering Woods — Sound Test',
        artwork: [{ src: ART_URL, sizes: '768x768', type: 'image/png' }],
      })
      // Playback still only ever STARTS from the on-screen tap; these serve the
      // lock screen / control center once the user has begun it.
      ms.setActionHandler('play', () => void audio.play())
      ms.setActionHandler('pause', () => audio.pause())
      ms.setActionHandler('seekbackward', () => seekBy(-10))
      ms.setActionHandler('seekforward', () => seekBy(10))
      ms.setActionHandler('seekto', (details) => {
        if (details.seekTime == null) return
        audio.currentTime = details.seekTime
        syncPosition()
      })
    }

    return () => {
      audio.pause()
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onStop)
      audio.removeEventListener('ended', onStop)
      audio.removeEventListener('loadedmetadata', onMeta)
      if (ms) {
        const actions: MediaSessionAction[] = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto']
        actions.forEach((a) => ms.setActionHandler(a, null))
        ms.metadata = null
        ms.playbackState = 'none'
      }
      // Drop the src and re-load so the element releases its buffer.
      audio.src = ''
      audio.load()
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = loop
  }, [loop])

  function handleToggle() {
    const a = audioRef.current
    if (!a) return
    if (a.paused || a.ended) void a.play()
    else a.pause()
  }

  function handleSeek(value: number) {
    const a = audioRef.current
    if (!a) return
    a.currentTime = value
    setTime(value)
    syncPositionRef.current()
  }

  return (
    <div className="screen">
      <h1 className="section-title" style={{ ...capsHeadingStyle, margin: 0 }}>
        <Icon name="radio" size={20} />
        Radio Spike
      </h1>
      <p className="muted" style={{ marginTop: 6 }}>
        A sound trial for the coming Questland Radio. Nothing here is final.
      </p>

      <div className="stack" style={{ marginTop: 18, gap: 16 }}>
        <Card eyebrow="Now sounding" title="The Trial Track">
          <div className="stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 12 }}>
              <img
                src={ART_URL}
                alt="Questland mark"
                width={56}
                height={56}
                style={{
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-hairline)',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-body)' }}>
                  The Bard&apos;s Placeholder
                </div>
                <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
                  Questland Adventures &middot; {fmt(duration)}
                </p>
              </div>
            </div>

            <div>
              <input
                type="range"
                aria-label="Seek"
                min={0}
                max={duration || 0}
                step={1}
                value={Math.min(time, duration || 0)}
                disabled={!duration}
                onChange={(e) => handleSeek(Number(e.target.value))}
                style={{ display: 'block', width: '100%', accentColor: 'var(--gold-500)' }}
              />
              <div className="row row--between muted" style={{ marginTop: 4, fontSize: 12 }}>
                <span>{fmt(time)}</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>

            <Button fullWidth icon={playing ? 'pause' : 'play'} onClick={handleToggle}>
              {playing ? 'Pause' : 'Play'}
            </Button>

            <Switch
              label="Loop the track"
              description="Keeps the trial sounding while you work through the checks."
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
          </div>
        </Card>

        <Card eyebrow="Field trial" title="Prove It on Your iPhone">
          <div className="stack" style={{ gap: 12 }}>
            {CHECKLIST.map((item) => (
              <div key={item.icon} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--text-gold)', display: 'inline-flex', flexShrink: 0, marginTop: 2 }}>
                  <Icon name={item.icon} size={16} />
                </span>
                <span style={{ fontSize: 14 }}>{item.text}</span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              If all four hold, the Radio is cleared to build.
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
