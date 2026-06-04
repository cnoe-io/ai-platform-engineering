import { NextRequest, NextResponse } from "next/server";

import { getAuthFromBearerOrSession, requireRbacPermission, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCachedOidcClaimGroups } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { groupsToExternalGroupsForUser } from "@/lib/rbac/oidc-claim-reconciler";
import { listIdentityGroupSyncRules } from "@/lib/rbac/identity-group-sync-rule-store";
import { planIdentityGroupSync } from "@/lib/rbac/identity-group-sync-planner";
import { normalizeTeamSlug } from "@/lib/rbac/team-slugs";
import { listActiveTeamMembershipSourcesForUser } from "@/lib/rbac/team-membership-source-store";
import type { ExternalGroup, IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";

interface TeamDocument {
  id?: string;
  _id?: unknown;
  slug: string;
  name: string;
}

interface ClaimSuggestion {
  source_group_id: string;
  display_name: string;
  suggested_team_slug: string;
  suggested_team_name: string;
  suggested_relationship: "member" | "admin";
  suggested_org_admin: boolean;
  reason: "unmatched_claim_group";
}

const DEFAULT_PROVIDER_ID = "oidc-claims";

async function listExistingTeams(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const collection = await getCollection<TeamDocument>("teams");
  const teams = await collection.find({}).project({ id: 1, slug: 1, name: 1 }).toArray();
  return teams.map((team) => ({
    id: team.id ?? String(team._id ?? team.slug),
    slug: team.slug,
    name: team.name,
  }));
}

function suggestionForGroup(group: ExternalGroup): ClaimSuggestion {
  const slug = normalizeTeamSlug(group.display_name || group.external_group_id);
  const looksAdmin = /\badmin(s)?\b/i.test(group.display_name) || /(^|-)admin(s)?($|-)/.test(slug);
  return {
    source_group_id: group.external_group_id,
    display_name: group.display_name,
    suggested_team_slug: slug,
    suggested_team_name: group.display_name,
    suggested_relationship: looksAdmin ? "admin" : "member",
    suggested_org_admin: looksAdmin,
    reason: "unmatched_claim_group",
  };
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured - identity group sync requires MongoDB",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");

  const groups = getCachedOidcClaimGroups(session.sub);
  if (groups.length === 0) {
    return successResponse({
      provider_id: process.env.IDENTITY_SYNC_OIDC_CLAIM_PROVIDER_ID || DEFAULT_PROVIDER_ID,
      groups: [],
      dry_run: null,
      suggestions: [],
      reason: "missing_session_group_claims",
    });
  }

  const providerId = process.env.IDENTITY_SYNC_OIDC_CLAIM_PROVIDER_ID || DEFAULT_PROVIDER_ID;
  const claimGroups = groupsToExternalGroupsForUser({
    providerId,
    groups,
    user: {
      subject: session.sub ?? session.user?.email ?? "unknown",
      email: session.user?.email,
      displayName: session.user?.name,
    },
  });

  const [rules, existingTeams, existingMembershipSources] = await Promise.all([
    listIdentityGroupSyncRules(providerId),
    listExistingTeams(),
    listActiveTeamMembershipSourcesForUser({
      providerId,
      sourceType: "oidc_claim",
      userSubject: session.sub,
      userEmail: session.user?.email,
    }),
  ]);

  const dryRun: IdentityGroupSyncDryRunResult = planIdentityGroupSync({
    groups: claimGroups,
    rules,
    existingTeams,
    existingMembershipSources,
    now: new Date().toISOString(),
    actor: `claim-suggestions:${session.user?.email ?? "unknown"}`,
  });

  return successResponse({
    provider_id: providerId,
    groups: claimGroups,
    dry_run: dryRun,
    suggestions: dryRun.ignored_groups.map(suggestionForGroup),
  });
});
