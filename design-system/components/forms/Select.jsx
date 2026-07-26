import React from 'react';
import { Icon } from '../core/Icon.jsx';

const LabelRow = ({ label, hint, htmlFor, required }) => (
  label ? (
    <label htmlFor={htmlFor} style={{
      display: 'flex', alignItems: 'baseline', gap: 'var(--space-xs)',
      font: 'var(--label-ui)', letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase', color: 'var(--text-gold)', marginBottom: 'var(--space-xs)',
    }}>
      {label}{required ? <span style={{ color: 'var(--status-danger)' }}>*</span> : null}
      {hint ? <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, font: '400 var(--text-xs)/1 var(--font-ui)', color: 'var(--text-muted)' }}>{hint}</span> : null}
    </label>
  ) : null
);

/* Native select in the carved field shell. */
export function Select({ label, hint, error, options = [], required = false, disabled = false, id, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const uid = React.useMemo(() => id || 'qa-sel-' + Math.random().toString(36).slice(2, 8), [id]);
  return (
    <div style={{ display: 'block', ...style }}>
      <LabelRow label={label} hint={hint} htmlFor={uid} required={required} />
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center',
        background: 'var(--surface-inset)',
        border: '1px solid ' + (error ? 'var(--status-danger)' : focus ? 'var(--gold-500)' : 'var(--border-hairline)'),
        borderRadius: 'var(--radius-xs)', boxShadow: 'var(--shadow-carve-in)',
        transition: 'var(--transition-control)', opacity: disabled ? .55 : 1,
      }}>
        <select
          id={uid} disabled={disabled}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{
            flex: 1, height: 44, padding: '0 40px 0 var(--space-sm)',
            background: 'transparent', border: 0, outline: 'none', appearance: 'none',
            color: 'var(--text-body)', font: 'var(--body-base)', cursor: 'pointer',
          }}
          {...rest}>
          {options.map(o => {
            const value = typeof o === 'string' ? o : o.value;
            const lab = typeof o === 'string' ? o : o.label;
            return <option key={value} value={value} style={{ background: 'var(--stone-800)' }}>{lab}</option>;
          })}
        </select>
        <span style={{ position: 'absolute', right: 'var(--space-sm)', pointerEvents: 'none', color: 'var(--text-gold)' }}>
          <Icon name="chevron-down" size={18} />
        </span>
      </div>
      {error ? <div style={{ marginTop: 6, font: '400 var(--text-xs)/1.3 var(--font-ui)', color: 'var(--status-danger)' }}>{error}</div> : null}
    </div>
  );
}
