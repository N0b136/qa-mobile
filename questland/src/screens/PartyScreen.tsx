import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser, getUser } from '../services/authService'
import { completedCount, levelFor, totalXp } from '../services/progressService'
import { createParty, getUserParty, joinParty, leaveParty } from '../services/partyService'
import { ORGS, getOrg } from '../content/orgs'
import ProgressBar from '../components/ProgressBar'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, Dialog, Icon, Input } from '../ui'
import { isTracked, placeNameFor, presenceFor, statusOf, windowLeft } from '../services/presenceService'
import { romanNumeral } from './questIcons'

// content/orgs.ts still carries an emoji `sigil` field (data-level purge is a
// separate later pass) — this screen derives a Lucide glyph per org id instead.
const ORG_ICON: Record<string, string> = {
  rangers: 'compass',
  alehiim: 'scroll-text',
  elm: 'trees',
}

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

export default function PartyScreen() {
  useAppTick()
  const toast = useToast()
  const user = currentUser()
  const [partyName, setPartyName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [busy, setBusy] = useState<'create' | 'join' | 'leave' | null>(null)

  if (!user) return null

  const party = getUserParty(user.id)

  // Create/join/leave are validated against the cloud, so each is a round trip.
  async function handleCreate() {
    if (!user || busy) return
    setBusy('create')
    try {
      await createParty(user.id, partyName)
      setPartyName('')
    } finally {
      setBusy(null)
    }
  }

  async function handleJoin() {
    if (!user || busy) return
    if (!joinCode.trim()) {
      setJoinError('Enter an invite code first.')
      return
    }
    setBusy('join')
    try {
      const result = await joinParty(user.id, joinCode)
      if (!result.ok) {
        setJoinError(result.error)
        return
      }
      setJoinError('')
      setJoinCode('')
    } finally {
      setBusy(null)
    }
  }

  async function handleCopyCode() {
    if (!party) return
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(party.code)
      }
    } catch {
      // clipboard unavailable — the code is still shown on screen
    }
    toast.show({ title: 'Code copied', icon: 'copy' })
  }

  async function handleLeave() {
    if (!user || busy) return
    setBusy('leave')
    try {
      await leaveParty(user.id)
      setConfirmingLeave(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="screen">
      <h1 className="section-title" style={{ ...capsHeadingStyle, margin: 0 }}>
        <Icon name="users-round" size={20} />
        My Party
      </h1>
      <Link
        to="/leaderboard"
        className="row"
        style={{ gap: 4, marginTop: 6, color: 'var(--text-gold)', fontSize: 13, fontWeight: 700 }}
      >
        <Icon name="trophy" size={16} />
        View standings
      </Link>

      {!party ? (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            A Party lets fellow adventurers see one another&apos;s questline progress as you travel Questia
            together. Start one, or answer an invite code from a friend.
          </p>

          <div className="stack" style={{ marginTop: 18 }}>
            <Card eyebrow="Start a fellowship" title="Create a Party">
              <div className="stack" style={{ gap: 12 }}>
                <Input
                  label="Party name"
                  placeholder={`${user.name.split(' ')[0]}'s Party`}
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                />
                <Button icon="users-round" disabled={busy !== null} onClick={handleCreate}>
                  {busy === 'create' ? 'Raising the banner…' : 'Create a Party'}
                </Button>
              </div>
            </Card>

            <Card eyebrow="Already have a code" title="Join a Party">
              <div className="stack" style={{ gap: 12 }}>
                <Input
                  label="Invite code"
                  icon="key-round"
                  placeholder="ABC123"
                  value={joinCode}
                  error={joinError || undefined}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase())
                    if (joinError) setJoinError('')
                  }}
                  style={{ textTransform: 'uppercase' }}
                />
                <Button variant="secondary" icon="user-plus" disabled={busy !== null} onClick={handleJoin}>
                  {busy === 'join' ? 'Answering the code…' : 'Join a Party'}
                </Button>
              </div>
            </Card>
          </div>
        </>
      ) : (
        <div className="stack" style={{ marginTop: 18 }}>
          <Card>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, textTransform: 'uppercase' }}>
              {party.name}
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              {party.memberIds.length} adventurer{party.memberIds.length === 1 ? '' : 's'}
            </p>
            <div className="row row--between" style={{ marginTop: 14, gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
                  Invite code
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: '0.12em', color: 'var(--text-gold)' }}>
                  {party.code}
                </div>
              </div>
              <Button variant="secondary" size="sm" icon="copy" onClick={handleCopyCode}>
                Copy code
              </Button>
            </div>
          </Card>

          <div className="stack" style={{ gap: 12 }}>
            {party.memberIds.map((memberId) => {
              const member = getUser(memberId)
              if (!member) return null
              const org = member.orgId ? getOrg(member.orgId) : undefined
              const xp = totalXp(member.id)
              const isYou = member.id === user.id
              return (
                <Card key={member.id}>
                  <div className="row" style={{ gap: 12 }}>
                    <span
                      style={{
                        color: org?.color ?? 'var(--text-muted)',
                        display: 'inline-flex',
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={org ? ORG_ICON[org.id] ?? 'compass' : 'user'} size={24} />
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="row row--between">
                        <div className="row" style={{ gap: 8 }}>
                          <span style={{ fontWeight: 700 }}>{member.name}</span>
                          {isYou ? <Badge tone="gold">You</Badge> : null}
                        </div>
                        <Badge>Lv {levelFor(xp)}</Badge>
                      </div>
                      <MemberWhereabouts memberId={member.id} />
                    </div>
                  </div>
                  <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                    {ORGS.map((o) => {
                      const count = completedCount(member.id, o.id)
                      return (
                        <div key={o.id}>
                          <div className="row row--between" style={{ fontSize: 12 }}>
                            <span className="muted">{o.name}</span>
                            <span className="muted">{count} / 10</span>
                          </div>
                          <ProgressBar value={count} max={10} color={o.color} />
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )
            })}
          </div>

          <Button
            variant="ghost"
            icon="log-out"
            style={{ color: 'var(--status-danger)' }}
            onClick={() => setConfirmingLeave(true)}
          >
            Leave party
          </Button>
        </div>
      )}

      {confirmingLeave ? (
        <Dialog
          title="Leave this party?"
          onClose={() => setConfirmingLeave(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmingLeave(false)}>
                Stay
              </Button>
              <Button variant="danger" disabled={busy !== null} onClick={handleLeave}>
                {busy === 'leave' ? 'Parting ways…' : 'Leave party'}
              </Button>
            </>
          }
        >
          <p>You&apos;ll need a fresh invite code to rejoin {party?.name ?? 'this party'} later.</p>
        </Dialog>
      ) : null}
    </div>
  )
}

/**
 * Where a party member is and what they are walking, read straight off their
 * presence record — the same package the Back Office sees.
 */
function MemberWhereabouts({ memberId }: { memberId: string }) {
  const p = presenceFor(memberId)
  if (!p || !isTracked(p)) return null

  const status = statusOf(p)
  const place = placeNameFor(p)
  const mins = Math.max(1, Math.ceil(windowLeft(p) / 60000))

  const where =
    status === 'village'
      ? `In the ${place}`
      : status === 'en-route'
        ? `En route from ${place}`
        : `At ${place} — ${mins} min left`

  const walk =
    p.episodeNumber && p.stationsTotal
      ? `Episode ${romanNumeral(p.episodeNumber)} · ${p.stationsDone ?? 0} of ${p.stationsTotal}`
      : null

  return (
    <div style={{ marginTop: 4 }}>
      <div className="row muted" style={{ gap: 6, fontSize: 12 }}>
        <Icon name={status === 'en-route' ? 'footprints' : status === 'village' ? 'castle' : 'map-pin'} size={12} />
        {where}
      </div>
      {walk ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {walk}
          {p.nextStationName ? ` · next ${p.nextStationName}` : ''}
        </div>
      ) : null}
    </div>
  )
}
