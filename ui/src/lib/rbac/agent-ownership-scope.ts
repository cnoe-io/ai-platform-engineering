// assisted-by Codex Codex-sonnet-4-6
//
// Mongo-backed scope filter for dynamic agents. OpenFGA is authoritative at
// invoke time, but stale `user:* user agent:<id>` tuples (e.g. after a
// global → team demote before reconcile runs) can temporarily grant
// `can_use` to every org member. This helper narrows candidate agents using
// persisted ownership metadata before FGA batch checks.

import { authorize } from "@/lib/authz";
import type { DynamicAgentConfig, LegacyVisibilityType } from "@/types/dynamic-agent";

import { listUserTeamSlugs } from "./openfga-team-membership";
import { caipeOrgKey } from "./organization";
import type { ResourceAuthzSession } from "./resource-authz";

export interface AgentOwnershipScopeContext {
  userSub: string;
  teamSlugs: ReadonlySet<string>;
  platformDefaultAgentId: string | null;
}

function normalizeVisibility(value: unknown): "global" | "team" {
  return value === "global" ? "global" : "team";
}

function ownerSubject(agent: Pick<DynamicAgentConfig, "owner_id" | "owner_subject">): string | null {
  const raw = agent.owner_subject ?? agent.owner_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function teamSlugMatches(teamSlugs: ReadonlySet<string>, slug: unknown): boolean {
  if (typeof slug !== "string") return false;
  const trimmed = slug.trim();
  return trimmed.length > 0 && teamSlugs.has(trimmed);
}

/**
 * Returns true when Mongo metadata says the user may see this agent in list
 * UIs (chat picker, admin agents tab) before OpenFGA filtering.
 */
export function isAgentInOwnershipScope(
  agent: Pick<
    DynamicAgentConfig,
    | "_id"
    | "visibility"
    | "owner_id"
    | "owner_subject"
    | "owner_team_slug"
    | "shared_with_teams"
  > & { visibility?: LegacyVisibilityType },
  ctx: AgentOwnershipScopeContext,
): boolean {
  const agentId = String(agent._id ?? "").trim();
  if (!agentId) return false;

  if (ctx.platformDefaultAgentId && agentId === ctx.platformDefaultAgentId) {
    return true;
  }

  if (normalizeVisibility(agent.visibility) === "global") {
    return true;
  }

  const owner = ownerSubject(agent);
  if (owner && owner === ctx.userSub) {
    return true;
  }

  if (teamSlugMatches(ctx.teamSlugs, agent.owner_team_slug)) {
    return true;
  }

  for (const slug of agent.shared_with_teams ?? []) {
    if (teamSlugMatches(ctx.teamSlugs, slug)) {
      return true;
    }
  }

  return false;
}

export async function buildAgentOwnershipScopeContext(
  userSub: string,
  platformDefaultAgentId: string | null,
): Promise<AgentOwnershipScopeContext> {
  const teamSlugs = await listUserTeamSlugs({ subject: userSub });
  return {
    userSub,
    teamSlugs: new Set(teamSlugs),
    platformDefaultAgentId,
  };
}

export function filterAgentsByOwnershipScope<T extends DynamicAgentConfig>(
  agents: T[],
  ctx: AgentOwnershipScopeContext,
): T[] {
  return agents.filter((agent) => isAgentInOwnershipScope(agent, ctx));
}

async function isOrgAdminSession(session: ResourceAuthzSession): Promise<boolean> {
  if (typeof session.sub !== "string" || !session.sub.trim()) return false;
  const result = await authorize({
    subject: {
      type: session.isServiceAccount === true ? "service_account" : "user",
      id: session.sub.trim(),
    },
    resource: { type: "organization", id: caipeOrgKey() },
    action: "manage",
  });
  return result.decision === "ALLOW";
}

/**
 * Narrow agent candidates using Mongo ownership metadata. Org admins skip
 * this layer and rely on OpenFGA alone.
 */
export async function filterAgentsByOwnershipScopeForSession<T extends DynamicAgentConfig>(
  session: ResourceAuthzSession,
  agents: T[],
  platformDefaultAgentId: string | null,
): Promise<T[]> {
  if (typeof session.sub !== "string" || !session.sub.trim()) return [];
  if (await isOrgAdminSession(session)) return agents;
  const ctx = await buildAgentOwnershipScopeContext(session.sub.trim(), platformDefaultAgentId);
  return filterAgentsByOwnershipScope(agents, ctx);
}
