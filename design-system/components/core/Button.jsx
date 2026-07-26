import React from 'react';
import { Icon } from './Icon.jsx';

const SIZES = {
  sm: { padding: '0 var(--space-sm)', height: 32, font: '700 var(--text-xs)/1 var(--font-ui)', icon: 16 },
  md: { padding: '0 var(--space-lg)', height: 44, font: 'var(--button-ui)', icon: 18 },
  lg: { padding: '0 var(--space-xl)', height: 56, font: '700 var(--text-md)/1 var(--font-ui)', icon: 20 },
};

const VARIANTS = {
  primary: {
    background: 'var(--brand-primary)', color: 'var(--brand-on-primary)',
    border: '1px solid var(--gold-700)', boxShadow: 'inset 0 1px 0 rgba(246,235,212,.45), var(--shadow-xs)',
    hover: { background: 'var(--brand-primary-hover)', boxShadow: 'var(--shadow-gold-glow)' },
    press: { background: 'var(--brand-primary-press)', boxShadow: 'var(--shadow-carve-in)' },
  },
  secondary: {
    background: 'transparent', color: 'var(--text-gold)',
    border: '1px solid var(--border-strong)', boxShadow: 'none',
    hover: { color: 'var(--gold-300)', borderColor: 'var(--gold-500)', background: 'rgba(224,200,142,.06)' },
    press: { background: 'rgba(0,0,0,.35)', boxShadow: 'var(--shadow-carve-in)' },
  },
  ghost: {
    background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent', boxShadow: 'none',
    hover: { color: 'var(--text-gold)' },
    press: { color: 'var(--gold-600)' },
  },
  danger: {
    background: 'var(--brand-danger)', color: 'var(--parchment-50)',
    border: '1px solid var(--ruby-800)', boxShadow: 'var(--shadow-xs)',
    hover: { background: 'var(--ruby-300)' },
    press: { background: 'var(--ruby-800)', boxShadow: 'var(--shadow-carve-in)' },
  },
};

/* Primary action. Gold = the one and only primary; everything else is quieter. */
export function Button({
  children, variant = 'primary', size = 'md', icon, iconAfter,
  fullWidth = false, disabled = false, as = 'button', style, ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.primary;
  const state = disabled ? {} : press ? v.press : hover ? v.hover : {};
  const Tag = as;
  return (
    <Tag
      disabled={as === 'button' ? disabled : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-xs)', width: fullWidth ? '100%' : undefined,
        height: s.height, padding: s.padding, font: s.font,
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase',
        textDecoration: 'none', whiteSpace: 'nowrap',
        borderRadius: 'var(--radius-sm)', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'var(--transition-control)',
        transform: press && !disabled ? 'translateY(1px)' : 'none',
        opacity: disabled ? 1 : 1,
        ...v, ...state,
        ...(disabled ? {
          background: 'var(--stone-700)', color: 'var(--status-locked)',
          border: '1px solid var(--stone-600)', boxShadow: 'var(--shadow-carve-in)',
        } : null),
        ...style,
      }}
      {...rest}>
      {icon ? <Icon name={icon} size={s.icon} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={s.icon} /> : null}
    </Tag>
  );
}
