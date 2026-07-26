import * as React from 'react';
/**
 * A collected seal — the reward object of the whole park experience.
 * @startingPoint section="Brand" subtitle="Earned and unearned seals in three sizes" viewport="700x200"
 */
export interface SealProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Which supplied badge asset to show. Do not add invented art. */
  art?: 'crown' | 'compass' | 'relief';
  /** Uppercase caption under the ring. */
  label?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** false renders the dashed, locked placeholder. */
  earned?: boolean;
  /** Path prefix to the design-system `assets/` folder, e.g. "../..". */
  assetBase?: string;
}
export declare function Seal(props: SealProps): JSX.Element;
