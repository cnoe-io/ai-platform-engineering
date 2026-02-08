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
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
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
    const insertedId = new ObjectId();
    msgCol.insertOne.mockResolvedValue({ insertedId });
    msgCol.findOne.mockResolvedValue({
      _id: insertedId,
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

    // Verify insertOne was called with correct data
    const insertedDoc = msgCol.insertOne.mock.calls[0][0];
    expect(insertedDoc.message_id).toBe('client-msg-123');
    expect(insertedDoc.role).toBe('user');
    expect(insertedDoc.content).toBe('What is the weather?');
    expect(insertedDoc.metadata.turn_id).toBe('turn-abc');

    // Verify conversation was updated
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
    const insertedId = new ObjectId();
    msgCol.insertOne.mockResolvedValue({ insertedId });
    msgCol.findOne.mockResolvedValue({
      _id: insertedId,
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

    // Verify A2A events were persisted
    const insertedDoc = msgCol.insertOne.mock.calls[0][0];
    expect(insertedDoc.a2a_events).toHaveLength(3);
    expect(insertedDoc.a2a_events[0].type).toBe('tool_start');
    expect(insertedDoc.a2a_events[0].toolName).toBe('weather_api');
    expect(insertedDoc.a2a_events[1].type).toBe('artifact');
    expect(insertedDoc.a2a_events[1].artifactName).toBe('execution_plan_update');
    expect(insertedDoc.metadata.is_final).toBe(true);
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
    const insertedId = new ObjectId();
    msgCol.insertOne.mockResolvedValue({ insertedId });
    msgCol.findOne.mockResolvedValue({
      _id: insertedId,
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

    const insertedDoc = msgCol.insertOne.mock.calls[0][0];
    expect(insertedDoc.a2a_events).toBeUndefined();
    expect(insertedDoc.message_id).toBeUndefined();
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

    msgCol.insertOne
      .mockResolvedValueOnce({ insertedId: userMsgId })
      .mockResolvedValueOnce({ insertedId: assistantMsgId });

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
