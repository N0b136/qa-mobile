import * as React from 'react';
export interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  checked?: boolean;
  name?: string;
  value?: string;
}
export declare function Radio(props: RadioProps): JSX.Element;
