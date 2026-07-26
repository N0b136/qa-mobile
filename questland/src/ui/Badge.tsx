import * as React from 'react';
import { Icon } from './Icon';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  /** Track tones map to questlines; `live` for now/open; `locked` renders dashed. */
  tone?: 'gold' | 'valor' | 'lore' | 'wilds' | 'forge' | 'live' | 'locked' | 'neutral';
  /** Lucide glyph name. */
  icon?: string;
  /** Show a leading status dot instead of an icon. */
  dot?: boolean;
}

type ToneSpec = { color: string; border: string; bg: string };
const TONES: Record<NonNullable<BadgeProps['tone']>, ToneSpec> = {
  gold: { color: 'var(--gold-300)', border: 'var(--gold-700)', bg: 'rgba(168,120,72,.16)' },
  valor: { color: 'var(--ruby-200)', border: 'var(--ruby-600)', bg: 'rgba(176,27,52,.18)' },
  lore: { color: 'var(--sapphire-200)', border: 'var(--sapphire-600)', bg: 'rgba(30,79,168,.20)' },
  wilds: { color: 'var(--moss-400)', border: 'var(--forest-500)', bg: 'rgba(74,90,69,.28)' },
  forge: { color: 'var(--ember-300)', border: 'var(--ember-700)', bg: 'rgba(224,123,42,.16)' },
  live: { color: 'var(--ember-300)', border: 'var(--ember-700)', bg: 'rgba(224,123,42,.16)' },
  locked: { color: 'var(--status-locked)', border: 'var(--stone-600)', bg: 'transparent' },
  neutral: { color: 'var(--text-muted)', border: 'var(--border-hairline)', bg: 'rgba(255,255,255,.03)' },
};

/* Small status object: OPEN TODAY, EPISODE II, LOCKED, track labels. */
export function Badge({ children, tone = 'neutral', icon, dot = false, style, ...rest }: BadgeProps) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 22, padding: '0 var(--space-xs)',
        font: '700 var(--text-2xs)/1 var(--font-ui)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
        color: t.color, background: t.bg,
        border: '1px solid ' + t.border,
        borderStyle: tone === 'locked' ? 'dashed' : 'solid',
        borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}>
      {dot ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color }} /> : null}
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
