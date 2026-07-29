import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { currentEpisode, getProgress, rankFor } from '../services/progressService'
import { getOrg } from '../content/orgs'
import { episodesFor } from '../content/quests'
import { stationsFor } from '../content/stations'
import type { Episode } from '../content/types'
import { questTaken } from '../services/presenceService'
import GateArrival from '../components/GateArrival'
import { ArchCard, Badge, Button, Dialog, Ornament, ProgressTrail, Seal } from '../ui'
import type { TrailStep } from '../ui'
import { ORG_SEAL_ART, romanNumeral } from './questIcons'

export default function QuestlineScreen() {
  useAppTick()
  const navigate = useNavigate()
  const { orgId } = useParams<{ orgId: string }>()
  const user = currentUser()
  const [loreEpisode, setLoreEpisode] = useState<Episode | null>(null)
  const [gateOpen, setGateOpen] = useState(false)

  if (!user) return null
  const org = orgId ? getOrg(orgId) : undefined
  if (!org) return <Navigate to="/quests" replace />

  const episodes = episodesFor(org.id)
  const doneIds = new Set(getProgress(user.id)[org.id] ?? [])
  const current = currentEpisode(user.id, org.id)
  const count = doneIds.size
  const rank = rankFor(org.id, count)
  // "Continue" rather than "Take up a quest at the gate" once THIS questline's
  // current episode has been taken. Read per questline, not off the one quest
  // they are physically walking: a Hero Pass opens all three at once, and
  // sealing an episode moves the questline on to one nobody has paid for yet.
  const walking = questTaken(user.id, org.id)

  const steps: TrailStep[] = episodes.map((ep) => {
    const state: TrailStep['state'] = doneIds.has(ep.id) ? 'complete' : current?.id === ep.id ? 'current' : 'locked'
    const checkpoint = org.ranks.find((r) => r.atEpisodes === ep.number && r.atEpisodes > 0)
    return {
      label: `${ep.number}. ${ep.title}${checkpoint ? ` — ${checkpoint.name}` : ''}`,
      state,
    }
  })

  function handleStepClick(index: number) {
    const episode = episodes[index]
    if (!episode) return
    if (current?.id === episode.id) {
      navigate(`/quests/${org!.id}/check-in`)
    } else if (doneIds.has(episode.id)) {
      setLoreEpisode(episode)
    }
    // locked steps never reach here — ProgressTrail withholds onStepClick for them.
  }

  return (
    <div className="screen">
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <Seal art={ORG_SEAL_ART[org.id]} size="md" assetBase={import.meta.env.BASE_URL} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              font: 'var(--title-section)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-display-tight)',
              color: 'var(--text-heading)',
            }}
          >
            {org.name}
          </h1>
          <p style={{ marginTop: 4, font: '400 var(--text-md)/1.35 var(--font-scribe)', color: 'var(--text-muted)' }}>
            {org.motto}
          </p>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Badge tone={org.track}>{rank.name}</Badge>
            <span className="muted" style={{ fontSize: 12 }}>
              {count} / 10 episodes
            </span>
          </div>
        </div>
      </div>

      <Ornament style={{ margin: '20px 0' }} />

      {current ? (
        <div style={{ maxWidth: 280, margin: '0 auto' }}>
          <ArchCard
            track={org.track}
            numeral={romanNumeral(current.number)}
            title={current.title}
            subtitle={`${stationsFor(current.id).length} Stations · Tap in as you arrive`}
            state="available"
          />
          <Button
            fullWidth
            size="lg"
            icon={walking ? 'footprints' : 'door-open'}
            style={
              walking
                ? { marginTop: 12 }
                : // "Take up a quest at the gate" is longer than the lg button's
                  // default tracking and padding allow — ease both rather than
                  // let it run under the edge.
                  {
                    marginTop: 12,
                    padding: '0 var(--space-md)',
                    // Override the shorthand Button sets, not just its size —
                    // mixing `font` with `fontSize` makes React complain.
                    font: '700 var(--text-sm)/1 var(--font-ui)',
                    letterSpacing: '0.05em',
                  }
            }
            onClick={
              walking ? () => navigate(`/quests/${org!.id}/check-in`) : () => setGateOpen(true)
            }
          >
            {walking ? 'Continue quest' : 'Take up a quest at the gate'}
          </Button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <Ornament label="Questline complete" />
          <p className="muted" style={{ marginTop: 12 }}>
            You have walked all ten episodes of {org.name}. Every seal is claimed — the Questline stays open to
            revisit anytime.
          </p>
        </div>
      )}

      <h2 className="section-title" style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-display)' }}>
        The full questline
      </h2>
      <ProgressTrail steps={steps} track={org.track} orientation="vertical" onStepClick={handleStepClick} blurLocked />

      <Dialog
        open={!!loreEpisode}
        eyebrow={loreEpisode ? `Episode ${loreEpisode.number}` : undefined}
        title={loreEpisode?.title}
        onClose={() => setLoreEpisode(null)}
        footer={
          <Button variant="secondary" onClick={() => setLoreEpisode(null)}>
            Close
          </Button>
        }
      >
        {loreEpisode?.loreOnComplete}
      </Dialog>

      {gateOpen ? (
        <GateArrival
          userId={user.id}
          orgId={org.id}
          onClose={() => setGateOpen(false)}
          onTaken={() => navigate(`/quests/${org!.id}/check-in`)}
        />
      ) : null}
    </div>
  )
}
