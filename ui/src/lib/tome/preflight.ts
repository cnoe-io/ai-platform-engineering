// Shared preflight types + state logic. One home so the preflight route, the
// ingest panel, and the BHAG synthesize panel agree on the shape and on what
// "accessible" means. Pure — no I/O, safe to import anywhere.

/** Per-provider resource access result for one project. */
export interface PreflightSourceResult {
  provider: "github" | "confluence" | "webex";
  label: string;
  /** Items that passed the resource-level access check. */
  accessible: string[];
  /** Items where the check returned 403/404 (no access or not found). */
  inaccessible: string[];
  /** True when the provider token is missing entirely (not just per-item failures). */
  no_token: boolean;
}

/** Resource-level preflight for one project across all its sources. */
export interface PreflightResult {
  can_ingest: boolean;
  sources: PreflightSourceResult[];
  credentials_url: string;
}

/**
 * The access state of a single source, for UI display:
 *  - ok           — connected and every resource is accessible
 *  - access_issue — connected but some resources are blocked (amber)
 *  - no_token     — provider not connected at all (red)
 *  - unknown      — not checked yet / no result
 */
export type PreflightState = "ok" | "access_issue" | "no_token" | "unknown";

export function preflightState(pf: PreflightSourceResult | undefined): PreflightState {
  if (!pf) return "unknown";
  if (pf.no_token) return "no_token";
  if (pf.inaccessible.length > 0) return "access_issue";
  return "ok";
}

/**
 * Roll a whole project's preflight up to one state (worst-wins), for a per-row
 * indicator like the BHAG child list. No sources to check counts as `ok`.
 */
export function preflightRollup(result: PreflightResult | undefined): PreflightState {
  if (!result) return "unknown";
  if (result.sources.length === 0) return "ok";
  const states = result.sources.map(preflightState);
  if (states.includes("no_token")) return "no_token";
  if (states.includes("access_issue")) return "access_issue";
  return "ok";
}
