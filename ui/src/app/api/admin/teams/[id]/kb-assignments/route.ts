import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  requireRbacPermission,
  ApiError,
} from '@/lib/api-middleware';
import type { TeamKbOwnership, KbPermission } from '@/lib/rbac/types';

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

function extractTeamRolesFromSession(session: Record<string, unknown>): string[] {
  const accessToken = session.accessToken as string | undefined;
  if (!accessToken) return [];
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return [];
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    const realmRoles: string[] =
      (payload.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
    return realmRoles.filter((r: string) => r.startsWith('team_member('));
  } catch {
    return [];
  }
}

function isTeamAdminOrOwner(
  session: Record<string, unknown>,
  teamId: string,
  userRole: string
): boolean {
  if (userRole === 'admin') return true;
  const teamRoles = extractTeamRolesFromSession(session);
  return teamRoles.some((r: string) => {
    const match = r.match(/^team_member\((.+)\)$/);
    return match && match[1] === teamId;
  });
}

const VALID_PERMISSIONS: KbPermission[] = ['read', 'ingest', 'admin'];

// GET /api/admin/teams/[id]/kb-assignments
export const GET = withErrorHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    return withAuth(request, async (_req, user, session) => {
      const params = await context.params;
      validateTeamId(params.id);

      if (params.id === GLOBAL_PSEUDO_TEAM) {
        if (user.role !== 'admin') {
          throw new ApiError('Only admins can view global KB assignments', 403);
        }
      } else {
        const canViewAdmin = await requireRbacPermission(session, 'admin_ui', 'view').then(
          () => true,
          () => false
        );
        if (!canViewAdmin && !isTeamAdminOrOwner(session, params.id, user.role)) {
          throw new ApiError('You do not have permission to view this team\'s KB assignments', 403);
        }

        const teams = await getCollection('teams');
        const team = await teams.findOne({ _id: new ObjectId(params.id) });
        if (!team) {
          throw new ApiError('Team not found', 404);
        }
      }

      const ownership = await getCollection<TeamKbOwnership>('team_kb_ownership');
      const record = await ownership.findOne({ team_id: params.id });

      return successResponse({
        team_id: params.id,
        kb_ids: record?.kb_ids ?? [],
        kb_permissions: record?.kb_permissions ?? {},
        allowed_datasource_ids: record?.allowed_datasource_ids ?? [],
        updated_at: record?.updated_at ?? null,
        updated_by: record?.updated_by ?? null,
      });
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

    return withAuth(request, async (_req, user, session) => {
      const params = await context.params;
      validateTeamId(params.id);

      if (params.id === GLOBAL_PSEUDO_TEAM) {
        if (user.role !== 'admin') {
          throw new ApiError('Only admins can manage global KB assignments', 403);
        }
      } else {
        const canAdmin = await requireRbacPermission(session, 'admin_ui', 'admin').then(
          () => true,
          () => false
        );
        if (!canAdmin && !isTeamAdminOrOwner(session, params.id, user.role)) {
          throw new ApiError('You do not have permission to manage this team\'s KB assignments', 403);
        }

        const teams = await getCollection('teams');
        const team = await teams.findOne({ _id: new ObjectId(params.id) });
        if (!team) {
          throw new ApiError('Team not found', 404);
        }
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

    return withAuth(request, async (_req, user, session) => {
      const params = await context.params;
      validateTeamId(params.id);

      if (params.id === GLOBAL_PSEUDO_TEAM) {
        if (user.role !== 'admin') {
          throw new ApiError('Only admins can manage global KB assignments', 403);
        }
      } else {
        const canAdmin = await requireRbacPermission(session, 'admin_ui', 'admin').then(
          () => true,
          () => false
        );
        if (!canAdmin && !isTeamAdminOrOwner(session, params.id, user.role)) {
          throw new ApiError('You do not have permission to manage this team\'s KB assignments', 403);
        }
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
    });
  }
);
