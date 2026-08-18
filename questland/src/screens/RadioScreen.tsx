import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { useRadio } from '../hooks/useRadio'
import { useOfflineAudio } from '../hooks/useOfflineAudio'
import { currentUser } from '../services/authService'
import { isEntitled, playPlaylist, seekTo, toggle, next, prev } from '../services/radioService'
import {
  cancelPlaylist,
  formatBytes,
  forgetAll,
  isBusy,
  isKept,
  isPlaylistKept,
  keepPlaylist,
  playlistProgress,
  refresh as refreshOffline,
  retryPlaylist,
  unkeepPlaylist,
} from '../services/offlineAudioService'
import { PLAYLISTS, getPlaylist, getTrack, tracksFor } from '../content/soundtrack'
import type { RadioPlaylist, RadioTrack } from '../content/soundtrack'
import { getOrg } from '../content/orgs'
import ProgressBar from '../components/ProgressBar'
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


/**
 * "Keep on this device" for one playlist.
 *
 * Four honest states, and no fifth: the bundled demo loops are already on the
 * device (there is nothing to download), a keepable playlist is either offered,
 * coming down, or kept. Progress counts SONGS COMPLETED — the Storage SDK
 * reports no byte-level progress, so a percentage bar would be invented.
 */
function KeepRow({ playlist }: { playlist: RadioPlaylist }) {
  useOfflineAudio()
  const progress = playlistProgress(playlist.id)
  const wanted = isPlaylistKept(playlist.id)

  // Songs that ship inside the app bundle. Offering to download one would be
  // theatre — say plainly that it is already with you.
  if (progress.total === 0) {
    return (
      <Card>
        <div className="row" style={{ gap: 10 }}>
          <Icon name="check" size={18} style={{ color: 'var(--text-gold)', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700 }}>Always with you</div>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
              These songs ride inside the app. They play with no signal at all.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  const working = progress.working > 0

  return (
    <Card>
      <div className="stack" style={{ gap: 12 }}>
        <div className="row row--between" style={{ gap: 10 }}>
          <span className="row" style={{ gap: 10, minWidth: 0 }}>
            <Icon
              name={progress.complete ? 'check' : working ? 'cloud-download' : 'download'}
              size={18}
              style={{ color: progress.complete ? 'var(--text-gold)' : 'var(--text-muted)', flexShrink: 0 }}
            />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, display: 'block' }}>
                {progress.complete ? 'Kept on this device' : working ? 'Keeping your songs' : 'Keep on this device'}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {working
                  ? `${progress.kept} of ${progress.total} songs · ${progress.working} coming down`
                  : progress.complete
                    ? `${progress.total} ${progress.total === 1 ? 'song' : 'songs'} · ${formatBytes(progress.bytes)}`
                    : 'Play them in the car, out of signal, on no data at all.'}
              </span>
            </span>
          </span>
          {progress.complete ? (
            <IconButton
              icon="trash-2"
              label="Remove these downloads"
              onClick={() => unkeepPlaylist(playlist.id)}
            />
          ) : null}
        </div>

        {working ? (
          <>
            <ProgressBar value={progress.kept} max={progress.total} />
            <Button variant="ghost" icon="x" onClick={() => cancelPlaylist(playlist.id)}>
              Stop keeping
            </Button>
          </>
        ) : null}

        {!working && !progress.complete ? (
          <Button variant="secondary" icon="download" onClick={() => keepPlaylist(playlist.id)}>
            {wanted ? 'Finish keeping' : 'Keep on this device'}
          </Button>
        ) : null}

        {progress.failed > 0 ? (
          <div className="row row--between" style={{ gap: 10 }}>
            <span className="muted" style={{ fontSize: 12, color: 'var(--status-danger)' }}>
              {progress.failed} {progress.failed === 1 ? 'song' : 'songs'} did not come down.
            </span>
            <Button variant="ghost" icon="rotate-cw" onClick={() => retryPlaylist(playlist.id)}>
              Try again
            </Button>
          </div>
        ) : null}

        {progress.complete ? (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Your device may reclaim the space when it runs low. The radio keeps them again next
            time you open it.
          </p>
        ) : null}
      </div>
    </Card>
  )
}

/** What the radio is holding on this device, and the way to hand it back. */
function StorageRow() {
  const offline = useOfflineAudio()
  const count = Object.keys(offline.kept).length

  return (
    <Card eyebrow="On this device" title="Kept Songs">
      <div className="stack" style={{ gap: 12 }}>
        <div className="row row--between" style={{ gap: 10 }}>
          <span className="row" style={{ gap: 10, minWidth: 0 }}>
            <Icon name="hard-drive" size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {count > 0
                ? `${formatBytes(offline.totalBytes)} · ${count} ${count === 1 ? 'song' : 'songs'}`
                : 'Nothing kept yet'}
            </span>
          </span>
          {count > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              icon="trash-2"
              style={{ color: 'var(--status-danger)', flexShrink: 0 }}
              onClick={() => void forgetAll()}
            >
              Remove all
            </Button>
          ) : null}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {count > 0
            ? 'Kept songs play with no signal. Your device may reclaim the space when it runs low.'
            : 'Open a playlist to keep its songs here for the road.'}
        </p>
      </div>
    </Card>
  )
}

/** One playlist opened into its songs. */
function TrackList({ playlist, onBack }: { playlist: RadioPlaylist; onBack: () => void }) {
  const radio = useRadio()
  useOfflineAudio() // kept/coming-down badges follow the vault
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

      <KeepRow playlist={playlist} />

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
                {isKept(trk.id) ? (
                  <Icon
                    name="check"
                    size={16}
                    aria-label="Kept on this device"
                    style={{ color: 'var(--text-gold)', flexShrink: 0 }}
                  />
                ) : isBusy(trk.id) ? (
                  <Icon
                    name="cloud-download"
                    size={16}
                    aria-label="Coming down"
                    style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                  />
                ) : null}
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

  // Downloads are a LEASE: the browser may have reclaimed songs since this
  // screen was last open, so read what is really on the device rather than
  // trusting a remembered answer.
  useEffect(() => {
    void refreshOffline()
  }, [])

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
            {entitled ? <StorageRow /> : null}
          </div>
        )}
      </div>
    </div>
  )
}
