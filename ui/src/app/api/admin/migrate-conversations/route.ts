import { getErrorMessage } from "@/lib/error-utils";
// POST /api/admin/migrate-conversations - Migrate localStorage conversations to MongoDB

import {
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler
} from '@/lib/api-middleware';
import { getCollection,isMongoDBConfigured } from '@/lib/mongodb';
import type { Document } from 'mongodb';
import { NextRequest,NextResponse } from 'next/server';

interface LegacyMessage {
  agent_name?: string;
  artifacts?: unknown[];
  content?: string;
  created_at?: string;
  latency_ms?: number;
  role?: string;
  turn_id?: string;
}

interface MigratedConversationDocument extends Document {
  _id: string;
  client_type: 'webui';
  created_at: Date;
  is_archived: boolean;
  is_pinned: boolean;
  metadata: { total_messages: number };
  owner_id: string;
  sharing: {
    is_public: false;
    share_link_enabled: false;
    shared_with: string[];
    shared_with_teams: string[];
  };
  tags: string[];
  title: string;
  updated_at: Date;
}

interface MigratedMessageDocument extends Document {
  artifacts: unknown[];
  content: string;
  conversation_id: string;
  created_at: Date;
  metadata: {
    agent_name?: string;
    latency_ms?: number;
    source: 'web';
    turn_id: string;
  };
  owner_id: string;
  role: string;
}

interface MigrateRequest {
  conversations: Array<{
    id: string;
    title: string;
    createdAt: string;
    messages: LegacyMessage[];
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

    const conversations = await getCollection<MigratedConversationDocument>('conversations');
    const messages = await getCollection<MigratedMessageDocument>('messages');

    let migrated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const conv of body.conversations) {
      try {
        // Check if conversation already exists in MongoDB
        const existing = await conversations.findOne({ _id: conv.id });
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
        });

        // Migrate messages if available
        if (conv.messages && conv.messages.length > 0) {
          const messageDocs: MigratedMessageDocument[] = conv.messages.map((msg, index) => ({
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
      } catch (error) {
        console.error(`[Admin Migration] Failed to migrate ${conv.id}:`, error);
        errors.push(`${conv.title}: ${getErrorMessage(error, "")}`);
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
