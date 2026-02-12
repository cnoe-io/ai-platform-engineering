// GET /api/chat/conversations/[id]/share - Get sharing info
// POST /api/chat/conversations/[id]/share - Share conversation with users
// DELETE /api/chat/conversations/[id]/share/[userId] handled in separate file

import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCollection } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireOwnership,
  validateUUID,
  validateRequired,
  validateEmail,
} from '@/lib/api-middleware';
import type { Conversation, ShareConversationRequest, SharingAccess } from '@/types/mongodb';

// GET /api/chat/conversations/[id]/share
export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  return withAuth(request, async (req, user) => {
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

    requireOwnership(conversation.owner_id, user.email);

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
  return withAuth(request, async (req, user) => {
    const params = await context.params;
    const conversationId = params.id;
    const body: ShareConversationRequest = await request.json();

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    // Require at least one of user_emails or team_ids
    if ((!body.user_emails || body.user_emails.length === 0) && 
        (!body.team_ids || body.team_ids.length === 0)) {
      throw new ApiError('Either user_emails or team_ids must be provided', 400);
    }

    validateRequired(body, ['permission']);

    const conversations = await getCollection<Conversation>('conversations');
    const conversation = await conversations.findOne({ _id: conversationId });

    if (!conversation) {
      throw new ApiError('Conversation not found', 404);
    }

    requireOwnership(conversation.owner_id, user.email);

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
      // Validate team IDs exist
      const teams = await getCollection('teams');
      for (const teamId of body.team_ids) {
        // Convert string teamId to ObjectId for MongoDB query
        if (!ObjectId.isValid(teamId)) {
          throw new ApiError(`Invalid team ID format: ${teamId}`, 400);
        }
        const team = await teams.findOne({ _id: new ObjectId(teamId) });
        if (!team) {
          throw new ApiError(`Team not found: ${teamId}`, 404);
        }
      }

      // Initialize sharing object if it doesn't exist
      if (!conversation.sharing) {
        update['sharing'] = {};
      }

      // Update conversation shared_with_teams
      const existingSharedWithTeams = conversation.sharing?.shared_with_teams || [];
      update['sharing.shared_with_teams'] = [...new Set([...existingSharedWithTeams, ...body.team_ids])];
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
