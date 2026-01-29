// GET /api/chat/conversations/[id]/share - Get sharing info
// POST /api/chat/conversations/[id]/share - Share conversation with users
// DELETE /api/chat/conversations/[id]/share/[userId] handled in separate file

import { NextRequest } from 'next/server';
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
  { params }: { params: { id: string } }
) => {
  return withAuth(request, async (req, user) => {
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
      .find({ conversation_id: conversationId, revoked_at: null })
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
  { params }: { params: { id: string } }
) => {
  return withAuth(request, async (req, user) => {
    const conversationId = params.id;
    const body: ShareConversationRequest = await request.json();

    if (!validateUUID(conversationId)) {
      throw new ApiError('Invalid conversation ID format', 400);
    }

    validateRequired(body, ['user_emails', 'permission']);

    // Validate emails
    for (const email of body.user_emails) {
      if (!validateEmail(email)) {
        throw new ApiError(`Invalid email format: ${email}`, 400);
      }
    }

    const conversations = await getCollection<Conversation>('conversations');
    const conversation = await conversations.findOne({ _id: conversationId });

    if (!conversation) {
      throw new ApiError('Conversation not found', 404);
    }

    requireOwnership(conversation.owner_id, user.email);

    const now = new Date();
    const sharingAccess = await getCollection<SharingAccess>('sharing_access');

    // Create sharing access records
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

    // Update conversation sharing info
    const update: any = {
      'sharing.shared_with': [...new Set([...conversation.sharing.shared_with, ...body.user_emails])],
    };

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
