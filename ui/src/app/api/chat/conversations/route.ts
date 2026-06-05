// GET /api/chat/conversations - List user's conversations
// POST /api/chat/conversations - Create new conversation (or return existing via upsert)

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import {
  getAuthFromBearerOrSession,
  withErrorHandler,
  successResponse,
  paginatedResponse,
  validateRequired,
  getPaginationParams,
  requireRbacPermission,
} from '@/lib/api-middleware';
import type { Conversation, CreateConversationRequest, ClientType } from '@/types/mongodb';
import { VALID_CLIENT_TYPES } from '@/types/mongodb';
import { buildParticipants } from '@/types/a2a';
import packageJson from '../../../../../package.json';
import { filterConversationsByImplicitOrExplicitPermission } from '@/lib/rbac/conversation-implicit-authz';
import { requireAgentUsePermission } from '@/lib/rbac/openfga-agent-authz';

type ConversationWithAgentDisplay = Conversation & {
  agent_id?: string;
  agent_name?: string;
};

function getConversationAgentId(conversation: Conversation): string | undefined {
  return conversation.participants?.find((participant) => participant.type === 'agent')?.id;
}

async function enrichConversationAgentNames(
  items: Conversation[],
): Promise<ConversationWithAgentDisplay[]> {
  const agentIds = Array.from(
    new Set(items.map(getConversationAgentId).filter((id): id is string => Boolean(id))),
  );

  if (agentIds.length === 0) {
    return items;
  }

  const agents = await getCollection<{ _id: string; name?: string }>('dynamic_agents');
  const agentDocs = await agents
    .find({ _id: { $in: agentIds } })
    .project({ _id: 1, name: 1 })
    .toArray();
  const agentNames = new Map(agentDocs.map((agent) => [agent._id, agent.name]));

  return items.map((conversation) => {
    const agentId = getConversationAgentId(conversation);
    if (!agentId) {
      return conversation;
    }

    return {
      ...conversation,
      agent_id: agentId,
      agent_name: agentNames.get(agentId) ?? agentId,
    };
  });
}

// GET /api/chat/conversations
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - use localStorage mode',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const { user, session } = await getAuthFromBearerOrSession(request);
  const { page, pageSize, skip } = getPaginationParams(request);
  const url = new URL(request.url);
  const archived = url.searchParams.get('archived') === 'true';
  const pinned = url.searchParams.get('pinned') === 'true';
  const clientTypeParam = url.searchParams.get('client_type') as ClientType | null;

  // Validate client_type param if provided
  if (clientTypeParam && !VALID_CLIENT_TYPES.includes(clientTypeParam)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid client_type: "${clientTypeParam}". Valid values: ${VALID_CLIENT_TYPES.join(', ')}`,
      },
      { status: 400 }
    );
  }

  const conversations = await getCollection<Conversation>('conversations');

  // Fetch non-deleted candidates and let the ReBAC filter decide visibility.
  // Legacy sharing fields are still stored for migration, but no longer prefilter reads.
  const query: any = {
    $and: [
      { $or: [{ deleted_at: null }, { deleted_at: { $exists: false } }] },
    ],
  };

  // Filter by client_type if specified.
  // Backward compat: older documents without top-level client_type are treated as 'webui'.
  if (clientTypeParam) {
    if (clientTypeParam === 'webui') {
      // Match docs with client_type: 'webui' OR missing client_type (legacy)
      query.$and.push({
        $or: [
          { client_type: 'webui' },
          { client_type: { $exists: false } },
        ],
      });
    } else {
      query.$and.push({ client_type: clientTypeParam });
    }
  }

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

  const visibleItems = await filterConversationsByImplicitOrExplicitPermission(session, user.email, items);

  return paginatedResponse(
    await enrichConversationAgentNames(visibleItems),
    visibleItems.length < items.length ? visibleItems.length : total,
    page,
    pageSize
  );
});

// POST /api/chat/conversations
export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: 'MongoDB not configured - use localStorage mode',
        code: 'MONGODB_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  // Combine release/0.4.0's dual-auth (bearer token | session) with comprehensive
  // RBAC enforcement. The bearer path is required by the Slack bot and other
  // first-party service callers; the RBAC check is required to enforce the
  // 098-enterprise-rbac scope on supervisor invocations.
  const { user, session } = await getAuthFromBearerOrSession(request);
  const body: CreateConversationRequest = await request.json();

  validateRequired(body, ['title', 'client_type']);

  // Validate client_type enum
  if (!VALID_CLIENT_TYPES.includes(body.client_type)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid client_type: "${body.client_type}". Valid values: ${VALID_CLIENT_TYPES.join(', ')}`,
      },
      { status: 400 }
    );
  }

  if (body.agent_id) {
    const denial = await requireAgentUsePermission({
      subject: session.sub,
      agentId: body.agent_id,
      email: user.email,
    });
    if (denial) {
      return denial;
    }
  } else {
    const supervisorDenial = await requireRbacPermission(session, 'supervisor', 'invoke');
    if (supervisorDenial) {
      return supervisorDenial;
    }
  }

  const conversations = await getCollection<Conversation>('conversations');

  // ⚠️ RISK: owner_id can be set by any authenticated caller. This trusts the caller
  // (e.g. Slack bot setting owner_id to the Slack user's email). Future mitigation:
  // implement a service account allowlist — only specific OAuth2 client IDs should be
  // permitted to set owner_id on behalf of users.
  const ownerId = body.owner_id || user.email;

  // Idempotency: if an idempotency_key is provided, return the existing conversation
  // instead of creating a duplicate. This maintains a 1-1 mapping between integration-
  // specific identities (e.g. Slack thread_ts) and the conversation_id used by
  // UI and LangGraph checkpoints.
  if (body.idempotency_key) {
    const existing = await conversations.findOne({
      idempotency_key: body.idempotency_key,
    });
    if (existing) {
      return successResponse({ conversation: existing, created: false }, 200);
    }
  }

  const now = new Date();
  const clientMetadata: Record<string, unknown> = {
    ...body.metadata,
    total_messages: 0,
  };

  // Add UI-specific metadata
  if (body.client_type === 'webui') {
    clientMetadata.ui_version = packageJson.version;
  }

  const newConversation: Conversation = {
    _id: uuidv4(), // Server owns ID generation
    title: body.title,
    client_type: body.client_type,
    owner_id: ownerId,
    ...(typeof session.sub === 'string' && session.sub.trim() && ownerId === user.email
      ? { owner_subject: session.sub.trim(), owner_identity_version: 2 }
      : {}),
    ...(body.idempotency_key && { idempotency_key: body.idempotency_key }),
    participants: buildParticipants(body.agent_id, ownerId),
    created_at: now,
    updated_at: now,
    metadata: clientMetadata as Conversation['metadata'],
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

  return successResponse({ conversation: newConversation, created: true }, 201);
});
