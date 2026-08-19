import React from 'react';
import { Icon } from './Icon.jsx';

const SIZES = {
  sm: { padding: '0 var(--space-sm)', height: 32, font: '700 var(--text-xs)/1 var(--font-ui)', icon: 16, cls: 'btn-gem-sm' },
  md: { padding: '0 var(--space-lg)', height: 44, font: 'var(--button-ui)', icon: 18, cls: '' },
  lg: { padding: '0 var(--space-xl)', height: 56, font: '700 var(--text-md)/1 var(--font-ui)', icon: 20, cls: 'btn-gem-lg' },
};

/* Filled variants render as faceted glass gems; ghost stays plain text (no jewel body to render). */
const GEM = {
  primary: { gem: 'citrine', shimmer: true },
  secondary: { gem: 'sapphire', shimmer: false },
  danger: { gem: 'ruby', shimmer: false },
};

const GHOST_STYLE = {
  background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent', boxShadow: 'none',
  hover: { color: 'var(--text-gold)' },
  press: { color: 'var(--gold-600)' },
};

/* Primary action. Citrine gem is reserved for `primary` — one per view. */
export function Button({
  children, variant = 'primary', size = 'md', icon, iconAfter,
  fullWidth = false, disabled = false, as = 'button', style, ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const Tag = as;
  const layout = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 'var(--space-xs)', width: fullWidth ? '100%' : undefined,
    height: s.height, padding: s.padding, font: s.font,
    letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
    textDecoration: 'none', whiteSpace: 'nowrap', cursor: disabled ? 'not-allowed' : 'pointer',
  };

  if (disabled) {
    return (
      <Tag disabled={as === 'button' ? disabled : undefined} style={{
        ...layout, borderRadius: 'var(--radius-sm)',
        background: 'var(--stone-700)', color: 'var(--status-locked)',
        border: '1px solid var(--stone-600)', boxShadow: 'var(--shadow-carve-in)',
        ...style,
      }} {...rest}>
        {icon ? <Icon name={icon} size={s.icon} /> : null}
        {children}
        {iconAfter ? <Icon name={iconAfter} size={s.icon} /> : null}
      </Tag>
    );
  }

  const gem = GEM[variant];
  if (gem) {
    return (
      <Tag className={`btn-gem btn-gem-${gem.gem}${s.cls ? ' ' + s.cls : ''}`}
        style={{ ...layout, transition: 'var(--transition-control)', ...style }} {...rest}>
        {gem.shimmer ? <i className="btn-gem-sheen" aria-hidden="true" /> : null}
        {icon ? <Icon name={icon} size={s.icon} /> : null}
        {children}
        {iconAfter ? <Icon name={iconAfter} size={s.icon} /> : null}
      </Tag>
    );
  }

  // ghost: plain text control, no jewel surface
  const v = GHOST_STYLE;
  const state = press ? v.press : hover ? v.hover : {};
  return (
    <Tag
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        ...layout, borderRadius: 'var(--radius-sm)', transition: 'var(--transition-control)',
        transform: press ? 'translateY(1px)' : 'none',
        ...v, ...state, ...style,
      }}
      {...rest}>
      {icon ? <Icon name={icon} size={s.icon} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={s.icon} /> : null}
    </Tag>
  );
}
