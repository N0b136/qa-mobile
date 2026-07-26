import * as React from 'react';
export interface TrailStep {
  label: string;
  state?: 'complete' | 'current' | 'locked';
}
/**
 * Station/episode progress drawn as a walked path.
 * @startingPoint section="Brand" subtitle="Horizontal and vertical station progress trails" viewport="700x260"
 */
export interface ProgressTrailProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: TrailStep[];
  /** Paints completed nodes and the connecting line in the questline colour. */
  track?: 'valor' | 'lore' | 'wilds' | 'forge' | 'gold';
  /** vertical is the app's station list; horizontal is the web episode strip. */
  orientation?: 'horizontal' | 'vertical';
  onStepClick?: (index: number, step: TrailStep) => void;
}
export declare function ProgressTrail(props: ProgressTrailProps): JSX.Element;
