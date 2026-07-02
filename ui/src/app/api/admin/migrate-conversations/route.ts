// POST /api/admin/migrate-conversations - Migrate localStorage conversations to MongoDB

import {
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler
} from '@/lib/api-middleware';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import { NextRequest,NextResponse } from 'next/server';

interface MigrateRequest {
  conversations: Array<{
    id: string;
    title: string;
    createdAt: string;
    messages: any[];
  }>;
}

// POST /api/admin/migrate-conversations
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, 'admin_ui', 'admin');

    const body: MigrateRequest = await request.json();

    if (!body.conversations || body.conversations.length === 0) {
      return successResponse({
        message: 'No conversations to migrate',
        migrated: 0,
        skipped: 0,
      });
    }

    const conversations = await getCollection('conversations');
    const messages = await getCollection('messages');

    let migrated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const conv of body.conversations) {
      try {
        // Check if conversation already exists in MongoDB
        const existing = await conversations.findOne({ _id: conv.id } as any);
        if (existing) {
          skipped++;
          continue;
        }

        // Create conversation in MongoDB
        const now = new Date();
        await conversations.insertOne({
          _id: conv.id,
          title: conv.title,
          // Canonical top-level client_type (metadata.client_type is deprecated).
          client_type: 'webui',
          owner_id: user.email,
          created_at: new Date(conv.createdAt),
          updated_at: now,
          metadata: {
            total_messages: conv.messages?.length || 0,
          },
          sharing: {
            is_public: false,
            shared_with: [],
            shared_with_teams: [],
            share_link_enabled: false,
          },
          tags: ['migrated-from-localstorage'],
          is_archived: false,
          is_pinned: false,
        } as any);

        // Migrate messages if available
        if (conv.messages && conv.messages.length > 0) {
          const messageDocs = conv.messages.map((msg: any, index: number) => ({
            conversation_id: conv.id,
            // Denormalized for the analytics queries that group by owner.
            owner_id: user.email,
            role: msg.role || 'user',
            content: msg.content || '',
            created_at: msg.created_at ? new Date(msg.created_at) : now,
            metadata: {
              // 'web' so migrated messages are counted by the admin stats route,
              // which filters web traffic on metadata.source.
              source: 'web',
              turn_id: msg.turn_id || `turn-${index}`,
              latency_ms: msg.latency_ms,
              agent_name: msg.agent_name,
            },
            artifacts: msg.artifacts || [],
          }));

          await messages.insertMany(messageDocs);
        }

        migrated++;
      } catch (error: any) {
        console.error(`[Admin Migration] Failed to migrate ${conv.id}:`, error);
        errors.push(`${conv.title}: ${error.message}`);
      }
    }

    console.log(`[Admin Migration] Migrated ${migrated} conversations, skipped ${skipped}`);

    return successResponse({
      message: `Successfully migrated ${migrated} conversations`,
      migrated,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
});
