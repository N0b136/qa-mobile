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

/* Text field. Carved into the stone — inset shadow, tight 2px radius. */
export function Input({
  label, hint, error, icon, required = false, disabled = false,
  multiline = false, rows = 4, id, style, ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const uid = React.useMemo(() => id || 'qa-in-' + Math.random().toString(36).slice(2, 8), [id]);
  const Tag = multiline ? 'textarea' : 'input';
  const border = error ? 'var(--status-danger)' : focus ? 'var(--gold-500)' : 'var(--border-hairline)';
  return (
    <div style={{ display: 'block', ...style }}>
      <LabelRow label={label} hint={hint} htmlFor={uid} required={required} />
      <div style={{
        position: 'relative', display: 'flex', alignItems: multiline ? 'flex-start' : 'center',
        background: 'var(--surface-inset)', border: '1px solid ' + border,
        borderRadius: 'var(--radius-xs)',
        boxShadow: focus ? 'var(--shadow-carve-in), 0 0 0 2px rgba(224,200,142,.22)' : 'var(--shadow-carve-in)',
        transition: 'var(--transition-control)',
        opacity: disabled ? .55 : 1,
      }}>
        {icon ? (
          <span style={{ padding: '0 0 0 var(--space-sm)', marginTop: multiline ? 12 : 0, color: focus ? 'var(--text-gold)' : 'var(--text-muted)' }}>
            <Icon name={icon} size={18} />
          </span>
        ) : null}
        <Tag
          id={uid} rows={multiline ? rows : undefined} disabled={disabled}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{
            flex: 1, width: '100%', background: 'transparent', border: 0, outline: 'none',
            color: 'var(--text-body)', font: 'var(--body-base)', resize: multiline ? 'vertical' : undefined,
            padding: multiline ? 'var(--space-sm)' : '0 var(--space-sm)',
            height: multiline ? undefined : 44, lineHeight: multiline ? 'var(--leading-normal)' : undefined,
          }}
          {...rest} />
      </div>
      {error ? (
        <div style={{ marginTop: 6, font: '400 var(--text-xs)/1.3 var(--font-ui)', color: 'var(--status-danger)' }}>{error}</div>
      ) : null}
    </div>
  );
}
