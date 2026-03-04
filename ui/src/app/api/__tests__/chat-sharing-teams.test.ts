/**
 * @jest-environment node
 */
/**
 * Tests for Chat Sharing with Teams
 *
 * Covers the core bug fix: conversations shared with teams now appear
 * for all team members across all relevant endpoints.
 *
 * Endpoints tested:
 * - GET /api/chat/conversations — team-shared conversations appear in listing
 * - GET /api/chat/shared — team-shared conversations appear in shared listing
 * - requireConversationAccess — team members can access team-shared conversations
 * - getUserTeamIds — resolves team memberships correctly
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

const TEAM_ID_1 = new ObjectId();
const TEAM_ID_2 = new ObjectId();

const OWNER_EMAIL = 'owner@example.com';
const MEMBER_EMAIL = 'member@example.com';
const NON_MEMBER_EMAIL = 'outsider@example.com';

const TEAM_WITH_MEMBER = {
  _id: TEAM_ID_1,
  name: 'Platform Engineering',
  members: [
    { user_id: OWNER_EMAIL, role: 'owner', added_at: new Date(), added_by: OWNER_EMAIL },
    { user_id: MEMBER_EMAIL, role: 'member', added_at: new Date(), added_by: OWNER_EMAIL },
  ],
};

const TEAM_WITHOUT_MEMBER = {
  _id: TEAM_ID_2,
  name: 'Other Team',
  members: [
    { user_id: 'someone@example.com', role: 'owner', added_at: new Date(), added_by: 'someone@example.com' },
  ],
};

function makeConversation(overrides: Record<string, any> = {}) {
  return {
    _id: 'conv-' + Math.random().toString(36).slice(2, 10),
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
// getUserTeamIds
// ============================================================================

describe('getUserTeamIds', () => {
  let getUserTeamIds: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/lib/api-middleware');
    getUserTeamIds = mod.getUserTeamIds;
  });

  it('returns team IDs for a user who belongs to teams', async () => {
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: TEAM_ID_1 },
          { _id: TEAM_ID_2 },
        ]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const result = await getUserTeamIds(MEMBER_EMAIL);

    expect(result).toEqual([TEAM_ID_1.toString(), TEAM_ID_2.toString()]);
    expect(teamsCol.find).toHaveBeenCalledWith({ 'members.user_id': MEMBER_EMAIL });
  });

  it('returns empty array when user has no teams', async () => {
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const result = await getUserTeamIds(NON_MEMBER_EMAIL);

    expect(result).toEqual([]);
  });

  it('returns empty array on database error (graceful degradation)', async () => {
    mockGetCollection.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await getUserTeamIds(MEMBER_EMAIL);

    expect(result).toEqual([]);
  });
});

// ============================================================================
// requireConversationAccess — team sharing
// ============================================================================

describe('requireConversationAccess — team-based access', () => {
  let requireConversationAccess: any;
  let ApiError: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/lib/api-middleware');
    requireConversationAccess = mod.requireConversationAccess;
    ApiError = mod.ApiError;
  });

  it('grants access when user is the owner', async () => {
    const conv = makeConversation();
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const result = await requireConversationAccess(conv._id, OWNER_EMAIL, mockGetCollection);

    expect(result).toBeDefined();
    expect(result.conversation._id).toBe(conv._id);
    expect(result.access_level).toBe('owner');
  });

  it('grants access when user is in shared_with (direct share)', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [MEMBER_EMAIL], shared_with_teams: [] },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const result = await requireConversationAccess(conv._id, MEMBER_EMAIL, mockGetCollection);

    expect(result).toBeDefined();
    expect(result.conversation._id).toBe(conv._id);
    expect(result.access_level).toBe('shared');
  });

  it('grants access when user belongs to a shared team', async () => {
    const conv = makeConversation({
      sharing: {
        shared_with: [],
        shared_with_teams: [TEAM_ID_1.toString()],
      },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    // User is a member of TEAM_ID_1
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: TEAM_ID_1 }]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const result = await requireConversationAccess(conv._id, MEMBER_EMAIL, mockGetCollection);

    expect(result).toBeDefined();
    expect(result.conversation._id).toBe(conv._id);
    expect(result.access_level).toBe('shared');
  });

  it('denies access when user does not belong to any shared team', async () => {
    const conv = makeConversation({
      sharing: {
        shared_with: [],
        shared_with_teams: [TEAM_ID_1.toString()],
      },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    // Non-member has no teams
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    // No sharing_access record either
    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    mockCollections['sharing_access'] = sharingAccessCol;

    await expect(
      requireConversationAccess(conv._id, NON_MEMBER_EMAIL, mockGetCollection)
    ).rejects.toThrow('Forbidden');
  });

  it('denies access when user belongs to a different team than shared', async () => {
    const conv = makeConversation({
      sharing: {
        shared_with: [],
        shared_with_teams: [TEAM_ID_1.toString()],
      },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    // User belongs to TEAM_ID_2, not TEAM_ID_1
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: TEAM_ID_2 }]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    mockCollections['sharing_access'] = sharingAccessCol;

    await expect(
      requireConversationAccess(conv._id, NON_MEMBER_EMAIL, mockGetCollection)
    ).rejects.toThrow('Forbidden');
  });

  it('grants access via sharing_access record when no team or direct share', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [], shared_with_teams: [] },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    // No team membership
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    // But has sharing_access record
    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue({
      conversation_id: conv._id,
      granted_to: MEMBER_EMAIL,
      permission: 'view',
    });
    mockCollections['sharing_access'] = sharingAccessCol;

    const result = await requireConversationAccess(conv._id, MEMBER_EMAIL, mockGetCollection);

    expect(result).toBeDefined();
    expect(result.conversation._id).toBe(conv._id);
    expect(result.access_level).toBe('shared');
  });

  it('throws 404 when conversation does not exist', async () => {
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(null);
    mockCollections['conversations'] = convsCol;

    await expect(
      requireConversationAccess('non-existent', MEMBER_EMAIL, mockGetCollection)
    ).rejects.toThrow('Conversation not found');
  });

  it('skips team check when shared_with_teams is empty', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [], shared_with_teams: [] },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    mockCollections['sharing_access'] = sharingAccessCol;

    await expect(
      requireConversationAccess(conv._id, NON_MEMBER_EMAIL, mockGetCollection)
    ).rejects.toThrow('Forbidden');

    // getUserTeamIds should NOT have been called — no teams collection access needed
    expect(mockGetCollection).not.toHaveBeenCalledWith('teams');
  });

  it('skips team check when shared_with_teams is undefined', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [] },
    });
    delete conv.sharing.shared_with_teams;

    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    mockCollections['sharing_access'] = sharingAccessCol;

    await expect(
      requireConversationAccess(conv._id, NON_MEMBER_EMAIL, mockGetCollection)
    ).rejects.toThrow('Forbidden');

    expect(mockGetCollection).not.toHaveBeenCalledWith('teams');
  });
});

// ============================================================================
// GET /api/chat/conversations — team sharing in listing
// ============================================================================

describe('GET /api/chat/conversations — team sharing', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/chat/conversations/route');
    GET = mod.GET;
  });

  it('includes shared_with_teams condition when user belongs to teams', async () => {
    mockGetServerSession.mockResolvedValue(userSession(MEMBER_EMAIL));

    // User belongs to TEAM_ID_1
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: TEAM_ID_1 }]),
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

    expect(orConditions).toContainEqual({ owner_id: MEMBER_EMAIL });
    expect(orConditions).toContainEqual({ 'sharing.shared_with': MEMBER_EMAIL });
    expect(orConditions).toContainEqual({
      'sharing.shared_with_teams': { $in: [TEAM_ID_1.toString()] },
    });
  });

  it('does NOT include shared_with_teams condition when user has no teams', async () => {
    mockGetServerSession.mockResolvedValue(userSession(NON_MEMBER_EMAIL));

    // No teams
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

    expect(orConditions).toHaveLength(3);
    expect(orConditions).toContainEqual({ owner_id: NON_MEMBER_EMAIL });
    expect(orConditions).toContainEqual({ 'sharing.shared_with': NON_MEMBER_EMAIL });
    expect(orConditions).toContainEqual({ 'sharing.is_public': true });
    const teamCondition = orConditions.find(
      (c: any) => c['sharing.shared_with_teams']
    );
    expect(teamCondition).toBeUndefined();
  });

  it('includes multiple team IDs when user belongs to multiple teams', async () => {
    mockGetServerSession.mockResolvedValue(userSession(MEMBER_EMAIL));

    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: TEAM_ID_1 },
          { _id: TEAM_ID_2 },
        ]),
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
    const teamCondition = orConditions.find(
      (c: any) => c['sharing.shared_with_teams']
    );

    expect(teamCondition).toBeDefined();
    expect(teamCondition['sharing.shared_with_teams'].$in).toEqual([
      TEAM_ID_1.toString(),
      TEAM_ID_2.toString(),
    ]);
  });

  it('still excludes soft-deleted conversations', async () => {
    mockGetServerSession.mockResolvedValue(userSession(MEMBER_EMAIL));

    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: TEAM_ID_1 }]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    const req = makeRequest('/api/chat/conversations');
    await GET(req);

    const findCall = convsCol.find.mock.calls[0][0];
    expect(findCall.$and).toBeDefined();
    expect(findCall.$and).toContainEqual(
      expect.objectContaining({
        $or: expect.arrayContaining([
          { deleted_at: null },
          { deleted_at: { $exists: false } },
        ]),
      })
    );
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = makeRequest('/api/chat/conversations');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// GET /api/chat/shared — team sharing in shared listing
// ============================================================================

describe('GET /api/chat/shared — team sharing', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/chat/shared/route');
    GET = mod.GET;
  });

  it('includes shared_with_teams condition when user belongs to teams', async () => {
    mockGetServerSession.mockResolvedValue(userSession(MEMBER_EMAIL));

    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: TEAM_ID_1 }]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    const req = makeRequest('/api/chat/shared');
    await GET(req);

    const findCall = convsCol.find.mock.calls[0][0];

    // Should exclude owner's own conversations
    expect(findCall.owner_id).toEqual({ $ne: MEMBER_EMAIL });

    // Should have $or with direct and team sharing
    expect(findCall.$or).toBeDefined();
    expect(findCall.$or).toContainEqual({ 'sharing.shared_with': MEMBER_EMAIL });
    expect(findCall.$or).toContainEqual({
      'sharing.shared_with_teams': { $in: [TEAM_ID_1.toString()] },
    });
  });

  it('only includes direct sharing when user has no teams', async () => {
    mockGetServerSession.mockResolvedValue(userSession(NON_MEMBER_EMAIL));

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
    expect(findCall.$or).toHaveLength(2);
    expect(findCall.$or).toContainEqual({ 'sharing.shared_with': NON_MEMBER_EMAIL });
    expect(findCall.$or).toContainEqual({ 'sharing.is_public': true });
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = makeRequest('/api/chat/shared');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
