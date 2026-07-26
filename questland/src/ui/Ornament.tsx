import * as React from 'react';

export interface OrnamentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** rule = hairline with centred ✦ or label; plain = full-width hairline; star = inline ✦ separator. */
  variant?: 'rule' | 'plain' | 'star';
  /** Centred uppercase gold label in place of the ✦. */
  label?: React.ReactNode;
}

/* Gold hairline rule with the logo's ✦ — the system's only decoration. */
export function Ornament({ variant = 'rule', label, style, ...rest }: OrnamentProps) {
  if (variant === 'star') {
    return (
      <span
        style={{ color: 'var(--gold-700)', font: '400 1em/1 var(--font-ui)', ...style }}
        {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>
        ✦
      </span>
    );
  }
  if (variant === 'plain') {
    return (
      <hr
        className="qa-rule"
        style={{ margin: 0, ...style }}
        {...(rest as React.HTMLAttributes<HTMLHRElement>)}
      />
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', ...style }} {...rest}>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,var(--border-strong))' }} />
      {label ? (
        <span style={{
          font: 'var(--label-ui)', letterSpacing: 'var(--tracking-label)',
          textTransform: 'uppercase', color: 'var(--text-gold)',
        }}>{label}</span>
      ) : <span style={{ color: 'var(--gold-400)', fontSize: 15 }}>✦</span>}
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,var(--border-strong),transparent)' }} />
    </div>
  );
}
