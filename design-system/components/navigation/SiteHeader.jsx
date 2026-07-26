import React from 'react';
import { Button } from '../core/Button.jsx';
import { IconButton } from '../core/IconButton.jsx';

/* Sticky website header: translucent over photography, gold hairline once scrolled. */
export function SiteHeader({
  logoSrc, brandName = 'Questland Adventures', links = [], activeLink,
  onNavigate, cta = 'Book your visit', onCta, scrolled = false, style, ...rest
}) {
  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 40, height: 'var(--header-h)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-xl)',
        padding: '0 var(--gutter-lg)',
        background: scrolled ? 'var(--surface-overlay)' : 'var(--scrim-top)',
        backdropFilter: scrolled ? 'var(--blur-veil)' : 'none',
        WebkitBackdropFilter: scrolled ? 'var(--blur-veil)' : 'none',
        borderBottom: '1px solid ' + (scrolled ? 'var(--border-hairline)' : 'transparent'),
        transition: 'background-color var(--dur-base) var(--ease-standard), border-color var(--dur-base) var(--ease-standard)',
        ...style,
      }}
      {...rest}>
      <a
        href="#" onClick={e => { e.preventDefault(); onNavigate && onNavigate(links[0] && (links[0].id || links[0])); }}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', textDecoration: 'none' }}>
        {logoSrc ? <img src={logoSrc} alt={brandName} style={{ height: 48, width: 'auto', display: 'block' }} /> : null}
        <span style={{
          font: '700 var(--text-sm)/1.1 var(--font-display)', letterSpacing: 'var(--tracking-display)',
          textTransform: 'uppercase', maxWidth: 120,
          background: 'var(--gradient-gold)', WebkitBackgroundClip: 'text', backgroundClip: 'text',
          color: 'var(--text-gold)', WebkitTextFillColor: 'transparent',
        }}>{brandName}</span>
      </a>
      <nav style={{ display: 'flex', gap: 'var(--space-lg)', marginLeft: 'auto' }}>
        {links.map(l => {
          const id = typeof l === 'string' ? l : l.id;
          const label = typeof l === 'string' ? l : l.label;
          const active = id === activeLink;
          return (
            <a
              key={id} href="#" onClick={e => { e.preventDefault(); onNavigate && onNavigate(id); }}
              style={{
                font: '700 var(--text-xs)/1 var(--font-ui)', letterSpacing: 'var(--tracking-label)',
                textTransform: 'uppercase', textDecoration: 'none',
                color: active ? 'var(--text-gold)' : 'var(--text-on-media)',
                borderBottom: '1px solid ' + (active ? 'var(--gold-500)' : 'transparent'),
                paddingBottom: 4,
              }}>{label}</a>
          );
        })}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
        <IconButton icon="search" label="Search" size="sm" />
        <Button size="sm" icon="ticket" onClick={onCta}>{cta}</Button>
      </div>
    </header>
  );
}
