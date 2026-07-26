import * as React from 'react';
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Uppercase gold label above the field. */
  label?: React.ReactNode;
  /** Right-aligned sentence-case helper on the label row. */
  hint?: React.ReactNode;
  /** Ruby message below the field; also reddens the border. */
  error?: React.ReactNode;
  /** Leading Lucide glyph inside the field. */
  icon?: string;
  required?: boolean;
  /** Render a textarea instead. */
  multiline?: boolean;
  rows?: number;
}
export declare function Input(props: InputProps): JSX.Element;
