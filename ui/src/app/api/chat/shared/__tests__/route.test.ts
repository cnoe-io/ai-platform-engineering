/**
 * @jest-environment node
 */
/**
 * Unit tests for GET /api/chat/shared
 *
 * Issue #1979: the route was querying ALL non-owner conversations and then
 * post-filtering with OpenFGA, which exposed private conversations to the
 * permission pipeline and returned an inflated/incorrect total count.
 *
 * Fix: pre-filter at the MongoDB layer to conversations that carry a sharing
 * configuration before passing candidates to OpenFGA.
 *
 * Tests:
 * - Security: private conversations never appear in the MongoDB query
 * - Security: query always includes a sharing pre-filter ($or)
 * - Security: pre-filter covers direct shares, share links, and team shares
 * - Security: query scope is non-owner only (owner_id $ne)
 * - Pagination: returns paginatedResponse with correct items
 * - Pagination: total reflects pre-filtered count, not all non-owner conversations
 * - Auth: returns 401 when not authenticated
 * - Visibility: only conversations returned by filterConversationsByImplicitOrExplicitPermission are included
 */

import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';

// ============================================================================
// Mocks — must be before imports
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

const mockFilterConversations = jest.fn();
const mockGetDirectSharingAccessConversationIds = jest.fn();
jest.mock('@/lib/rbac/conversation-implicit-authz', () => ({
  filterConversationsByImplicitOrExplicitPermission: (...args: unknown[]) =>
    mockFilterConversations(...args),
  getDirectSharingAccessConversationIds: (...args: unknown[]) =>
    mockGetDirectSharingAccessConversationIds(...args),
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

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// ============================================================================
// Helpers
// ============================================================================

function createMockCollection() {
  const toArray = jest.fn().mockResolvedValue([]);
  const limit = jest.fn().mockReturnValue({ toArray });
  const skip = jest.fn().mockReturnValue({ limit });
  const sort = jest.fn().mockReturnValue({ skip });

  return {
    find: jest.fn().mockReturnValue({ sort }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    _sort: sort,
    _skip: skip,
    _limit: limit,
    _toArray: toArray,
  };
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

function userSession(email = 'caller@example.com') {
  return { user: { email, name: 'Test User' }, role: 'user' };
}

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'conv-' + Math.random().toString(36).slice(2, 10),
    title: 'Test Conversation',
    owner_id: 'other@example.com',
    created_at: new Date(),
    updated_at: new Date(),
    metadata: { total_messages: 2 },
    sharing: {
      is_public: false,
      shared_with: [],
      shared_with_teams: [],
      share_link_enabled: false,
    },
    ...overrides,
  };
}

const CALLER = 'caller@example.com';

// ============================================================================
// Setup
// ============================================================================

let GET: unknown;

beforeEach(async () => {
  jest.clearAllMocks();
  Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
  // Default: filterConversations passes everything through
  mockFilterConversations.mockImplementation((_session: unknown, _email: string, items: unknown[]) =>
    Promise.resolve(items)
  );
  mockGetDirectSharingAccessConversationIds.mockResolvedValue([]);
  jest.resetModules();
  const mod = await import('@/app/api/chat/shared/route');
  GET = mod.GET;
});

// ============================================================================
// Authentication
// ============================================================================

describe('authentication', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(makeRequest('/api/chat/shared'));

    expect(res.status).toBe(401);
  });
});

// ============================================================================
// Security — MongoDB pre-filter
// ============================================================================

describe('security — MongoDB pre-filter (issue #1979)', () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(userSession(CALLER));
  });

  it('scopes query to non-owner conversations', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    const findCall = convsCol.find.mock.calls[0][0];
    expect(findCall.owner_id).toEqual({ $ne: CALLER });
  });

  it('includes a $or sharing pre-filter to exclude private conversations', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    const findCall = convsCol.find.mock.calls[0][0];
    expect(findCall.$or).toBeDefined();
    expect(Array.isArray(findCall.$or)).toBe(true);
  });

  it('pre-filter does not include is_public because everyone sharing is disabled', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    const findCall = convsCol.find.mock.calls[0][0];
    const clauses = JSON.stringify(findCall.$or);
    expect(clauses).not.toContain('sharing.is_public');
  });

  it('pre-filter includes caller email in shared_with to surface direct shares', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    const findCall = convsCol.find.mock.calls[0][0];
    const orClauses: unknown[] = findCall.$or;
    const directShareClause = orClauses.find(
      (c) => c['sharing.shared_with'] === CALLER
    );
    expect(directShareClause).toBeDefined();
  });

  it('pre-filter includes direct SharingAccess conversation ids to surface old direct shares', async () => {
    mockGetDirectSharingAccessConversationIds.mockResolvedValue(['legacy-share']);
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    const findCall = convsCol.find.mock.calls[0][0];
    expect(findCall.$or).toContainEqual({ _id: { $in: ['legacy-share'] } });
    expect(mockFilterConversations).toHaveBeenCalledWith(
      expect.anything(),
      CALLER,
      expect.any(Array),
      'discover',
      ['legacy-share'],
    );
  });

  it('pre-filter includes share_link_enabled to surface link-shared conversations', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    const findCall = convsCol.find.mock.calls[0][0];
    const clauses = JSON.stringify(findCall.$or);
    expect(clauses).toContain('sharing.share_link_enabled');
  });

  it('pre-filter includes non-empty shared_with_teams to surface team-shared conversations', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    const findCall = convsCol.find.mock.calls[0][0];
    const clauses = JSON.stringify(findCall.$or);
    expect(clauses).toContain('sharing.shared_with_teams');
  });

  it('does NOT expose private conversations (no sharing config) via the query', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    // find returns nothing (the pre-filter would exclude privateConv)
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    // Verify the query sent to MongoDB cannot match a fully-private conversation
    const findCall = convsCol.find.mock.calls[0][0];
    expect(findCall.$or).toBeDefined();
    // None of the $or clauses should be a bare { owner_id: anything } — i.e.
    // the query must require some sharing signal
    const orClauses: unknown[] = findCall.$or;
    const hasUnguardedClause = orClauses.some(
      (c) => !Object.keys(c).some((k) => k.startsWith('sharing.')) && !('_id' in c)
    );
    expect(hasUnguardedClause).toBe(false);
  });
});

// ============================================================================
// Visibility — OpenFGA post-filter
// ============================================================================

describe('visibility — OpenFGA post-filter', () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(userSession(CALLER));
  });

  it('passes items through filterConversationsByImplicitOrExplicitPermission', async () => {
    const sharedConv = makeConversation({
      sharing: { is_public: false, shared_with: [CALLER], shared_with_teams: [], share_link_enabled: false },
    });
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(1);
    convsCol._toArray.mockResolvedValue([sharedConv]);
    mockCollections['conversations'] = convsCol;

    mockFilterConversations.mockResolvedValue([sharedConv]);

    const res = await GET(makeRequest('/api/chat/shared'));
    const body = await res.json();

    expect(mockFilterConversations).toHaveBeenCalled();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]._id).toBe(sharedConv._id);
  });

  it('excludes conversations rejected by OpenFGA even if they pass the pre-filter', async () => {
    const conv1 = makeConversation({
      sharing: { is_public: false, shared_with: [CALLER], shared_with_teams: [], share_link_enabled: false },
    });
    const conv2 = makeConversation({
      sharing: { is_public: false, shared_with: [CALLER], shared_with_teams: [], share_link_enabled: false },
    });
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(2);
    convsCol._toArray.mockResolvedValue([conv1, conv2]);
    mockCollections['conversations'] = convsCol;

    // OpenFGA only allows conv1
    mockFilterConversations.mockResolvedValue([conv1]);

    const res = await GET(makeRequest('/api/chat/shared'));
    const body = await res.json();

    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]._id).toBe(conv1._id);
  });

  it('returns empty list when OpenFGA rejects all pre-filtered candidates', async () => {
    const conv = makeConversation({
      sharing: { is_public: false, shared_with: [CALLER], shared_with_teams: [], share_link_enabled: false },
    });
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(1);
    convsCol._toArray.mockResolvedValue([conv]);
    mockCollections['conversations'] = convsCol;

    mockFilterConversations.mockResolvedValue([]);

    const res = await GET(makeRequest('/api/chat/shared'));
    const body = await res.json();

    expect(body.data.items).toHaveLength(0);
  });
});

// ============================================================================
// Pagination
// ============================================================================

describe('pagination', () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(userSession(CALLER));
  });

  it('passes skip and limit to MongoDB based on page/page_size params', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(50);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared?page=2&page_size=10'));

    expect(convsCol._skip).toHaveBeenCalledWith(10); // page 2, size 10 → skip 10
    expect(convsCol._limit).toHaveBeenCalledWith(10);
  });

  it('uses pre-filtered count for total (not all non-owner conversations)', async () => {
    const conv = makeConversation({
      sharing: { is_public: false, shared_with: [CALLER], shared_with_teams: [], share_link_enabled: false },
    });
    const convsCol = createMockCollection();
    // pre-filtered count = 5, not the full non-owner count
    convsCol.countDocuments.mockResolvedValue(5);
    convsCol._toArray.mockResolvedValue([conv]);
    mockCollections['conversations'] = convsCol;

    mockFilterConversations.mockResolvedValue([conv]);

    const res = await GET(makeRequest('/api/chat/shared'));
    const body = await res.json();

    expect(body.data.total).toBe(5);
  });

  it('returns page 1 with default page_size when no params given', async () => {
    const convsCol = createMockCollection();
    convsCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convsCol;

    await GET(makeRequest('/api/chat/shared'));

    expect(convsCol._skip).toHaveBeenCalledWith(0);
  });
});
