const { Ornament, Badge, Icon, Switch, Button, Card } = window.QuestlandAdventuresDesignSystem_fd4a09;
const { A, party } = window.QA_APP;

window.Party = function Party() {
  const [audio, setAudio] = React.useState(true);
  const [hints, setHints] = React.useState(false);
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-md)' }}>
      <div className="qa-label">Your party</div>
      <h1 style={{ marginTop: 4, font: '700 var(--text-2xl)/1.1 var(--font-display)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-display-tight)' }}>
        The Ashcroft four
      </h1>
      <div style={{ marginTop: 'var(--space-xs)', display: 'flex', gap: 'var(--space-xs)' }}>
        <Badge tone="gold" icon="crown">Season passage</Badge>
        <Badge tone="lore" icon="scroll-text">Scribe's Hollow</Badge>
      </div>

      <div style={{ marginTop: 'var(--space-lg)', display: 'grid', gap: 'var(--space-xs)' }}>
        {party.map(p => (
          <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', background: 'var(--surface-card)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-sm) var(--space-md)' }}>
            <span style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'var(--surface-inset)', border: '1px solid var(--gold-700)', color: 'var(--text-gold)', font: '700 var(--text-sm)/1 var(--font-display)' }}>{p.name[0]}</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', font: '400 var(--text-md)/1.2 var(--font-body)', color: 'var(--text-heading)' }}>{p.name}</span>
              <span style={{ display: 'block', font: '700 var(--text-2xs)/1.2 var(--font-ui)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{p.role}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-gold)', font: '700 var(--text-sm)/1 var(--font-ui)' }}>
              <Icon name="stamp" size={16} />{p.seals}
            </span>
          </div>
        ))}
      </div>

      <Ornament label="On the trail" style={{ margin: 'var(--space-xl) 0 var(--space-md)' }} />
      <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <Switch checked={audio} onChange={() => setAudio(!audio)} label="Story audio" description="Narration plays at each station" />
        <Switch checked={hints} onChange={() => setHints(!hints)} label="Nudges" description="A hint after ten minutes at a station" />
      </div>

      <div style={{ marginTop: 'var(--space-xl)' }}>
        <Card tone="parchment" eyebrow="Your passage" title="Sat 12 Jul · 9:00" meta={<>4 ADVENTURERS · SEALED AT THE GATE</>}>
          Show this at the gate. Wardens can add a fifth adventurer on the day.
        </Card>
      </div>
      <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-sm)' }}>
        <Button variant="secondary" icon="users" fullWidth>Invite</Button>
        <Button variant="ghost" icon="map" fullWidth>Chart</Button>
      </div>
    </div>
  );
};
