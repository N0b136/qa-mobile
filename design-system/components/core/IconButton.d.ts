import * as React from 'react';
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide glyph name. */
  icon: string;
  /** Required accessible label — also used as the tooltip title. */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  /** ghost = transparent until hover; solid = citrine cabochon gem. */
  variant?: 'ghost' | 'solid';
  disabled?: boolean;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
