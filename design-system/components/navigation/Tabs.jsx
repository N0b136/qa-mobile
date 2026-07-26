import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* Underlined tab set (web) or a carved segmented control (app). */
export function Tabs({ items = [], value, onChange, variant = 'underline', style, ...rest }) {
  const segmented = variant === 'segmented';
  return (
    <div
      role="tablist"
      style={segmented ? {
        display: 'inline-flex', padding: 3, gap: 3, background: 'var(--surface-inset)',
        border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-pill)',
        boxShadow: 'var(--shadow-carve-in)', ...style,
      } : {
        display: 'flex', gap: 'var(--space-lg)', borderBottom: '1px solid var(--border-hairline)', ...style,
      }}
      {...rest}>
      {items.map(it => {
        const id = typeof it === 'string' ? it : it.id;
        const label = typeof it === 'string' ? it : it.label;
        const icon = typeof it === 'string' ? null : it.icon;
        const active = id === value;
        return (
          <button
            key={id} role="tab" aria-selected={active} onClick={() => onChange && onChange(id)}
            style={segmented ? {
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 var(--space-md)',
              borderRadius: 'var(--radius-pill)', border: '1px solid ' + (active ? 'var(--gold-700)' : 'transparent'),
              background: active ? 'var(--gold-600)' : 'transparent',
              color: active ? 'var(--brand-on-primary)' : 'var(--text-muted)',
              font: '700 var(--text-xs)/1 var(--font-ui)', letterSpacing: 'var(--tracking-label)',
              textTransform: 'uppercase', cursor: 'pointer', transition: 'var(--transition-control)',
            } : {
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-xs)',
              padding: '0 0 var(--space-sm)', marginBottom: -1, background: 'none',
              border: 0, borderBottom: '2px solid ' + (active ? 'var(--gold-500)' : 'transparent'),
              color: active ? 'var(--text-gold)' : 'var(--text-muted)',
              font: '700 var(--text-sm)/1 var(--font-ui)', letterSpacing: 'var(--tracking-label)',
              textTransform: 'uppercase', cursor: 'pointer', transition: 'var(--transition-control)',
            }}>
            {icon ? <Icon name={icon} size={16} /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}
