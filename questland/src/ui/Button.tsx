import * as React from 'react';
import { Icon } from './Icon';

/**
 * Primary action control. The citrine gem is reserved for `primary` — one per view.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  /** primary = citrine gem; secondary = sapphire gem; ghost = text only; danger = ruby gem. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Lucide glyph name shown before the label. */
  icon?: string;
  /** Lucide glyph name shown after the label. */
  iconAfter?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  /** Render as another element, e.g. "a" for a link-button. */
  as?: 'button' | 'a';
}

type SizeSpec = { padding: string; height: number; font: string; icon: number; cls: string };
const SIZES: Record<NonNullable<ButtonProps['size']>, SizeSpec> = {
  sm: { padding: '0 var(--space-sm)', height: 32, font: '700 var(--text-xs)/1 var(--font-ui)', icon: 16, cls: 'btn-gem-sm' },
  md: { padding: '0 var(--space-lg)', height: 44, font: 'var(--button-ui)', icon: 18, cls: '' },
  lg: { padding: '0 var(--space-xl)', height: 56, font: '700 var(--text-md)/1 var(--font-ui)', icon: 20, cls: 'btn-gem-lg' },
};

/* Filled variants render as faceted glass gems; ghost stays plain text (no jewel body to render). */
type GemSpec = { gem: string; shimmer: boolean };
const GEM: Partial<Record<NonNullable<ButtonProps['variant']>, GemSpec>> = {
  primary: { gem: 'citrine', shimmer: true },
  secondary: { gem: 'sapphire', shimmer: false },
  danger: { gem: 'ruby', shimmer: false },
};

/* Tertiary/inline control: no jewel surface, so hover/press stay in JS like the other plain controls. */
const GHOST = {
  base: {
    background: 'transparent', color: 'var(--text-muted)',
    border: '1px solid transparent', boxShadow: 'none',
  } as React.CSSProperties,
  hover: { color: 'var(--text-gold)' } as React.CSSProperties,
  press: { color: 'var(--gold-600)' } as React.CSSProperties,
};

export function Button({
  children, variant = 'primary', size = 'md', icon, iconAfter,
  fullWidth = false, disabled = false, as = 'button', style, ...rest
}: ButtonProps) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const Tag = as as React.ElementType;

  // Shared box metrics. The gem chassis owns fill, border, radius and state —
  // never set those inline for a gem, inline styles outrank the stylesheet.
  const layout: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 'var(--space-xs)', width: fullWidth ? '100%' : undefined,
    height: s.height, padding: s.padding, font: s.font,
    letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
    textDecoration: 'none', whiteSpace: 'nowrap',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };

  const glyphs = (
    <>
      {icon ? <Icon name={icon} size={s.icon} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={s.icon} /> : null}
    </>
  );

  // Disabled is carved-out stone, never a gem — a dimmed jewel reads as a render bug.
  if (disabled) {
    return (
      <Tag
        disabled={as === 'button' ? disabled : undefined}
        style={{
          ...layout, borderRadius: 'var(--radius-sm)',
          background: 'var(--stone-700)', color: 'var(--status-locked)',
          border: '1px solid var(--stone-600)', boxShadow: 'var(--shadow-carve-in)',
          ...style,
        }}
        {...rest}>
        {glyphs}
      </Tag>
    );
  }

  const gem = GEM[variant];
  if (gem) {
    return (
      <Tag
        className={`btn-gem btn-gem-${gem.gem}${s.cls ? ' ' + s.cls : ''}`}
        style={{ ...layout, ...style }}
        {...rest}>
        {gem.shimmer ? <i className="btn-gem-sheen" aria-hidden="true" /> : null}
        {glyphs}
      </Tag>
    );
  }

  const state = press ? GHOST.press : hover ? GHOST.hover : {};
  return (
    <Tag
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        ...layout, borderRadius: 'var(--radius-sm)',
        transition: 'var(--transition-control)',
        transform: press ? 'translateY(1px)' : 'none',
        ...GHOST.base, ...state, ...style,
      }}
      {...rest}>
      {glyphs}
    </Tag>
  );
}
