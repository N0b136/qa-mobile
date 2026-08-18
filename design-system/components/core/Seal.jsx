import React from 'react';
import { Icon } from './Icon.jsx';

const ART = {
  crown: 'assets/badge-crowned-realm-gold.png',
  compass: 'assets/badge-compass-sword.png',
  relief: 'assets/relief-pomegranate-tree-stone.png',
};
const SIZES = { sm: 56, md: 88, lg: 128 };

/* An awarded seal: physical badge art in a ceremonial gold ring. */
export function Seal({ art = 'crown', label, size = 'md', earned = true, assetBase = '', style, ...rest }) {
  const box = SIZES[size] || SIZES.md;
  const src = (assetBase ? assetBase.replace(/\/$/, '') + '/' : '') + (ART[art] || ART.crown);
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-xs)', ...style }} {...rest}>
      <div style={{
        width: box, height: box, display: 'grid', placeItems: 'center', borderRadius: '50%',
        background: earned ? 'radial-gradient(circle at 34% 26%, rgba(224,200,142,.16), rgba(18,18,20,.9) 70%)' : 'var(--surface-inset)',
        border: '2px solid ' + (earned ? 'var(--gold-600)' : 'var(--stone-600)'),
        borderStyle: earned ? 'solid' : 'dashed',
        boxShadow: earned ? 'var(--shadow-gold-glow)' : 'var(--shadow-carve-in)',
      }}>
        {earned
          ? <img src={src} alt="" style={{ width: box * 0.68, height: box * 0.68, objectFit: 'contain' }} />
          : <span style={{ color: 'var(--status-locked)' }}><Icon name="lock" size={box * 0.3} /></span>}
      </div>
      {label ? (
        <div style={{
          maxWidth: box + 32, textAlign: 'center',
          font: '700 var(--text-2xs)/1.3 var(--font-ui)', letterSpacing: 'var(--tracking-label)',
          textTransform: 'uppercase', color: earned ? 'var(--text-gold)' : 'var(--status-locked)',
        }}>{label}</div>
      ) : null}
    </div>
  );
}
