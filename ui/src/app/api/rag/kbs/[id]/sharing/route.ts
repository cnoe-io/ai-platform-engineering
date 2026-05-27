/**
 * Knowledge Base "Share with Teams" route.
 *
 * GET /api/rag/kbs/[id]/sharing — returns the canonical set of team slugs
 * that currently have read access to `knowledge_base:<id>`, derived from
 * OpenFGA (`team:<slug>#member reader knowledge_base:<id>` is the canonical
 * marker; the matching `team:<slug>#admin manager knowledge_base:<id>` is
 * always written alongside it by the reconciler).
 *
 * PUT /api/rag/kbs/[id]/sharing — accepts `{ team_slugs: string[] }` and
 * calls `reconcileKnowledgeBaseRelationships` so unchecking a team in the UI
 * genuinely revokes its grant (instead of leaving a dangling tuple — the
 * long-standing bug that motivated PR 3 of the 2026-05-27 fine-grained KB
 * ReBAC plan).
 *
 * Gate: `requireResourcePermission` on `knowledge_base:<id>#admin` with
 * `bypassForOrgAdmin: true` so org admins always retain access; team admins
 * on the owner team also satisfy this via the inheritance edge in the
 * OpenFGA model.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import {
  ApiError,
  handleApiError,
  requireRbacPermission,
} from "@/lib/api-middleware";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import {
  reconcileKnowledgeBaseRelationships,
  buildKnowledgeBaseRelationshipTupleDiff,
} from "@/lib/rbac/openfga-owned-resources";
import { readOpenFgaTuples } from "@/lib/rbac/openfga";

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

async function loadOwnerTeamSlug(kbId: string): Promise<string | null> {
  // The reconciler writes the owner team using the same `reader`/`manager`
  // pattern as a shared team, so we can't distinguish them from OpenFGA
  // alone. For the read response we treat them all as "shared teams" — the
  // UI hides the owner-team duplicate at render time using
  // `effective_teams.owner_team_slug` returned by the RAG server.
  void kbId;
  return null;
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

    const [sharedTeamSlugs, ownerTeamSlug] = await Promise.all([
      loadSharedTeamSlugs(id),
      loadOwnerTeamSlug(id),
    ]);

    return NextResponse.json({
      knowledge_base_id: id,
      shared_team_slugs: sharedTeamSlugs,
      owner_team_slug: ownerTeamSlug,
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
    const nextSlugs = normalizeTeamSlugs((body as { team_slugs?: unknown }).team_slugs);
    const previousSlugs = await loadSharedTeamSlugs(id);

    const diff = buildKnowledgeBaseRelationshipTupleDiff({
      knowledgeBaseId: id,
      nextSharedTeamSlugs: nextSlugs,
      previousSharedTeamSlugs: previousSlugs,
    });
    void diff;

    const result = await reconcileKnowledgeBaseRelationships({
      knowledgeBaseId: id,
      nextSharedTeamSlugs: nextSlugs,
      previousSharedTeamSlugs: previousSlugs,
    });

    return NextResponse.json({
      knowledge_base_id: id,
      shared_team_slugs: nextSlugs,
      reconcile: result,
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
