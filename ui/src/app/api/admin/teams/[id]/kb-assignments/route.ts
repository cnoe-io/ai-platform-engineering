import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from '@/lib/api-middleware';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import { writeOpenFgaTuples,type OpenFgaTupleKey,type TeamResourceTupleDiff } from '@/lib/rbac/openfga';
import { reconcileDataSourceRelationships } from '@/lib/rbac/openfga-owned-resources-reconcile';
import { listTeamKbGrants } from '@/lib/rbac/team-resource-listing';
import { findUserRoleInTeam } from '@/lib/rbac/team-membership-store';
import type { KbPermission } from '@/lib/rbac/types';
import { ObjectId } from 'mongodb';
import { NextRequest,NextResponse } from 'next/server';

function requireMongoDB() {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - team KB assignments require MongoDB',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }
  return null;
}

const GLOBAL_PSEUDO_TEAM = 'global';

function validateTeamId(id: string): void {
  if (id === GLOBAL_PSEUDO_TEAM) return;
  if (!ObjectId.isValid(id)) {
    throw new ApiError('Invalid team ID format', 400);
  }
}

interface TeamDoc {
  _id: ObjectId;
  slug?: string;
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * KB-permission gate helpers backed by the canonical
 * team_membership_sources store (post 2026-05-26 canonical-membership
 * refactor). The legacy embedded `team.members[]` is no longer
 * consulted.
 *
 * Note on `"owner"`: the legacy store distinguished "owner" from
 * "admin"; the canonical store collapses both to "admin". KB gates
 * always treated owner == admin (see `isTeamAdminOrOwner` original
 * impl), so the collapse is behavior-preserving.
 */
async function isTeamMember(team: TeamDoc, email: string): Promise<boolean> {
  if (!team.slug) return false;
  const role = await findUserRoleInTeam(team.slug, { user_email: normalizeEmail(email) });
  return role !== null;
}

async function isTeamAdminOrOwner(team: TeamDoc, email: string): Promise<boolean> {
  if (!team.slug) return false;
  const role = await findUserRoleInTeam(team.slug, { user_email: normalizeEmail(email) });
  return role === "admin";
}

const VALID_PERMISSIONS: KbPermission[] = ['read', 'ingest', 'admin'];

const KB_PERMISSION_TO_OPENFGA_RELATION: Record<KbPermission, string> = {
  read: 'reader',
  ingest: 'ingestor',
  admin: 'manager',
};

function teamUsersetForPermission(teamSlug: string, permission: KbPermission): string {
  return permission === 'admin'
    ? `team:${teamSlug}#admin`
    : `team:${teamSlug}#member`;
}

function uniqueTupleKeys(tuples: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const unique: OpenFgaTupleKey[] = [];
  for (const tuple of tuples) {
    const key = `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(tuple);
  }
  return unique;
}

function kbTuple(teamSlug: string, datasourceId: string, permission: KbPermission): OpenFgaTupleKey {
  return {
    user: teamUsersetForPermission(teamSlug, permission),
    relation: KB_PERMISSION_TO_OPENFGA_RELATION[permission],
    object: `knowledge_base:${datasourceId}`,
  };
}

/** Previous team→KB grant state, read from OpenFGA (the source of truth). */
interface PreviousKbGrants {
  kb_ids: string[];
  kb_permissions: Record<string, KbPermission>;
}

function buildKnowledgeBaseTupleDiff(
  teamSlug: string,
  previous: PreviousKbGrants | null | undefined,
  nextKbIds: string[],
  nextPermissions: Record<string, KbPermission>
): TeamResourceTupleDiff {
  const previousIds = new Set(previous?.kb_ids ?? []);
  const nextIds = new Set(nextKbIds);
  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];

  for (const datasourceId of nextIds) {
    const nextPermission = nextPermissions[datasourceId] ?? 'read';
    writes.push(kbTuple(teamSlug, datasourceId, nextPermission));
  }

  for (const datasourceId of previousIds) {
    const previousPermission = previous?.kb_permissions?.[datasourceId] ?? 'read';
    const nextPermission = nextPermissions[datasourceId] ?? 'read';
    if (!nextIds.has(datasourceId) || previousPermission !== nextPermission) {
      deletes.push(kbTuple(teamSlug, datasourceId, previousPermission));
    }
  }

  return {
    writes: uniqueTupleKeys(writes),
    deletes: uniqueTupleKeys(deletes),
  };
}

/**
 * Collect the distinct datasource ids referenced by a knowledge_base tuple
 * diff (both writes and deletes), so we can ensure each has its `parent_kb`
 * inheritance edge.
 */
function knowledgeBaseIdsFromDiff(diff: TeamResourceTupleDiff): string[] {
  const KB_PREFIX = 'knowledge_base:';
  const ids = new Set<string>();
  for (const tuple of [...diff.writes, ...diff.deletes]) {
    if (tuple.object.startsWith(KB_PREFIX)) {
      ids.add(tuple.object.slice(KB_PREFIX.length));
    }
  }
  return [...ids];
}

async function writeRequiredKnowledgeBaseTuples(diff: TeamResourceTupleDiff): Promise<void> {
  if (diff.writes.length === 0 && diff.deletes.length === 0) return;
  const result = await writeOpenFgaTuples(diff);
  if (!result.enabled) {
    throw new ApiError('OpenFGA is not configured; KB assignments cannot be persisted safely', 503);
  }
  // Query-time access (RAG search + BFF filter) is enforced on
  // `data_source#read`. Rather than mirror every per-team grant onto the
  // parallel data_source type (the retired PR #1703 approach), the
  // data_source now inherits read/ingest/manage from its knowledge_base via
  // the `parent_kb` edge (spec 2026-06-03, US4). We ensure that single
  // inheritance edge exists for each affected datasource — idempotent, and
  // O(#datasources) instead of O(#grants).
  for (const datasourceId of knowledgeBaseIdsFromDiff(diff)) {
    await reconcileDataSourceRelationships({
      dataSourceId: datasourceId,
      parentKnowledgeBaseId: datasourceId,
    });
  }
}

// GET /api/admin/teams/[id]/kb-assignments
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);

      const params = await context.params;
      validateTeamId(params.id);
      // The userset slug FGA grants are keyed under. The global pseudo-team
      // grants under `team:global#...`; every real team under `team:<slug>#...`.
      let teamSlug = GLOBAL_PSEUDO_TEAM;

      if (params.id === GLOBAL_PSEUDO_TEAM) {
        if (user.role !== 'admin') {
          throw new ApiError('Only admins can view global KB assignments', 403);
        }
      } else {
        const canViewAdmin = await requireRbacPermission(session, 'admin_ui', 'view').then(
          () => true,
          () => false
        );
        const teams = await getCollection('teams');
        const team = await teams.findOne({ _id: new ObjectId(params.id) }) as TeamDoc | null;
        if (!team) {
          throw new ApiError('Team not found', 404);
        }
        if (!canViewAdmin && !(await isTeamMember(team, user.email))) {
          throw new ApiError('You do not have permission to view this team\'s KB assignments', 403);
        }
        teamSlug = (team.slug as string | undefined) || params.id;
      }

      // OpenFGA is the SINGLE source of truth for which KBs a team can access
      // (mirrors agents/skills/workflows). Every write path lands the same
      // `knowledge_base` tuples: the PUT/DELETE below, AND the RAG-server
      // upload (`write_datasource_ownership`). Reading FGA here means an
      // uploaded datasource with an owning team shows up without a manual
      // re-assignment, and there is no second store to drift.
      const grants = await listTeamKbGrants(teamSlug);

      return successResponse({
        team_id: params.id,
        kb_ids: grants.kbIds,
        kb_permissions: grants.permissions,
        allowed_datasource_ids: grants.kbIds,
        updated_at: null,
        updated_by: null,
      });
  }
);

interface PutKbAssignmentsBody {
  kb_ids: string[];
  kb_permissions?: Record<string, KbPermission>;
}

// PUT /api/admin/teams/[id]/kb-assignments
export const PUT = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);

      const params = await context.params;
      validateTeamId(params.id);
      let teamSlug = params.id;

      if (params.id === GLOBAL_PSEUDO_TEAM) {
        if (user.role !== 'admin') {
          throw new ApiError('Only admins can manage global KB assignments', 403);
        }
      } else {
        const canAdmin = await requireRbacPermission(session, 'admin_ui', 'admin').then(
          () => true,
          () => false
        );
        const teams = await getCollection('teams');
        const team = await teams.findOne({ _id: new ObjectId(params.id) }) as TeamDoc | null;
        if (!team) {
          throw new ApiError('Team not found', 404);
        }
        if (!canAdmin && !(await isTeamAdminOrOwner(team, user.email))) {
          throw new ApiError('You do not have permission to manage this team\'s KB assignments', 403);
        }
        teamSlug = (team.slug as string | undefined) || params.id;
      }

      const body: PutKbAssignmentsBody = await request.json();

      if (!Array.isArray(body.kb_ids)) {
        throw new ApiError('kb_ids must be an array of strings', 400);
      }
      if (body.kb_ids.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new ApiError('Each kb_id must be a non-empty string', 400);
      }

      const permissions: Record<string, KbPermission> = {};
      for (const kbId of body.kb_ids) {
        const perm = body.kb_permissions?.[kbId] ?? 'read';
        if (!VALID_PERMISSIONS.includes(perm)) {
          throw new ApiError(
            `Invalid permission "${perm}" for KB "${kbId}". Must be one of: ${VALID_PERMISSIONS.join(', ')}`,
            400
          );
        }
        permissions[kbId] = perm;
      }

      // Previous grant state comes from OpenFGA (the source of truth), so the
      // diff reconciles exactly what is live — no separate Mongo store to keep
      // in sync or to drift.
      const previous = await listTeamKbGrants(teamSlug);

      await writeRequiredKnowledgeBaseTuples(
        buildKnowledgeBaseTupleDiff(
          teamSlug,
          { kb_ids: previous.kbIds, kb_permissions: previous.permissions },
          body.kb_ids,
          permissions
        )
      );

      console.log(
        `[Admin] Team KB assignments updated: team=${params.id}, kbs=${body.kb_ids.length} by ${user.email}`
      );

      return successResponse({
        team_id: params.id,
        kb_ids: body.kb_ids,
        kb_permissions: permissions,
        allowed_datasource_ids: body.kb_ids,
        updated_at: null,
        updated_by: user.email,
      });
  }
);

// DELETE /api/admin/teams/[id]/kb-assignments — remove a specific KB
export const DELETE = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);

      const params = await context.params;
      validateTeamId(params.id);
      let teamSlug = params.id;

      if (params.id === GLOBAL_PSEUDO_TEAM) {
        if (user.role !== 'admin') {
          throw new ApiError('Only admins can manage global KB assignments', 403);
        }
      } else {
        const canAdmin = await requireRbacPermission(session, 'admin_ui', 'admin').then(
          () => true,
          () => false
        );
        const teams = await getCollection('teams');
        const team = await teams.findOne({ _id: new ObjectId(params.id) }) as TeamDoc | null;
        if (!team) {
          throw new ApiError('Team not found', 404);
        }
        if (!canAdmin && !(await isTeamAdminOrOwner(team, user.email))) {
          throw new ApiError('You do not have permission to manage this team\'s KB assignments', 403);
        }
        teamSlug = (team.slug as string | undefined) || params.id;
      }

      const { searchParams } = new URL(request.url);
      const datasourceId = searchParams.get('datasource_id');
      if (!datasourceId) {
        throw new ApiError('datasource_id query parameter is required', 400);
      }

      // Current grants come from OpenFGA (the source of truth). Delete the
      // tuple matching the live permission so the revoke is exact.
      const current = await listTeamKbGrants(teamSlug);
      if (!current.kbIds.includes(datasourceId)) {
        throw new ApiError(`KB "${datasourceId}" is not assigned to this team`, 404);
      }

      const updatedKbIds = current.kbIds.filter((id) => id !== datasourceId);

      await writeRequiredKnowledgeBaseTuples({
        writes: [],
        deletes: [kbTuple(teamSlug, datasourceId, current.permissions[datasourceId] ?? 'read')],
      });

      console.log(
        `[Admin] KB "${datasourceId}" removed from team ${params.id} by ${user.email}`
      );

      return successResponse({
        team_id: params.id,
        removed_datasource_id: datasourceId,
        remaining_kb_ids: updatedKbIds,
      });
  }
);
