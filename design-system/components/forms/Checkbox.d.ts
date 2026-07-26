import * as React from 'react';
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  /** Small sentence-case line under the label. */
  description?: React.ReactNode;
  checked?: boolean;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
