import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  getPaginationParams,
  ApiError,
  successResponse,
  getAuthFromBearerOrSession,
  requireRbacPermission,
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

    const { session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, 'admin_ui', 'audit.view');

      const { id: conversationId } = await params;

      if (!conversationId) {
        throw new ApiError('Conversation ID is required', 400);
      }

      const conversations = await getCollection<Conversation>('conversations');
      const conversation = await conversations.findOne({ _id: conversationId });

      if (!conversation) {
        throw new ApiError('Conversation not found', 404, 'NOT_FOUND');
      }

      // Get agent_id from conversation participants
      const agentParticipant = conversation.participants?.find(
        (p: { type: string; id: string }) => p.type === 'agent'
      );
      const agentId = agentParticipant?.id || null;

      // Count GridFS files for this conversation namespace
      let fileCount = 0;
      if (agentId) {
        try {
          const gridfsFiles = await getCollection('agent_files.files');
          fileCount = await gridfsFiles.countDocuments({
            'metadata.namespace': [agentId, conversationId, 'filesystem'],
          });
        } catch {
          // GridFS collection may not exist yet — not an error
        }
      }

      const { page, pageSize, skip } = getPaginationParams(request);
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
          agent_id: agentId,
        },
        file_count: fileCount,
        messages: {
          items,
          total,
          page,
          page_size: pageSize,
          has_more: page * pageSize < total,
        },
      });
  },
);
