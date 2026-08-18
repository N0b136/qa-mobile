const { Seal, Ornament, Badge, Tabs, Card, Icon } = window.QuestlandAdventuresDesignSystem_fd4a09;
const { A, seals } = window.QA_APP;

window.Collection = function Collection() {
  const [filter, setFilter] = React.useState('all');
  const list = seals.filter(s => filter === 'all' || (filter === 'earned' ? s.earned : !s.earned));
  const earned = seals.filter(s => s.earned).length;
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-md)' }}>
      <div className="qa-label">Your seals</div>
      <h1 style={{ marginTop: 4, font: '700 var(--text-2xl)/1.1 var(--font-display)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-display-tight)' }}>
        {earned} of {seals.length} collected
      </h1>
      <div style={{ marginTop: 'var(--space-md)', display: 'flex', justifyContent: 'center' }}>
        <Tabs variant="segmented" value={filter} onChange={setFilter} items={[{ id: 'all', label: 'All' }, { id: 'earned', label: 'Earned' }, { id: 'locked', label: 'Locked' }]} />
      </div>
      <div style={{ marginTop: 'var(--space-lg)', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 'var(--space-lg) var(--space-sm)', justifyItems: 'center' }}>
        {list.map((s, i) => <Seal key={i} art={s.art} label={s.label} earned={s.earned} assetBase="../.." />)}
      </div>
      <Ornament label="Season passage" style={{ margin: 'var(--space-xl) 0 var(--space-md)' }} />
      <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-md)', display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
        <img src={A + 'badge-crowned-realm-gold.png'} alt="" style={{ height: 64 }} />
        <div>
          <div style={{ font: '600 var(--text-md)/1.15 var(--font-display)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-display-tight)', color: 'var(--text-heading)' }}>The crowned tree</div>
          <p style={{ marginTop: 4, font: '400 var(--text-sm)/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>Collect all six seals this season and the pin is yours at the gate.</p>
        </div>
      </div>
    </div>
  );
};
