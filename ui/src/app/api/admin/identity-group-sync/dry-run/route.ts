import { NextRequest, NextResponse } from "next/server";

import { successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { planIdentityGroupSync } from "@/lib/rbac/identity-group-sync-planner";
import { listIdentityGroupSyncRules } from "@/lib/rbac/identity-group-sync-rule-store";
import { fetchOktaExternalGroups } from "@/lib/rbac/okta-directory-connector";
import { listActiveTeamMembershipSourcesForProvider } from "@/lib/rbac/team-membership-source-store";
import type { ExternalGroup, IdentityGroupSyncRule, TeamMembershipSource } from "@/types/identity-group-sync";

import { withIdentityGroupSyncAdminAuth } from "../_lib";

interface DryRunBody {
  provider_id?: string;
  fetch_from_provider?: boolean;
  groups?: ExternalGroup[];
  rules?: IdentityGroupSyncRule[];
  existing_teams?: Array<{ id: string; slug: string; name: string }>;
  existing_membership_sources?: TeamMembershipSource[];
}

interface TeamDocument {
  id?: string;
  _id?: unknown;
  slug: string;
  name: string;
}

async function listExistingTeams(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const collection = await getCollection<TeamDocument>("teams");
  const teams = await collection.find({}).project({ id: 1, slug: 1, name: 1 }).toArray();
  return teams.map((team) => ({
    id: team.id ?? String(team._id ?? team.slug),
    slug: team.slug,
    name: team.name,
  }));
}

async function fetchProviderGroups(providerId: string): Promise<ExternalGroup[]> {
  if (providerId.startsWith("okta")) {
    return fetchOktaExternalGroups({ providerId });
  }
  throw new Error(`No directory connector is configured for provider "${providerId}"`);
}

export const POST = withErrorHandler(async (request: NextRequest) => {
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

  return withIdentityGroupSyncAdminAuth(request, async () => {
    const body = (await request.json()) as DryRunBody;
    const groups =
      body.fetch_from_provider && body.provider_id
        ? await fetchProviderGroups(body.provider_id)
        : body.groups ?? [];
    const rules =
      body.rules ?? (body.provider_id ? await listIdentityGroupSyncRules(body.provider_id) : []);
    const existingTeams = body.existing_teams ?? (body.provider_id ? await listExistingTeams() : []);
    const existingMembershipSources =
      body.existing_membership_sources ??
      (body.provider_id ? await listActiveTeamMembershipSourcesForProvider(body.provider_id) : []);

    const result = planIdentityGroupSync({
      groups,
      rules,
      existingTeams,
      existingMembershipSources,
      now: new Date().toISOString(),
      actor: "api",
    });
    return successResponse({ dry_run: result });
  });
});
