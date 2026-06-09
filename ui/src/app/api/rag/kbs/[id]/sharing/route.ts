/**
 * Knowledge Base "Share with Teams" route.
 *
 * GET /api/rag/kbs/[id]/sharing — returns the canonical set of team slugs
 * that currently have read access to `knowledge_base:<id>`, derived from
 * OpenFGA (`team:<slug>#member reader knowledge_base:<id>` is the canonical
 * marker; the matching `team:<slug>#member ingestor ...` and
 * `team:<slug>#admin manager ...` tuples are always written alongside it by
 * the reconciler).
 *
 * PUT /api/rag/kbs/[id]/sharing — accepts `{ team_slugs: string[] }` and
 * calls `reconcileKnowledgeBaseRelationships` so unchecking a team in the UI
 * genuinely revokes its grant instead of leaving a dangling tuple.
 *
 * Gate: `requireResourcePermission` on `knowledge_base:<id>#admin` with
 * `bypassForOrgAdmin: true` so org admins always retain access; team admins
 * on the owner team also satisfy this via the inheritance edge in the
 * OpenFGA model.
 */

import {
ApiError,
handleApiError,
requireRbacPermission,
} from "@/lib/api-middleware";
import { authOptions } from "@/lib/auth-config";
import { readOpenFgaTuples } from "@/lib/rbac/openfga";
import {
reconcileDataSourceRelationships,
reconcileKnowledgeBaseRelationships,
} from "@/lib/rbac/openfga-owned-resources";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { handleShareableResourceWrite } from "@/lib/rbac/shareable-resource";
import { getServerSession } from "next-auth";
import { NextRequest,NextResponse } from "next/server";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

function isValidId(value: unknown): value is string {
  return typeof value === "string" && OPENFGA_ID_PATTERN.test(value);
}

function normalizeTeamSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed || !isValidId(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function loadSharedTeamSlugs(kbId: string): Promise<string[]> {
  // Read every tuple targeting this knowledge_base and extract any
  // `team:<slug>#member reader knowledge_base:<id>` entry. The matching
  // admin/manager pair is always written together so reading the reader
  // marker is sufficient to recover the set.
  const slugs = new Set<string>();
  let continuationToken: string | undefined;
  const object = `knowledge_base:${kbId}`;
  do {
    const page = await readOpenFgaTuples({
      tuple: { object },
      continuationToken,
    });
    for (const tuple of page.tuples) {
      const key = tuple.key;
      if (!key) continue;
      if (key.object !== object) continue;
      if (key.relation !== "reader") continue;
      const match = /^team:([^#]+)#member$/.exec(key.user);
      if (match && match[1] && isValidId(match[1])) {
        slugs.add(match[1]);
      }
    }
    continuationToken = page.continuationToken;
  } while (continuationToken);

  return [...slugs].sort();
}

function getRagServerUrl(): string {
  return (
    process.env.RAG_SERVER_URL ||
    process.env.NEXT_PUBLIC_RAG_URL ||
    "http://localhost:9446"
  );
}

/**
 * Read the persisted owner team + creator from the datasource config (the
 * source of truth — see spec 2026-06-03, US5). A data_source is 1:1 with its
 * knowledge_base (same id), so we look up the datasource by `kbId` from the
 * RAG server's `/v1/datasources` list. Returns nulls when the config is
 * unavailable or carries no ownership (pre-migration datasources).
 */
interface DatasourceConfigSnapshot {
  ownerTeamSlug: string | null;
  creatorSubject: string | null;
  /** The full datasource record, needed for the read-modify-write owner upsert. */
  raw: Record<string, unknown> | null;
}

async function loadOwnerFromConfig(
  kbId: string,
  session: { accessToken?: string; org?: string },
): Promise<DatasourceConfigSnapshot> {
  const empty: DatasourceConfigSnapshot = { ownerTeamSlug: null, creatorSubject: null, raw: null };
  if (!session.accessToken) return empty;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
  if (session.org) headers["X-Tenant-Id"] = session.org;

  let response: Response;
  try {
    response = await fetch(`${getRagServerUrl()}/v1/datasources`, {
      method: "GET",
      headers,
    });
  } catch {
    return empty;
  }
  if (!response.ok) return empty;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return empty;
  }
  const list =
    data && typeof data === "object" && Array.isArray((data as { datasources?: unknown }).datasources)
      ? (data as { datasources: Array<Record<string, unknown>> }).datasources
      : [];
  const match = list.find((ds) => {
    const id = ds.datasource_id ?? ds.id;
    return typeof id === "string" && id === kbId;
  });
  if (!match) return empty;
  const ownerTeamSlug =
    typeof match.owner_team_slug === "string" && match.owner_team_slug.trim()
      ? match.owner_team_slug.trim()
      : null;
  const creatorSubject =
    typeof match.creator_subject === "string" && match.creator_subject.trim()
      ? match.creator_subject.trim()
      : null;
  return { ownerTeamSlug, creatorSubject, raw: match };
}

/**
 * Persist the new owner team to the datasource config via the RAG server's
 * full-object upsert (`POST /v1/datasource`). Used by the ownership-transfer
 * path: read the current `DataSourceInfo`, set `owner_team_slug`, and re-upsert
 * (config is the source of truth; the OpenFGA projection is reconciled
 * separately by the shared helper). No-op when the snapshot is unavailable.
 */
async function persistOwnerToConfig(
  snapshot: DatasourceConfigSnapshot,
  ownerTeamSlug: string | null,
  session: { accessToken?: string; org?: string },
): Promise<void> {
  if (!snapshot.raw || !session.accessToken) return;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
  };
  if (session.org) headers["X-Tenant-Id"] = session.org;
  const next = { ...snapshot.raw, owner_team_slug: ownerTeamSlug };
  const response = await fetch(`${getRagServerUrl()}/v1/datasource`, {
    method: "POST",
    headers,
    body: JSON.stringify(next),
  });
  if (!response.ok) {
    throw new ApiError(
      `Failed to persist new owner to the datasource config (${response.status}).`,
      502,
      "OWNER_PERSIST_FAILED",
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidId(id)) {
      throw new ApiError(`Invalid knowledge base id: ${id}`, 400, "INVALID_KB_ID");
    }

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      throw new ApiError("Unauthorized", 401);
    }
    if (!session.accessToken) {
      throw new ApiError("A Keycloak access token is required for KB sharing.", 401, "NOT_SIGNED_IN");
    }

    await requireRbacPermission(
      {
        accessToken: session.accessToken,
        sub: session.sub,
        org: session.org,
        user: session.user,
      },
      "rag",
      "query",
    );

    await requireResourcePermission(
      { sub: session.sub, role: session.role, user: session.user },
      { type: "knowledge_base", id, action: "read" },
      { bypassForOrgAdmin: true },
    );

    const [sharedTeamSlugs, owner] = await Promise.all([
      loadSharedTeamSlugs(id),
      loadOwnerFromConfig(id, { accessToken: session.accessToken, org: session.org }),
    ]);

    // The owner team is granted via the same reader/manager tuples as a shared
    // team, so OpenFGA can't distinguish it — but the datasource config CAN
    // (it stores owner_team_slug). Dedupe the owner out of the shared list so
    // the UI renders it once, in the owner slot.
    const sharedWithoutOwner = owner.ownerTeamSlug
      ? sharedTeamSlugs.filter((slug) => slug !== owner.ownerTeamSlug)
      : sharedTeamSlugs;

    return NextResponse.json({
      knowledge_base_id: id,
      shared_team_slugs: sharedWithoutOwner,
      owner_team_slug: owner.ownerTeamSlug,
      creator_subject: owner.creatorSubject,
    });
  } catch (error) {
    if (error instanceof ApiError) return handleApiError(error);
    console.error("[rag/kbs/[id]/sharing] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load KB sharing", details: String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidId(id)) {
      throw new ApiError(`Invalid knowledge base id: ${id}`, 400, "INVALID_KB_ID");
    }

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      throw new ApiError("Unauthorized", 401);
    }
    if (!session.accessToken) {
      throw new ApiError("A Keycloak access token is required for KB sharing.", 401, "NOT_SIGNED_IN");
    }

    await requireRbacPermission(
      {
        accessToken: session.accessToken,
        sub: session.sub,
        org: session.org,
        user: session.user,
      },
      "rag",
      "admin",
    );

    await requireResourcePermission(
      { sub: session.sub, role: session.role, user: session.user },
      { type: "knowledge_base", id, action: "admin" },
      { bypassForOrgAdmin: true },
    );

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("Invalid JSON body", 400, "INVALID_JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError(
        "Request body must be an object with a `team_slugs` array",
        400,
        "INVALID_BODY",
      );
    }
    const requestedSlugs = normalizeTeamSlugs((body as { team_slugs?: unknown }).team_slugs);
    const requestedOwner =
      typeof (body as { owner_team_slug?: unknown }).owner_team_slug === "string"
        ? ((body as { owner_team_slug: string }).owner_team_slug.trim() || null)
        : null;
    const confirmedNotMember = (body as { confirm_not_member?: unknown }).confirm_not_member === true;
    const previousSlugs = await loadSharedTeamSlugs(id);
    const snapshot = await loadOwnerFromConfig(id, {
      accessToken: session.accessToken,
      org: session.org,
    });

    // Single shared ownership flow (creator preserved, transfer guard +
    // not-a-member confirm, shared-team diff). The KB persists owner to the
    // datasource config (read-modify-write upsert) and reconciles via
    // `reconcileKnowledgeBaseRelationships` (which carries the KB's
    // reader+ingestor member set) plus the data_source `parent_kb` edge.
    let dataSourceResult: Awaited<ReturnType<typeof reconcileDataSourceRelationships>> = {
      enabled: false,
      writes: 0,
      deletes: 0,
    };
    const { reconcile: result, ownerTeamSlug, sharedTeamSlugs } =
      await handleShareableResourceWrite({
        objectType: "knowledge_base",
        objectId: id,
        session: { sub: session.sub, role: session.role, user: session.user },
        requestedOwnerTeamSlug: requestedOwner,
        requestedSharedTeamSlugs: requestedSlugs,
        confirmedNotMember,
        loadPrevious: async () => ({
          ownerTeamSlug: snapshot.ownerTeamSlug,
          sharedTeamSlugs: previousSlugs,
          creatorSubject: snapshot.creatorSubject,
        }),
        // Persist owner to the datasource config (source of truth) only when it
        // changed (a transfer); a share-only edit leaves the config untouched.
        persist: async (next) => {
          if (next.ownerTeamSlug !== snapshot.ownerTeamSlug) {
            await persistOwnerToConfig(snapshot, next.ownerTeamSlug, {
              accessToken: session.accessToken,
              org: session.org,
            });
          }
        },
        extraMemberRelations: ["ingestor"],
        // Reconcile the KB grants, then (idempotently) ensure the data_source
        // parent_kb inheritance edge so shared teams can query the datasource.
        reconcile: async (input) => {
          const kb = await reconcileKnowledgeBaseRelationships({
            knowledgeBaseId: id,
            ownerTeamSlug: input.ownerTeamSlug,
            previousOwnerTeamSlug: input.previousOwnerTeamSlug,
            nextSharedTeamSlugs: input.nextSharedTeamSlugs ?? [],
            previousSharedTeamSlugs: input.previousSharedTeamSlugs ?? [],
            creatorSubject: input.creatorSubject,
          });
          dataSourceResult = await reconcileDataSourceRelationships({
            dataSourceId: id,
            parentKnowledgeBaseId: id,
          });
          return kb;
        },
      });

    return NextResponse.json({
      knowledge_base_id: id,
      owner_team_slug: ownerTeamSlug,
      shared_team_slugs: sharedTeamSlugs,
      reconcile: result,
      data_source_reconcile: dataSourceResult,
    });
  } catch (error) {
    if (error instanceof ApiError) return handleApiError(error);
    console.error("[rag/kbs/[id]/sharing] PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update KB sharing", details: String(error) },
      { status: 500 },
    );
  }
}
