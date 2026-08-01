import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import {
  currentEpisode,
  stationsDone,
  validateQrText,
  validateStaffCode,
} from '../services/progressService'
import { checkIn, presenceFor, questTaken, statusOf, windowLeft } from '../services/presenceService'
import { getOrg } from '../content/orgs'
import { stationsFor } from '../content/stations'
import type { Station } from '../content/types'
import { useToast } from '../components/Toast'
import { QrScanner } from '../components/QrScanner'
import GateArrival from '../components/GateArrival'
import FlagStandard from '../components/FlagStandard'
import { Badge, Button, Card, Icon, IconButton, Input, Ornament, Tag } from '../ui'
import { romanNumeral, STATION_ICON } from './questIcons'

interface OkResult {
  ok: true
  episode: { title: string }
  rankUp: { name: string } | null
}

export default function CheckInScreen() {
  useAppTick()
  const navigate = useNavigate()
  const { orgId } = useParams<{ orgId: string }>()
  const user = currentUser()
  const { show } = useToast()

  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | undefined>(undefined)
  const [gateOpen, setGateOpen] = useState(false)

  if (!user) return null
  const org = orgId ? getOrg(orgId) : undefined
  if (!org) return <Navigate to="/quests" replace />

  const ep = currentEpisode(user.id, org.id)

  function finishOk(result: OkResult) {
    show({ title: `${result.episode.title} — seal claimed`, icon: 'stamp' })
    if (result.rankUp) {
      show({ title: `New rank — ${result.rankUp.name}`, icon: 'award' })
    }
    navigate(`/quests/${org!.id}`)
  }

  // Tapping a station is the ordinary way through an episode: seven stations,
  // seven check-ins, and the seventh seals it. The Guide's code below stays as
  // the override for a marker that will not read.
  function handleStationCheckIn(station: Station) {
    const result = checkIn(user!.id, station.id, { orgId: org!.id })
    if (!result.ok) {
      show({ title: result.error, icon: 'triangle-alert' })
      return
    }

    show({
      title: `Checked in — ${station.name}`,
      body: result.carried.length ? `${result.partyName} checked in with you.` : undefined,
      icon: 'stamp',
    })

    const credit = result.credit
    if (credit?.completion?.ok) {
      finishOk(credit.completion)
    } else if (credit?.repeat) {
      show({ title: 'Already sealed here', icon: 'stamp' })
    }
  }

  function handleStaffCode() {
    const result = validateStaffCode(user!.id, org!.id, code)
    if (result.ok) {
      setCodeError(undefined)
      finishOk(result)
    } else {
      setCodeError(result.error)
    }
  }

  function handleScanDecode(text: string) {
    setScanning(false)
    const result = validateQrText(user!.id, text)
    if (result.ok) {
      setScanError(undefined)
      finishOk(result)
    } else {
      setScanError(result.error)
    }
  }

  if (!ep) {
    return (
      <div className="screen" style={{ textAlign: 'center' }}>
        <p style={{ marginTop: 40 }}>This questline is complete.</p>
        <Button style={{ marginTop: 16 }} onClick={() => navigate(`/quests/${org.id}`)}>
          Back to the questline
        </Button>
      </div>
    )
  }

  const stations = stationsFor(ep.id)
  const done = stationsDone(user.id, ep.id)
  const here = presenceFor(user.id)
  const hereId = here && statusOf(here) === 'at-station' ? here.stationId : null
  const minutesLeft = here ? Math.max(1, Math.ceil(windowLeft(here) / 60000)) : 0

  // The rotation is walked in order and the road ahead is dark: a station you
  // have not reached yet keeps its name hidden, so the episode is discovered on
  // foot rather than read off a list. Only the next one can be checked into.
  const walking = questTaken(user.id, org.id)
  const nextId = walking ? stations.find((st) => !done.includes(st.id))?.id : undefined

  return (
    <div className="screen">
      <div
        style={{
          position: 'relative',
          margin: '-12px -16px 18px',
          padding: '18px 16px 20px',
          background: org.colorSoft,
        }}
      >
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: org.color }} />
        <IconButton icon="arrow-left" label="Back to the questline" onClick={() => navigate(`/quests/${org.id}`)} />
        <div style={{ marginTop: 10 }}>
          <div style={{ font: '900 var(--text-3xl)/1 var(--font-display-ornate)', color: 'var(--gold-300)' }}>
            {romanNumeral(ep.number)}
          </div>
          <h1
            style={{
              marginTop: 4,
              font: '600 var(--text-2xl)/1.1 var(--font-display)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-display-tight)',
              color: 'var(--text-heading)',
            }}
          >
            {ep.title}
          </h1>
          <Badge tone={org.track} icon="map-pin" style={{ marginTop: 8 }}>
            Episode {ep.number} of 10
          </Badge>
          {/* The standard, inline, because THIS is the screen a guest has open
              while standing at a marker about to touch a pole to it. The label
              settles "which one is ours" in the field, and the stale badge lands
              at the only moment it can still save them a walk — before they set
              off for the next station rather than after. It renders nothing when
              there is no pole: the in-app check-in below is a first-class way
              through an episode and must not be nagged at. This screen belongs to
              ONE order and a Hero Pass keeps all three open, so it hands the
              standard the order it is showing — a pole bound elsewhere has to say
              so here, or the label reads as if it belonged to this quest. */}
          <FlagStandard
            userId={user.id}
            variant="inline"
            orgId={org.id}
            style={{ marginTop: 10 }}
          />
        </div>
      </div>

      {/*
        THE ONE CONTROL ON THIS SCREEN THAT HAS TO BE FOUND IN A HURRY.

        It was a 13px muted text link, which is the treatment this app uses for
        things that do not matter — and this is the screen a guest has open while
        standing in the woods, which makes it the likeliest place in the whole app
        for somebody to go looking for help. Now a full-width bordered row at the
        DS control height, with a gold hairline and gold label so it reads as an
        affordance rather than a caption.

        Gold stays metal: a hairline edge and a label, never a flat fill — a solid
        gold block here would outrank the primary action on the screen (checking
        in) and pull every tap.

        The second line names the two ways through deliberately. Half the guests
        who need something have a question, not an emergency, and the old wording
        offered only "aid" — which reads as "for emergencies", so they don't tap
        it, and the quiet lane the chat was built for goes unused.
      */}
      <Link
        to="/help"
        aria-label="Need aid? Reach a Warden by call or chat"
        className="row"
        style={{
          gap: 12,
          marginTop: 14,
          padding: '10px 14px',
          minHeight: 56,
          textDecoration: 'none',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <span style={{ color: 'var(--text-gold)', display: 'inline-flex', flexShrink: 0 }}>
          <Icon name="shield" size={22} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              font: 'var(--button-ui)',
              letterSpacing: 'var(--tracking-label)',
              textTransform: 'uppercase',
              color: 'var(--text-gold)',
            }}
          >
            Need aid?
          </span>
          <span style={{ display: 'block', marginTop: 2, fontSize: 13, color: 'var(--text-muted)' }}>
            Summon a Warden, or ask a question by chat
          </span>
        </span>
        <Icon name="chevron-right" size={18} style={{ color: 'var(--text-muted)' }} />
      </Link>

      <Card tone="parchment" eyebrow="The quest brief">
        {ep.tagline}
      </Card>

      <div className="row row--between" style={{ marginTop: 18, alignItems: 'baseline' }}>
        <h2
          className="section-title"
          style={{ margin: 0, textTransform: 'uppercase', letterSpacing: 'var(--tracking-display)' }}
        >
          Stations on this episode
        </h2>
        <span style={{ font: 'var(--body-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {done.length} of {stations.length}
        </span>
      </div>

      <div className="stack" style={{ marginTop: 10 }}>
        {stations.map((st) => {
          const sealed = done.includes(st.id)
          const isNext = st.id === nextId
          const hidden = !sealed && !isNext
          const standing = hereId === st.id
          return (
            <div key={st.id} className="row" style={{ gap: 10 }}>
              <span
                style={{
                  color: sealed ? 'var(--text-gold)' : 'var(--text-muted)',
                  display: 'inline-flex',
                  flexShrink: 0,
                }}
              >
                <Icon
                  name={sealed ? 'stamp' : hidden ? 'circle-help' : (STATION_ICON[st.type] ?? 'map-pin')}
                  size={20}
                />
              </span>
              <span style={{ flex: 1, minWidth: 0, color: sealed ? 'var(--text-body)' : 'var(--text-muted)' }}>
                <span
                  title={hidden ? 'Not yet reached' : undefined}
                  aria-label={hidden ? 'Station not yet reached' : undefined}
                  style={
                    hidden
                      ? { display: 'inline-block', filter: 'blur(4px)', userSelect: 'none' }
                      : undefined
                  }
                >
                  {st.name}
                </span>
                {standing ? (
                  <span style={{ display: 'block', font: 'var(--body-sm)', color: 'var(--text-gold)' }}>
                    You are here — {minutesLeft} min left
                  </span>
                ) : null}
              </span>
              {sealed ? (
                <Tag icon="stamp">Sealed</Tag>
              ) : isNext ? (
                <Button size="sm" variant="ghost" icon="stamp" onClick={() => handleStationCheckIn(st)}>
                  Check in
                </Button>
              ) : (
                <Tag icon="lock">Ahead</Tag>
              )}
            </div>
          )
        })}
      </div>

      <p style={{ marginTop: 10, font: 'var(--body-sm)', color: 'var(--text-muted)' }}>
        {walking
          ? 'Check in at each station as you reach it — on this list or on the chart. The road ahead stays dark until you walk it. A party checks in together.'
          : 'Take this quest up at the gate — a passage buys one Quest Experience, and one Quest Experience is one episode. The Chief gives the brief; the trail opens one station at a time.'}
      </p>

      {!walking ? (
        <Button
          fullWidth
          size="lg"
          icon="door-open"
          style={{
            marginTop: 14,
            padding: '0 var(--space-md)',
            font: '700 var(--text-sm)/1 var(--font-ui)',
            letterSpacing: '0.05em',
          }}
          onClick={() => setGateOpen(true)}
        >
          Take up a quest at the gate
        </Button>
      ) : null}

      <Ornament style={{ margin: '20px 0' }} />

      <Input
        label="Guide's code"
        icon="key-round"
        placeholder="e.g. RANG-101"
        value={code}
        onChange={(e) => {
          setCode(e.target.value)
          if (codeError) setCodeError(undefined)
        }}
        error={codeError}
      />
      <p style={{ marginTop: 6, font: 'var(--body-sm)', color: 'var(--text-muted)' }}>
        A Guide can seal the whole episode at once if a marker will not read.
      </p>
      <Button
        fullWidth
        size="lg"
        icon="stamp"
        disabled={!code.trim()}
        style={{ marginTop: 12 }}
        onClick={handleStaffCode}
      >
        Claim the seal
      </Button>

      <div style={{ marginTop: 20 }}>
        {scanning ? (
          <QrScanner onDecode={handleScanDecode} onClose={() => setScanning(false)} />
        ) : (
          <Button
            fullWidth
            variant="ghost"
            icon="qr-code"
            onClick={() => {
              setScanError(undefined)
              setScanning(true)
            }}
          >
            Scan the marker
          </Button>
        )}
        {scanError ? (
          <p style={{ marginTop: 8, font: '400 var(--text-xs)/1.3 var(--font-ui)', color: 'var(--status-danger)' }}>
            {scanError}
          </p>
        ) : null}
      </div>

      {gateOpen ? (
        <GateArrival userId={user.id} orgId={org.id} onClose={() => setGateOpen(false)} />
      ) : null}
    </div>
  )
}
