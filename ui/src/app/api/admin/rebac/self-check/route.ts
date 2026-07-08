// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";
import type { Document } from "mongodb";

import { ApiError,successResponse,withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { repairableMissingTuples,runRbacSelfCheck } from "@/lib/rbac/self-check";
import { deleteExactOpenFgaTuples,writeOpenFgaTuples } from "@/lib/rbac/openfga";
import { invalidateUserTeamMembershipCache } from "@/lib/rbac/openfga-team-membership";
import { slackChannelGrantRelationship } from "@/lib/rbac/slack-channel-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import { webexSpaceGrantRelationship } from "@/lib/rbac/webex-space-rebac";
import { scopeWriteTuple } from "@/lib/service-account-scopes";
import type { UniversalRebacResourceAction,UniversalRebacResourceType } from "@/types/rbac-universal";
import type {
  RbacSelfCheckBulkRevokeResult,
  RbacSelfCheckFinding,
  RbacSelfCheckCleanupResult,
  RbacSelfCheckRepairResult,
  RbacSelfCheckRevokeResult,
  RbacSelfCheckTuple,
} from "@/types/rbac-self-check";

import { withRebacAdminAuth,withRebacViewAuth } from "../_lib";

const BULK_REVOKE_REVIEW_LIMIT = 5000;
const REPAIR_BATCH_LIMIT = 10000;
const DEFAULT_SLACK_WORKSPACE = "CAIPE";
const DEFAULT_WEBEX_WORKSPACE = "Cisco";

interface TeamSourceCleanupRow extends Document {
  team_slug?: string;
  user_subject?: string;
  relationship?: string;
}

interface TeamCleanupDoc extends Document {
  slug?: string;
  status?: string;
}

interface CleanupScope {
  type?: string;
  ref?: string;
}

interface ServiceAccountCleanupDoc extends Document {
  sa_sub?: string;
  status?: string;
  scopes_snapshot?: CleanupScope[];
}

interface MessagingGrantDoc extends Document {
  status?: string;
  workspace_id?: string;
  channel_id?: string;
  space_id?: string;
  resource?: {
    type?: string;
    id?: string;
  };
  actions?: string[];
}

type CleanupResourceType = "agent" | "tool" | "knowledge_base" | "skill" | "task";

interface StaleResourceRef {
  type: CleanupResourceType;
  id: string;
}

const CLEANUP_RESOURCE_TYPES = new Set<CleanupResourceType>([
  "agent",
  "tool",
  "knowledge_base",
  "skill",
  "task",
]);

const CLEANUP_ACTIONS = new Set<UniversalRebacResourceAction>([
  "discover",
  "read",
  "use",
  "write",
  "create",
  "delete",
  "manage",
  "administer",
  "audit",
  "approve",
  "share",
  "call",
  "invoke",
  "map",
  "ingest",
  "read-metadata",
]);

function parseChecks(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withRebacViewAuth(request, async () => {
    const report = await runRbacSelfCheck({
      checks: parseChecks(request.nextUrl.searchParams.getAll("checks")),
    });
    return successResponse(report);
  })
);

function isTuple(value: unknown): value is RbacSelfCheckTuple {
  if (!value || typeof value !== "object") return false;
  const tuple = value as Partial<RbacSelfCheckTuple>;
  return (
    typeof tuple.user === "string" &&
    typeof tuple.relation === "string" &&
    typeof tuple.object === "string" &&
    tuple.user.length > 0 &&
    tuple.relation.length > 0 &&
    tuple.object.length > 0
  );
}

function tupleKey(tuple: RbacSelfCheckTuple): string {
  return `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
}

function uniqueTuples(tuples: RbacSelfCheckTuple[]): RbacSelfCheckTuple[] {
  const seen = new Set<string>();
  const out: RbacSelfCheckTuple[] = [];
  for (const tuple of tuples) {
    const key = tupleKey(tuple);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
}

function membershipSubjects(tuples: RbacSelfCheckTuple[]): string[] {
  return Array.from(new Set(
    tuples
      .map((tuple) => {
        if (tuple.relation !== "member" && tuple.relation !== "admin") return null;
        if (!tuple.object.startsWith("team:")) return null;
        const match = /^user:([^#]+)$/.exec(tuple.user);
        return match?.[1] ?? null;
      })
      .filter((subject): subject is string => Boolean(subject)),
  ));
}

function isDeletedTeamMembershipFinding(candidate: {
  severity: string;
  title: string;
  review_action?: { type?: string };
  tuple?: RbacSelfCheckTuple;
}): boolean {
  return (
    candidate.severity === "orphan_candidate" &&
    candidate.title === "Stale deleted-team membership tuple" &&
    candidate.review_action?.type === "revoke_tuple" &&
    Boolean(candidate.tuple)
  );
}

async function cleanupStaleTeamMembershipSources(): Promise<RbacSelfCheckCleanupResult> {
  const teamCollection = await getCollection<TeamCleanupDoc>("teams");
  const activeTeams = await teamCollection
    .find({ status: { $ne: "deleted" } })
    .project({ slug: 1 })
    .toArray();
  const activeTeamSlugs = new Set(
    activeTeams
      .map((team) => team.slug)
      .filter((slug): slug is string => typeof slug === "string" && slug.length > 0),
  );

  if (activeTeamSlugs.size === 0) {
    throw new ApiError("No active teams were found; refusing to bulk-remove membership sources.", 409);
  }

  const sourceCollection = await getCollection<TeamSourceCleanupRow>("team_membership_sources");
  const rows = await sourceCollection
    .find({
      status: "active",
      user_subject: { $exists: true, $ne: null },
      team_slug: { $nin: Array.from(activeTeamSlugs) },
    })
    .project({ _id: 1, team_slug: 1, user_subject: 1, relationship: 1 })
    .toArray();

  const rowIds = rows.map((row) => row._id).filter(Boolean);
  const tupleDeletes = uniqueTuples(
    rows
      .filter((row) => row.relationship === "member" || row.relationship === "admin")
      .filter((row) => Boolean(row.team_slug && row.user_subject))
      .map((row) => ({
        user: `user:${row.user_subject}`,
        relation: row.relationship!,
        object: `team:${row.team_slug}`,
      })),
  );
  const deleteResult = tupleDeletes.length > 0
    ? await writeOpenFgaTuples({ writes: [], deletes: tupleDeletes })
    : { deletes: 0 };

  const now = new Date().toISOString();
  const updateResult = rowIds.length > 0
    ? await sourceCollection.updateMany(
        { _id: { $in: rowIds }, status: "active" },
        {
          $set: {
            status: "removed",
            removed_by: "rbac-self-check",
            removed_at: now,
          },
        },
      )
    : { matchedCount: 0, modifiedCount: 0 };

  invalidateUserTeamMembershipCache(membershipSubjects(tupleDeletes));

  return {
    matched_rows: updateResult.matchedCount ?? rows.length,
    modified_rows: updateResult.modifiedCount ?? 0,
    attempted_tuple_deletes: tupleDeletes.length,
    applied_tuple_deletes: deleteResult.deletes,
  };
}

function cleanupResourceKey(resource: StaleResourceRef): string {
  return `${resource.type}:${resource.id}`;
}

function staleResourcesForSource(findings: RbacSelfCheckFinding[], source: string): StaleResourceRef[] {
  const byKey = new Map<string, StaleResourceRef>();
  for (const finding of findings) {
    const resource = finding.resource;
    if (finding.severity !== "stale_reference" || finding.source !== source || !resource) continue;
    if (!CLEANUP_RESOURCE_TYPES.has(resource.type as CleanupResourceType)) continue;
    const id = resource.id.trim();
    if (!id) continue;
    const ref: StaleResourceRef = { type: resource.type as CleanupResourceType, id };
    byKey.set(cleanupResourceKey(ref), ref);
  }
  return Array.from(byKey.values());
}

function scopeMatchesStaleResource(scope: CleanupScope, staleResources: Set<string>): boolean {
  if (scope.type !== "agent" && scope.type !== "tool") return false;
  const ref = typeof scope.ref === "string" ? scope.ref.trim() : "";
  return Boolean(ref && staleResources.has(`${scope.type}:${ref}`));
}

function isValidCleanupAction(value: string): value is UniversalRebacResourceAction {
  return CLEANUP_ACTIONS.has(value as UniversalRebacResourceAction);
}

function messagingGrantDeleteTuples(
  source: "slack_channel_grants" | "webex_space_grants",
  rows: MessagingGrantDoc[],
): RbacSelfCheckTuple[] {
  const relationships = rows.flatMap((row) => {
    const type = row.resource?.type;
    const id = row.resource?.id;
    if (!type || !id || !CLEANUP_RESOURCE_TYPES.has(type as CleanupResourceType)) return [];
    const actions = (row.actions ?? []).filter(isValidCleanupAction);
    if (source === "slack_channel_grants") {
      const workspaceId = row.workspace_id ?? DEFAULT_SLACK_WORKSPACE;
      const channelId = row.channel_id;
      if (!channelId) return [];
      return actions.map((action) =>
        slackChannelGrantRelationship(workspaceId, channelId, {
          type: type as UniversalRebacResourceType,
          id,
        }, action)
      );
    }
    const workspaceId = row.workspace_id ?? DEFAULT_WEBEX_WORKSPACE;
    const spaceId = row.space_id;
    if (!spaceId) return [];
    return actions.map((action) =>
      webexSpaceGrantRelationship(workspaceId, spaceId, {
        type: type as UniversalRebacResourceType,
        id,
      }, action)
    );
  });
  return buildUniversalRebacTupleDiff({ writes: [], deletes: relationships }).deletes;
}

async function cleanupStaleResourceReferences(
  findings: RbacSelfCheckFinding[],
): Promise<RbacSelfCheckCleanupResult> {
  const now = new Date().toISOString();
  const tupleDeletes: RbacSelfCheckTuple[] = [];
  let matchedRows = 0;
  let modifiedRows = 0;

  const serviceAccountResources = staleResourcesForSource(findings, "service_accounts.scopes_snapshot")
    .filter((resource) => resource.type === "agent" || resource.type === "tool");
  if (serviceAccountResources.length > 0) {
    const staleKeys = new Set(serviceAccountResources.map(cleanupResourceKey));
    const serviceAccounts = await getCollection<ServiceAccountCleanupDoc>("service_accounts");
    const rows = await serviceAccounts
      .find({
        status: "active",
        $or: serviceAccountResources.map((resource) => ({
          scopes_snapshot: { $elemMatch: { type: resource.type, ref: resource.id } },
        })),
      } as never)
      .project({ _id: 1, sa_sub: 1, scopes_snapshot: 1 })
      .toArray();
    matchedRows += rows.length;

    for (const row of rows) {
      if (!row.sa_sub) continue;
      const scopes = row.scopes_snapshot ?? [];
      const nextScopes = scopes.filter((scope) => !scopeMatchesStaleResource(scope, staleKeys));
      if (nextScopes.length === scopes.length) continue;
      for (const scope of scopes) {
        if (!scopeMatchesStaleResource(scope, staleKeys)) continue;
        if ((scope.type !== "agent" && scope.type !== "tool") || !scope.ref) continue;
        tupleDeletes.push(scopeWriteTuple({ type: scope.type, ref: scope.ref }, `service_account:${row.sa_sub}`));
      }
      const result = await serviceAccounts.updateOne(
        { _id: row._id, status: "active" } as never,
        { $set: { scopes_snapshot: nextScopes, updated_by: "rbac-self-check", updated_at: now } } as never,
      );
      modifiedRows += result.modifiedCount ?? 0;
    }
  }

  for (const source of ["slack_channel_grants", "webex_space_grants"] as const) {
    const staleResources = staleResourcesForSource(findings, source);
    if (staleResources.length === 0) continue;
    const collection = await getCollection<MessagingGrantDoc>(source);
    const rows = await collection
      .find({
        status: "active",
        $or: staleResources.map((resource) => ({
          "resource.type": resource.type,
          "resource.id": resource.id,
        })),
      } as never)
      .project({ _id: 1, workspace_id: 1, channel_id: 1, space_id: 1, resource: 1, actions: 1 })
      .toArray();
    matchedRows += rows.length;
    tupleDeletes.push(...messagingGrantDeleteTuples(source, rows));

    const rowIds = rows.map((row) => row._id).filter(Boolean);
    if (rowIds.length > 0) {
      const result = await collection.updateMany(
        { _id: { $in: rowIds }, status: "active" } as never,
        { $set: { status: "revoked", updated_by: "rbac-self-check", updated_at: now } } as never,
      );
      modifiedRows += result.modifiedCount ?? 0;
    }
  }

  const uniqueDeletes = uniqueTuples(tupleDeletes);
  const deleteResult = uniqueDeletes.length > 0
    ? await writeOpenFgaTuples({ writes: [], deletes: uniqueDeletes })
    : { deletes: 0 };

  return {
    matched_rows: matchedRows,
    modified_rows: modifiedRows,
    attempted_tuple_deletes: uniqueDeletes.length,
    applied_tuple_deletes: deleteResult.deletes,
  };
}

export const POST = withErrorHandler(async (request: NextRequest) =>
  withRebacAdminAuth(request, async () => {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      sources?: unknown;
      checks?: unknown;
      tuple?: unknown;
      tuples?: unknown;
    };
    const checks = parseChecks(body.checks);

    if (body.action === "revoke_tuple") {
      if (!isTuple(body.tuple)) {
        throw new ApiError("A tuple is required to revoke an unowned tuple.", 400);
      }
      const before = await runRbacSelfCheck({ checks });
      const requestedKey = tupleKey(body.tuple);
      const finding = before.findings.find(
        (candidate) =>
          candidate.severity === "orphan_candidate" &&
          candidate.review_action?.type === "revoke_tuple" &&
          candidate.tuple &&
          tupleKey(candidate.tuple) === requestedKey,
      );
      if (!finding?.tuple) {
        throw new ApiError("Tuple is not currently classified as unowned. Run the self-check again.", 409);
      }
      const result = await deleteExactOpenFgaTuples([finding.tuple]);
      invalidateUserTeamMembershipCache(membershipSubjects([finding.tuple]));
      const after = await runRbacSelfCheck({ checks });
      const revoke: RbacSelfCheckRevokeResult = {
        attempted_deletes: 1,
        applied_deletes: result.deletes,
        skipped_findings: before.summary.total_findings - 1,
        tuple: finding.tuple,
      };
      return successResponse({ revoke, report: after });
    }

    if (body.action === "revoke_tuples") {
      if (!Array.isArray(body.tuples) || body.tuples.some((tuple) => !isTuple(tuple))) {
        throw new ApiError("A list of tuples is required to revoke unowned tuples.", 400);
      }
      const requestedTuples = uniqueTuples(body.tuples.filter(isTuple));
      if (requestedTuples.length === 0) {
        throw new ApiError("Select at least one tuple to revoke.", 400);
      }

      const before = await runRbacSelfCheck({ checks });
      const revokableByKey = new Map(
        before.findings
          .filter(
            (candidate) =>
              candidate.severity === "orphan_candidate" &&
              candidate.review_action?.type === "revoke_tuple" &&
              candidate.tuple,
          )
          .map((candidate) => [tupleKey(candidate.tuple!), candidate.tuple!]),
      );
      const deletes = requestedTuples
        .map((tuple) => revokableByKey.get(tupleKey(tuple)))
        .filter((tuple): tuple is RbacSelfCheckTuple => Boolean(tuple));
      const result = deletes.length > 0
        ? await deleteExactOpenFgaTuples(deletes)
        : { deletes: 0 };
      invalidateUserTeamMembershipCache(membershipSubjects(deletes));
      const after = await runRbacSelfCheck({ checks });
      const bulk_revoke: RbacSelfCheckBulkRevokeResult = {
        requested_deletes: requestedTuples.length,
        attempted_deletes: deletes.length,
        applied_deletes: result.deletes,
        skipped_deletes: requestedTuples.length - deletes.length,
      };
      return successResponse({ bulk_revoke, report: after });
    }

    if (body.action === "revoke_deleted_team_memberships") {
      const before = await runRbacSelfCheck({
        checks: ["team_memberships"],
        maxFindings: BULK_REVOKE_REVIEW_LIMIT,
        orphanCandidateLimit: BULK_REVOKE_REVIEW_LIMIT,
      });
      const deletes = uniqueTuples(
        before.findings
          .filter(isDeletedTeamMembershipFinding)
          .map((finding) => finding.tuple!)
      );
      const result = deletes.length > 0
        ? await deleteExactOpenFgaTuples(deletes)
        : { deletes: 0 };
      invalidateUserTeamMembershipCache(membershipSubjects(deletes));
      const after = await runRbacSelfCheck({ checks });
      const bulk_revoke: RbacSelfCheckBulkRevokeResult = {
        requested_deletes: deletes.length,
        attempted_deletes: deletes.length,
        applied_deletes: result.deletes,
        skipped_deletes: 0,
      };
      return successResponse({ bulk_revoke, report: after });
    }

    if (body.action === "cleanup_stale_team_membership_sources") {
      const cleanup = await cleanupStaleTeamMembershipSources();
      const after = await runRbacSelfCheck({ checks });
      return successResponse({ cleanup, report: after });
    }

    if (body.action === "cleanup_stale_resource_references") {
      const before = await runRbacSelfCheck({ checks });
      const cleanup = await cleanupStaleResourceReferences(before.findings);
      const after = await runRbacSelfCheck({ checks });
      return successResponse({ cleanup, report: after });
    }

    const sources = Array.isArray(body.sources)
      ? body.sources.filter((source): source is string => typeof source === "string" && source.trim().length > 0)
      : undefined;

    const before = await runRbacSelfCheck({
      checks,
      maxFindings: REPAIR_BATCH_LIMIT,
    });
    const writes = repairableMissingTuples(before, sources);
    const result = await writeOpenFgaTuples({ writes, deletes: [] });
    const after = await runRbacSelfCheck({ checks });
    const repair: RbacSelfCheckRepairResult = {
      requested_sources: sources ?? [],
      attempted_writes: writes.length,
      applied_writes: result.writes,
      skipped_findings: before.summary.total_findings - writes.length,
    };

    return successResponse({ repair, report: after });
  })
);
