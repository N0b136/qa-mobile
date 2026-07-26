import { Card, Icon } from '../ui'

export default function PlaceholderScreen({ title }: { title: string }) {
  return (
    <div className="screen">
      <h1
        className="section-title"
        style={{ textTransform: 'uppercase', letterSpacing: 'var(--tracking-display)' }}
      >
        {title}
      </h1>
      <Card>
        <div className="row" style={{ gap: 10 }}>
          <Icon name="castle" size={20} />
          <p>Coming soon — the guilds are still building this hall.</p>
        </div>
      </Card>
    </div>
  )
}
