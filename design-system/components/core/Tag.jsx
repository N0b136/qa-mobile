import React from 'react';
import { Icon } from './Icon.jsx';

/* Selectable filter chip — carved when off, gold when on. */
export function Tag({ children, selected = false, icon, onRemove, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const interactive = !!rest.onClick;
  return (
    <span
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 30, padding: '0 var(--space-sm)',
        font: '700 var(--text-xs)/1 var(--font-ui)',
        letterSpacing: '.08em', textTransform: 'uppercase',
        borderRadius: 'var(--radius-xs)', cursor: interactive ? 'pointer' : 'default',
        transition: 'var(--transition-control)',
        color: selected ? 'var(--brand-on-primary)' : hover ? 'var(--text-gold)' : 'var(--text-body)',
        background: selected ? 'var(--gold-500)' : 'var(--surface-inset)',
        border: '1px solid ' + (selected ? 'var(--gold-700)' : hover ? 'var(--border-strong)' : 'var(--border-hairline)'),
        boxShadow: selected ? 'inset 0 1px 0 rgba(246,235,212,.4)' : 'var(--shadow-carve-in)',
        ...style,
      }}
      {...rest}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
      {onRemove ? (
        <span onClick={e => { e.stopPropagation(); onRemove(e); }} style={{ display: 'flex', marginLeft: 2, opacity: .7 }}>
          <Icon name="x" size={13} />
        </span>
      ) : null}
    </span>
  );
}
