import * as React from 'react';
export interface TooltipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Short sentence-case text. No actions, no links. */
  label: React.ReactNode;
  children?: React.ReactNode;
  side?: 'top' | 'bottom';
}
export declare function Tooltip(props: TooltipProps): JSX.Element;
