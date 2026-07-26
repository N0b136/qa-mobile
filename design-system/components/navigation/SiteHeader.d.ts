import * as React from 'react';
export interface NavLink { id: string; label: string }
/**
 * Sticky marketing-site header — translucent over the hero, hairline once scrolled.
 * @startingPoint section="Website" subtitle="Sticky site header with logo, nav and gold CTA" viewport="1240x120"
 */
export interface SiteHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Path to assets/logo-questland-primary.png. */
  logoSrc?: string;
  brandName?: string;
  links?: (string | NavLink)[];
  activeLink?: string;
  onNavigate?: (id: string) => void;
  /** Gold CTA label — always the booking action. */
  cta?: string;
  onCta?: () => void;
  /** Pass true past ~40px of scroll to solidify the bar. */
  scrolled?: boolean;
}
export declare function SiteHeader(props: SiteHeaderProps): JSX.Element;
