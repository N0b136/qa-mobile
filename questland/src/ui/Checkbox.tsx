import * as React from 'react';
import { Icon } from './Icon';

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  /** Small sentence-case line under the label. */
  description?: React.ReactNode;
  checked?: boolean;
}

/* Checkbox: a carved square that fills gold when set. */
export function Checkbox({ label, description, checked = false, disabled = false, onChange, style, ...rest }: CheckboxProps) {
  const [hover, setHover] = React.useState(false);
  return (
    <label
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .55 : 1, ...style,
      }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange}
             style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} {...rest} />
      <span style={{
        flex: '0 0 auto', width: 20, height: 20, marginTop: 1,
        display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-xs)',
        background: checked ? 'var(--gold-500)' : 'var(--surface-inset)',
        border: '1px solid ' + (checked ? 'var(--gold-700)' : hover ? 'var(--border-strong)' : 'var(--border-hairline)'),
        boxShadow: checked ? 'inset 0 1px 0 rgba(246,235,212,.4)' : 'var(--shadow-carve-in)',
        color: 'var(--brand-on-primary)',
        transition: 'var(--transition-control)',
      }}>
        {checked ? <Icon name="check" size={14} strokeWidth={3} /> : null}
      </span>
      <span>
        <span style={{ display: 'block', font: 'var(--body-base)', color: 'var(--text-body)' }}>{label}</span>
        {description ? <span style={{ display: 'block', marginTop: 2, font: '400 var(--text-xs)/1.4 var(--font-ui)', color: 'var(--text-muted)' }}>{description}</span> : null}
      </span>
    </label>
  );
}
