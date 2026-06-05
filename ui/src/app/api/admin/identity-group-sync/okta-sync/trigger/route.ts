import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { planIdentityGroupSync } from "@/lib/rbac/identity-group-sync-planner";
import { applyIdentityGroupSyncPlan } from "@/lib/rbac/identity-group-sync-reconciler";
import { listIdentityGroupSyncRules } from "@/lib/rbac/identity-group-sync-rule-store";
import { fetchOktaExternalGroups } from "@/lib/rbac/okta-directory-connector";
import { insertOktaSyncRun, updateOktaSyncRun } from "@/lib/rbac/okta-sync-store";
import { listActiveTeamMembershipSourcesForProvider } from "@/lib/rbac/team-membership-source-store";

import { withIdentityGroupSyncAdminAuth } from "../../_lib";

const PROVIDER_ID = "okta";

interface TeamDocument {
  id?: string;
  _id?: unknown;
  slug: string;
  name: string;
}

async function listExistingTeams(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const col = await getCollection<TeamDocument>("teams");
  const teams = await col.find({}).project({ id: 1, slug: 1, name: 1 }).toArray();
  return teams.map((t) => ({
    id: t.id ?? String(t._id ?? t.slug),
    slug: t.slug,
    name: t.name,
  }));
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  return withIdentityGroupSyncAdminAuth(request, async () => {
    const { session } = await getAuthFromBearerOrSession(request);
    const actor = session?.user?.email ?? "api";

    const runId = randomUUID();
    const startedAt = new Date().toISOString();

    await insertOktaSyncRun({
      id: runId,
      status: "running",
      triggered_by: "manual",
      triggered_by_user: actor,
      started_at: startedAt,
    });

    try {
      const [groups, rules, existingTeams, existingMembershipSources] = await Promise.all([
        fetchOktaExternalGroups({ providerId: PROVIDER_ID }),
        listIdentityGroupSyncRules(PROVIDER_ID),
        listExistingTeams(),
        listActiveTeamMembershipSourcesForProvider(PROVIDER_ID),
      ]);

      const plan = planIdentityGroupSync({
        groups,
        rules,
        existingTeams,
        existingMembershipSources,
        now: new Date().toISOString(),
        actor,
      });

      const result = await applyIdentityGroupSyncPlan({
        plan,
        actor,
        now: new Date().toISOString(),
      });

      const completedAt = new Date().toISOString();
      await updateOktaSyncRun(runId, {
        status: "success",
        completed_at: completedAt,
        groups_fetched: groups.length,
        groups_matched: plan.matched_groups.length,
        membership_sources_added: result.membershipSourcesAdded,
        membership_sources_removed: result.membershipSourcesRemoved,
      });

      return successResponse({
        run_id: runId,
        status: "success",
        groups_fetched: groups.length,
        groups_matched: plan.matched_groups.length,
        membership_sources_added: result.membershipSourcesAdded,
        membership_sources_removed: result.membershipSourcesRemoved,
      });
    } catch (err) {
      await updateOktaSyncRun(runId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
});
