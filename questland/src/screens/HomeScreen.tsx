import { Link, useNavigate } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { useAppTick } from '../hooks/useAppTick'
import { currentUser } from '../services/authService'
import { completedCount, levelFor, rankFor, totalXp, xpIntoLevel, XP_PER_LEVEL } from '../services/progressService'
import { getUserParty } from '../services/partyService'
import { partyStandings } from '../services/leaderboardService'
import { ORGS, getOrg } from '../content/orgs'
import { load } from '../services/store'
import type { Booking } from '../types'
import ProgressBar from '../components/ProgressBar'
import EmptyState from '../components/EmptyState'
import { Card, Badge, Button, Icon, Ornament, Seal } from '../ui'

// content/orgs.ts still carries an emoji `sigil` field (data-level purge is a
// separate later pass) — this screen derives a Lucide glyph per org id instead.
const ORG_ICON: Record<string, string> = {
  rangers: 'compass',
  alehiim: 'scroll-text',
  elm: 'trees',
}

// Org -> DS Seal brand art (the chosen order's glyph, shown on the profile mark).
const ORG_SEAL_ART: Record<string, 'compass' | 'relief' | 'crown'> = {
  rangers: 'compass',
  alehiim: 'relief',
  elm: 'crown',
}

const sectionTitleStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

export default function HomeScreen() {
  useAppTick()
  const navigate = useNavigate()
  const user = currentUser()
  if (!user) return null

  const xp = totalXp(user.id)
  const level = levelFor(xp)
  const xpInto = xpIntoLevel(xp)

  const chosenOrg = user.orgId ? getOrg(user.orgId) : undefined
  const sealArt = chosenOrg ? ORG_SEAL_ART[chosenOrg.id] : undefined

  const parties = partyStandings()
  const myParty = getUserParty(user.id)
  const myPartyStanding = myParty ? parties.find((p) => p.party.id === myParty.id) : undefined

  const bookings = load<Booking[]>(`ql:bookings:${user.id}`, [])
  const today = new Date().toISOString().slice(0, 10)
  const nextBooking = bookings
    .filter((b) => b.status === 'confirmed' && b.date >= today)
    .sort((a, b) => (a.date === b.date ? a.slot.localeCompare(b.slot) : a.date.localeCompare(b.date)))[0]

  return (
    <div className="screen">
      <Card>
        <div className="row" style={{ gap: 14 }}>
          {chosenOrg && sealArt ? (
            <Seal art={sealArt} size="sm" assetBase="/" style={{ flexShrink: 0 }} />
          ) : (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'var(--gold-soft)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-gold)',
                flexShrink: 0,
              }}
            >
              <Icon name={user.avatar || 'shield'} size={28} />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div className="row row--between">
              <h2 style={{ fontSize: 19 }}>Well met, {user.name}!</h2>
              <Badge tone="gold">Lv {level}</Badge>
            </div>
            <div style={{ marginTop: 8 }}>
              <ProgressBar value={xpInto} max={XP_PER_LEVEL} />
              <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                {xpInto} / {XP_PER_LEVEL} XP to level {level + 1}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Ornament />

      <h2 className="section-title" style={sectionTitleStyle}>
        <Icon name="swords" size={18} />
        Your quests
      </h2>
      <div className="stack">
        {ORGS.map((org) => {
          const count = completedCount(user.id, org.id)
          const rank = rankFor(org.id, count)
          return (
            <Link key={org.id} to={`/quests/${org.id}`} style={{ display: 'block' }}>
              <Card interactive>
                <div className="row" style={{ gap: 12 }}>
                  <span style={{ color: org.color, display: 'inline-flex' }}>
                    <Icon name={ORG_ICON[org.id] ?? 'compass'} size={26} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{org.name}</div>
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
                </div>
              </Card>
            </Link>
          )
        })}
      </div>

      <h2 className="section-title" style={sectionTitleStyle}>
        <Icon name="trophy" size={18} />
        Standings
      </h2>
      <Link to="/leaderboard" style={{ display: 'block' }}>
        <Card interactive>
          {parties.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No parties have formed yet.
            </p>
          ) : (
            <>
              {myParty && myPartyStanding ? (
                <p style={{ margin: 0, color: 'var(--text-gold)', fontWeight: 700 }}>
                  Your party — #{myPartyStanding.rank} of {parties.length}
                </p>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Join a Party to climb the standings.
                </p>
              )}
              <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                {parties.slice(0, 5).map((standing) => {
                  const isMine = myParty?.id === standing.party.id
                  return (
                    <div
                      key={standing.party.id}
                      className="row row--between"
                      style={{
                        gap: 10,
                        padding: '4px 6px',
                        borderRadius: 'var(--radius-sm)',
                        background: isMine ? 'var(--gold-soft)' : 'transparent',
                      }}
                    >
                      <span className="row" style={{ gap: 10, minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: 13,
                            width: 22,
                            flexShrink: 0,
                            color: standing.rank <= 3 ? 'var(--text-gold)' : 'var(--text-muted)',
                          }}
                        >
                          #{standing.rank}
                        </span>
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {standing.party.name}
                        </span>
                      </span>
                      <Badge>Lv {standing.level}</Badge>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </Card>
      </Link>

      <h2 className="section-title" style={sectionTitleStyle}>
        <Icon name="calendar" size={18} />
        Your next visit
      </h2>
      {nextBooking ? (
        <Card>
          <div className="row row--between">
            <div>
              <div style={{ fontWeight: 800 }}>{nextBooking.date}</div>
              <div className="muted">{nextBooking.slot}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/bookings')}>
              View
            </Button>
          </div>
        </Card>
      ) : (
        <Link to="/book" style={{ display: 'block' }}>
          <Card interactive style={{ textAlign: 'center' }}>
            <div className="row" style={{ justifyContent: 'center', gap: 8, fontWeight: 700 }}>
              <Icon name="ticket" size={18} />
              Plan your next visit
            </div>
          </Card>
        </Link>
      )}

      <h2 className="section-title" style={sectionTitleStyle}>
        <Icon name="bell" size={18} />
        Happenings
      </h2>
      <EmptyState icon="scroll-text" title="The heralds are painting the notice board…" />
    </div>
  )
}
