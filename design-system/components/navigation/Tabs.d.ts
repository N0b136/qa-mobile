import * as React from 'react';
export interface TabItem { id: string; label: string; icon?: string }
export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  items: (string | TabItem)[];
  /** Active tab id. */
  value?: string;
  onChange?: (id: string) => void;
  /** underline for web sections; segmented (pill) for in-app view switching. */
  variant?: 'underline' | 'segmented';
}
export declare function Tabs(props: TabsProps): JSX.Element;
