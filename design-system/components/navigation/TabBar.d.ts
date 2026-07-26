import * as React from 'react';
export interface TabBarItem { id: string; label: string; icon: string; badge?: number | string }
/**
 * The companion app's fixed bottom navigation.
 * @startingPoint section="App" subtitle="Four-up bottom tab bar with active gold marker" viewport="390x90"
 */
export interface TabBarProps extends React.HTMLAttributes<HTMLElement> {
  items: TabBarItem[];
  value?: string;
  onChange?: (id: string) => void;
}
export declare function TabBar(props: TabBarProps): JSX.Element;
