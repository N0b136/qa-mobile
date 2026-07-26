import * as React from 'react';
import { Icon } from './Icon';

/**
 * Gate-silhouette card (`--radius-arch`) for episodes and trail stations.
 */
export interface ArchCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  image?: string;
  imageAlt?: string;
  /** Roman numeral or station number, rendered in Cinzel Decorative. */
  numeral?: React.ReactNode;
  title: React.ReactNode;
  /** Uppercase gold sub-line: duration, distance, station count. */
  subtitle?: React.ReactNode;
  /** Questline track — paints the 3px top edge. */
  track?: 'valor' | 'lore' | 'wilds' | 'forge' | 'gold';
  /** locked keeps the arch shape but drops the image and shadow. */
  state?: 'available' | 'complete' | 'locked';
}

const TRACKS: Record<NonNullable<ArchCardProps['track']>, string> = {
  valor: 'var(--track-valor)', lore: 'var(--track-lore)', wilds: 'var(--track-wilds)', forge: 'var(--track-forge)', gold: 'var(--gold-600)',
};

/* The gate silhouette — the brand's one distinctive shape. Episodes and stations. */
export function ArchCard({
  image, imageAlt = '', numeral, title, subtitle, track = 'gold',
  state = 'available', onClick, style, ...rest
}: ArchCardProps) {
  const [hover, setHover] = React.useState(false);
  const locked = state === 'locked';
  const done = state === 'complete';
  const accent = TRACKS[track] || TRACKS.gold;
  return (
    <div
      onClick={locked ? undefined : onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', width: '100%', aspectRatio: '3 / 4', overflow: 'hidden',
        borderRadius: 'var(--radius-arch)',
        background: locked ? 'var(--surface-inset)' : 'var(--surface-card)',
        border: '1px ' + (locked ? 'dashed' : 'solid') + ' ' + (hover && !locked ? 'var(--border-strong)' : 'var(--border-hairline)'),
        boxShadow: locked ? 'none' : hover ? 'var(--shadow-lift)' : 'var(--shadow-sm)',
        cursor: locked ? 'default' : onClick ? 'pointer' : 'default',
        transition: 'box-shadow var(--dur-base) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)',
        ...style,
      }}
      {...rest}>
      {image && !locked ? (
        <img src={image} alt={imageAlt} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: done ? 'saturate(.7)' : 'none' }} />
      ) : null}
      <div style={{ position: 'absolute', inset: 0, background: locked ? 'none' : 'var(--scrim-bottom)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: accent, opacity: locked ? .35 : 1 }} />
      {numeral ? (
        <div style={{
          position: 'absolute', top: 'var(--space-lg)', left: 0, right: 0, textAlign: 'center',
          font: '900 var(--text-3xl)/1 var(--font-display-ornate)',
          color: locked ? 'var(--status-locked)' : 'var(--gold-300)',
          textShadow: locked ? 'none' : '0 2px 10px rgba(0,0,0,.7)',
        }}>{numeral}</div>
      ) : null}
      {locked || done ? (
        <div style={{
          position: 'absolute', top: 'var(--space-sm)', right: 'var(--space-sm)',
          color: locked ? 'var(--status-locked)' : 'var(--gold-300)',
        }}>
          <Icon name={locked ? 'lock' : 'stamp'} size={18} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: 'var(--space-md)', right: 'var(--space-md)', bottom: 'var(--space-md)' }}>
        <div style={{
          font: '600 var(--text-md)/1.15 var(--font-display)', textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-display-tight)',
          color: locked ? 'var(--status-locked)' : 'var(--text-heading)',
        }}>{title}</div>
        {subtitle ? (
          <div style={{
            marginTop: 6, font: '700 var(--text-2xs)/1.2 var(--font-ui)',
            letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
            color: locked ? 'var(--status-locked)' : 'var(--text-gold)',
          }}>{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}
