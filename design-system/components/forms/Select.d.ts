import * as React from 'react';
export interface SelectOption { value: string; label: string }
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Strings or {value,label} pairs. */
  options?: (string | SelectOption)[];
  required?: boolean;
}
export declare function Select(props: SelectProps): JSX.Element;
