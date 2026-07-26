import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { StaffPersona } from '../../content/staff'
import type { CloudState } from '../../services/firebase'
import { cloudState, onCloudState } from '../../services/firebase'
import type { BadgeProps } from '../../ui'
import { Badge, Button } from '../../ui'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

interface Props {
  persona: StaffPersona
  onSwitch: () => void
}

function cloudBadge(state: CloudState): { tone: NonNullable<BadgeProps['tone']>; label: string } {
  if (state === 'live') return { tone: 'live', label: 'Live' }
  if (state === 'disabled') return { tone: 'locked', label: 'Local only' }
  return { tone: 'neutral', label: 'Offline' }
}

export default function ConsoleHeader({ persona, onSwitch }: Props) {
  const [state, setState] = useState<CloudState>(() => cloudState())
  useEffect(() => onCloudState(setState), [])

  const cloud = cloudBadge(state)

  return (
    <header className="console-header">
      <img
        src={`${import.meta.env.BASE_URL}assets/logo-questland-primary.png`}
        alt="Questland Adventures"
        style={{ height: 38, width: 'auto', objectFit: 'contain', display: 'block' }}
      />
      <h1
        className="section-title"
        style={{ ...capsHeadingStyle, margin: 0, fontSize: 18 }}
      >
        Back Office
      </h1>

      <div className="console-header__spacer" />

      <div className="console-header__actions">
        <Badge tone={cloud.tone} dot>
          {cloud.label}
        </Badge>
        <Badge tone={persona.role === 'warden' ? 'valor' : 'wilds'} icon={persona.icon}>
          {persona.name}
        </Badge>
        <Button variant="ghost" size="sm" icon="repeat" onClick={onSwitch}>
          Switch
        </Button>
      </div>
    </header>
  )
}
