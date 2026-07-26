import React from 'react';
import { Icon } from '../core/Icon.jsx';

/* The app's fixed bottom bar. Opaque stone, gold hairline top, 64px. */
export function TabBar({ items = [], value, onChange, style, ...rest }) {
  return (
    <nav
      style={{
        height: 'var(--tabbar-h)', display: 'grid',
        gridTemplateColumns: 'repeat(' + Math.max(items.length, 1) + ',1fr)',
        background: 'var(--stone-950)', borderTop: '1px solid var(--border-hairline)',
        ...style,
      }}
      {...rest}>
      {items.map(it => {
        const active = it.id === value;
        return (
          <button
            key={it.id} onClick={() => onChange && onChange(it.id)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 4, background: 'none', border: 0, cursor: 'pointer',
              color: active ? 'var(--text-gold)' : 'var(--stone-300)',
              transition: 'color var(--dur-fast) var(--ease-standard)',
              position: 'relative',
            }}>
            {active ? <span style={{ position: 'absolute', top: 0, left: '28%', right: '28%', height: 2, background: 'var(--gold-500)' }} /> : null}
            <Icon name={it.icon} size={22} />
            <span style={{
              font: '700 9.5px/1 var(--font-ui)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
            }}>{it.label}</span>
            {it.badge ? (
              <span style={{
                position: 'absolute', top: 8, right: '28%', minWidth: 16, height: 16, padding: '0 4px',
                display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-pill)',
                background: 'var(--ember-500)', color: '#2A2016',
                font: '700 9px/1 var(--font-ui)',
              }}>{it.badge}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
