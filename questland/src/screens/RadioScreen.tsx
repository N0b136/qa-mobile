import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { useRadio } from '../hooks/useRadio'
import { currentUser } from '../services/authService'
import { isEntitled, playPlaylist, seekTo, toggle, next, prev } from '../services/radioService'
import { PLAYLISTS, getPlaylist, getTrack, tracksFor } from '../content/soundtrack'
import type { RadioPlaylist, RadioTrack } from '../content/soundtrack'
import { getOrg } from '../content/orgs'
import { ArchCard, Button, Card, Icon, IconButton } from '../ui'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

// 160ms, no bounce — view swaps fade in mechanically.
const viewFade: CSSProperties = {
  animation: 'qa-fade-in var(--dur-fast) var(--ease-standard) both',
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Cover art: track art → playlist art → the Questland mark. */
function artOf(track: RadioTrack | undefined, playlist: RadioPlaylist | undefined): string {
  const art = track?.art ?? playlist?.art ?? 'assets/logo-questland-primary.png'
  return import.meta.env.BASE_URL + art
}

/** The org's sanctioned track colour, or gold for the full playlist. */
function trackOf(pl: RadioPlaylist): 'valor' | 'lore' | 'wilds' | 'gold' {
  const track = pl.orgId ? getOrg(pl.orgId)?.track : undefined
  return track === 'valor' || track === 'lore' || track === 'wilds' ? track : 'gold'
}

/** The seek bar + transport, shown wherever a session exists. */
function NowPlaying() {
  const radio = useRadio()
  if (!radio.trackId) return null
  const track = getTrack(radio.trackId)
  const playlist = radio.playlistId ? getPlaylist(radio.playlistId) : undefined
  if (!track) return null

  return (
    <Card>
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <img
            src={artOf(track, playlist)}
            alt=""
            width={56}
            height={56}
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
                color: 'var(--text-body)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {track.title}
            </div>
            <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
              {playlist?.name ?? 'Questland Radio'}
            </p>
          </div>
        </div>

        <div>
          <input
            type="range"
            aria-label="Seek"
            min={0}
            max={radio.duration || 0}
            step={1}
            value={Math.min(radio.position, radio.duration || 0)}
            disabled={!radio.duration}
            onChange={(e) => seekTo(Number(e.target.value))}
            style={{ display: 'block', width: '100%', accentColor: 'var(--gold-500)' }}
          />
          <div className="row row--between muted" style={{ marginTop: 4, fontSize: 12 }}>
            <span>{fmt(radio.position)}</span>
            <span>{fmt(radio.duration)}</span>
          </div>
        </div>

        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <IconButton icon="skip-back" label="Previous track" onClick={() => void prev()} />
          <IconButton
            icon={radio.status === 'playing' ? 'pause' : 'play'}
            label={radio.status === 'playing' ? 'Pause' : 'Play'}
            variant="solid"
            size="lg"
            onClick={toggle}
          />
          <IconButton icon="skip-forward" label="Next track" onClick={() => void next()} />
        </div>

        {radio.error ? (
          <p className="muted" style={{ margin: 0, fontSize: 12, color: 'var(--status-danger)' }}>
            {radio.error}
          </p>
        ) : null}
      </div>
    </Card>
  )
}

/** One playlist opened into its songs. */
function TrackList({ playlist, onBack }: { playlist: RadioPlaylist; onBack: () => void }) {
  const radio = useRadio()
  const tracks = tracksFor(playlist.id)

  return (
    <div className="stack" style={{ gap: 16, ...viewFade }}>
      <div className="row" style={{ gap: 8 }}>
        <IconButton icon="arrow-left" label="Back to playlists" onClick={onBack} />
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, ...capsHeadingStyle }}>
          {playlist.name}
        </div>
      </div>

      <NowPlaying />

      <div className="stack" style={{ gap: 10 }}>
        {tracks.map((trk, i) => {
          const current = radio.trackId === trk.id
          return (
            <Card
              key={trk.id}
              interactive
              onClick={() => playPlaylist(playlist.id, trk.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault() // Space must not scroll the list it plays from
                  playPlaylist(playlist.id, trk.id)
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="row" style={{ gap: 12 }}>
                <span
                  style={{
                    width: 20,
                    textAlign: 'center',
                    flexShrink: 0,
                    color: current ? 'var(--text-gold)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-ui)',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {current ? <Icon name="audio-lines" size={18} /> : i + 1}
                </span>
                <img
                  src={artOf(trk, playlist)}
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
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: 'var(--font-ui)',
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: current ? 'var(--text-gold)' : 'var(--text-body)',
                  }}
                >
                  {trk.title}
                </span>
                <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
                  {fmt(trk.duration)}
                </span>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export default function RadioScreen() {
  useAppTick() // entitlement reacts to bookings landing in the mirror
  const navigate = useNavigate()
  const [openId, setOpenId] = useState<string | null>(null)
  const user = currentUser()
  if (!user) return null

  const entitled = isEntitled(user.id)
  const open = openId ? getPlaylist(openId) : undefined

  return (
    <div className="screen">
      <h1 className="section-title" style={{ ...capsHeadingStyle, margin: 0 }}>
        <Icon name="radio" size={20} />
        Questland Radio
      </h1>
      <p className="muted" style={{ marginTop: 6 }}>
        The songs of the Wilds — in the park, and on the road to it.
      </p>

      <div style={{ marginTop: 18 }}>
        {entitled && open ? (
          <TrackList playlist={open} onBack={() => setOpenId(null)} />
        ) : (
          <div className="stack" style={{ gap: 16, ...viewFade }}>
            {!entitled ? (
              <Card eyebrow="A Citizen's perk" title="Music for Citizens">
                <div className="stack" style={{ gap: 14 }}>
                  <p style={{ margin: 0 }}>
                    The radio belongs to the Citizens of Questia. Hold a monthly membership — from
                    $30 — and every song of the Wilds rides with you, in the park and on the road
                    to it.
                  </p>
                  <Button icon="ticket" onClick={() => navigate('/book')}>
                    Become a Citizen
                  </Button>
                </div>
              </Card>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {PLAYLISTS.map((pl) => (
                <ArchCard
                  key={pl.id}
                  title={pl.name}
                  subtitle={`${pl.trackIds.length} ${pl.trackIds.length === 1 ? 'song' : 'songs'}`}
                  image={artOf(undefined, pl)}
                  track={trackOf(pl)}
                  state={entitled ? 'available' : 'locked'}
                  onClick={entitled ? () => setOpenId(pl.id) : undefined}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
