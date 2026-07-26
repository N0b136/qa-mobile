import React from 'react';

/* Radio: a carved circle with a gold gem centre. */
export function Radio({ label, description, checked = false, disabled = false, name, value, onChange, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <label
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, ...style,
      }}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChange}
             style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} {...rest} />
      <span style={{
        flex: '0 0 auto', width: 20, height: 20, marginTop: 1, borderRadius: '50%',
        display: 'grid', placeItems: 'center', background: 'var(--surface-inset)',
        border: '1px solid ' + (checked ? 'var(--gold-600)' : hover ? 'var(--border-strong)' : 'var(--border-hairline)'),
        boxShadow: checked ? 'var(--shadow-gold-glow)' : 'var(--shadow-carve-in)',
        transition: 'var(--transition-control)',
      }}>
        {checked ? <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--gradient-gold)' }} /> : null}
      </span>
      <span>
        <span style={{ display: 'block', font: 'var(--body-base)', color: 'var(--text-body)' }}>{label}</span>
        {description ? <span style={{ display: 'block', marginTop: 2, font: '400 var(--text-xs)/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>{description}</span> : null}
      </span>
    </label>
  );
}
