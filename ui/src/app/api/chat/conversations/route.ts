// GET /api/chat/conversations - List user's conversations
// POST /api/chat/conversations - Create new conversation

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  withAuth,
  withErrorHandler,
  successResponse,
  paginatedResponse,
  validateRequired,
  getPaginationParams,
} from '@/lib/api-middleware';
import type { Conversation, CreateConversationRequest } from '@/types/mongodb';

// GET /api/chat/conversations
export const GET = withErrorHandler(async (request: NextRequest) => {
  // Check if MongoDB is configured
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - use localStorage mode',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 } // Service Unavailable
    );
  }

  return withAuth(request, async (req, user) => {
    const { page, pageSize, skip } = getPaginationParams(request);
    const url = new URL(request.url);
    const archived = url.searchParams.get('archived') === 'true';
    const pinned = url.searchParams.get('pinned') === 'true';

    const conversations = await getCollection<Conversation>('conversations');

    // Build query
    const query: any = {
      $or: [
        { owner_id: user.email },
        { 'sharing.shared_with': user.email },
      ],
    };

    if (archived !== null) {
      query.is_archived = archived;
    }

    if (pinned) {
      query.is_pinned = true;
    }

    // Get total count
    const total = await conversations.countDocuments(query);

    // Get paginated results
    const items = await conversations
      .find(query)
      .sort({ is_pinned: -1, updated_at: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    return paginatedResponse(items, total, page, pageSize);
  });
});

// POST /api/chat/conversations
export const POST = withErrorHandler(async (request: NextRequest) => {
  // Check if MongoDB is configured
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - use localStorage mode',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 } // Service Unavailable
    );
  }

  return withAuth(request, async (req, user) => {
    const body: CreateConversationRequest = await request.json();

    validateRequired(body, ['title']);

    const conversations = await getCollection<Conversation>('conversations');

    const now = new Date();
    const newConversation: Conversation = {
      _id: body.id || uuidv4(), // Use client-provided ID if given, otherwise generate
      title: body.title,
      owner_id: user.email,
      created_at: now,
      updated_at: now,
      metadata: {
        agent_version: process.env.npm_package_version || '0.1.0',
        model_used: 'gpt-4o',
        total_messages: 0,
      },
      sharing: {
        is_public: false,
        shared_with: [],
        shared_with_teams: [],
        share_link_enabled: false,
      },
      tags: body.tags || [],
      is_archived: false,
      is_pinned: false,
    };

    await conversations.insertOne(newConversation);

    return successResponse(newConversation, 201);
  });
});
