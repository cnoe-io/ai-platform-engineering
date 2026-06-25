// GET /api/chat/conversations/[id]/share - Get sharing info
// POST /api/chat/conversations/[id]/share - Share conversation with users
// DELETE /api/chat/conversations/[id]/share/[userId] handled in separate file

import {
ApiError,
successResponse,
validateEmail,
validateUUID,
withAuth,
withErrorHandler
} from '@/lib/api-middleware';
import { getCollection } from '@/lib/mongodb';
import { requireConversationResourcePermission } from '@/lib/rbac/conversation-implicit-authz';
import { writeOpenFgaTuples, type OpenFgaTupleKey } from '@/lib/rbac/openfga';
import type { Conversation,ShareConversationRequest,SharingAccess } from '@/types/mongodb';
import { ObjectId } from 'mongodb';
import { NextRequest } from 'next/server';

type SharePermission = 'view' | 'comment';

interface TeamShareDocument {
  _id?: unknown;
  slug?: string;
  name?: string;
}

interface ResolvedTeamShare {
  shareRef: string;
  subjectRef: string;
  aliases: string[];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function teamLookupFilter(teamRef: string): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [
    { slug: teamRef },
    { _id: teamRef },
  ];
  if (ObjectId.isValid(teamRef)) {
    clauses.push({ _id: new ObjectId(teamRef) });
  }
  return { $or: clauses };
}

async function resolveTeamShares(teamRefs: string[]): Promise<ResolvedTeamShare[]> {
  const teams = await getCollection<TeamShareDocument>('teams');
  const resolved: ResolvedTeamShare[] = [];

  for (const rawRef of uniqueStrings(teamRefs)) {
    const team = await teams.findOne(teamLookupFilter(rawRef));
    if (!team) {
      throw new ApiError(`Team not found: ${rawRef}`, 404);
    }

    const id = team._id !== undefined && team._id !== null ? String(team._id) : rawRef;
    const slug = typeof team.slug === 'string' ? team.slug.trim() : '';
    // assisted-by Codex Codex-sonnet-4-6
    // Store canonical slugs for new team shares, while accepting legacy Mongo _id refs.
    const shareRef = slug || id;

    resolved.push({
      shareRef,
      subjectRef: slug || id,
      aliases: uniqueStrings([rawRef, id, slug]),
    });
  }

  return resolved;
}

function canonicalizeSharedTeamRefs(existingRefs: string[], resolvedTeams: ResolvedTeamShare[]): string[] {
  const next: string[] = [];
  for (const existingRef of existingRefs) {
    const ref = String(existingRef).trim();
    if (!ref) continue;
    const resolved = resolvedTeams.find((team) => team.aliases.includes(ref));
    next.push(resolved?.shareRef ?? ref);
  }
  next.push(...resolvedTeams.map((team) => team.shareRef));
  return uniqueStrings(next);
}

function mergeTeamPermissions(
  existing: Record<string, SharePermission> | undefined,
  resolvedTeams: ResolvedTeamShare[],
  permission: SharePermission,
): Record<string, SharePermission> {
  const next: Record<string, SharePermission> = {};
  for (const [ref, value] of Object.entries(existing || {})) {
    const resolved = resolvedTeams.find((team) => team.aliases.includes(ref));
    next[resolved?.shareRef ?? ref] = value;
  }
  for (const team of resolvedTeams) {
    next[team.shareRef] = permission;
  }
  return next;
}

function teamConversationGrantTuples(
  conversationId: string,
  resolvedTeams: ResolvedTeamShare[],
  permission: SharePermission,
): OpenFgaTupleKey[] {
  const tuples: OpenFgaTupleKey[] = [];
  for (const team of resolvedTeams) {
    const user = `team:${team.subjectRef}#member`;
    tuples.push({ user, relation: 'reader', object: `conversation:${conversationId}` });
    if (permission === 'comment') {
      tuples.push({ user, relation: 'writer', object: `conversation:${conversationId}` });
    }
  }
  return tuples;
}

// GET /api/chat/conversations/[id]/share
export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user, session) => {
    const params = await context.params;
    const conversationId = params.id;

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    const conversations = await getCollection<Conversation>('conversations');
    const conversation = await conversations.findOne({ _id: conversationId });

    if (!conversation) {
      throw new ApiError('Conversation not found', 404);
    }

    await requireConversationResourcePermission(session, user.email, conversation, 'share');

    const sharingAccess = await getCollection<SharingAccess>('sharing_access');
    const accessList = await sharingAccess
      .find({ 
        conversation_id: conversationId, 
        revoked_at: { $exists: false }
      })
      .toArray();

    return successResponse({
      sharing: conversation.sharing,
      access_list: accessList,
    });
  });
});

// POST /api/chat/conversations/[id]/share
export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user, session) => {
    const params = await context.params;
    const conversationId = params.id;
    const body: ShareConversationRequest = await request.json();

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    // Require at least one sharing action
    const hasUsers = body.user_emails && body.user_emails.length > 0;
    const hasTeams = body.team_ids && body.team_ids.length > 0;
    const hasPublicToggle = body.is_public !== undefined;
    if (!hasUsers && !hasTeams && !hasPublicToggle) {
      throw new ApiError('At least one of user_emails, team_ids, or is_public must be provided', 400);
    }

    if ((hasUsers || hasTeams) && !body.permission) {
      throw new ApiError('permission is required when sharing with users or teams', 400);
    }
    if (body.permission && !['view', 'comment'].includes(body.permission)) {
      throw new ApiError('permission must be "view" or "comment"', 400);
    }

    const conversations = await getCollection<Conversation>('conversations');
    const conversation = await conversations.findOne({ _id: conversationId });

    if (!conversation) {
      throw new ApiError('Conversation not found', 404);
    }

    await requireConversationResourcePermission(session, user.email, conversation, 'share');

    const now = new Date();
    const sharingAccess = await getCollection<SharingAccess>('sharing_access');
    const update: any = {};

    // Handle user sharing
    if (body.user_emails && body.user_emails.length > 0) {
      // Validate emails
      for (const email of body.user_emails) {
        if (!validateEmail(email)) {
          throw new ApiError(`Invalid email format: ${email}`, 400);
        }
      }

      // Create sharing access records for users
      const accessRecords: SharingAccess[] = body.user_emails.map((email) => ({
        conversation_id: conversationId,
        granted_by: user.email,
        granted_to: email,
        permission: body.permission,
        granted_at: now,
      }));

      if (accessRecords.length > 0) {
        await sharingAccess.insertMany(accessRecords as any);
      }

      // Initialize sharing object if it doesn't exist
      if (!conversation.sharing) {
        update['sharing'] = {};
      }
      
      // Update conversation shared_with
      const existingSharedWith = conversation.sharing?.shared_with || [];
      update['sharing.shared_with'] = [...new Set([...existingSharedWith, ...body.user_emails])];
    }

    // Handle team sharing
    if (body.team_ids && body.team_ids.length > 0) {
      const resolvedTeams = await resolveTeamShares(body.team_ids);
      const permission = body.permission as SharePermission;

      // Initialize sharing object if it doesn't exist
      if (!conversation.sharing) {
        update['sharing'] = {};
      }

      // Update conversation shared_with_teams
      const existingSharedWithTeams = conversation.sharing?.shared_with_teams || [];
      update['sharing.shared_with_teams'] = canonicalizeSharedTeamRefs(existingSharedWithTeams, resolvedTeams);

      // Store per-team permission
      update['sharing.team_permissions'] = mergeTeamPermissions(
        conversation.sharing?.team_permissions,
        resolvedTeams,
        permission,
      );

      const grantTuples = teamConversationGrantTuples(conversationId, resolvedTeams, permission);
      if (grantTuples.length > 0) {
        try {
          await writeOpenFgaTuples({ writes: grantTuples, deletes: [] });
        } catch (err) {
          console.warn('[chat/share] Team conversation grant write failed (best-effort):', err);
        }
      }
    }

    if (body.is_public !== undefined) {
      update['sharing.is_public'] = body.is_public;
    }

    if (body.public_permission) {
      update['sharing.public_permission'] = body.public_permission;
    }

    if (body.enable_link !== undefined) {
      update['sharing.share_link_enabled'] = body.enable_link;
    }

    if (body.link_expires) {
      update['sharing.share_link_expires'] = new Date(body.link_expires);
    }

    await conversations.updateOne(
      { _id: conversationId },
      { $set: update }
    );

    const updated = await conversations.findOne({ _id: conversationId });

    return successResponse(updated);
  });
});

// PATCH /api/chat/conversations/[id]/share — update permission for a user or team
export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user, session) => {
    const params = await context.params;
    const conversationId = params.id;
    const body = await request.json();

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    const { email, team_id, permission } = body;
    if (!permission || !['view', 'comment'].includes(permission)) {
      throw new ApiError('permission must be "view" or "comment"', 400);
    }
    if (!email && !team_id) {
      throw new ApiError('email or team_id is required', 400);
    }

    const conversations = await getCollection<Conversation>('conversations');
    const conversation = await conversations.findOne({ _id: conversationId });
    if (!conversation) {
      throw new ApiError('Conversation not found', 404);
    }

    await requireConversationResourcePermission(session, user.email, conversation, 'share');

    if (email) {
      const sharingAccess = await getCollection<SharingAccess>('sharing_access');
      await sharingAccess.updateOne(
        { conversation_id: conversationId, granted_to: email, revoked_at: null },
        { $set: { permission } }
      );
    }

    if (team_id) {
      const teamPerms = conversation.sharing?.team_permissions || {};
      teamPerms[team_id] = permission;
      await conversations.updateOne(
        { _id: conversationId },
        { $set: { 'sharing.team_permissions': teamPerms } }
      );
    }

    const updated = await conversations.findOne({ _id: conversationId });
    return successResponse(updated);
  });
});
