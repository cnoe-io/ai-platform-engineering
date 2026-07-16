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
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: '',
}));

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => key === 'ssoEnabled',
}));

const mockCollections: Record<string, unknown> = {};
const mockGetCollection = jest.fn((name: string) => {
  if (!mockCollections[name]) {
    mockCollections[name] = createMockCollection();
  }
  return Promise.resolve(mockCollections[name]);
});

jest.mock('@/lib/mongodb', () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
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

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'conv-' + Math.random().toString(36).slice(2, 10),
    title: 'Test Conversation',
    owner_id: OWNER_EMAIL,
    created_at: new Date(),
    updated_at: new Date(),
    metadata: { client_type: 'ui', ui_version: '0.2.0', total_messages: 0 },
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
  let getUserTeamIds: unknown;

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
    expect(teamsCol.find).toHaveBeenCalledWith({
      $or: [{ 'members.user_id': MEMBER_EMAIL }],
    });
  });

  it('returns canonical team ids and slugs from team_membership_sources', async () => {
    const sourcesCol = createMockCollection();
    sourcesCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { team_id: TEAM_ID_1.toString(), team_slug: 'platform' },
          { team_id: TEAM_ID_2.toString(), team_slug: 'sre' },
        ]),
      }),
    });
    mockCollections['team_membership_sources'] = sourcesCol;

    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const result = await getUserTeamIds(MEMBER_EMAIL);

    expect(result).toEqual([
      TEAM_ID_1.toString(),
      'platform',
      TEAM_ID_2.toString(),
      'sre',
    ]);
    expect(sourcesCol.find).toHaveBeenCalledWith({
      status: 'active',
      user_email: MEMBER_EMAIL,
    });
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
  let requireConversationAccess: unknown;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/lib/api-middleware');
    requireConversationAccess = mod.requireConversationAccess;
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

  it('grants access when user belongs to a canonically shared team slug', async () => {
    const conv = makeConversation({
      sharing: {
        shared_with: [],
        shared_with_teams: ['platform'],
      },
    });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const sourcesCol = createMockCollection();
    sourcesCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { team_id: TEAM_ID_1.toString(), team_slug: 'platform' },
        ]),
      }),
    });
    mockCollections['team_membership_sources'] = sourcesCol;

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
    ).rejects.toThrow('You do not have access to this conversation.');
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
    ).rejects.toThrow('You do not have access to this conversation.');
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

    // But has sharing_access record with view permission → shared_readonly
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
    expect(result.access_level).toBe('shared_readonly');
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
    ).rejects.toThrow('You do not have access to this conversation.');

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
    ).rejects.toThrow('You do not have access to this conversation.');

    expect(mockGetCollection).not.toHaveBeenCalledWith('teams');
  });
});

// ============================================================================
// GET /api/chat/conversations — team sharing in listing
// ============================================================================

describe('GET /api/chat/conversations — team sharing', () => {
  let GET: unknown;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/chat/conversations/route');
    GET = mod.GET;
  });

  it('prefilters owned and sharing-configured candidates before ReBAC', async () => {
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
    expect(findCall.$and).toEqual(expect.arrayContaining([
      {
        $or: [
          { owner_id: MEMBER_EMAIL },
          { 'sharing.shared_with': MEMBER_EMAIL },
          { 'sharing.shared_with_teams.0': { $exists: true } },
        ],
      },
    ]));
  });

  it('uses the same bounded candidate shape when user has no teams', async () => {
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

    const req = makeRequest('/api/chat/conversations');
    await GET(req);

    const findCall = convsCol.find.mock.calls[0][0];
    expect(findCall.$and).toEqual(expect.arrayContaining([
      expect.objectContaining({
        $or: [
          { owner_id: NON_MEMBER_EMAIL },
          { 'sharing.shared_with': NON_MEMBER_EMAIL },
          { 'sharing.shared_with_teams.0': { $exists: true } },
        ],
      }),
    ]));
  });

  it('does not branch query shape on the number of teams (ReBAC does the filtering)', async () => {
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
    expect(findCall.$and).toEqual(expect.arrayContaining([
      expect.objectContaining({
        $or: expect.arrayContaining([
          { 'sharing.shared_with_teams.0': { $exists: true } },
        ]),
      }),
    ]));
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
  let GET: unknown;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/chat/shared/route');
    GET = mod.GET;
  });

  // Issue #1979 fix: the query must pre-filter to conversations that carry a
  // sharing configuration so that private conversations from other users never
  // enter the OpenFGA pipeline or inflate the total count.
  it('pre-filters to sharing-configured conversations and scopes to non-owner', async () => {
    mockGetServerSession.mockResolvedValue(userSession(MEMBER_EMAIL));

    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    const req = makeRequest('/api/chat/shared');
    await GET(req);

    const findCall = convsCol.find.mock.calls[0][0];

    expect(findCall.owner_id).toEqual({ $ne: MEMBER_EMAIL });
    // Must include a sharing pre-filter ($or over sharing fields)
    expect(findCall.$or).toBeDefined();
    const orStr = JSON.stringify(findCall.$or);
    expect(orStr).not.toContain('sharing.is_public');
    expect(orStr).toContain('sharing.shared_with');
    expect(orStr).toContain('sharing.share_link_enabled');
    expect(orStr).toContain('sharing.shared_with_teams');
  });

  it('uses the same query shape regardless of team membership', async () => {
    mockGetServerSession.mockResolvedValue(userSession(NON_MEMBER_EMAIL));

    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    const req = makeRequest('/api/chat/shared');
    await GET(req);

    const findCall = convsCol.find.mock.calls[0][0];
    expect(findCall.owner_id).toEqual({ $ne: NON_MEMBER_EMAIL });
    expect(findCall.$or).toBeDefined();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = makeRequest('/api/chat/shared');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
