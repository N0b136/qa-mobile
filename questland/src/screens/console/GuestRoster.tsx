import type { Audience, GuestDoc } from '../../services/cloudSync'
import { listDirectory } from '../../services/consoleService'
import { getOrg } from '../../content/orgs'
import type { BadgeProps } from '../../ui'
import { Badge, Card, IconButton } from '../../ui'

interface Props {
  onSend: (audience: Audience) => void
}

function orgTone(orgId?: string): NonNullable<BadgeProps['tone']> | null {
  if (orgId === 'rangers') return 'valor'
  if (orgId === 'alehiim') return 'wilds'
  if (orgId === 'elm') return 'lore'
  return null
}

export default function GuestRoster({ onSend }: Props) {
  const directory = listDirectory()

  return (
    <Card eyebrow="Directory" title="Guests Afield">
      {directory.length === 0 ? (
        <p className="muted">No travellers have checked in yet.</p>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {directory.map((g: GuestDoc, i) => {
            const tone = orgTone(g.orgId)
            const orgName = g.orgId ? getOrg(g.orgId)?.name : undefined
            return (
              <div
                key={g.id}
                className="row row--between"
                style={{
                  padding: '12px 0',
                  gap: 10,
                  borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--text-heading)' }}>{g.name}</strong>
                    <Badge tone="gold">Lv {g.level}</Badge>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    {tone && orgName ? <Badge tone={tone}>{orgName}</Badge> : null}
                    {g.partyName ? (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {g.partyName}
                      </span>
                    ) : null}
                  </div>
                </div>
                <IconButton
                  icon="send"
                  label={`Send word to ${g.name}`}
                  size="sm"
                  onClick={() => onSend({ kind: 'guest', id: g.id })}
                />
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
