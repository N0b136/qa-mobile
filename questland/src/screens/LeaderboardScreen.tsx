import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { getUserParty } from '../services/partyService'
import { partyStandings, playerStandings } from '../services/leaderboardService'
import { getOrg } from '../content/orgs'
import ProgressBar from '../components/ProgressBar'
import EmptyState from '../components/EmptyState'
import { Badge, Button, Card, Icon } from '../ui'
import { ORG_ICON } from './questIcons'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

function RankMarker({ rank }: { rank: number }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 17,
        fontWeight: 700,
        width: 32,
        flexShrink: 0,
        color: rank <= 3 ? 'var(--text-gold)' : 'var(--text-muted)',
      }}
    >
      #{rank}
    </div>
  )
}

export default function LeaderboardScreen() {
  useAppTick()
  const user = currentUser()
  const [view, setView] = useState<'parties' | 'players'>('parties')

  if (!user) return null

  const parties = partyStandings()
  const players = playerStandings()
  const myParty = getUserParty(user.id)
  const myPartyStanding = myParty ? parties.find((p) => p.party.id === myParty.id) : undefined
  const myPlayerStanding = players.find((p) => p.user.id === user.id)

  return (
    <div className="screen">
      <h1 className="section-title" style={{ ...capsHeadingStyle, margin: 0 }}>
        <Icon name="trophy" size={20} />
        Standings
      </h1>
      <p className="muted" style={{ marginTop: 6 }}>
        See how far each Party and adventurer has journeyed across all three questlines.
      </p>

      <div className="row" style={{ gap: 10, marginTop: 16 }}>
        <Button variant={view === 'parties' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('parties')}>
          Parties
        </Button>
        <Button variant={view === 'players' ? 'primary' : 'secondary'} size="sm" onClick={() => setView('players')}>
          Adventurers
        </Button>
      </div>

      {view === 'parties' ? (
        <>
          {myParty ? (
            myPartyStanding ? (
              <p style={{ marginTop: 14, color: 'var(--text-gold)', fontWeight: 700 }}>
                Your party — #{myPartyStanding.rank} of {parties.length}
              </p>
            ) : null
          ) : (
            <div className="row row--between" style={{ marginTop: 14, gap: 12, flexWrap: 'wrap' }}>
              <p className="muted" style={{ margin: 0 }}>
                Join a Party to enter the standings.
              </p>
              <Link to="/party">
                <Button size="sm" variant="secondary">
                  Join a Party
                </Button>
              </Link>
            </div>
          )}

          <div className="stack" style={{ marginTop: 16 }}>
            {parties.length === 0 ? (
              <EmptyState icon="trophy" title="No deeds recorded yet." />
            ) : (
              parties.map((standing) => {
                const isMine = myParty?.id === standing.party.id
                return (
                  <Card key={standing.party.id} style={isMine ? { border: '1px solid var(--gold-soft)' } : undefined}>
                    <div className="row" style={{ gap: 12 }}>
                      <RankMarker rank={standing.rank} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row row--between">
                          <div className="row" style={{ gap: 8 }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                              {standing.party.name}
                            </span>
                            {isMine ? <Badge tone="gold">Yours</Badge> : null}
                          </div>
                          <Badge>Lv {standing.level}</Badge>
                        </div>
                        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                          {standing.memberCount} adventurer{standing.memberCount === 1 ? '' : 's'}
                        </p>
                        <p className="muted" style={{ marginTop: 2, fontSize: 12 }}>
                          {standing.completed} episodes cleared
                        </p>
                      </div>
                    </div>
                  </Card>
                )
              })
            )}
          </div>
        </>
      ) : (
        <>
          {myPlayerStanding ? (
            <p style={{ marginTop: 14, color: 'var(--text-gold)', fontWeight: 700 }}>
              Your standing — #{myPlayerStanding.rank} of {players.length}
            </p>
          ) : null}

          <div className="stack" style={{ marginTop: 16 }}>
            {players.length === 0 ? (
              <EmptyState icon="trophy" title="No deeds recorded yet." />
            ) : (
              players.map((standing) => {
                const isMe = standing.user.id === user.id
                const org = standing.user.orgId ? getOrg(standing.user.orgId) : undefined
                return (
                  <Card key={standing.user.id} style={isMe ? { border: '1px solid var(--gold-soft)' } : undefined}>
                    <div className="row" style={{ gap: 12 }}>
                      <RankMarker rank={standing.rank} />
                      <span style={{ color: org?.color ?? 'var(--text-muted)', display: 'inline-flex', flexShrink: 0 }}>
                        <Icon name={org ? ORG_ICON[org.id] ?? 'compass' : 'user'} size={22} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row row--between">
                          <div className="row" style={{ gap: 8 }}>
                            <span style={{ fontWeight: 700 }}>{standing.user.name}</span>
                            {isMe ? <Badge tone="gold">You</Badge> : null}
                          </div>
                          <Badge>Lv {standing.level}</Badge>
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <ProgressBar value={standing.completed} max={30} color={org?.color} />
                          <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                            {standing.completed} / 30 episodes
                          </p>
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
