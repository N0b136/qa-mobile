import * as React from 'react';
export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  children?: React.ReactNode;
  /** Selected chips fill gold with dark text. */
  selected?: boolean;
  icon?: string;
  /** Renders a trailing × when provided. */
  onRemove?: (e: React.MouseEvent) => void;
}
export declare function Tag(props: TagProps): JSX.Element;
