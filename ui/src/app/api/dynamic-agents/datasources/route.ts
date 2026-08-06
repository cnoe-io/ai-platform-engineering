/**
 * API route for listing the datasources a team can see, for the dynamic
 * agent editor's datasource-binding picker (spec
 * 2026-07-21-rag-source-mgmt-ui, Workstream D).
 *
 * GET /api/dynamic-agents/datasources?team_slug=<slug>
 *
 * Returns the union of the owning team's `knowledge_base` grants and the
 * current caller's readable datasources. The caller-specific half is what lets
 * a creator pin their personal source to an agent without granting that source
 * to the entire owner team. At runtime the RAG server still intersects the pin
 * with each caller's own access, so selecting a personal source never shares
 * it with other agent users.
 */

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { manageableDatasourceIdsForCollectionPublishing } from "@/lib/rag-collections.server";
import { listTeamKbGrants } from "@/lib/rbac/team-resource-listing";
import { NextRequest } from "next/server";

function getRagServerUrl(): string {
  return (
    process.env.RAG_SERVER_URL ||
    process.env.NEXT_PUBLIC_RAG_URL ||
    "http://localhost:9446"
  );
}

interface RagDatasourceListItem {
  datasource_id?: unknown;
  id?: unknown;
  name?: unknown;
  source_type?: unknown;
  _permissions?: {
    can_read_content?: unknown;
    can_manage_source?: unknown;
  };
}

interface CallerDatasourceOption {
  name: string;
  sourceType?: string;
  canRead: boolean;
  canManageSource: boolean;
}

interface DatasourceIngestionStats {
  documentCount: number;
  chunkCount: number;
}

interface RagJobListItem {
  status?: unknown;
  created_at?: unknown;
  document_count?: unknown;
  chunk_count?: unknown;
}

const MAX_JOB_BATCH_SIZE = 100;
const SUCCESSFUL_JOB_STATUSES = new Set(["completed", "completed_with_errors"]);

function ragRequestHeaders(session: {
  accessToken?: string;
  org?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  if (session.org) headers["X-Tenant-Id"] = session.org;
  return headers;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

/**
 * Best-effort id -> display name lookup from the RAG server. Returns an
 * empty map (never throws) so a RAG-server outage degrades the picker to
 * raw ids instead of failing the whole editor load.
 */
async function loadCallerReadableDatasources(session: {
  accessToken?: string;
  org?: string;
}): Promise<Map<string, CallerDatasourceOption>> {
  const options = new Map<string, CallerDatasourceOption>();
  if (!session.accessToken) return options;

  try {
    const response = await fetch(`${getRagServerUrl()}/v1/datasources`, {
      method: "GET",
      headers: ragRequestHeaders(session),
    });
    if (!response.ok) return options;
    const data: unknown = await response.json();
    const list =
      data &&
      typeof data === "object" &&
      Array.isArray((data as { datasources?: unknown }).datasources)
        ? (data as { datasources: RagDatasourceListItem[] }).datasources
        : [];
    for (const item of list) {
      const id = item.datasource_id ?? item.id;
      if (typeof id !== "string" || !id) continue;
      const canRead = item._permissions?.can_read_content === true;
      const canManageSource = item._permissions?.can_manage_source === true;
      if (!canRead && !canManageSource) continue;
      options.set(id, {
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name.trim()
            : id,
        ...(typeof item.source_type === "string" && item.source_type.trim()
          ? { sourceType: item.source_type.trim() }
          : {}),
        canRead,
        canManageSource,
      });
    }
  } catch {
    // best-effort — fall back to raw ids
  }
  return options;
}

/**
 * Load the latest successful ingestion counts in bounded batches. The RAG
 * endpoint applies its own datasource read filter, and failures intentionally
 * degrade to cards without rarity metadata.
 */
async function loadLatestIngestionStats(
  session: { accessToken?: string; org?: string },
  datasourceIds: string[],
): Promise<Map<string, DatasourceIngestionStats>> {
  const stats = new Map<string, DatasourceIngestionStats>();
  if (!session.accessToken || datasourceIds.length === 0) return stats;

  const batches: string[][] = [];
  for (
    let index = 0;
    index < datasourceIds.length;
    index += MAX_JOB_BATCH_SIZE
  ) {
    batches.push(datasourceIds.slice(index, index + MAX_JOB_BATCH_SIZE));
  }

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const response = await fetch(`${getRagServerUrl()}/v1/jobs/batch`, {
        method: "POST",
        headers: ragRequestHeaders(session),
        body: JSON.stringify({
          datasource_ids: batch,
          status_filter: [...SUCCESSFUL_JOB_STATUSES],
        }),
      });
      if (!response.ok) return null;
      return {
        batch,
        body: (await response.json()) as unknown,
      };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { batch, body } = result.value;
    const jobs =
      body && typeof body === "object"
        ? (body as { jobs?: unknown }).jobs
        : undefined;
    if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) continue;

    for (const datasourceId of batch) {
      const candidateJobs = (jobs as Record<string, unknown>)[datasourceId];
      if (!Array.isArray(candidateJobs)) continue;
      const latest = (candidateJobs as RagJobListItem[])
        .filter(
          (job) =>
            typeof job.status === "string" &&
            SUCCESSFUL_JOB_STATUSES.has(job.status),
        )
        .sort(
          (left, right) =>
            nonNegativeInteger(right.created_at) -
            nonNegativeInteger(left.created_at),
        )[0];
      if (!latest) continue;
      stats.set(datasourceId, {
        documentCount: nonNegativeInteger(latest.document_count),
        chunkCount: nonNegativeInteger(latest.chunk_count),
      });
    }
  }

  return stats;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);

  const { searchParams } = new URL(request.url);
  const teamSlug = (searchParams.get("team_slug") || "").trim();
  const purpose =
    searchParams.get("purpose") === "publish" ? "publish" : "agent";

  if (teamSlug) {
    // The caller must be able to act as this team (member/admin) — mirrors the
    // owner-team gate used elsewhere in the agent editor's write path. Org
    // admins can edit agents for any team and therefore need the same explicit
    // bypass here or their datasource picker would fail to load.
    try {
      await requireResourcePermission(
        session,
        { type: "team", id: teamSlug, action: "use" },
        { bypassForOrgAdmin: true },
      );
    } catch {
      await requireResourcePermission(
        session,
        { type: "team", id: teamSlug, action: "manage" },
        { bypassForOrgAdmin: true },
      );
    }
  }

  const grants = teamSlug
    ? await listTeamKbGrants(teamSlug)
    : { kbIds: [] as string[], permissions: {} as Record<string, string> };
  const callerDatasources = await loadCallerReadableDatasources({
    accessToken: session.accessToken,
    org: session.org,
  });
  const callerReadableIds = [...callerDatasources]
    .filter(([, option]) => option.canRead)
    .map(([id]) => id);
  const ids = new Set(
    purpose === "publish"
      ? callerDatasources.keys()
      : [...grants.kbIds, ...callerReadableIds],
  );
  const candidates = [...ids].map((id) => ({ id }));
  const manageableIds =
    purpose === "publish"
      ? await manageableDatasourceIdsForCollectionPublishing(session, [...ids])
      : new Set<string>();
  const ingestionStats = await loadLatestIngestionStats(
    { accessToken: session.accessToken, org: session.org },
    [...ids],
  );

  return successResponse({
    datasources: candidates
      .map(({ id }) => {
        const canManage = manageableIds.has(id);
        return {
          datasource_id: id,
          name: callerDatasources.get(id)?.name || id,
          ...(callerDatasources.get(id)?.sourceType
            ? { source_type: callerDatasources.get(id)?.sourceType }
            : {}),
          ...(ingestionStats.has(id)
            ? {
                document_count: ingestionStats.get(id)?.documentCount,
                chunk_count: ingestionStats.get(id)?.chunkCount,
              }
            : {}),
          permission:
            purpose === "publish"
              ? canManage
                ? "Manage source"
                : "Read source"
              : grants.permissions[id] || "Your access",
          ...(purpose === "publish" ? { can_manage: canManage } : {}),
          ...(purpose === "publish"
            ? { can_read: callerDatasources.get(id)?.canRead === true }
            : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});
