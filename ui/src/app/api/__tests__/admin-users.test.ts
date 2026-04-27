/**
 * @jest-environment node
 */
/**
 * Tests for Admin Users API Route
 *
 * Covers:
 * - GET /api/admin/users — paginated user list with per-user statistics
 *
 * Features tested:
 * - Authentication: 401 when unauthenticated
 * - Authorization: 403 when non-admin
 * - MongoDB guard: 503 when MongoDB is not configured
 * - Pagination (page, limit, search params)
 * - Batch aggregation for conversation counts, message counts, last activity
 * - User role from metadata.role or default 'user'
 * - Edge case: empty database returns empty list
 * - Edge case: user with no conversations/messages
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

let mockIsMongoDBConfigured = true;
jest.mock('@/lib/mongodb', () => ({
  getCollection: (...args: any[]) => mockGetCollection(...args),
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
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
        toArray: jest.fn().mockResolvedValue([]),
      }),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
  };
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

function adminSession() {
  return {
    user: { email: 'admin@example.com', name: 'Admin User' },
    role: 'admin',
  };
}

function userSession() {
  return {
    user: { email: 'user@example.com', name: 'Regular User' },
    role: 'user',
  };
}

function resetMocks() {
  mockGetServerSession.mockReset();
  mockGetCollection.mockClear();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
}

/** Set up users collection to return data. Supports both find().sort().toArray()
 *  (used by the GET all-users path) and find().sort().skip().limit().toArray()
 *  (used by paginated legacy paths). */
function setupUsersCol(usersData: any[]) {
  const usersCol = createMockCollection();
  usersCol.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(usersData),   // find().sort().toArray()
      skip: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(usersData),
        }),
      }),
    }),
  });
  usersCol.countDocuments.mockResolvedValue(usersData.length);
  mockCollections['users'] = usersCol;
  return usersCol;
}

/** Set up conversations collection.
 *  The GET /admin/users route queries conversations per user via countDocuments
 *  and findOne (not batch aggregation). convCounts drives countDocuments so
 *  per-user conversation counts match the expected test values. */
function setupConvCol(convCounts: { email: string; count: number }[], lastActivities: { email: string; date: Date }[] = []) {
  const convCol = createMockCollection();

  // Per-user countDocuments — returns the configured count for the given owner_id.
  convCol.countDocuments.mockImplementation(async (query: any) => {
    const email = query?.owner_id;
    const found = convCounts.find(c => c.email === email);
    return found?.count ?? 0;
  });

  // Per-user findOne for last activity — returns null (last_login fallback) unless
  // a lastActivity entry is provided for that email.
  convCol.findOne.mockImplementation(async (query: any) => {
    const email = query?.owner_id;
    const activity = lastActivities.find(a => a.email === email);
    return activity ? { updated_at: activity.date } : null;
  });

  mockCollections['conversations'] = convCol;
  return convCol;
}

/** Set up messages collection with batch aggregation results. */
function setupMsgCol(msgCounts: { email: string; count: number }[]) {
  const msgCol = createMockCollection();
  msgCol.aggregate.mockReturnValue({
    toArray: jest.fn().mockResolvedValue(msgCounts.map(m => ({ _id: m.email, count: m.count }))),
  });
  mockCollections['messages'] = msgCol;
  return msgCol;
}

// ============================================================================
// Test imports (after mocks)
// ============================================================================

import { GET } from '../admin/users/route';

// ============================================================================
// Tests: Authentication & Authorization
// ============================================================================

describe('GET /api/admin/users — Auth', () => {
  beforeEach(resetMocks);

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks admin view group', async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Admin view access required');
  });

  it('allows non-admin users with view access to read user list (readonly)', async () => {
    mockGetServerSession.mockResolvedValue({ ...userSession(), canViewAdmin: true });

    setupUsersCol([]);
    setupConvCol([]);
    setupMsgCol([]);

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 503 when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });
});

// ============================================================================
// Tests: User listing with stats
// ============================================================================

describe('GET /api/admin/users — User List', () => {
  beforeEach(resetMocks);

  it('returns users with their statistics and pagination', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const usersData = [
      {
        _id: new ObjectId(),
        email: 'alice@example.com',
        name: 'Alice',
        created_at: lastWeek,
        last_login: now,
        metadata: { role: 'user' },
      },
      {
        _id: new ObjectId(),
        email: 'bob@example.com',
        name: 'Bob',
        created_at: lastWeek,
        last_login: lastWeek,
        metadata: { role: 'admin' },
      },
    ];

    setupUsersCol(usersData);
    setupConvCol(
      [{ email: 'alice@example.com', count: 5 }, { email: 'bob@example.com', count: 3 }],
      [{ email: 'alice@example.com', date: now }],
    );
    setupMsgCol([
      { email: 'alice@example.com', count: 25 },
      { email: 'bob@example.com', count: 10 },
    ]);

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.users).toHaveLength(2);
    expect(body.data.total).toBe(2);
    expect(body.data.pagination).toBeDefined();
    expect(body.data.pagination.page).toBe(1);

    const alice = body.data.users.find((u: any) => u.email === 'alice@example.com');
    expect(alice).toBeDefined();
    expect(alice.name).toBe('Alice');
    expect(alice.role).toBe('user');
    expect(alice.stats.conversations).toBe(5);
    expect(alice.stats.messages).toBe(25);

    const bob = body.data.users.find((u: any) => u.email === 'bob@example.com');
    expect(bob).toBeDefined();
    expect(bob.name).toBe('Bob');
    expect(bob.role).toBe('admin');
    expect(bob.stats.conversations).toBe(3);
    expect(bob.stats.messages).toBe(10);
  });

  it('returns empty list when no users exist', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    setupUsersCol([]);
    setupConvCol([]);
    setupMsgCol([]);

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.users).toEqual([]);
    expect(body.data.total).toBe(0);
    expect(body.data.pagination.total_pages).toBe(0);
  });
});

// ============================================================================
// Tests: Batch aggregation for message counts
// ============================================================================

describe('GET /api/admin/users — Batch Aggregation', () => {
  beforeEach(resetMocks);

  it('uses batch aggregation with $match/$group for message counts', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const usersData = [
      { _id: new ObjectId(), email: 'test@example.com', name: 'Test', created_at: new Date(), last_login: new Date(), metadata: { role: 'user' } },
    ];
    setupUsersCol(usersData);
    const msgCol = setupMsgCol([]);
    setupConvCol([]);

    const req = makeRequest('/api/admin/users');
    await GET(req);

    expect(msgCol.aggregate).toHaveBeenCalled();
    const pipeline = msgCol.aggregate.mock.calls[0][0];
    expect(Array.isArray(pipeline)).toBe(true);

    const matchStage = pipeline.find((stage: Record<string, any>) => stage.$match);
    expect(matchStage).toBeDefined();
    expect(matchStage.$match.owner_id).toBeDefined();

    const groupStage = pipeline.find((stage: Record<string, any>) => stage.$group);
    expect(groupStage).toBeDefined();
    expect(groupStage.$group._id).toBe('$owner_id');
  });

  it('assigns 0 messages for users not in aggregation result', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const usersData = [
      { _id: new ObjectId(), email: 'newuser@example.com', name: 'New User', created_at: new Date(), last_login: new Date() },
    ];
    setupUsersCol(usersData);
    setupMsgCol([]);
    setupConvCol([]);

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.users[0].stats.messages).toBe(0);
    expect(body.data.users[0].stats.conversations).toBe(0);
  });
});

// ============================================================================
// Tests: User metadata
// ============================================================================

describe('GET /api/admin/users — Metadata', () => {
  beforeEach(resetMocks);

  it('defaults role to "user" when metadata.role is not set', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const now = new Date();
    const usersData = [
      { _id: new ObjectId(), email: 'norole@example.com', name: 'No Role User', created_at: now, last_login: now },
    ];
    setupUsersCol(usersData);
    setupMsgCol([]);
    setupConvCol([]);

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.users[0].role).toBe('user');
  });

  it('falls back last_activity to last_login when no conversation', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const loginTime = new Date('2025-12-01T10:00:00Z');
    const usersData = [
      { _id: new ObjectId(), email: 'lonely@example.com', name: 'Lonely User', created_at: new Date('2025-01-01'), last_login: loginTime },
    ];
    setupUsersCol(usersData);
    setupMsgCol([]);
    setupConvCol([], []);

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.users[0].last_activity).toBe(loginTime.toISOString());
  });
});
