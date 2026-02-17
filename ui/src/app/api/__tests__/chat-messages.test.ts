/**
 * @jest-environment node
 */
/**
 * Tests for Chat Messages API Routes (MongoDB persistence for cross-device sync)
 *
 * Covers:
 * - GET /api/chat/conversations/[id]/messages — list messages in conversation
 * - POST /api/chat/conversations/[id]/messages — add message to conversation
 *
 * Features tested:
 * - Message persistence with A2A events (tasks, tool calls, debug)
 * - Client-generated message_id tracking
 * - Turn ID metadata for message grouping
 * - Conversation access control (owner + shared users)
 * - UUID validation
 * - Pagination
 */

import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';

// ============================================================================
// Mocks
// ============================================================================

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
}));

const mockCollections: Record<string, any> = {};
const mockGetCollection = jest.fn((name: string) => {
  if (!mockCollections[name]) {
    mockCollections[name] = createMockCollection();
  }
  return Promise.resolve(mockCollections[name]);
});

jest.mock('@/lib/mongodb', () => ({
  getCollection: (...args: any[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockCollection() {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({
      upsertedId: new ObjectId(),
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
}

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
}

function authenticatedSession(email = 'user@example.com') {
  return {
    user: { email, name: 'Test User' },
    role: 'user',
  };
}

const testConversationId = '12345678-1234-1234-1234-123456789012';

function resetMocks() {
  mockGetServerSession.mockReset();
  mockGetCollection.mockClear();
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
}

// ============================================================================
// Test imports (after mocks)
// ============================================================================

import { GET, POST } from '../chat/conversations/[id]/messages/route';

// ============================================================================
// Tests: GET /api/chat/conversations/[id]/messages
// ============================================================================

describe('GET /api/chat/conversations/[id]/messages', () => {
  beforeEach(resetMocks);

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`);
    const res = await GET(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid UUID format', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());
    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/chat/conversations/invalid-id/messages');
    const res = await GET(req, { params: Promise.resolve({ id: 'invalid-id' }) });
    expect(res.status).toBe(400);
  });

  it('returns paginated messages for authorized user', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    // Conversation exists and user is owner
    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    // Messages collection
    const msgCol = createMockCollection();
    const testMessages = [
      {
        _id: new ObjectId(),
        message_id: 'msg-1',
        conversation_id: testConversationId,
        role: 'user',
        content: 'Hello!',
        created_at: new Date(),
        metadata: { turn_id: 'turn-1' },
      },
      {
        _id: new ObjectId(),
        message_id: 'msg-2',
        conversation_id: testConversationId,
        role: 'assistant',
        content: 'Hi there!',
        created_at: new Date(),
        metadata: { turn_id: 'turn-1', is_final: true },
        a2a_events: [
          { id: 'evt-1', type: 'tool_start', toolName: 'search' },
          { id: 'evt-2', type: 'tool_end', toolName: 'search' },
        ],
      },
    ];

    msgCol.countDocuments.mockResolvedValue(2);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue(testMessages),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    // Also mock sharing_access for requireConversationAccess
    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages?page=1&page_size=20`);
    const res = await GET(req, { params: Promise.resolve({ id: testConversationId }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.total).toBe(2);
  });
});

// ============================================================================
// Tests: POST /api/chat/conversations/[id]/messages
// ============================================================================

describe('POST /api/chat/conversations/[id]/messages', () => {
  beforeEach(resetMocks);

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'user', content: 'Hello' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(401);
  });

  it('saves a user message with client-generated message_id', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    const upsertedId = new ObjectId();
    msgCol.updateOne.mockResolvedValue({
      upsertedId,
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: upsertedId,
      message_id: 'client-msg-123',
      conversation_id: testConversationId,
      role: 'user',
      content: 'What is the weather?',
      created_at: new Date(),
      metadata: { turn_id: 'turn-abc' },
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'client-msg-123',
        role: 'user',
        content: 'What is the weather?',
        metadata: { turn_id: 'turn-abc' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(201);

    // Verify updateOne was called with correct data ($set and $setOnInsert)
    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$setOnInsert.message_id).toBe('client-msg-123');
    expect(updateDoc.$setOnInsert.role).toBe('user');
    expect(updateDoc.$set.content).toBe('What is the weather?');
    expect(updateDoc.$set.metadata.turn_id).toBe('turn-abc');

    // Verify conversation was updated (only on new inserts)
    expect(convCol.updateOne).toHaveBeenCalledWith(
      { _id: testConversationId },
      expect.objectContaining({
        $set: expect.objectContaining({ updated_at: expect.any(Date) }),
        $inc: { 'metadata.total_messages': 1 },
      })
    );
  });

  it('saves an assistant message with A2A events', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    const upsertedId = new ObjectId();
    msgCol.updateOne.mockResolvedValue({
      upsertedId,
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: upsertedId,
      message_id: 'assistant-msg-456',
      conversation_id: testConversationId,
      role: 'assistant',
      content: 'The weather is sunny.',
      created_at: new Date(),
      metadata: { turn_id: 'turn-abc', is_final: true },
      a2a_events: [
        { id: 'evt-1', type: 'tool_start', toolName: 'weather_api' },
        { id: 'evt-2', type: 'artifact', artifactName: 'execution_plan_update' },
        { id: 'evt-3', type: 'tool_end', toolName: 'weather_api' },
      ],
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const a2aEvents = [
      { id: 'evt-1', type: 'tool_start', toolName: 'weather_api', timestamp: new Date().toISOString() },
      { id: 'evt-2', type: 'artifact', artifactName: 'execution_plan_update', timestamp: new Date().toISOString() },
      { id: 'evt-3', type: 'tool_end', toolName: 'weather_api', timestamp: new Date().toISOString() },
    ];

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'assistant-msg-456',
        role: 'assistant',
        content: 'The weather is sunny.',
        metadata: {
          turn_id: 'turn-abc',
          is_final: true,
        },
        a2a_events: a2aEvents,
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(201);

    // Verify A2A events were persisted in $set
    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$set.a2a_events).toHaveLength(3);
    expect(updateDoc.$set.a2a_events[0].type).toBe('tool_start');
    expect(updateDoc.$set.a2a_events[0].toolName).toBe('weather_api');
    expect(updateDoc.$set.a2a_events[1].type).toBe('artifact');
    expect(updateDoc.$set.a2a_events[1].artifactName).toBe('execution_plan_update');
    expect(updateDoc.$set.metadata.is_final).toBe(true);
  });

  it('saves a message without A2A events (simple user message)', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    const upsertedId = new ObjectId();
    msgCol.updateOne.mockResolvedValue({
      upsertedId,
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: upsertedId,
      conversation_id: testConversationId,
      role: 'user',
      content: 'Simple question',
      created_at: new Date(),
      metadata: { turn_id: 'turn-xyz' },
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: 'user',
        content: 'Simple question',
        metadata: { turn_id: 'turn-xyz' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(201);

    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$set.a2a_events).toBeUndefined();
    expect(updateDoc.$setOnInsert.message_id).toBeUndefined();
  });

  it('rejects request with missing required fields', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'user' }), // missing 'content'
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('content');
  });

  it('returns 403 when user does not have access to conversation', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession('other@example.com'));

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com', // Different owner
      sharing: { shared_with: [] },
    });
    mockCollections['conversations'] = convCol;

    // sharing_access also returns nothing
    const sharingCol = createMockCollection();
    sharingCol.findOne.mockResolvedValue(null);
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: 'user',
        content: 'Should not be allowed',
        metadata: { turn_id: 'turn-1' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(403);
  });

  it('returns 200 when updating an existing message (upsert matched)', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    const existingMsgId = new ObjectId();
    msgCol.updateOne.mockResolvedValue({
      upsertedId: null,
      upsertedCount: 0,
      matchedCount: 1,
      modifiedCount: 1,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: existingMsgId,
      message_id: 'client-msg-existing',
      conversation_id: testConversationId,
      role: 'user',
      content: 'Updated content',
      created_at: new Date(),
      metadata: { turn_id: 'turn-xyz' },
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'client-msg-existing',
        role: 'user',
        content: 'Updated content',
        metadata: { turn_id: 'turn-xyz' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(200);

    // Verify conversation was updated with timestamp only (no $inc on update path)
    expect(convCol.updateOne).toHaveBeenCalledWith(
      { _id: testConversationId },
      expect.objectContaining({
        $set: expect.objectContaining({ updated_at: expect.any(Date) }),
      })
    );
    const convUpdateCall = convCol.updateOne.mock.calls[0][1];
    expect(convUpdateCall.$inc).toBeUndefined();
  });

  it('upsert updates content and metadata for existing message', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.updateOne.mockResolvedValue({
      upsertedId: null,
      upsertedCount: 0,
      matchedCount: 1,
      modifiedCount: 1,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      message_id: 'assistant-msg-update',
      conversation_id: testConversationId,
      role: 'assistant',
      content: 'Final answer after streaming',
      created_at: new Date(),
      metadata: { turn_id: 'turn-abc', is_final: true, tokens_used: 150 },
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'assistant-msg-update',
        role: 'assistant',
        content: 'Final answer after streaming',
        metadata: {
          turn_id: 'turn-abc',
          is_final: true,
          tokens_used: 150,
          model: 'gpt-4o',
        },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(200);

    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$set.content).toBe('Final answer after streaming');
    expect(updateDoc.$set.metadata.turn_id).toBe('turn-abc');
    expect(updateDoc.$set.metadata.is_final).toBe(true);
    expect(updateDoc.$set.metadata.model).toBe('gpt-4o');
    expect(updateDoc.$set.metadata.tokens_used).toBe(150);
  });

  it('upsert updates a2a_events on existing message', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.updateOne.mockResolvedValue({
      upsertedId: null,
      upsertedCount: 0,
      matchedCount: 1,
      modifiedCount: 1,
      acknowledged: true,
    });
    const a2aEvents = [
      { id: 'evt-1', type: 'tool_start', toolName: 'search' },
      { id: 'evt-2', type: 'tool_end', toolName: 'search' },
    ];
    msgCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      message_id: 'assistant-msg-events',
      conversation_id: testConversationId,
      role: 'assistant',
      content: 'Result with events',
      created_at: new Date(),
      metadata: { turn_id: 'turn-1', is_final: true },
      a2a_events: a2aEvents,
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'assistant-msg-events',
        role: 'assistant',
        content: 'Result with events',
        metadata: { turn_id: 'turn-1', is_final: true },
        a2a_events: a2aEvents,
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(200);

    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$set.a2a_events).toHaveLength(2);
    expect(updateDoc.$set.a2a_events[0].type).toBe('tool_start');
    expect(updateDoc.$set.a2a_events[0].toolName).toBe('search');
    expect(updateDoc.$set.a2a_events[1].type).toBe('tool_end');
  });
});

// ============================================================================
// Tests: Sender identity for shared conversations
// ============================================================================

describe('Sender identity in shared conversations', () => {
  beforeEach(resetMocks);

  it('stores sender_email and sender_name from request body on insert', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession('alice@example.com'));

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'owner@example.com', // Different from sender
      sharing: { shared_with: ['alice@example.com'] },
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    const upsertedId = new ObjectId();
    msgCol.updateOne.mockResolvedValue({
      upsertedId,
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: upsertedId,
      message_id: 'shared-msg-1',
      conversation_id: testConversationId,
      role: 'user',
      content: 'Hello from Alice',
      sender_email: 'alice@example.com',
      sender_name: 'Alice Johnson',
      created_at: new Date(),
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    sharingCol.findOne.mockResolvedValue({
      conversation_id: testConversationId,
      user_email: 'alice@example.com',
      access_level: 'write',
    });
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'shared-msg-1',
        role: 'user',
        content: 'Hello from Alice',
        sender_email: 'alice@example.com',
        sender_name: 'Alice Johnson',
        metadata: { turn_id: 'turn-1' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(201);

    // Verify sender fields are in $setOnInsert (immutable per message)
    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$setOnInsert.sender_email).toBe('alice@example.com');
    expect(updateDoc.$setOnInsert.sender_name).toBe('Alice Johnson');
  });

  it('falls back to authenticated user identity when no sender fields provided', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession('bob@example.com'));

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'bob@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.updateOne.mockResolvedValue({
      upsertedId: new ObjectId(),
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      message_id: 'legacy-msg-1',
      conversation_id: testConversationId,
      role: 'user',
      content: 'No sender fields',
      created_at: new Date(),
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    // Send without sender_email / sender_name
    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'legacy-msg-1',
        role: 'user',
        content: 'No sender fields',
        metadata: { turn_id: 'turn-1' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(201);

    // Should fall back to authenticated session user
    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$setOnInsert.sender_email).toBe('bob@example.com');
    expect(updateDoc.$setOnInsert.sender_name).toBe('Test User');
  });

  it('does not set sender fields for assistant messages', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.updateOne.mockResolvedValue({
      upsertedId: new ObjectId(),
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      message_id: 'assistant-msg-no-sender',
      conversation_id: testConversationId,
      role: 'assistant',
      content: 'AI response',
      created_at: new Date(),
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'assistant-msg-no-sender',
        role: 'assistant',
        content: 'AI response',
        metadata: { turn_id: 'turn-1', is_final: true },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(201);

    // Assistant messages should not have sender fields
    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$setOnInsert.sender_email).toBeUndefined();
    expect(updateDoc.$setOnInsert.sender_name).toBeUndefined();
  });

  it('stores sender_image from request body on insert', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession('alice@example.com'));

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'alice@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.updateOne.mockResolvedValue({
      upsertedId: new ObjectId(),
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      message_id: 'img-msg-1',
      conversation_id: testConversationId,
      role: 'user',
      content: 'With avatar',
      sender_image: 'https://example.com/alice-avatar.png',
      created_at: new Date(),
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'img-msg-1',
        role: 'user',
        content: 'With avatar',
        sender_email: 'alice@example.com',
        sender_name: 'Alice',
        sender_image: 'https://example.com/alice-avatar.png',
        metadata: { turn_id: 'turn-1' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(201);

    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$setOnInsert.sender_image).toBe('https://example.com/alice-avatar.png');
    expect(updateDoc.$setOnInsert.sender_email).toBe('alice@example.com');
    expect(updateDoc.$setOnInsert.sender_name).toBe('Alice');
  });

  it('does not persist empty strings for sender fields (uses session fallback)', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession('user@example.com'));

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.updateOne.mockResolvedValue({
      upsertedId: new ObjectId(),
      upsertedCount: 1,
      matchedCount: 0,
      modifiedCount: 0,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      message_id: 'empty-sender-msg',
      conversation_id: testConversationId,
      role: 'user',
      content: 'Empty sender strings',
      created_at: new Date(),
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    // Send empty strings for sender fields — should fall back to session
    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'empty-sender-msg',
        role: 'user',
        content: 'Empty sender strings',
        sender_email: '',
        sender_name: '',
        sender_image: '',
        metadata: { turn_id: 'turn-1' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(201);

    // Empty strings are falsy, so || fallback kicks in for email and name
    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$setOnInsert.sender_email).toBe('user@example.com');
    expect(updateDoc.$setOnInsert.sender_name).toBe('Test User');
    // sender_image has no session fallback, so empty string → undefined → not set
    expect(updateDoc.$setOnInsert.sender_image).toBeUndefined();
  });

  it('sender fields in $setOnInsert are not overwritten on upsert update', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession('user@example.com'));

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    // Simulate upsert match (existing message) — no upsertedId
    msgCol.updateOne.mockResolvedValue({
      upsertedId: null,
      upsertedCount: 0,
      matchedCount: 1,
      modifiedCount: 1,
      acknowledged: true,
    });
    msgCol.findOne.mockResolvedValue({
      _id: new ObjectId(),
      message_id: 'existing-msg',
      conversation_id: testConversationId,
      role: 'user',
      content: 'Updated content',
      sender_email: 'original@example.com', // Original sender preserved
      sender_name: 'Original User',
      created_at: new Date(),
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    // Send with different sender — should NOT overwrite (only in $setOnInsert)
    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'existing-msg',
        role: 'user',
        content: 'Updated content',
        sender_email: 'attacker@example.com',
        sender_name: 'Attacker',
        metadata: { turn_id: 'turn-1' },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: testConversationId }) });
    expect(res.status).toBe(200); // Update, not insert

    // Verify sender fields are ONLY in $setOnInsert (not in $set)
    // Since MongoDB matched, $setOnInsert is a no-op — original sender preserved
    const updateDoc = msgCol.updateOne.mock.calls[0][1];
    expect(updateDoc.$set.sender_email).toBeUndefined();
    expect(updateDoc.$set.sender_name).toBeUndefined();
    expect(updateDoc.$set.sender_image).toBeUndefined();
    // They ARE in $setOnInsert, but MongoDB ignores it on matched updates
    expect(updateDoc.$setOnInsert.sender_email).toBe('attacker@example.com');
    // The returned document should still have the original sender
    const body = await res.json();
    expect(body.data.sender_email).toBe('original@example.com');
    expect(body.data.sender_name).toBe('Original User');
  });

  it('GET returns sender fields when present on messages', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    const messagesWithSender = [
      {
        _id: new ObjectId(),
        message_id: 'msg-alice',
        conversation_id: testConversationId,
        role: 'user',
        content: 'Hello from Alice',
        sender_email: 'alice@example.com',
        sender_name: 'Alice Johnson',
        sender_image: 'https://example.com/alice.png',
        created_at: new Date(),
        metadata: { turn_id: 'turn-1' },
      },
      {
        _id: new ObjectId(),
        message_id: 'msg-bob',
        conversation_id: testConversationId,
        role: 'user',
        content: 'Hello from Bob',
        sender_email: 'bob@example.com',
        sender_name: 'Bob Williams',
        // No sender_image
        created_at: new Date(),
        metadata: { turn_id: 'turn-2' },
      },
    ];

    msgCol.countDocuments.mockResolvedValue(2);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue(messagesWithSender),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages?page_size=100`);
    const res = await GET(req, { params: Promise.resolve({ id: testConversationId }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    // First message has all sender fields
    expect(body.data.items[0].sender_email).toBe('alice@example.com');
    expect(body.data.items[0].sender_name).toBe('Alice Johnson');
    expect(body.data.items[0].sender_image).toBe('https://example.com/alice.png');

    // Second message has sender but no image
    expect(body.data.items[1].sender_email).toBe('bob@example.com');
    expect(body.data.items[1].sender_name).toBe('Bob Williams');
    expect(body.data.items[1].sender_image).toBeUndefined();
  });

  it('GET returns messages without sender fields for legacy data (backward compat)', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    const legacyMessages = [
      {
        _id: new ObjectId(),
        message_id: 'legacy-msg-1',
        conversation_id: testConversationId,
        role: 'user',
        content: 'Old message without sender',
        // No sender_email, sender_name, sender_image
        created_at: new Date(),
        metadata: { turn_id: 'turn-1' },
      },
    ];

    msgCol.countDocuments.mockResolvedValue(1);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue(legacyMessages),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    const req = makeRequest(`/api/chat/conversations/${testConversationId}/messages?page_size=100`);
    const res = await GET(req, { params: Promise.resolve({ id: testConversationId }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Legacy message should not have sender fields
    expect(body.data.items[0].sender_email).toBeUndefined();
    expect(body.data.items[0].sender_name).toBeUndefined();
    expect(body.data.items[0].sender_image).toBeUndefined();
    // But should still have standard fields
    expect(body.data.items[0].content).toBe('Old message without sender');
    expect(body.data.items[0].role).toBe('user');
  });
});

// ============================================================================
// Tests: Cross-device message persistence scenario
// ============================================================================

describe('Cross-device message persistence', () => {
  beforeEach(resetMocks);

  it('messages saved on device A can be retrieved on device B', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: testConversationId,
      owner_id: 'user@example.com',
    });
    mockCollections['conversations'] = convCol;

    const sharingCol = createMockCollection();
    mockCollections['sharing_access'] = sharingCol;

    // Step 1: Save messages (simulating Device A after streaming)
    const msgCol = createMockCollection();
    const userMsgId = new ObjectId();
    const assistantMsgId = new ObjectId();

    msgCol.updateOne
      .mockResolvedValueOnce({
        upsertedId: userMsgId,
        upsertedCount: 1,
        matchedCount: 0,
        modifiedCount: 0,
        acknowledged: true,
      })
      .mockResolvedValueOnce({
        upsertedId: assistantMsgId,
        upsertedCount: 1,
        matchedCount: 0,
        modifiedCount: 0,
        acknowledged: true,
      });

    msgCol.findOne
      .mockResolvedValueOnce({
        _id: userMsgId,
        message_id: 'user-msg-1',
        role: 'user',
        content: 'List ArgoCD apps',
        metadata: { turn_id: 'turn-1' },
      })
      .mockResolvedValueOnce({
        _id: assistantMsgId,
        message_id: 'assistant-msg-1',
        role: 'assistant',
        content: 'Here are the ArgoCD applications...',
        metadata: { turn_id: 'turn-1', is_final: true },
        a2a_events: [
          { id: 'evt-1', type: 'execution_plan', artifactName: 'execution_plan_update' },
          { id: 'evt-2', type: 'tool_start', toolName: 'argocd_list_apps' },
          { id: 'evt-3', type: 'tool_end', toolName: 'argocd_list_apps' },
        ],
      });

    mockCollections['messages'] = msgCol;

    // Save user message
    const req1 = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'user-msg-1',
        role: 'user',
        content: 'List ArgoCD apps',
        metadata: { turn_id: 'turn-1' },
      }),
    });
    const res1 = await POST(req1, { params: Promise.resolve({ id: testConversationId }) });
    expect(res1.status).toBe(201);

    // Save assistant message with A2A events
    const req2 = makeRequest(`/api/chat/conversations/${testConversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message_id: 'assistant-msg-1',
        role: 'assistant',
        content: 'Here are the ArgoCD applications...',
        metadata: { turn_id: 'turn-1', is_final: true },
        a2a_events: [
          { id: 'evt-1', type: 'execution_plan', artifactName: 'execution_plan_update' },
          { id: 'evt-2', type: 'tool_start', toolName: 'argocd_list_apps' },
          { id: 'evt-3', type: 'tool_end', toolName: 'argocd_list_apps' },
        ],
      }),
    });
    const res2 = await POST(req2, { params: Promise.resolve({ id: testConversationId }) });
    expect(res2.status).toBe(201);

    // Step 2: Read messages on Device B (simulating new browser)
    const savedMessages = [
      {
        _id: userMsgId,
        message_id: 'user-msg-1',
        conversation_id: testConversationId,
        role: 'user',
        content: 'List ArgoCD apps',
        created_at: new Date(),
        metadata: { turn_id: 'turn-1' },
      },
      {
        _id: assistantMsgId,
        message_id: 'assistant-msg-1',
        conversation_id: testConversationId,
        role: 'assistant',
        content: 'Here are the ArgoCD applications...',
        created_at: new Date(),
        metadata: { turn_id: 'turn-1', is_final: true },
        a2a_events: [
          { id: 'evt-1', type: 'execution_plan', artifactName: 'execution_plan_update' },
          { id: 'evt-2', type: 'tool_start', toolName: 'argocd_list_apps' },
          { id: 'evt-3', type: 'tool_end', toolName: 'argocd_list_apps' },
        ],
      },
    ];

    msgCol.countDocuments.mockResolvedValue(2);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue(savedMessages),
          }),
        }),
      }),
    });

    const reqGet = makeRequest(`/api/chat/conversations/${testConversationId}/messages?page_size=100`);
    const resGet = await GET(reqGet, { params: Promise.resolve({ id: testConversationId }) });
    expect(resGet.status).toBe(200);

    const body = await resGet.json();
    expect(body.data.items).toHaveLength(2);

    // Verify user message
    expect(body.data.items[0].message_id).toBe('user-msg-1');
    expect(body.data.items[0].content).toBe('List ArgoCD apps');

    // Verify assistant message with A2A events
    expect(body.data.items[1].message_id).toBe('assistant-msg-1');
    expect(body.data.items[1].content).toBe('Here are the ArgoCD applications...');
    expect(body.data.items[1].a2a_events).toHaveLength(3);
    expect(body.data.items[1].a2a_events[0].type).toBe('execution_plan');
    expect(body.data.items[1].a2a_events[1].toolName).toBe('argocd_list_apps');
    expect(body.data.items[1].metadata.is_final).toBe(true);
  });
});
