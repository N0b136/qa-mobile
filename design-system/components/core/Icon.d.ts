import * as React from 'react';
export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Lucide glyph name, kebab-case: "map-pin", "compass", "scroll-text". */
  name: string;
  /** Box size in px. 24 default, 20 in dense app rows, 32 for wayfinding. */
  size?: number;
  /** Always 2 in this brand. Do not use filled or thin variants. */
  strokeWidth?: number;
}
export declare function Icon(props: IconProps): JSX.Element;
