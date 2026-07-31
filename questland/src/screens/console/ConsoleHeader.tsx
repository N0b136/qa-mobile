import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { StaffPersona } from '../../content/staff'
import type { CloudState } from '../../services/firebase'
import { cloudState, onCloudState } from '../../services/firebase'
import type { BadgeProps, TabItem } from '../../ui'
import { Badge, Button, Tabs } from '../../ui'

const capsHeadingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-display)',
}

/** Which surface the console is showing. Owned by ConsoleScreen, named here. */
export type ConsoleView = 'console' | 'manager'

// Both glyphs come from the DS readme's preferred vocabulary rather than the
// dashboard/chart icons a back office usually reaches for: `scroll-text` is the
// working board (calls, sends, records), and `key-round` says what the second
// tab actually is — a surface behind a lock, drawn only for a manager.
const VIEWS: TabItem[] = [
  { id: 'console', label: 'Back Office', icon: 'scroll-text' },
  { id: 'manager', label: 'Manager', icon: 'key-round' },
]

interface Props {
  persona: StaffPersona
  onSignOut: () => void
  view: ConsoleView
  onView: (view: ConsoleView) => void
  /** Draws the Manager tab. False for every staff account without a managers doc. */
  canManage: boolean
}

function cloudBadge(state: CloudState): { tone: NonNullable<BadgeProps['tone']>; label: string } {
  if (state === 'live') return { tone: 'live', label: 'Live' }
  if (state === 'disabled') return { tone: 'locked', label: 'Local only' }
  return { tone: 'neutral', label: 'Offline' }
}

export default function ConsoleHeader({ persona, onSignOut, view, onView, canManage }: Props) {
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

      {/* Its own flex child with no width of its own, so the header's phone
          wrap rules can drop it onto its own line rather than squeezing it.
          A lone tab is a control that cannot do anything, so the nav appears
          only once there is somewhere else to go. */}
      {canManage ? (
        <Tabs
          variant="segmented"
          items={VIEWS}
          value={view}
          onChange={(id) => onView(id as ConsoleView)}
          aria-label="Console view"
          style={{ maxWidth: '100%' }}
        />
      ) : null}

      <div className="console-header__spacer" />

      <div className="console-header__actions">
        <Badge tone={cloud.tone} dot>
          {cloud.label}
        </Badge>
        <Badge tone={persona.role === 'warden' ? 'valor' : 'wilds'} icon={persona.icon}>
          {persona.name}
        </Badge>
        <Button variant="ghost" size="sm" icon="log-out" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </header>
  )
}
