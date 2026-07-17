import { checkOpenFgaTuple } from "./openfga";
import { listUserTeamSlugs } from "./openfga-team-membership";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const OPENFGA_SUBJECT_PATTERN = /^[A-Za-z0-9._%+@-]+$/;

export interface EvaluateAgentAccessInput {
  /** The user's stable identifier (OIDC sub). */
  subject: string;
  /** The target agent's identifier. */
  agentId: string;
  /** Optional team context that must itself authorize the user and agent. */
  teamSlug?: string;
}

export type AgentAccessPath =
  | "direct_user_grant"
  | "team_union"
  | "channel_grant_and_team"
  | "denied";

export interface AgentAccessDecision {
  allowed: boolean;
  path: AgentAccessPath;
  /** Present only when path === "team_union". */
  matchedTeamSlug?: string;
  /** Coarse machine-readable reason — stable for audit logs and metrics. */
  reasonCode:
    | "ALLOW_DIRECT"
    | "ALLOW_TEAM_UNION"
    | "DENY_NO_CAPABILITY";
}

function assertValidSubject(subject: string): void {
  if (!subject || subject.length === 0 || !OPENFGA_SUBJECT_PATTERN.test(subject)) {
    throw new Error(
      "evaluateAgentAccess: subject must be a non-empty OpenFGA-safe identifier",
    );
  }
}

function assertValidAgentId(agentId: string): void {
  if (!agentId || agentId.length === 0 || !OPENFGA_ID_PATTERN.test(agentId)) {
    throw new Error(
      "evaluateAgentAccess: agentId must be a non-empty OpenFGA-safe identifier",
    );
  }
}

/**
 * Probe a single `team:<slug>#member can_use agent:<id>` tuple. Returns the
 * slug on allow, `null` on deny, and re-raises on PDP error.
 */
async function probeTeamGrant(
  slug: string,
  agentId: string,
): Promise<string | null> {
  const decision = await checkOpenFgaTuple({
    user: `team:${slug}#member`,
    relation: "can_use",
    object: `agent:${agentId}`,
  });
  return decision.allowed ? slug : null;
}

/**
 * Evaluate whether a user can use a given agent, distinguishing between
 * direct user grants and team-mediated grants for audit/explainability.
 *
 * Algorithm:
 *  1. Probe `user:<sub> can_use agent:<id>` (the cheapest path; covers
 *     direct grants and any team-mediated grants the model unifies under
 *     `user`). If allowed, return `direct_user_grant` immediately.
 *  2. If denied, enumerate the user's team memberships via OpenFGA
 *     `list_objects` and probe `team:<slug>#member can_use agent:<id>` for
 *     each in parallel. First allow wins; we report which slug matched so
 *     audit logs can show *which* team granted access.
 *  3. If neither path allows, deny.
 *
 * Note: step (1) already evaluates team-mediated grants in the model
 * union; step (2) is for surfacing the matched team slug. We do not need
 * step (2) for a yes/no decision; we run it because the spec (FR-010)
 * requires audit logs include `team_resolution_path` with the matched
 * team's slug when access was team-mediated.
 *
 * Callers that don't need the audit path (e.g. `requireAgentUsePermission`
 * today) can still call this helper — they just ignore `matchedTeamSlug`.
 */
export async function evaluateAgentAccess(
  input: EvaluateAgentAccessInput,
): Promise<AgentAccessDecision> {
  const { subject, agentId, teamSlug } = input;
  assertValidSubject(subject);
  assertValidAgentId(agentId);

  if (teamSlug !== undefined) {
    assertValidAgentId(teamSlug);
    const teamSlugs = await listUserTeamSlugs({ subject });
    if (!teamSlugs.includes(teamSlug)) {
      return {
        allowed: false,
        path: "denied",
        reasonCode: "DENY_NO_CAPABILITY",
      };
    }
    const matchedTeamSlug = await probeTeamGrant(teamSlug, agentId);
    if (matchedTeamSlug) {
      return {
        allowed: true,
        path: "team_union",
        matchedTeamSlug,
        reasonCode: "ALLOW_TEAM_UNION",
      };
    }
    return {
      allowed: false,
      path: "denied",
      reasonCode: "DENY_NO_CAPABILITY",
    };
  }

  const directDecision = await checkOpenFgaTuple({
    user: `user:${subject}`,
    relation: "can_use",
    object: `agent:${agentId}`,
  });
  if (directDecision.allowed) {
    return {
      allowed: true,
      path: "direct_user_grant",
      reasonCode: "ALLOW_DIRECT",
    };
  }

  const teamSlugs = await listUserTeamSlugs({ subject });
  if (teamSlugs.length === 0) {
    return {
      allowed: false,
      path: "denied",
      reasonCode: "DENY_NO_CAPABILITY",
    };
  }

  // Parallel probe with first-allow short-circuit. We resolve a single
  // "winner" Promise that's the first probe to report `allowed:true`. If
  // none allow, all probes settle with null and we fall through. The first
  // probe to throw triggers fail-closed by rejecting the outer promise.
  const matchedSlug = await new Promise<string | null>((resolve, reject) => {
    let remaining = teamSlugs.length;
    let settled = false;

    const settle = (slug: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(slug);
    };

    const fail = (err: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    };

    for (const slug of teamSlugs) {
      probeTeamGrant(slug, agentId)
        .then((maybeSlug) => {
          if (maybeSlug !== null) {
            settle(maybeSlug);
            return;
          }
          remaining -= 1;
          if (remaining === 0) {
            settle(null);
          }
        })
        .catch(fail);
    }
  });

  if (typeof matchedSlug === "string") {
    return {
      allowed: true,
      path: "team_union",
      matchedTeamSlug: matchedSlug,
      reasonCode: "ALLOW_TEAM_UNION",
    };
  }

  return {
    allowed: false,
    path: "denied",
    reasonCode: "DENY_NO_CAPABILITY",
  };
}
