import { Card, Icon } from '../ui'

// Kebab-case Lucide glyph names only — legacy emoji strings from callers not
// yet migrated fall back to their raw literal so they keep rendering as-is
// (data-level emoji purge for those call sites is a separate later pass).
const LUCIDE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

interface EmptyStateProps {
  /** Lucide glyph name, e.g. "scroll-text". */
  icon: string
  title: string
  body?: string
}

export default function EmptyState({ icon, title, body }: EmptyStateProps) {
  return (
    <Card pad="32px 20px" style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: 'var(--text-muted)' }}>
        {LUCIDE_NAME.test(icon) ? <Icon name={icon} size={32} /> : <span style={{ fontSize: 40 }}>{icon}</span>}
      </div>
      <h3 style={{ fontSize: 17, marginBottom: body ? 6 : 0 }}>{title}</h3>
      {body && <p className="muted">{body}</p>}
    </Card>
  )
}
