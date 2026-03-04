/**
 * @jest-environment node
 */
/**
 * Tests for Read-Only Sharing Permissions
 *
 * Covers the sharing permission model:
 * - 'view' permission → shared_readonly access (cannot send messages)
 * - 'comment' permission → shared access (can send messages)
 * - Public shares → always shared_readonly
 * - Team shares with per-team permissions
 * - Permission changes via PATCH
 * - Backward compatibility: legacy shares without permission records default to 'comment'
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
  v4: () => 'mock-uuid-1234',
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockCollection() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    insertMany: jest.fn().mockResolvedValue({ insertedCount: 0 }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
}

const OWNER_EMAIL = 'owner@example.com';
const VIEWER_EMAIL = 'viewer@example.com';
const EDITOR_EMAIL = 'editor@example.com';
const TEAM_MEMBER_EMAIL = 'team-member@example.com';
const TEAM_ID = new ObjectId().toHexString();
const TEST_CONV_ID = '12345678-1234-1234-1234-123456789abc';

function makeConversation(overrides: any = {}) {
  return {
    _id: TEST_CONV_ID,
    title: 'Test Conversation',
    owner_id: OWNER_EMAIL,
    created_at: new Date(),
    updated_at: new Date(),
    metadata: { agent_version: '1.0', model_used: 'test', total_messages: 0 },
    sharing: {
      is_public: false,
      shared_with: [],
      shared_with_teams: [],
      share_link_enabled: false,
      ...overrides.sharing,
    },
    tags: [],
    is_archived: false,
    is_pinned: false,
    ...overrides,
    // Keep sharing merge at top level
  };
}

// ============================================================================
// Import after mocks
// ============================================================================

import { requireConversationAccess } from '@/lib/api-middleware';

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
});

describe('requireConversationAccess — readonly sharing permissions', () => {
  describe('direct user shares', () => {
    it('returns shared_readonly when user has view permission', async () => {
      const conv = makeConversation({
        sharing: { shared_with: [VIEWER_EMAIL], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const sharingAccessCol = createMockCollection();
      sharingAccessCol.findOne.mockResolvedValue({
        conversation_id: conv._id,
        granted_to: VIEWER_EMAIL,
        permission: 'view',
      });
      mockCollections['sharing_access'] = sharingAccessCol;

      const result = await requireConversationAccess(conv._id, VIEWER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared_readonly');
      expect(result.conversation._id).toBe(conv._id);
    });

    it('returns shared when user has comment permission', async () => {
      const conv = makeConversation({
        sharing: { shared_with: [EDITOR_EMAIL], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const sharingAccessCol = createMockCollection();
      sharingAccessCol.findOne.mockResolvedValue({
        conversation_id: conv._id,
        granted_to: EDITOR_EMAIL,
        permission: 'comment',
      });
      mockCollections['sharing_access'] = sharingAccessCol;

      const result = await requireConversationAccess(conv._id, EDITOR_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared');
    });

    it('defaults to shared (comment) for legacy shares without a SharingAccess record', async () => {
      const conv = makeConversation({
        sharing: { shared_with: [VIEWER_EMAIL], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const sharingAccessCol = createMockCollection();
      sharingAccessCol.findOne.mockResolvedValue(null);
      mockCollections['sharing_access'] = sharingAccessCol;

      const result = await requireConversationAccess(conv._id, VIEWER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared');
    });
  });

  describe('public shares', () => {
    it('returns shared (comment) by default for public conversations', async () => {
      const conv = makeConversation({
        sharing: { is_public: true, shared_with: [], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const result = await requireConversationAccess(conv._id, VIEWER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared');
    });

    it('returns shared_readonly when public_permission is view', async () => {
      const conv = makeConversation({
        sharing: { is_public: true, public_permission: 'view', shared_with: [], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const result = await requireConversationAccess(conv._id, VIEWER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared_readonly');
    });

    it('returns shared when public_permission is comment', async () => {
      const conv = makeConversation({
        sharing: { is_public: true, public_permission: 'comment', shared_with: [], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const result = await requireConversationAccess(conv._id, VIEWER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared');
    });

    it('owner still gets owner access on public conversations', async () => {
      const conv = makeConversation({
        sharing: { is_public: true, shared_with: [], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const result = await requireConversationAccess(conv._id, OWNER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('owner');
    });
  });

  describe('team shares with permissions', () => {
    it('returns shared_readonly when team has view permission', async () => {
      const conv = makeConversation({
        sharing: {
          shared_with: [],
          shared_with_teams: [TEAM_ID],
          team_permissions: { [TEAM_ID]: 'view' },
        },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const teamsCol = createMockCollection();
      teamsCol.find.mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            { _id: new ObjectId(TEAM_ID) },
          ]),
        }),
      });
      mockCollections['teams'] = teamsCol;

      const result = await requireConversationAccess(conv._id, TEAM_MEMBER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared_readonly');
    });

    it('returns shared when team has comment permission', async () => {
      const conv = makeConversation({
        sharing: {
          shared_with: [],
          shared_with_teams: [TEAM_ID],
          team_permissions: { [TEAM_ID]: 'comment' },
        },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const teamsCol = createMockCollection();
      teamsCol.find.mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            { _id: new ObjectId(TEAM_ID) },
          ]),
        }),
      });
      mockCollections['teams'] = teamsCol;

      const result = await requireConversationAccess(conv._id, TEAM_MEMBER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared');
    });

    it('defaults to shared (comment) for legacy team shares without team_permissions', async () => {
      const conv = makeConversation({
        sharing: {
          shared_with: [],
          shared_with_teams: [TEAM_ID],
        },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const teamsCol = createMockCollection();
      teamsCol.find.mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([
            { _id: new ObjectId(TEAM_ID) },
          ]),
        }),
      });
      mockCollections['teams'] = teamsCol;

      const result = await requireConversationAccess(conv._id, TEAM_MEMBER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared');
    });
  });

  describe('sharing_access fallback', () => {
    it('returns shared_readonly when sharing_access record has view permission', async () => {
      const conv = makeConversation({
        sharing: { shared_with: [], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const sharingAccessCol = createMockCollection();
      sharingAccessCol.findOne.mockResolvedValue({
        conversation_id: conv._id,
        granted_to: VIEWER_EMAIL,
        permission: 'view',
      });
      mockCollections['sharing_access'] = sharingAccessCol;

      const result = await requireConversationAccess(conv._id, VIEWER_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared_readonly');
    });

    it('returns shared when sharing_access record has comment permission', async () => {
      const conv = makeConversation({
        sharing: { shared_with: [], shared_with_teams: [] },
      });
      const convsCol = createMockCollection();
      convsCol.findOne.mockResolvedValue(conv);
      mockCollections['conversations'] = convsCol;

      const sharingAccessCol = createMockCollection();
      sharingAccessCol.findOne.mockResolvedValue({
        conversation_id: conv._id,
        granted_to: EDITOR_EMAIL,
        permission: 'comment',
      });
      mockCollections['sharing_access'] = sharingAccessCol;

      const result = await requireConversationAccess(conv._id, EDITOR_EMAIL, mockGetCollection);

      expect(result.access_level).toBe('shared');
    });
  });
});

describe('POST /api/chat/conversations/[id]/messages — readonly sharing', () => {
  it('blocks message creation for shared_readonly users', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [VIEWER_EMAIL], shared_with_teams: [] },
    });

    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue({
      conversation_id: conv._id,
      granted_to: VIEWER_EMAIL,
      permission: 'view',
    });
    mockCollections['sharing_access'] = sharingAccessCol;

    mockGetServerSession.mockResolvedValue({
      user: { email: VIEWER_EMAIL, name: 'Viewer' },
    });

    const { POST } = await import('@/app/api/chat/conversations/[id]/messages/route');

    const req = new NextRequest(`http://localhost/api/chat/conversations/${TEST_CONV_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'user', content: 'test message' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: conv._id }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Read-only');
  });

  it('allows message creation for shared (comment) users', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [EDITOR_EMAIL], shared_with_teams: [] },
    });

    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue({
      conversation_id: conv._id,
      granted_to: EDITOR_EMAIL,
      permission: 'comment',
    });
    mockCollections['sharing_access'] = sharingAccessCol;

    const msgCol = createMockCollection();
    mockCollections['messages'] = msgCol;

    mockGetServerSession.mockResolvedValue({
      user: { email: EDITOR_EMAIL, name: 'Editor' },
    });

    const { POST } = await import('@/app/api/chat/conversations/[id]/messages/route');

    const req = new NextRequest(`http://localhost/api/chat/conversations/${TEST_CONV_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'user', content: 'test message' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: conv._id }) });

    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/chat/conversations/[id]/share — permission updates', () => {
  it('updates user permission via PATCH', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [VIEWER_EMAIL], shared_with_teams: [] },
    });

    const convsCol = createMockCollection();
    convsCol.findOne
      .mockResolvedValueOnce(conv)
      .mockResolvedValue({ ...conv });
    mockCollections['conversations'] = convsCol;

    const sharingAccessCol = createMockCollection();
    mockCollections['sharing_access'] = sharingAccessCol;

    mockGetServerSession.mockResolvedValue({
      user: { email: OWNER_EMAIL, name: 'Owner' },
    });

    const { PATCH } = await import('@/app/api/chat/conversations/[id]/share/route');

    const req = new NextRequest(`http://localhost/api/chat/conversations/${TEST_CONV_ID}/share`, {
      method: 'PATCH',
      body: JSON.stringify({ email: VIEWER_EMAIL, permission: 'comment' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: conv._id }) });

    expect(res.status).toBe(200);
    expect(sharingAccessCol.updateOne).toHaveBeenCalledWith(
      { conversation_id: conv._id, granted_to: VIEWER_EMAIL, revoked_at: null },
      { $set: { permission: 'comment' } }
    );
  });

  it('updates team permission via PATCH', async () => {
    const conv = makeConversation({
      sharing: {
        shared_with: [],
        shared_with_teams: [TEAM_ID],
        team_permissions: { [TEAM_ID]: 'view' },
      },
    });

    const convsCol = createMockCollection();
    convsCol.findOne
      .mockResolvedValueOnce(conv)
      .mockResolvedValue({ ...conv });
    mockCollections['conversations'] = convsCol;

    mockGetServerSession.mockResolvedValue({
      user: { email: OWNER_EMAIL, name: 'Owner' },
    });

    const { PATCH } = await import('@/app/api/chat/conversations/[id]/share/route');

    const req = new NextRequest(`http://localhost/api/chat/conversations/${TEST_CONV_ID}/share`, {
      method: 'PATCH',
      body: JSON.stringify({ team_id: TEAM_ID, permission: 'comment' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: conv._id }) });

    expect(res.status).toBe(200);
    expect(convsCol.updateOne).toHaveBeenCalledWith(
      { _id: conv._id },
      { $set: { 'sharing.team_permissions': { [TEAM_ID]: 'comment' } } }
    );
  });

  it('rejects PATCH with invalid permission value', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: OWNER_EMAIL, name: 'Owner' },
    });

    const { PATCH } = await import('@/app/api/chat/conversations/[id]/share/route');

    const req = new NextRequest(`http://localhost/api/chat/conversations/${TEST_CONV_ID}/share`, {
      method: 'PATCH',
      body: JSON.stringify({ email: VIEWER_EMAIL, permission: 'admin' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: TEST_CONV_ID }) });

    expect(res.status).toBe(400);
  });

  it('rejects PATCH from non-owner', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [VIEWER_EMAIL], shared_with_teams: [] },
    });

    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    mockCollections['conversations'] = convsCol;

    mockGetServerSession.mockResolvedValue({
      user: { email: VIEWER_EMAIL, name: 'Viewer' },
    });

    const { PATCH } = await import('@/app/api/chat/conversations/[id]/share/route');

    const req = new NextRequest(`http://localhost/api/chat/conversations/${TEST_CONV_ID}/share`, {
      method: 'PATCH',
      body: JSON.stringify({ email: VIEWER_EMAIL, permission: 'comment' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: conv._id }) });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/chat/conversations/[id]/share — permission storage', () => {
  it('stores permission in SharingAccess when sharing with users', async () => {
    const conv = makeConversation({
      sharing: { shared_with: [], shared_with_teams: [] },
    });

    const convsCol = createMockCollection();
    convsCol.findOne
      .mockResolvedValueOnce(conv)
      .mockResolvedValue({ ...conv, sharing: { ...conv.sharing, shared_with: [VIEWER_EMAIL] } });
    mockCollections['conversations'] = convsCol;

    const sharingAccessCol = createMockCollection();
    mockCollections['sharing_access'] = sharingAccessCol;

    mockGetServerSession.mockResolvedValue({
      user: { email: OWNER_EMAIL, name: 'Owner' },
    });

    const { POST } = await import('@/app/api/chat/conversations/[id]/share/route');

    const req = new NextRequest(`http://localhost/api/chat/conversations/${TEST_CONV_ID}/share`, {
      method: 'POST',
      body: JSON.stringify({
        user_emails: [VIEWER_EMAIL],
        permission: 'view',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: conv._id }) });

    expect(res.status).toBe(200);
    expect(sharingAccessCol.insertMany).toHaveBeenCalled();
    const insertedRecords = sharingAccessCol.insertMany.mock.calls[0][0];
    expect(insertedRecords[0].permission).toBe('view');
    expect(insertedRecords[0].granted_to).toBe(VIEWER_EMAIL);
  });

  it('stores team_permissions when sharing with teams', async () => {
    const teamObjId = new ObjectId();
    const teamIdStr = teamObjId.toHexString();

    const conv = makeConversation({
      sharing: { shared_with: [], shared_with_teams: [] },
    });

    const convsCol = createMockCollection();
    convsCol.findOne
      .mockResolvedValueOnce(conv)
      .mockResolvedValue({ ...conv });
    mockCollections['conversations'] = convsCol;

    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue({ _id: teamObjId, name: 'Test Team' });
    mockCollections['teams'] = teamsCol;

    mockGetServerSession.mockResolvedValue({
      user: { email: OWNER_EMAIL, name: 'Owner' },
    });

    const { POST } = await import('@/app/api/chat/conversations/[id]/share/route');

    const req = new NextRequest(`http://localhost/api/chat/conversations/${TEST_CONV_ID}/share`, {
      method: 'POST',
      body: JSON.stringify({
        team_ids: [teamIdStr],
        permission: 'view',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: conv._id }) });

    expect(res.status).toBe(200);
    const updateCall = convsCol.updateOne.mock.calls[0][1];
    expect(updateCall.$set['sharing.team_permissions']).toEqual({ [teamIdStr]: 'view' });
  });
});
