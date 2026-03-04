import { NextRequest, NextResponse } from 'next/server';
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  getPaginationParams,
  ApiError,
  successResponse,
} from '@/lib/api-middleware';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { getServerConfig } from '@/lib/config';
import type { Message, Conversation } from '@/types/mongodb';

export const GET = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    if (!isMongoDBConfigured) {
      return NextResponse.json(
        { success: false, error: 'MongoDB not configured', code: 'MONGODB_NOT_CONFIGURED' },
        { status: 503 },
      );
    }

    if (!getServerConfig().auditLogsEnabled) {
      return NextResponse.json(
        { success: false, error: 'Audit logs feature is not enabled', code: 'FEATURE_DISABLED' },
        { status: 403 },
      );
    }

    return withAuth(request, async (req, _user, session) => {
      requireAdmin(session);

      const { id: conversationId } = await params;

      if (!conversationId) {
        throw new ApiError('Conversation ID is required', 400);
      }

      const conversations = await getCollection<Conversation>('conversations');
      const conversation = await conversations.findOne({ _id: conversationId });

      if (!conversation) {
        throw new ApiError('Conversation not found', 404, 'NOT_FOUND');
      }

      const { page, pageSize, skip } = getPaginationParams(req);
      const messages = await getCollection<Message>('messages');

      const query = { conversation_id: conversationId };
      const total = await messages.countDocuments(query);
      const items = await messages
        .find(query)
        .sort({ created_at: 1 })
        .skip(skip)
        .limit(pageSize)
        .toArray();

      return successResponse({
        conversation: {
          _id: conversation._id,
          title: conversation.title,
          owner_id: conversation.owner_id,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
          tags: conversation.tags,
          sharing: conversation.sharing,
          is_archived: conversation.is_archived,
          deleted_at: conversation.deleted_at,
        },
        messages: {
          items,
          total,
          page,
          page_size: pageSize,
          has_more: page * pageSize < total,
        },
      });
    });
  },
);
