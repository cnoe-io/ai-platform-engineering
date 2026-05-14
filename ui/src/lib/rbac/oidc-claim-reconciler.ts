import { isMongoDBConfigured } from "@/lib/mongodb";
import type { ExternalGroup, TeamMembershipSource } from "@/types/identity-group-sync";

import { applyIdentityGroupSyncPlan } from "./identity-group-sync-reconciler";
import { listIdentityGroupSyncRules } from "./identity-group-sync-rule-store";
import { planIdentityGroupSync } from "./identity-group-sync-planner";
import { listActiveTeamMembershipSourcesForUser } from "./team-membership-source-store";

const DEFAULT_OIDC_CLAIM_PROVIDER_ID = "oidc-claims";

interface ExistingTeam {
  id?: string;
  _id?: unknown;
  slug: string;
  name: string;
}

export interface ClaimGroupUser {
  subject: string;
  email?: string;
  displayName?: string;
}

export type ClaimExternalGroup = ExternalGroup & {
  members: Array<{
    subject: string;
    email: string;
    display_name?: string;
    active: boolean;
  }>;
};

export function groupsToExternalGroupsForUser(input: {
  providerId?: string;
  groups: string[];
  user: ClaimGroupUser;
}): ClaimExternalGroup[] {
  const providerId = input.providerId ?? DEFAULT_OIDC_CLAIM_PROVIDER_ID;
  const email = input.user.email ?? input.user.subject;

  return Array.from(new Set(input.groups.map((group) => group.trim()).filter(Boolean))).map((group) => ({
    provider_id: providerId,
    external_group_id: group,
    display_name: group,
    normalized_name: group.toLowerCase(),
    status: "active",
    member_count: 1,
    last_seen_at: new Date().toISOString(),
    metadata: { source: "oidc_claim" },
    members: [
      {
        subject: input.user.subject,
        email,
        display_name: input.user.displayName,
        active: true,
      },
    ],
  }));
}

async function listExistingTeams(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const { getCollection } = await import("@/lib/mongodb");
  const collection = await getCollection<ExistingTeam>("teams");
  const teams = await collection.find({}).project({ id: 1, slug: 1, name: 1 }).toArray();
  return teams.map((team) => ({
    id: team.id ?? String(team._id ?? team.slug),
    slug: team.slug,
    name: team.name,
  }));
}

export async function reconcileOidcClaimGroupsForUser(input: {
  subject?: string;
  email?: string;
  displayName?: string;
  groups: string[];
  providerId?: string;
  now?: string;
}): Promise<void> {
  if (!isMongoDBConfigured) return;
  if (!input.subject || input.groups.length === 0) return;

  const providerId = input.providerId ?? DEFAULT_OIDC_CLAIM_PROVIDER_ID;
  const now = input.now ?? new Date().toISOString();
  const actor = `login:${providerId}`;
  const rules = await listIdentityGroupSyncRules(providerId);
  if (rules.length === 0) return;

  const [existingTeams, existingMembershipSources] = await Promise.all([
    listExistingTeams(),
    listActiveTeamMembershipSourcesForUser({
      providerId,
      sourceType: "oidc_claim",
      userSubject: input.subject,
      userEmail: input.email,
    }),
  ]);

  const plan = planIdentityGroupSync({
    groups: groupsToExternalGroupsForUser({
      providerId,
      groups: input.groups,
      user: {
        subject: input.subject,
        email: input.email,
        displayName: input.displayName,
      },
    }),
    rules,
    existingTeams,
    existingMembershipSources: existingMembershipSources as TeamMembershipSource[],
    now,
    actor,
  });

  await applyIdentityGroupSyncPlan({ plan, actor, now });
}
