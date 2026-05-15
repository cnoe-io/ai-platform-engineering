/**
 * GitLab token introspection helper used by the crawl console to
 * synthesize a precise scope-mismatch hint when a tree fetch
 * fails with an auth-shaped status (401 / 403 / 404).
 *
 * # Why this exists
 *
 * GitLab returns the same diagnostic cluster (401 / 403 / 404)
 * for several genuinely different problems:
 *
 *   - missing token
 *   - token from the wrong instance (gitlab.com vs self-hosted)
 *   - token missing the right scope
 *   - project doesn't exist
 *   - project exists but the user lacks access
 *
 * The most surprising of these in practice is the scope mismatch:
 * `read_repository` is enough for `git clone` but the REST API
 * tree endpoint requires `read_api` (or `api`). The user reported
 * exactly this failure mode -- their PAT had `read_repository`
 * checked but `read_api` was empty, and the tree endpoint
 * returned 404 (intentional cloaking on insufficient scope), so
 * the existing error message ("project not found") sent them
 * down the wrong debugging path.
 *
 * After an auth-shaped failure we probe ``GET
 * /personal_access_tokens/self`` -- which only requires the
 * token to be valid, not to have any specific scope -- and
 * inspect the returned ``scopes`` array. From that we can emit
 * one of three precise diagnoses:
 *
 *   1. Token responds with 200 and lacks the required REST scopes
 *      -> "scope_mismatch" hint listing the missing scopes.
 *   2. Token responds with 200 and has all required scopes -> the
 *      original auth failure was about ACCESS, not the token --
 *      surface "your token is valid but the user lacks access"
 *      hint.
 *   3. Token responds with 401 -> the token itself is invalid;
 *      surface "token expired or wrong instance" hint.
 *
 * # Why it's a separate module from formatGitLabFetchError
 *
 * formatGitLabFetchError is synchronous and based on STATIC state
 * (status code, env var presence). The introspection probe is
 * asynchronous, makes a real HTTP call, and uses DYNAMIC state
 * (scope list returned by the API). Mixing them would make
 * formatGitLabFetchError block on a network call and complicate
 * its tests; keeping them separate also lets us call the
 * introspection from places that aren't crawl helpers (e.g. a
 * future "test connection" admin button).
 */

import type {
  CrawlEventEmitter,
  CrawlWarningCode,
} from "@/lib/crawl-events";
import { NOOP_EMITTER } from "@/lib/crawl-events";

/**
 * Scopes that grant access to GitLab's REST API for repository
 * tree reads. Either ``api`` (full read+write) or ``read_api``
 * (read-only) suffices. ``read_repository`` is the common false
 * friend -- it works for git operations but NOT for the tree
 * endpoint we use, which is why the user's debugging journey
 * sent them in circles.
 */
const REST_TREE_REQUIRED_SCOPES = ["api", "read_api"] as const;

export interface ScopeIntrospectionResult {
  /**
   * - ``"scope_mismatch"`` -- token is valid but missing the
   *   scopes the REST tree endpoint requires.
   * - ``"access_denied"`` -- token is valid AND has the right
   *   scopes; the original auth failure was about user access.
   * - ``"invalid_token"`` -- ``/personal_access_tokens/self``
   *   itself returned 401 -- token is malformed, expired, or
   *   from a different instance.
   * - ``"unknown"`` -- introspection itself failed for an
   *   unrelated reason (network, 500, etc.); no reliable hint.
   */
  diagnosis:
    | "scope_mismatch"
    | "access_denied"
    | "invalid_token"
    | "unknown";
  /**
   * Scopes the token actually carries, as reported by GitLab.
   * Empty when ``diagnosis !== "scope_mismatch" | "access_denied"``.
   */
  scopes: readonly string[];
  /** Operator-actionable hint string, ready to drop into a UI. */
  hint: string;
}

/**
 * Probe ``GET /personal_access_tokens/self`` and translate the
 * result into a structured diagnosis. Best-effort -- if the probe
 * itself fails (network error, unexpected status, malformed body)
 * we return ``"unknown"`` rather than throwing, because failing
 * the introspection MUST NOT escalate to failing the entire
 * crawl response. The crawler already returned an error event
 * by this point; introspection is purely additive.
 */
export async function introspectGitLabToken(
  baseUrl: string,
  token: string,
): Promise<ScopeIntrospectionResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/personal_access_tokens/self`, {
      headers: {
        "PRIVATE-TOKEN": token,
        "User-Agent": "caipe-hub-crawler/1.0",
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return {
      diagnosis: "unknown",
      scopes: [],
      hint:
        "Could not verify the token (network error reaching " +
        `${baseUrl}/personal_access_tokens/self). Check that the GitLab ` +
        "API URL is reachable from this server.",
    };
  }

  if (res.status === 401) {
    return {
      diagnosis: "invalid_token",
      scopes: [],
      hint:
        `The configured GITLAB_TOKEN was rejected by ${baseUrl}. ` +
        `Common causes: token has expired, was revoked, or is from a ` +
        `different GitLab instance (a gitlab.com token will not work ` +
        `on a self-hosted GitLab and vice versa). Generate a new ` +
        `personal access token on this instance and re-set ` +
        `GITLAB_TOKEN.`,
    };
  }

  if (!res.ok) {
    return {
      diagnosis: "unknown",
      scopes: [],
      hint:
        `Could not verify the token: GitLab returned ${res.status} ` +
        `${res.statusText} when probing scopes. The crawl error above ` +
        `is the primary failure.`,
    };
  }

  // Successful introspection: parse out the scopes array. GitLab
  // returns `{ id, name, scopes: [...] }` for a healthy
  // `/personal_access_tokens/self`.
  let body: { scopes?: unknown };
  try {
    body = (await res.json()) as { scopes?: unknown };
  } catch {
    return {
      diagnosis: "unknown",
      scopes: [],
      hint:
        `Token verification returned a non-JSON body. The crawl ` +
        `error above is the primary failure.`,
    };
  }

  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is string => typeof s === "string")
    : [];
  const hasRestScope = scopes.some((s) =>
    (REST_TREE_REQUIRED_SCOPES as readonly string[]).includes(s),
  );

  if (!hasRestScope) {
    const have = scopes.length ? scopes.join(", ") : "(none)";
    const need = REST_TREE_REQUIRED_SCOPES.join(" or ");
    return {
      diagnosis: "scope_mismatch",
      scopes,
      hint:
        `Your GitLab token is valid but is missing the scope ` +
        `required to list a project's tree via the REST API. Token ` +
        `currently has: [${have}]. Add "${need}" to the token's ` +
        `scopes (the existing "read_repository" scope works for ` +
        `git operations but NOT for the REST tree endpoint we use). ` +
        `Edit the token at ${baseUrl.replace(/\/api\/v\d+\/?$/, "")}/-/user_settings/personal_access_tokens ` +
        `or generate a new one.`,
    };
  }

  return {
    diagnosis: "access_denied",
    scopes,
    hint:
      `Your GitLab token is valid and has the required REST API ` +
      `scope, but the user owning the token does not have access ` +
      `to this project on ${new URL(baseUrl).hostname}. Verify the ` +
      `project exists and the user is a member (or has at least ` +
      `Reporter access) before re-running the crawl.`,
  };
}

/**
 * Convenience: run the probe and emit a ``warning`` event with
 * the appropriate code so the live console renders the hint in
 * the same panel as the crawl error. Caller MAY also surface the
 * hint on a final ``error`` event for routes that emit one.
 *
 * Skips silently when no token is configured (no probe to run);
 * the caller's existing "no token configured" error message is
 * already operator-actionable.
 */
export async function emitScopeHintIfApplicable(
  baseUrl: string,
  token: string | undefined,
  emitter: CrawlEventEmitter = NOOP_EMITTER,
): Promise<ScopeIntrospectionResult | null> {
  if (!token) return null;
  const probe = await introspectGitLabToken(baseUrl, token);
  // Map our diagnosis enum onto the crawl-event taxonomy. Both
  // scope_mismatch and access_denied surface as the
  // ``scope_mismatch`` warning code -- the hint string carries
  // the precise diagnosis for the operator. Reusing one code
  // keeps the UI filter chips simple ("show me scope hints"
  // surfaces both flavors).
  let code: CrawlWarningCode | null = null;
  if (probe.diagnosis === "scope_mismatch") code = "scope_mismatch";
  else if (probe.diagnosis === "access_denied") code = "scope_mismatch";
  else if (probe.diagnosis === "invalid_token") code = "scope_mismatch";

  if (code) {
    emitter.emit({
      type: "warning",
      code,
      message: probe.hint,
      context: {
        diagnosis: probe.diagnosis,
        scopes: probe.scopes.join(",") || "(none)",
      },
    });
  }
  return probe;
}
