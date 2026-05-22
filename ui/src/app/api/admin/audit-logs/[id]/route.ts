/**
 * Admin audit-log single conversation operations.
 * DELETE permanently removes conversation + messages + checkpoints + GridFS files.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  withErrorHandler,
  ApiError,
  successResponse,
  getAuthFromBearerOrSession,
  requireRbacPermission,
} from '@/lib/api-middleware';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import { getServerConfig } from '@/lib/config';
import type { Conversation } from '@/types/mongodb';

export const DELETE = withErrorHandler(
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
    await requireRbacPermission(session, 'admin_ui', 'admin');

      const { id: conversationId } = await params;
      if (!conversationId) {
        throw new ApiError('Conversation ID is required', 400);
      }

      const conversations = await getCollection<Conversation>('conversations');
      const conversation = await conversations.findOne({ _id: conversationId });

      if (!conversation) {
        throw new ApiError('Conversation not found', 404, 'NOT_FOUND');
      }

      // Get agent_id from participants for GridFS cleanup
      const agentParticipant = conversation.participants?.find(
        (p: { type: string; id: string }) => p.type === 'agent'
      );
      const agentId = agentParticipant?.id || null;

      // 1. Delete conversation document
      await conversations.deleteOne({ _id: conversationId });

      // 2. Delete all messages
      const messages = await getCollection('messages');
      const msgResult = await messages.deleteMany({ conversation_id: conversationId });

      // 3. Delete checkpoints
      let checkpointCount = 0;
      let checkpointWritesCount = 0;
      try {
        const checkpoints = await getCollection('checkpoints_conversation');
        const cpResult = await checkpoints.deleteMany({ thread_id: conversationId });
        checkpointCount = cpResult.deletedCount;

        const checkpointWrites = await getCollection('checkpoint_writes_conversation');
        const cwResult = await checkpointWrites.deleteMany({ thread_id: conversationId });
        checkpointWritesCount = cwResult.deletedCount;
      } catch {
        // Checkpoint collections may not exist
      }

      // 4. Delete GridFS files for this conversation namespace
      let filesDeleted = 0;
      if (agentId) {
        try {
          const gridfsFiles = await getCollection('agent_files.files');
          const gridfsChunks = await getCollection('agent_files.chunks');

          // Find all file docs matching the namespace
          const fileDocs = await gridfsFiles
            .find({ 'metadata.namespace': [agentId, conversationId, 'filesystem'] })
            .toArray();

          if (fileDocs.length > 0) {
            const fileIds = fileDocs.map((d) => d._id);
            // Delete chunks first, then file metadata
            await gridfsChunks.deleteMany({ files_id: { $in: fileIds } as any });
            const delResult = await gridfsFiles.deleteMany({ _id: { $in: fileIds } as any });
            filesDeleted = delResult.deletedCount;
          }
        } catch {
          // GridFS collections may not exist
        }
      }

      return successResponse({
        deleted: true,
        conversation_id: conversationId,
        messages_deleted: msgResult.deletedCount,
        checkpoints_deleted: checkpointCount,
        checkpoint_writes_deleted: checkpointWritesCount,
        files_deleted: filesDeleted,
      });
  },
);
