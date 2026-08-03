/**
 * Starts a browser-native page navigation.
 *
 * Use this for imperative destinations that cannot be rendered as anchors.
 * Ordinary navigation should remain a real link so loading and accessibility
 * behavior come from the browser by default.
 */
export function navigateDocument(href: string): void {
  window.location.assign(href);
}
