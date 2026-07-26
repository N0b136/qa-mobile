import { Link } from 'react-router-dom'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { completedCount, currentEpisode, rankFor } from '../services/progressService'
import { ORGS } from '../content/orgs'
import ProgressBar from '../components/ProgressBar'
import { Badge, Card, Icon, Tag } from '../ui'
import { ORG_ICON } from './questIcons'

export default function QuestsScreen() {
  useAppTick()
  const user = currentUser()
  if (!user) return null

  // User's chosen order first (if set) — the other two questlines stay open below it.
  const orgs = user.orgId
    ? [...ORGS].sort((a, b) => (a.id === user.orgId ? -1 : b.id === user.orgId ? 1 : 0))
    : ORGS

  return (
    <div className="screen">
      <div className="row row--between">
        <h1 className="section-title" style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-display)' }}>
          <Icon name="swords" size={20} />
          Your questlines
        </h1>
        <Link to="/leaderboard" className="row" style={{ gap: 4, color: 'var(--text-gold)', fontSize: 13, fontWeight: 700 }}>
          <Icon name="trophy" size={18} />
          Standings
        </Link>
      </div>

      <div className="stack">
        {orgs.map((org) => {
          const count = completedCount(user.id, org.id)
          const rank = rankFor(org.id, count)
          const current = currentEpisode(user.id, org.id)
          return (
            <Link key={org.id} to={`/quests/${org.id}`} style={{ display: 'block' }}>
              <Card interactive>
                <div className="row" style={{ gap: 12 }}>
                  <span style={{ color: org.color, display: 'inline-flex', flexShrink: 0 }}>
                    <Icon name={ORG_ICON[org.id] ?? 'compass'} size={26} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row row--between">
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{org.name}</div>
                      {user.orgId === org.id ? <Tag>Your order</Tag> : null}
                    </div>
                    <Badge tone={org.track} style={{ marginTop: 4 }}>
                      {rank.name}
                    </Badge>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <ProgressBar value={count} max={10} color={org.color} />
                  <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {count} / 10 episodes
                  </p>
                  <p style={{ marginTop: 6, fontSize: 13 }}>{current ? current.title : 'Questline complete'}</p>
                </div>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
