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
import { checkIn, presenceFor, statusOf, windowLeft } from '../services/presenceService'
import { getOrg } from '../content/orgs'
import { stationsFor } from '../content/stations'
import type { Station } from '../content/types'
import { useToast } from '../components/Toast'
import { QrScanner } from '../components/QrScanner'
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
    const outcome = checkIn(user!.id, station.id, { orgId: org!.id })
    if (!outcome) return

    show({
      title: `Checked in — ${station.name}`,
      body: outcome.carried.length ? `${outcome.partyName} checked in with you.` : undefined,
      icon: 'stamp',
    })

    const credit = outcome.credit
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
        </div>
      </div>

      <Link
        to="/help"
        className="row"
        style={{ gap: 4, marginTop: 4, color: 'var(--text-muted)', fontSize: 13, fontWeight: 700 }}
      >
        <Icon name="shield" size={16} />
        Need aid?
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
        <span style={{ font: 'var(--body-sm)', color: 'var(--text-muted)' }}>
          {done.length} of {stations.length}
        </span>
      </div>

      <div className="stack" style={{ marginTop: 10 }}>
        {stations.map((st) => {
          const sealed = done.includes(st.id)
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
                <Icon name={sealed ? 'stamp' : (STATION_ICON[st.type] ?? 'map-pin')} size={20} />
              </span>
              <span style={{ flex: 1, color: sealed ? 'var(--text-body)' : 'var(--text-muted)' }}>
                {st.name}
                {standing ? (
                  <span style={{ display: 'block', font: 'var(--body-sm)', color: 'var(--text-gold)' }}>
                    You are here — {minutesLeft} min left
                  </span>
                ) : null}
              </span>
              {sealed ? (
                <Tag icon="stamp">Sealed</Tag>
              ) : (
                <Button size="sm" variant="ghost" icon="stamp" onClick={() => handleStationCheckIn(st)}>
                  Check in
                </Button>
              )}
            </div>
          )
        })}
      </div>

      <p style={{ marginTop: 10, font: 'var(--body-sm)', color: 'var(--text-muted)' }}>
        Tap a station as you reach it — on this list or on the chart. Walk all seven and the episode
        seals itself. A party checks in together.
      </p>

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
    </div>
  )
}
