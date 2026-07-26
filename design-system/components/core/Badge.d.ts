import * as React from 'react';
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  /** Track tones map to questlines; `live` for now/open; `locked` renders dashed. */
  tone?: 'gold' | 'valor' | 'lore' | 'wilds' | 'forge' | 'live' | 'locked' | 'neutral';
  /** Lucide glyph name. */
  icon?: string;
  /** Show a leading status dot instead of an icon. */
  dot?: boolean;
}
export declare function Badge(props: BadgeProps): JSX.Element;
