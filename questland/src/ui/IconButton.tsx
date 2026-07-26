import * as React from 'react';
import { Icon } from './Icon';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide glyph name. */
  icon: string;
  /** Required accessible label — also used as the tooltip title. */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  /** ghost = transparent until hover; solid = gold. */
  variant?: 'ghost' | 'solid';
  disabled?: boolean;
}

const BOX: Record<NonNullable<IconButtonProps['size']>, number> = { sm: 32, md: 40, lg: 48 };

/* Square icon-only control: header actions, close buttons, map controls. */
export function IconButton({ icon, label, size = 'md', variant = 'ghost', disabled = false, style, ...rest }: IconButtonProps) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const box = BOX[size] || BOX.md;
  const solid = variant === 'solid';
  return (
    <button
      aria-label={label} title={label} disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)} onMouseUp={() => setPress(false)}
      style={{
        width: box, height: box, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-sm)', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'var(--transition-control)',
        transform: press && !disabled ? 'translateY(1px)' : 'none',
        background: solid ? 'var(--brand-primary)' : press ? 'rgba(0,0,0,.35)' : hover ? 'rgba(224,200,142,.08)' : 'transparent',
        border: solid ? '1px solid var(--gold-700)' : '1px solid ' + (hover ? 'var(--border-strong)' : 'transparent'),
        color: disabled ? 'var(--status-locked)' : solid ? 'var(--brand-on-primary)' : hover ? 'var(--text-gold)' : 'var(--text-muted)',
        boxShadow: press && !disabled ? 'var(--shadow-carve-in)' : 'none',
        ...style,
      }}
      {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 24 : 20} />
    </button>
  );
}
