import * as React from 'react';
/**
 * Primary action control. Gold is reserved for `primary` — one per view.
 * @startingPoint section="Core" subtitle="Gold, outline, ghost and danger buttons in three sizes" viewport="700x180"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  /** primary = gold metal; secondary = gold outline; ghost = text only; danger = ruby. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** Lucide glyph name shown before the label. */
  icon?: string;
  /** Lucide glyph name shown after the label. */
  iconAfter?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  /** Render as another element, e.g. "a" for a link-button. */
  as?: 'button' | 'a';
}
export declare function Button(props: ButtonProps): JSX.Element;
