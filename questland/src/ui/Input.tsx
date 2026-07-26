import * as React from 'react';
import { Icon } from './Icon';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Uppercase gold label above the field. */
  label?: React.ReactNode;
  /** Right-aligned sentence-case helper on the label row. */
  hint?: React.ReactNode;
  /** Ruby message below the field; also reddens the border. */
  error?: React.ReactNode;
  /** Leading Lucide glyph inside the field. */
  icon?: string;
  required?: boolean;
  /** Render a textarea instead. */
  multiline?: boolean;
  rows?: number;
}

interface LabelRowProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor: string;
  required?: boolean;
}

function LabelRow({ label, hint, htmlFor, required }: LabelRowProps) {
  if (!label) return null;
  return (
    <label htmlFor={htmlFor} style={{
      display: 'flex', alignItems: 'baseline', gap: 'var(--space-xs)',
      font: 'var(--label-ui)', letterSpacing: 'var(--tracking-label)',
      textTransform: 'uppercase', color: 'var(--text-gold)', marginBottom: 'var(--space-xs)',
    }}>
      {label}{required ? <span style={{ color: 'var(--status-danger)' }}>*</span> : null}
      {hint ? <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, font: '400 var(--text-xs)/1 var(--font-ui)', color: 'var(--text-muted)' }}>{hint}</span> : null}
    </label>
  );
}

/* Text field. Carved into the stone — inset shadow, tight 2px radius. */
export function Input({
  label, hint, error, icon, required = false, disabled = false,
  multiline = false, rows = 4, id, style, ...rest
}: InputProps) {
  const [focus, setFocus] = React.useState(false);
  const uid = React.useMemo(() => id || 'qa-in-' + Math.random().toString(36).slice(2, 8), [id]);
  // Same element renders <input> or <textarea> depending on `multiline` — see
  // Button's `as` pattern for the ElementType precedent.
  const Tag = (multiline ? 'textarea' : 'input') as React.ElementType;
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
