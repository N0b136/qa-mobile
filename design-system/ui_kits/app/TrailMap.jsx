const { Badge, Button, Ornament, Icon, IconButton, Tabs, Tooltip, ProgressTrail } = window.QuestlandAdventuresDesignSystem_fd4a09;
const { A, stations } = window.QA_APP;

window.TrailMap = function TrailMap({ onOpenStation }) {
  const [mode, setMode] = React.useState('map');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'relative', flex: mode === 'map' ? '1 1 auto' : '0 0 190px', overflow: 'hidden' }}>
        <img src={A + 'img-village-path.png'} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(.85) contrast(1.05)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'var(--scrim-top)' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'var(--scrim-bottom)' }} />
        <div style={{ position: 'absolute', top: 'var(--space-md)', left: 'var(--space-md)', right: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          <Badge tone="lore" icon="scroll-text">Scribe's Hollow</Badge>
          <Badge tone="live" dot>Live</Badge>
          <span style={{ marginLeft: 'auto' }}>
            <Tooltip label="Recentre the chart"><IconButton icon="compass" label="Recentre" variant="solid" /></Tooltip>
          </span>
        </div>
        {mode === 'map' ? [
          { t: '38%', l: '22%', s: 'complete' }, { t: '52%', l: '46%', s: 'complete' },
          { t: '40%', l: '68%', s: 'current' }, { t: '68%', l: '80%', s: 'locked' },
        ].map((m, i) => (
          <div key={i} style={{ position: 'absolute', top: m.t, left: m.l, transform: 'translate(-50%,-50%)' }}>
            <div style={{
              width: m.s === 'current' ? 40 : 28, height: m.s === 'current' ? 40 : 28,
              display: 'grid', placeItems: 'center', borderRadius: '50%',
              background: m.s === 'complete' ? 'var(--track-lore)' : m.s === 'current' ? 'var(--gold-600)' : 'rgba(18,18,20,.75)',
              border: '2px ' + (m.s === 'locked' ? 'dashed' : 'solid') + ' ' + (m.s === 'locked' ? 'var(--stone-500)' : 'var(--gold-300)'),
              color: m.s === 'locked' ? 'var(--status-locked)' : m.s === 'current' ? 'var(--brand-on-primary)' : 'var(--parchment-50)',
              boxShadow: m.s === 'current' ? 'var(--shadow-gold-glow)' : 'var(--shadow-sm)',
            }}>
              <Icon name={m.s === 'complete' ? 'check' : m.s === 'locked' ? 'lock' : 'map-pin'} size={m.s === 'current' ? 20 : 14} strokeWidth={m.s === 'complete' ? 3 : 2} />
            </div>
          </div>
        )) : null}
        <div style={{ position: 'absolute', bottom: 'var(--space-md)', left: 'var(--space-md)', right: 'var(--space-md)', display: 'flex', justifyContent: 'center' }}>
          <Tabs variant="segmented" value={mode} onChange={setMode} items={[{ id: 'map', label: 'Chart' }, { id: 'list', label: 'Stations' }]} />
        </div>
      </div>

      <div style={{ flex: mode === 'list' ? '1 1 auto' : '0 0 auto', overflowY: 'auto', padding: 'var(--space-md)', background: 'var(--surface-page)' }}>
        {mode === 'map' ? (
          <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', padding: 'var(--space-md)' }}>
            <div className="qa-label">Next station · 300 m</div>
            <h3 style={{ marginTop: 6, font: '600 var(--text-lg)/1.15 var(--font-display)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-display-tight)' }}>The Scribe's Hollow</h3>
            <p style={{ marginTop: 8, font: 'var(--body-base)', color: 'var(--text-muted)' }}>Find the missing word on the fourth page. Bring good boots.</p>
            <div style={{ marginTop: 'var(--space-md)' }}>
              <Button fullWidth size="lg" icon="stamp" onClick={() => onOpenStation(2)}>Check in</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
            <ProgressTrail orientation="vertical" track="lore" steps={stations.map(s => ({ label: s.name + ' · ' + s.minutes + ' min', state: s.state }))}
                           onStepClick={i => stations[i].state !== 'locked' && onOpenStation(i)}
                           style={{ background: 'var(--surface-card)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-md)' }} />
            <Ornament label="3 of 5 sealed" />
          </div>
        )}
      </div>
    </div>
  );
};
