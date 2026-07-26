import type { CSSProperties } from 'react'
import { STAFF_PERSONAS } from '../../content/staff'
import { setStaffPersonaId } from '../../services/consoleService'
import { Badge, Card, Icon } from '../../ui'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

interface Props {
  onPick: (id: string) => void
}

// Before the console opens, the presenter chooses who answers the call. The
// persona is stored locally and stamps every dispatch and scheduled send.
export default function PersonaGate({ onPick }: Props) {
  function pick(id: string) {
    setStaffPersonaId(id)
    onPick(id)
  }

  return (
    <div className="console-gate">
      <div>
        <h1 className="section-title" style={{ ...capsHeadingStyle, justifyContent: 'center', margin: 0 }}>
          Who Answers the Call
        </h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Choose your guild persona. Wardens hold the emergencies; Guides carry the hints.
        </p>
      </div>

      <div className="console-gate__grid">
        {STAFF_PERSONAS.map((p) => (
          <Card
            key={p.id}
            interactive
            onClick={() => pick(p.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                pick(p.id)
              }
            }}
          >
            <div className="stack" style={{ gap: 10, alignItems: 'center', textAlign: 'center' }}>
              <span style={{ color: 'var(--text-gold)' }}>
                <Icon name={p.icon} size={32} />
              </span>
              <strong style={{ color: 'var(--text-heading)' }}>{p.name}</strong>
              <Badge tone={p.role === 'warden' ? 'valor' : 'wilds'} icon={p.icon}>
                {p.role === 'warden' ? 'Warden' : 'Guide'}
              </Badge>
              <p className="muted" style={{ fontSize: 13 }}>
                {p.blurb}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
