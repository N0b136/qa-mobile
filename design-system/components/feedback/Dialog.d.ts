import * as React from 'react';
export interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** Right-aligned action row — usually two Buttons. */
  footer?: React.ReactNode;
  onClose?: () => void;
  /** 6px gold frame + ornament rule. For seal-awarded and episode-unlocked moments. */
  ceremonial?: boolean;
  width?: number;
}
export declare function Dialog(props: DialogProps): JSX.Element;
