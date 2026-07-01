// Plain-data module — NO browser APIs, NO next/server imports.
// Safe to import from both client components and server-side code.
//
// Source of truth: ui/src/lib/credentials/built-in-oauth-connectors.ts
// This module derives the human-readable display names from the same 5 providers
// defined there, without importing the full OAuth descriptor (which carries
// authorizationUrl, tokenUrl, scopes, etc. not needed in UI display contexts).
//
// Keep this list in sync with BUILT_IN_OAUTH_CONNECTORS whenever a provider is
// added or renamed.

export type BuiltInProviderKey = "github" | "gitlab" | "atlassian" | "webex" | "webex_pam" | "pagerduty";

/** Ordered list of the built-in providers with their display names. */
export const PROVIDER_DISPLAY_LIST: { provider: BuiltInProviderKey; name: string }[] = [
  { provider: "github", name: "GitHub" },
  { provider: "gitlab", name: "GitLab" },
  { provider: "atlassian", name: "Atlassian Cloud" },
  { provider: "webex", name: "Webex" },
  { provider: "webex_pam", name: "Webex (Pam)" },
  { provider: "pagerduty", name: "PagerDuty" },
];

/** Map from provider key → display name for O(1) lookup. */
export const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  PROVIDER_DISPLAY_LIST.map(({ provider, name }) => [provider, name]),
);

/**
 * Returns the display name for a provider key, falling back to the raw key
 * for unknown/future providers.
 */
export function getProviderDisplayName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}
