import * as React from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Lucide glyph name, kebab-case: "map-pin", "compass", "scroll-text". */
  name: string;
  /** Box size in px. 24 default, 20 in dense app rows, 32 for wayfinding. */
  size?: number;
  /** Always 2 in this brand. Do not use filled or thin variants. */
  strokeWidth?: number;
}

// This version of lucide-react has no runtime `icons` lookup map export — icons are
// individual named exports. Index the namespace import by PascalCase name instead
// (the offline-safe replacement for the .jsx's CDN <script> + window.lucide lookup).
const registry = LucideIcons as unknown as Record<string, LucideIcon>;

function toPascalCase(name: string): string {
  return String(name)
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/* Lucide outline glyph, 2px stroke, currentColor. The only icon primitive in the system. */
export function Icon({ name, size = 24, strokeWidth = 2, style, ...rest }: IconProps) {
  const Cmp = registry[toPascalCase(name)];
  if (!Cmp) return null;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      color="currentColor"
      style={{ display: 'block', flex: '0 0 auto', ...style }}
      {...rest}
    />
  );
}
