const { Button, Badge, Ornament, Icon, IconButton, Input, Seal, Card } = window.QuestlandAdventuresDesignSystem_fd4a09;
const { A, stations } = window.QA_APP;

window.StationCheckIn = function StationCheckIn({ index = 2, onBack, onSealed }) {
  const st = stations[index] || stations[2];
  const [answer, setAnswer] = React.useState('');
  const ok = answer.trim().toLowerCase() === 'river';
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ position: 'relative', height: 220, flex: '0 0 auto' }}>
        <img src={A + 'img-village-path.png'} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'var(--scrim-bottom)' }} />
        <div style={{ position: 'absolute', top: 'var(--space-sm)', left: 'var(--space-sm)' }}>
          <IconButton icon="arrow-left" label="Back" onClick={onBack} />
        </div>
        <div style={{ position: 'absolute', left: 'var(--space-md)', right: 'var(--space-md)', bottom: 'var(--space-md)' }}>
          <Badge tone="lore" icon="map-pin">Station {st.id} of 5</Badge>
          <h1 style={{ marginTop: 8, font: '600 var(--text-2xl)/1.1 var(--font-display)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-display-tight)' }}>{st.name}</h1>
        </div>
      </div>

      <div style={{ padding: 'var(--space-md)', display: 'grid', gap: 'var(--space-md)' }}>
        <Card tone="parchment" eyebrow="The fourth page" title="“Turn left where the ______ forgets its name.”">
          The scribe left one word out of every page. Look at the carving above the door.
        </Card>

        <Input label="The missing word" icon="scroll-text" value={answer}
               onChange={e => setAnswer(e.target.value)} placeholder="Type what you found"
               error={answer && !ok ? 'Not that one. Look again at the carving.' : undefined} />

        <Button fullWidth size="lg" icon="stamp" disabled={!ok} onClick={onSealed}>
          {ok ? 'Claim the seal' : 'Seal locked'}
        </Button>

        <Ornament label="Progress" />
        <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'center' }}>
          <Seal art="crown" label="Guildsworn" size="sm" assetBase="../.." />
          <Seal art="compass" label="Wayfinder" size="sm" assetBase="../.." />
          <Seal art="relief" label="Riverkeeper" size="sm" earned={false} assetBase="../.." />
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', font: '400 var(--text-sm)/1.45 var(--font-ui)', color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--text-gold)' }}><Icon name="footprints" size={18} /></span>
          Step-free detour available: follow the gold markers past the forge instead of the stairs.
        </div>
      </div>
    </div>
  );
};
