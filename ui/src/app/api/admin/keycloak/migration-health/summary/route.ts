import { NextRequest } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getKeycloakMigrationHealth } from "@/lib/rbac/keycloak-migration-health";

import { requireMigrationAdmin } from "../../../rebac/migrations/_lib";

/**
 * Lightweight summary of Keycloak reconciliation health for the admin
 * alert chip in `AppHeader`. Returns only the booleans/counts an admin
 * needs to decide whether to navigate into the full panel, NOT the full
 * Keycloak inspector payload exposed by the parent route. We keep this
 * gated by the same `requireMigrationAdmin` predicate so a non-admin
 * session never triggers a Keycloak Admin API round-trip.
 *
 * The header polls every admin page load, so we memoize the full health
 * fetch for `SUMMARY_TTL_MS` to avoid pinning Keycloak whenever an admin
 * clicks around the app. Cache invalidation: ttl-only — admins reload
 * the full panel to force a fresh read, and write paths (Reconcile all /
 * Fix) already POST to the migration apply endpoint which doesn't share
 * this cache, so a successful reconcile is naturally observed by the next
 * post-TTL poll.
 */

interface KeycloakHealthSummary {
  configured: boolean;
  reachable: boolean;
  status:
    | "unconfigured"
    | "reachable"
    | "unreachable"
    | "admin_authorization_error"
    | "reconciliation_error";
  realm: string;
  invariants: {
    total: number;
    passing: number;
    failing: number;
    unknown: number;
    reconcile_now_recommended: boolean;
  } | null;
  /**
   * `true` whenever an admin should pay attention: Keycloak is configured
   * but unreachable or has an admin/reconciliation error, OR there is at
   * least one failing invariant. Computed
   * server-side so the client chip stays trivial.
   */
  has_issues: boolean;
  cached: boolean;
  fetched_at: string;
}

const SUMMARY_TTL_MS = 60_000;

let cached: { value: KeycloakHealthSummary; expiresAt: number } | null = null;

function buildSummary(
  health: Awaited<ReturnType<typeof getKeycloakMigrationHealth>>,
  now: Date,
): KeycloakHealthSummary {
  const invariants = health.keycloak_invariants
    ? {
        total: health.keycloak_invariants.summary.total,
        passing: health.keycloak_invariants.summary.passing,
        failing: health.keycloak_invariants.summary.failing,
        unknown: health.keycloak_invariants.summary.unknown,
        reconcile_now_recommended:
          health.keycloak_invariants.summary.reconcile_now_recommended,
      }
    : null;

  const has_issues =
    (health.keycloak.configured &&
      (health.keycloak.status ?? (health.keycloak.reachable ? "reachable" : "unreachable")) !== "reachable") ||
    (invariants?.failing ?? 0) > 0;

  return {
    configured: health.keycloak.configured,
    reachable: health.keycloak.reachable,
    status: health.keycloak.status ?? (health.keycloak.reachable ? "reachable" : "unreachable"),
    realm: health.keycloak.realm,
    invariants,
    has_issues,
    cached: false,
    fetched_at: now.toISOString(),
  };
}

export function __resetKeycloakHealthSummaryCacheForTests(): void {
  cached = null;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { user } = await requireMigrationAdmin(request);

  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return successResponse({ ...cached.value, cached: true });
  }

  const health = await getKeycloakMigrationHealth({ actor: user.email });
  const summary = buildSummary(health, new Date(now));
  cached = { value: summary, expiresAt: now + SUMMARY_TTL_MS };
  return successResponse(summary);
});
