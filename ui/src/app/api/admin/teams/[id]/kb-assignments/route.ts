import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
} from '@/lib/api-middleware';
import type { TeamKbOwnership, KbPermission } from '@/lib/rbac/types';
import { writeOpenFgaTuples, type OpenFgaTupleKey, type TeamResourceTupleDiff } from '@/lib/rbac/openfga';
import { mirrorKnowledgeBaseDiffToDataSource } from '@/lib/rbac/openfga-owned-resources';
import { findUserRoleInTeam } from '@/lib/rbac/team-membership-store';

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
  resources?: {
    knowledge_bases?: string[];
  };
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

function buildKnowledgeBaseTupleDiff(
  teamSlug: string,
  previous: Pick<TeamKbOwnership, 'kb_ids' | 'kb_permissions'> | null | undefined,
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

async function writeRequiredKnowledgeBaseTuples(diff: TeamResourceTupleDiff): Promise<void> {
  if (diff.writes.length === 0 && diff.deletes.length === 0) return;
  const result = await writeOpenFgaTuples(diff);
  if (!result.enabled) {
    throw new ApiError('OpenFGA is not configured; KB assignments cannot be persisted safely', 503);
  }
  // Mirror every knowledge_base grant onto the parallel data_source type.
  // Query-time access (RAG search + BFF filter) is enforced on
  // `data_source#read`; a knowledge_base-only grant lets the team discover
  // the KB but returns no search results. The mirror write is idempotent.
  const dataSourceDiff = mirrorKnowledgeBaseDiffToDataSource(diff);
  if (dataSourceDiff.writes.length > 0 || dataSourceDiff.deletes.length > 0) {
    await writeOpenFgaTuples(dataSourceDiff);
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
      let team: TeamDoc | null = null;

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
        team = await teams.findOne({ _id: new ObjectId(params.id) }) as TeamDoc | null;
        if (!team) {
          throw new ApiError('Team not found', 404);
        }
        if (!canViewAdmin && !(await isTeamMember(team, user.email))) {
          throw new ApiError('You do not have permission to view this team\'s KB assignments', 403);
        }
      }

      const ownership = await getCollection<TeamKbOwnership>('team_kb_ownership');
      const record = await ownership.findOne({ team_id: params.id });
      const legacyKbIds =
        !record && params.id !== GLOBAL_PSEUDO_TEAM && team?.resources?.knowledge_bases
          ? Array.from(
              new Set(
                team.resources.knowledge_bases
                  .map((id) => id.trim())
                  .filter((id) => id.length > 0)
              )
            )
          : [];
      const legacyPermissions = Object.fromEntries(
        legacyKbIds.map((id) => [id, 'read' as KbPermission])
      );

      return successResponse({
        team_id: params.id,
        kb_ids: record?.kb_ids ?? legacyKbIds,
        kb_permissions: record?.kb_permissions ?? legacyPermissions,
        allowed_datasource_ids: record?.allowed_datasource_ids ?? legacyKbIds,
        updated_at: record?.updated_at ?? null,
        updated_by: record?.updated_by ?? null,
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

      const ownership = await getCollection<TeamKbOwnership>('team_kb_ownership');
      const previous = await ownership.findOne({ team_id: params.id });
      const now = new Date();

      const doc: TeamKbOwnership = {
        team_id: params.id,
        tenant_id: 'default',
        kb_ids: body.kb_ids,
        allowed_datasource_ids: body.kb_ids,
        kb_permissions: permissions,
        keycloak_role: `team_member(${params.id})`,
        updated_at: now,
        updated_by: user.email,
      };

      await writeRequiredKnowledgeBaseTuples(
        buildKnowledgeBaseTupleDiff(teamSlug, previous, doc.kb_ids, doc.kb_permissions)
      );

      await ownership.updateOne(
        { team_id: params.id },
        { $set: doc },
        { upsert: true }
      );

      console.log(
        `[Admin] Team KB assignments updated: team=${params.id}, kbs=${body.kb_ids.length} by ${user.email}`
      );

      return successResponse({
        team_id: params.id,
        kb_ids: doc.kb_ids,
        kb_permissions: doc.kb_permissions,
        allowed_datasource_ids: doc.allowed_datasource_ids,
        updated_at: doc.updated_at,
        updated_by: doc.updated_by,
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

      const ownership = await getCollection<TeamKbOwnership>('team_kb_ownership');
      const record = await ownership.findOne({ team_id: params.id });
      if (!record) {
        throw new ApiError('No KB assignments found for this team', 404);
      }

      if (!record.kb_ids.includes(datasourceId)) {
        throw new ApiError(`KB "${datasourceId}" is not assigned to this team`, 404);
      }

      const updatedKbIds = record.kb_ids.filter((id) => id !== datasourceId);
      const updatedPermissions = { ...record.kb_permissions };
      delete updatedPermissions[datasourceId];
      const updatedAllowed = record.allowed_datasource_ids.filter((id) => id !== datasourceId);

      await writeRequiredKnowledgeBaseTuples({
        writes: [],
        deletes: [kbTuple(teamSlug, datasourceId, record.kb_permissions[datasourceId] ?? 'read')],
      });

      await ownership.updateOne(
        { team_id: params.id },
        {
          $set: {
            kb_ids: updatedKbIds,
            allowed_datasource_ids: updatedAllowed,
            kb_permissions: updatedPermissions,
            updated_at: new Date(),
            updated_by: user.email,
          },
        }
      );

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
