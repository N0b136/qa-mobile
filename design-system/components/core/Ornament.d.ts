import * as React from 'react';
export interface OrnamentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** rule = hairline with centred ✦ or label; plain = full-width hairline; star = inline ✦ separator. */
  variant?: 'rule' | 'plain' | 'star';
  /** Centred uppercase gold label in place of the ✦. */
  label?: React.ReactNode;
}
export declare function Ornament(props: OrnamentProps): JSX.Element;
