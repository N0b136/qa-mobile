import React from 'react';

/* Switch: an iron latch that slides. Used for app preferences only. */
export function Switch({ label, description, checked = false, disabled = false, onChange, style, ...rest }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, ...style,
    }}>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', font: 'var(--body-base)', color: 'var(--text-body)' }}>{label}</span>
        {description ? <span style={{ display: 'block', marginTop: 2, font: '400 var(--text-xs)/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>{description}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange}
             style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} {...rest} />
      <span style={{
        position: 'relative', flex: '0 0 auto', width: 46, height: 26, borderRadius: 'var(--radius-pill)',
        background: checked ? 'var(--gold-700)' : 'var(--surface-inset)',
        border: '1px solid ' + (checked ? 'var(--gold-600)' : 'var(--border-hairline)'),
        boxShadow: 'var(--shadow-carve-in)',
        transition: 'background-color var(--dur-base) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 22 : 2, width: 20, height: 20,
          borderRadius: '50%', background: checked ? 'var(--gradient-gold)' : 'var(--stone-400)',
          boxShadow: 'var(--shadow-xs)',
          transition: 'left var(--dur-base) var(--ease-out-door)',
        }} />
      </span>
    </label>
  );
}
