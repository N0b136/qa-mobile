import * as React from 'react';
/**
 * Gate-silhouette card (`--radius-arch`) for episodes and trail stations.
 * @startingPoint section="Brand" subtitle="Episode arches in available, complete and locked states" viewport="700x330"
 */
export interface ArchCardProps extends React.HTMLAttributes<HTMLDivElement> {
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
export declare function ArchCard(props: ArchCardProps): JSX.Element;
