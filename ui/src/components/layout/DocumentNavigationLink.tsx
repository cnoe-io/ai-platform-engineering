import type React from "react";

export interface DocumentNavigationLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

/**
 * A real document navigation rather than a Next.js client transition.
 *
 * Use this for page and workspace changes so browser-native loading feedback,
 * page initialization, and navigation state behave consistently. Keep
 * same-page state changes on the client router instead.
 */
export function DocumentNavigationLink({
  children,
  href,
  ...props
}: DocumentNavigationLinkProps): React.ReactElement {
  // This raw anchor is intentional: Next Link would suppress the browser's
  // native document-loading state for client-side transitions.
  return <a href={href} {...props}>{children}</a>;
}
