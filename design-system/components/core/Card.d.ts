import * as React from 'react';
/**
 * The stone-slab container: 1px gold hairline, 4px radius, 24px padding.
 * @startingPoint section="Core" subtitle="Stone, photographic, parchment and ceremonial cards" viewport="700x330"
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  /** Full-bleed image URL across the top; automatically gets a bottom scrim. */
  image?: string;
  imageAlt?: string;
  imageHeight?: number;
  /** Small gold uppercase label above the title. */
  eyebrow?: React.ReactNode;
  /** Cinzel caps title. */
  title?: React.ReactNode;
  /** Uppercase meta row at the bottom — separate items with ✦. */
  meta?: React.ReactNode;
  /** Adds hover lift + gold border. Use when the whole card is a link. */
  interactive?: boolean;
  /** parchment switches to hand-torn animal-skin vellum (see the parchment-card handoff). */
  tone?: 'stone' | 'parchment';
  /** Tear variant — different rip per card so repeats look hand-torn. Parchment only. Defaults to `rough`. */
  tear?: 'a' | 'b' | 'c' | 'rough';
  /** Skin hue in deg (--p-hue). 36 default; lower = pinker hide, higher = greener/older. */
  hue?: number;
  /** Skin lightness % (--p-light). 80 default; lower = more tanned. */
  light?: number;
  /** Padding override (--p-pad). Works from a small badge to a full hero panel. */
  pad?: string;
  /** 6px gold-gradient frame with an inner dark line — awards and reveals only. */
  ceremonial?: boolean;
}
export declare function Card(props: CardProps): JSX.Element;
