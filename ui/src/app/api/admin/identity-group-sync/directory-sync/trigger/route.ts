import { randomUUID } from "crypto";

import { NextRequest, NextResponse, after } from "next/server";

import { getAuthFromBearerOrSession, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { resolveOrProvisionUserSub } from "@/lib/rbac/keycloak-admin";
import { fetchExternalGroupsForProvider } from "@/lib/rbac/idp-connectors";
import {
  getIdpSyncSettings,
  heartbeatIdpSyncRun,
  HEARTBEAT_INTERVAL_MS,
  insertIdpSyncRun,
  listRunningIdpSyncRuns,
  reapStaleIdpSyncRuns,
  updateIdpSyncRun,
} from "@/lib/rbac/idp-sync-store";
import { planIdentityGroupSync } from "@/lib/rbac/identity-group-sync-planner";
import { applyIdentityGroupSyncPlan } from "@/lib/rbac/identity-group-sync-reconciler";
import { listIdentityGroupSyncRules } from "@/lib/rbac/identity-group-sync-rule-store";
import { listActiveTeamMembershipSourcesForProvider } from "@/lib/rbac/team-membership-source-store";

import { withIdentityGroupSyncAdminAuth } from "../../_lib";
import { resolveProviderParam } from "../_provider";

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

/**
 * Execute the full directory sync for an already-created `running` run record.
 * Runs AFTER the HTTP response (via `after()`), so a slow/rate-limited Okta
 * pull (which can take tens of seconds and may 429) never blocks the request
 * or surfaces as a UI error; the outcome is recorded on the run row instead
 * and shows up in the Sync History section.
 */
async function executeSyncRun(runId: string, provider: string, actor: string): Promise<void> {
  console.log(`[IdpSync] run ${runId} started (provider=${provider}, by=${actor})`);
  // Heartbeat for the whole run (covers every phase, not just member-scan), so
  // a crash anywhere is detectable. Cleared in `finally`.
  const heartbeat = setInterval(() => {
    void heartbeatIdpSyncRun(runId, Date.now());
  }, HEARTBEAT_INTERVAL_MS);
  try {
    await heartbeatIdpSyncRun(runId, Date.now());
    // Manual and scheduled syncs share this one path, so both honor the same
    // saved group filter from the connector's settings.
    const settings = await getIdpSyncSettings(provider);

    // Throttle progress writes so a large org doesn't do one Mongo write per
    // group, but always persist the first report (so the total shows up
    // immediately) and the final one. Step is capped at 25 so even a
    // thousand-group sync updates the chip frequently.
    let lastWritten = -1;
    const onProgress = (scanned: number, total: number) => {
      const step = Math.min(25, Math.max(1, Math.floor(total / 50)));
      const isFirst = lastWritten < 0;
      if (isFirst || scanned === total || scanned - lastWritten >= step) {
        lastWritten = scanned;
        void updateIdpSyncRun(runId, { progress_scanned: scanned, progress_total: total });
      }
    };

    const groupFilter = settings.group_filter?.trim() || undefined;
    // Record the filter this run used so Sync History can flag scoped runs.
    if (groupFilter) {
      await updateIdpSyncRun(runId, { group_filter: groupFilter });
    }
    const [groups, rules, existingTeams, existingMembershipSources] = await Promise.all([
      fetchExternalGroupsForProvider(provider, { groupFilter, onProgress }),
      listIdentityGroupSyncRules(provider),
      listExistingTeams(),
      listActiveTeamMembershipSourcesForProvider(provider),
    ]);

    // Resolve each active member's email to a Keycloak `sub`, JIT-creating a
    // federated shell user when none exists yet, so RBAC can be granted before
    // the person ever logs into CAIPE. Connectors return members without a
    // subject (they only know the directory identity); without this the planner
    // skips everyone as `missing_subject`. Cached per run so a user appearing in
    // many groups is resolved once.
    const subCache = new Map<string, string | null>();
    for (const group of groups as Array<{ members?: Array<{ email?: string; active?: boolean; subject?: string }> }>) {
      for (const member of group.members ?? []) {
        const email = member.email?.trim().toLowerCase();
        if (!member.active || !email) continue;
        if (!subCache.has(email)) {
          try {
            const { sub } = await resolveOrProvisionUserSub(email, {
              created_by: [`idp-sync:${provider}`],
            });
            subCache.set(email, sub);
          } catch (err) {
            console.warn(
              `[IdpSync] run ${runId}: failed to resolve/provision ${email}: ` +
                (err instanceof Error ? err.message : String(err))
            );
            subCache.set(email, null);
          }
        }
        const sub = subCache.get(email);
        if (sub) member.subject = sub;
      }
    }

    // A group filter means `groups` is only a subset of the directory, so the
    // plan must scope removals to the fetched groups (never drop memberships
    // for groups we didn't look at). Without a filter it's a full snapshot.
    const partialFetch = Boolean(groupFilter);

    const plan = planIdentityGroupSync({
      groups,
      rules,
      existingTeams,
      existingMembershipSources,
      now: new Date().toISOString(),
      actor,
      partialFetch,
    });

    const result = await applyIdentityGroupSyncPlan({
      plan,
      actor,
      now: new Date().toISOString(),
    });

    await updateIdpSyncRun(runId, {
      status: "success",
      completed_at: new Date().toISOString(),
      groups_fetched: groups.length,
      groups_matched: plan.matched_groups.length,
      membership_sources_added: result.membershipSourcesAdded,
      membership_sources_removed: result.membershipSourcesRemoved,
    });
    console.log(
      `[IdpSync] run ${runId} success: ${groups.length} groups, ` +
        `+${result.membershipSourcesAdded}/-${result.membershipSourcesRemoved} memberships`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface the failure in the server log too; the run row alone is easy to
    // miss, and `after()` otherwise swallows the error silently.
    console.error(`[IdpSync] run ${runId} failed (provider=${provider}): ${message}`);
    await updateIdpSyncRun(runId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { success: false, error: "MongoDB not configured", code: "MONGODB_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  return withIdentityGroupSyncAdminAuth(request, async () => {
    const provider = resolveProviderParam(request);
    const { session } = await getAuthFromBearerOrSession(request);
    const actor = session?.user?.email ?? "api";

    // Clear out any dead `running` rows (e.g. a pod that restarted mid-sync)
    // first, so an orphan never blocks new syncs.
    await reapStaleIdpSyncRuns(provider, Date.now());

    // Guard 1, fast pre-check: refuse if a sync is already running for this
    // connector (double-click, or the scheduler firing mid-manual-run).
    const alreadyRunning = await listRunningIdpSyncRuns(provider);
    if (alreadyRunning.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "A sync is already running for this connector. Wait for it to finish.",
          code: "SYNC_ALREADY_RUNNING",
          run_id: alreadyRunning[0].id,
        },
        { status: 409 }
      );
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();

    // Record the run as `running` up front so it appears immediately in the
    // Sync History, then do the actual work after the response returns.
    await insertIdpSyncRun({
      id: runId,
      provider_id: provider,
      status: "running",
      triggered_by: "manual",
      triggered_by_user: actor,
      started_at: startedAt,
    });

    // Guard 2, race resolution: two requests can both pass the pre-check and
    // insert. There's no unique index to lean on, so we re-read and let the
    // earliest run (by started_at, then id) win; any later one aborts itself.
    const running = await listRunningIdpSyncRuns(provider);
    const winner = running[0];
    if (winner && winner.id !== runId) {
      await updateIdpSyncRun(runId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Superseded by a concurrent sync for this connector.",
      });
      return NextResponse.json(
        {
          success: false,
          error: "A sync is already running for this connector. Wait for it to finish.",
          code: "SYNC_ALREADY_RUNNING",
          run_id: winner.id,
        },
        { status: 409 }
      );
    }

    after(() => executeSyncRun(runId, provider, actor));

    // 202 Accepted: the sync was scheduled, not completed, by the time we reply.
    return successResponse({ run_id: runId, provider, status: "running" }, 202);
  });
});
