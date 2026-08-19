import * as React from 'react';
import { Icon } from './Icon';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide glyph name. */
  icon: string;
  /** Required accessible label — also used as the tooltip title. */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  /** ghost = transparent until hover; solid = citrine cabochon gem. */
  variant?: 'ghost' | 'solid';
  disabled?: boolean;
}

const BOX: Record<NonNullable<IconButtonProps['size']>, number> = { sm: 32, md: 40, lg: 48 };

/* Square icon-only control: header actions, close buttons, map controls. solid = citrine cabochon gem. */
export function IconButton({ icon, label, size = 'md', variant = 'ghost', disabled = false, style, ...rest }: IconButtonProps) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const box = BOX[size] || BOX.md;
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 24 : 20;

  // Cabochon: the same gem chassis, but a round stone instead of the emerald cut.
  if (variant === 'solid' && !disabled) {
    return (
      <button
        aria-label={label} title={label}
        className="btn-gem btn-gem-citrine btn-gem-cab"
        style={{
          width: box, height: box, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          ...style,
        }}
        {...rest}>
        <Icon name={icon} size={iconSize} />
      </button>
    );
  }

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
        background: press ? 'rgba(0,0,0,.35)' : hover ? 'rgba(224,200,142,.08)' : 'transparent',
        border: '1px solid ' + (hover && !disabled ? 'var(--border-strong)' : 'transparent'),
        color: disabled ? 'var(--status-locked)' : hover ? 'var(--text-gold)' : 'var(--text-muted)',
        boxShadow: press && !disabled ? 'var(--shadow-carve-in)' : 'none',
        ...style,
      }}
      {...rest}>
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
