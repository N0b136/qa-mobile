// The park right now: how many are in it, and where they are standing.
//
// Every number is read from presenceService's own helpers. Nothing here decides
// what "en route" or "in the village" means — those windows and their edge cases
// live in that service, and a second opinion on this card would put the manager's
// phone and the Back Office board a party apart.

import { enRoute, inVillage, occupants } from '../../../services/presenceService'
import type { Occupant } from '../../../services/presenceService'
// The line a Guide reads on the board, reused rather than rewritten — "At the
// Maker's Cave", "En route — left the Sunken Hall 4 min ago".
import { questLine, statusLine } from '../GuestsAfield'
import type { BadgeProps } from '../../../ui'
import { Badge, Card, Icon } from '../../../ui'

/** Track colours are the ORDER's colours, fixed by canon. Never decorative. */
function orgTone(orgId?: string): NonNullable<BadgeProps['tone']> | null {
  if (orgId === 'rangers') return 'valor'
  if (orgId === 'alehiim') return 'wilds'
  if (orgId === 'elm') return 'lore'
  return null
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export default function PulseCard() {
  const now = Date.now()
  const all = occupants(now)
  const walking = enRoute(now)
  const village = inVillage(now)
  // Everyone else is standing at a station or at the chief's house. Derived by
  // subtraction rather than by testing `status`, so it stays correct if a fourth
  // presence status is ever added: an unaccounted party shows up in this figure
  // instead of silently vanishing from all three.
  const standing = all.length - walking.length - village.length
  const heads = all.reduce((n, o) => n + Math.max(1, o.memberNames.length), 0)

  if (all.length === 0) {
    return (
      <Card eyebrow="Right now" title="In the Park">
        <p className="muted">Nobody has checked in at the gate.</p>
      </Card>
    )
  }

  return (
    <Card eyebrow="Right now" title="In the Park">
      <p style={{ color: 'var(--text-heading)' }}>
        {plural(all.length, 'party', 'parties')}, {plural(heads, 'person', 'people')}
      </p>
      <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
        {standing} at stations · {walking.length} on the paths · {village.length} in the village
      </p>

      <div className="manager-rows" style={{ marginTop: 'var(--space-md)' }}>
        {all.map((o: Occupant) => {
          const status = statusLine(o, now)
          const quest = questLine(o)
          const tone = orgTone(o.orgId)
          return (
            <div key={o.key} style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Icon name={o.kind === 'party' ? 'users' : 'user'} size={15} />
                <strong style={{ color: 'var(--text-heading)' }}>{o.name}</strong>
                {tone && o.orgName ? <Badge tone={tone}>{o.orgName}</Badge> : null}
              </div>
              <div className="row muted" style={{ gap: 6, marginTop: 4, fontSize: 13 }}>
                <Icon name={status.icon} size={13} />
                {status.text}
              </div>
              {quest ? (
                <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>
                  {quest}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
