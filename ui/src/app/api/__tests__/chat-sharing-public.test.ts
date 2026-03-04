/**
 * @jest-environment node
 */
/**
 * Tests for Chat Sharing — "Share with everyone" (is_public)
 *
 * Covers the public sharing feature:
 * - POST /api/chat/conversations/[id]/share — toggle is_public
 * - requireConversationAccess — public conversations accessible to any user
 * - GET /api/chat/conversations — public conversations appear in listing
 * - GET /api/chat/shared — public conversations appear in shared listing
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

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => key === 'ssoEnabled',
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

jest.mock('uuid', () => ({
  v4: () => '550e8400-e29b-41d4-a716-446655440000',
}));

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// ============================================================================
// Helpers
// ============================================================================

function createMockCollection() {
  const findReturnValue = {
    project: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
    sort: jest.fn().mockReturnValue({
      skip: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
      }),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    toArray: jest.fn().mockResolvedValue([]),
  };

  return {
    find: jest.fn().mockReturnValue(findReturnValue),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    insertMany: jest.fn().mockResolvedValue({ insertedCount: 0 }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
}

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
}

function userSession(email = 'user@example.com') {
  return {
    user: { email, name: 'Test User' },
    role: 'user',
  };
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const OWNER_EMAIL = 'owner@example.com';
const VIEWER_EMAIL = 'viewer@example.com';
const STRANGER_EMAIL = 'stranger@example.com';

function makeConversation(overrides: Record<string, any> = {}) {
  return {
    _id: VALID_UUID,
    title: 'Test Conversation',
    owner_id: OWNER_EMAIL,
    created_at: new Date(),
    updated_at: new Date(),
    metadata: { agent_version: '0.1.0', model_used: 'gpt-4o', total_messages: 0 },
    sharing: {
      is_public: false,
      shared_with: [],
      shared_with_teams: [],
      share_link_enabled: false,
    },
    tags: [],
    is_archived: false,
    is_pinned: false,
    ...overrides,
  };
}

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach(key => delete mockCollections[key]);
});

// ============================================================================
// requireConversationAccess — public sharing
// ============================================================================

describe('requireConversationAccess — public (is_public) access', () => {
  let requireConversationAccess: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/lib/api-middleware');
    requireConversationAccess = mod.requireConversationAccess;
  });

  it('grants access to any user when conversation is_public is true', async () => {
    const conv = makeConversation({
      sharing: {
        is_public: true,
        shared_with: [],
        shared_with_teams: [],
      },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const result = await requireConversationAccess(conv._id, STRANGER_EMAIL, mockGetCollection);

    expect(result).toBeDefined();
    expect(result._id).toBe(conv._id);
  });

  it('denies access when is_public is false and user has no other access', async () => {
    const conv = makeConversation({
      sharing: {
        is_public: false,
        shared_with: [],
        shared_with_teams: [],
      },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    mockCollections['sharing_access'] = sharingAccessCol;

    await expect(
      requireConversationAccess(conv._id, STRANGER_EMAIL, mockGetCollection)
    ).rejects.toThrow('Forbidden');
  });

  it('grants access to owner regardless of is_public', async () => {
    const conv = makeConversation({
      sharing: { is_public: false, shared_with: [], shared_with_teams: [] },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const result = await requireConversationAccess(conv._id, OWNER_EMAIL, mockGetCollection);

    expect(result).toBeDefined();
    expect(result._id).toBe(conv._id);
  });
});

// ============================================================================
// POST /api/chat/conversations/[id]/share — is_public toggle
// ============================================================================

describe('POST /api/chat/conversations/[id]/share — is_public toggle', () => {
  let POST: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/chat/conversations/[id]/share/route');
    POST = mod.POST;
  });

  it('sets is_public to true', async () => {
    mockGetServerSession.mockResolvedValue(userSession(OWNER_EMAIL));

    const conv = makeConversation();
    const convsCol = createMockCollection();
    convsCol.findOne
      .mockResolvedValueOnce(conv)
      .mockResolvedValueOnce({ ...conv, sharing: { ...conv.sharing, is_public: true } });
    mockCollections['conversations'] = convsCol;

    const req = makeRequest(`/api/chat/conversations/${VALID_UUID}/share`, {
      method: 'POST',
      body: JSON.stringify({ is_public: true }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);

    const updateCall = convsCol.updateOne.mock.calls[0];
    expect(updateCall[1].$set['sharing.is_public']).toBe(true);
  });

  it('sets is_public to false', async () => {
    mockGetServerSession.mockResolvedValue(userSession(OWNER_EMAIL));

    const conv = makeConversation({
      sharing: { ...makeConversation().sharing, is_public: true },
    });
    const convsCol = createMockCollection();
    convsCol.findOne
      .mockResolvedValueOnce(conv)
      .mockResolvedValueOnce({ ...conv, sharing: { ...conv.sharing, is_public: false } });
    mockCollections['conversations'] = convsCol;

    const req = makeRequest(`/api/chat/conversations/${VALID_UUID}/share`, {
      method: 'POST',
      body: JSON.stringify({ is_public: false }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);

    const updateCall = convsCol.updateOne.mock.calls[0];
    expect(updateCall[1].$set['sharing.is_public']).toBe(false);
  });

  it('allows is_public alone without user_emails or team_ids', async () => {
    mockGetServerSession.mockResolvedValue(userSession(OWNER_EMAIL));

    const conv = makeConversation();
    const convsCol = createMockCollection();
    convsCol.findOne
      .mockResolvedValueOnce(conv)
      .mockResolvedValueOnce({ ...conv, sharing: { ...conv.sharing, is_public: true } });
    mockCollections['conversations'] = convsCol;

    const req = makeRequest(`/api/chat/conversations/${VALID_UUID}/share`, {
      method: 'POST',
      body: JSON.stringify({ is_public: true }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(200);
  });

  it('rejects request with no sharing actions', async () => {
    mockGetServerSession.mockResolvedValue(userSession(OWNER_EMAIL));

    const conv = makeConversation();
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const req = makeRequest(`/api/chat/conversations/${VALID_UUID}/share`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(400);
  });

  it('rejects non-owner from toggling is_public', async () => {
    mockGetServerSession.mockResolvedValue(userSession(STRANGER_EMAIL));

    const conv = makeConversation();
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const req = makeRequest(`/api/chat/conversations/${VALID_UUID}/share`, {
      method: 'POST',
      body: JSON.stringify({ is_public: true }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: VALID_UUID }) });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// GET /api/chat/conversations — public conversations in listing
// ============================================================================

describe('GET /api/chat/conversations — public conversations', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/chat/conversations/route');
    GET = mod.GET;
  });

  it('includes is_public condition in query', async () => {
    mockGetServerSession.mockResolvedValue(userSession(VIEWER_EMAIL));

    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    const req = makeRequest('/api/chat/conversations');
    await GET(req);

    const findCall = convsCol.find.mock.calls[0][0];
    const orConditions = findCall.$or;

    expect(orConditions).toContainEqual({ 'sharing.is_public': true });
  });
});

// ============================================================================
// GET /api/chat/shared — public conversations in shared listing
// ============================================================================

describe('GET /api/chat/shared — public conversations', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/chat/shared/route');
    GET = mod.GET;
  });

  it('includes is_public condition in shared query', async () => {
    mockGetServerSession.mockResolvedValue(userSession(VIEWER_EMAIL));

    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    const req = makeRequest('/api/chat/shared');
    await GET(req);

    const findCall = convsCol.find.mock.calls[0][0];
    expect(findCall.$or).toContainEqual({ 'sharing.is_public': true });
    expect(findCall.owner_id).toEqual({ $ne: VIEWER_EMAIL });
  });
});
