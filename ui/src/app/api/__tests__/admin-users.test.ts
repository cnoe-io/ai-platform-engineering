/**
 * @jest-environment node
 */
/**
 * Tests for Admin Users API Route
 *
 * Covers:
 * - GET /api/admin/users — list all users with per-user statistics
 *
 * Features tested:
 * - Authentication: 401 when unauthenticated
 * - Authorization: 403 when non-admin
 * - MongoDB guard: 503 when MongoDB is not configured
 * - User listing with sort by created_at descending
 * - Pre-aggregation of message counts via $lookup (backward compat fix)
 * - Message count map correctly populated per user
 * - Per-user conversation count via countDocuments
 * - Last activity populated from conversation updated_at or last_login fallback
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

  it('returns 403 when user is not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    expect(res.status).toBe(403);
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

  it('returns users with their statistics', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const now = new Date();
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Users collection: allUsers query and auth fallback
    const usersCol = createMockCollection();
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

    // find({}).sort().toArray() — list all users
    usersCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(usersData),
      }),
    });
    mockCollections['users'] = usersCol;

    // Conversations collection
    const convCol = createMockCollection();
    // Per-user countDocuments: alice has 5, bob has 3
    convCol.countDocuments
      .mockResolvedValueOnce(5)  // alice's conversations
      .mockResolvedValueOnce(3); // bob's conversations
    // Per-user findOne (last conversation): alice has recent, bob has nothing
    convCol.findOne
      .mockResolvedValueOnce({ updated_at: now })  // alice's last conv
      .mockResolvedValueOnce(null);                  // bob has no conv
    mockCollections['conversations'] = convCol;

    // Messages collection — pre-aggregate via $lookup
    const msgCol = createMockCollection();
    msgCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { _id: 'alice@example.com', count: 25 },
        { _id: 'bob@example.com', count: 10 },
      ]),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.users).toHaveLength(2);
    expect(body.data.total).toBe(2);

    // Alice
    const alice = body.data.users.find((u: any) => u.email === 'alice@example.com');
    expect(alice).toBeDefined();
    expect(alice.name).toBe('Alice');
    expect(alice.role).toBe('user');
    expect(alice.stats.conversations).toBe(5);
    expect(alice.stats.messages).toBe(25);

    // Bob
    const bob = body.data.users.find((u: any) => u.email === 'bob@example.com');
    expect(bob).toBeDefined();
    expect(bob.name).toBe('Bob');
    expect(bob.role).toBe('admin');
    expect(bob.stats.conversations).toBe(3);
    expect(bob.stats.messages).toBe(10);
  });

  it('returns empty list when no users exist', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const usersCol = createMockCollection();
    usersCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['users'] = usersCol;

    const msgCol = createMockCollection();
    msgCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.users).toEqual([]);
    expect(body.data.total).toBe(0);
  });
});

// ============================================================================
// Tests: Message count pre-aggregation ($lookup fix)
// ============================================================================

describe('GET /api/admin/users — Message Count $lookup', () => {
  beforeEach(resetMocks);

  it('uses $lookup through conversations for message counts', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const usersCol = createMockCollection();
    usersCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['users'] = usersCol;

    const msgCol = createMockCollection();
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/admin/users');
    await GET(req);

    // Verify messages.aggregate was called with a pipeline containing $lookup
    expect(msgCol.aggregate).toHaveBeenCalled();
    const pipeline = msgCol.aggregate.mock.calls[0][0];
    expect(Array.isArray(pipeline)).toBe(true);

    const lookupStage = pipeline.find(
      (stage: Record<string, any>) => stage.$lookup
    );
    expect(lookupStage).toBeDefined();
    expect(lookupStage.$lookup.from).toBe('conversations');
    expect(lookupStage.$lookup.localField).toBe('conversation_id');
    expect(lookupStage.$lookup.foreignField).toBe('_id');
  });

  it('pipeline uses $ifNull to prefer direct owner_id over $lookup', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const usersCol = createMockCollection();
    usersCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    mockCollections['users'] = usersCol;

    const msgCol = createMockCollection();
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/admin/users');
    await GET(req);

    const pipeline = msgCol.aggregate.mock.calls[0][0];

    const addFieldsStage = pipeline.find(
      (stage: Record<string, any>) => stage.$addFields
    );
    expect(addFieldsStage).toBeDefined();
    expect(addFieldsStage.$addFields._owner).toBeDefined();
    expect(addFieldsStage.$addFields._owner.$ifNull).toBeDefined();

    // First element is direct owner_id, second is from $lookup
    const ifNullArgs = addFieldsStage.$addFields._owner.$ifNull;
    expect(ifNullArgs[0]).toBe('$owner_id');
  });

  it('assigns 0 messages for users not in aggregation result', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const usersCol = createMockCollection();
    usersCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            email: 'newuser@example.com',
            name: 'New User',
            created_at: new Date(),
            last_login: new Date(),
          },
        ]),
      }),
    });
    mockCollections['users'] = usersCol;

    // Aggregation returns no results for newuser
    const msgCol = createMockCollection();
    msgCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['messages'] = msgCol;

    const convCol = createMockCollection();
    convCol.countDocuments.mockResolvedValue(0);
    convCol.findOne.mockResolvedValue(null);
    mockCollections['conversations'] = convCol;

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
    const usersCol = createMockCollection();
    usersCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            email: 'norole@example.com',
            name: 'No Role User',
            created_at: now,
            last_login: now,
            // metadata.role is absent
          },
        ]),
      }),
    });
    mockCollections['users'] = usersCol;

    const msgCol = createMockCollection();
    mockCollections['messages'] = msgCol;

    const convCol = createMockCollection();
    convCol.countDocuments.mockResolvedValue(0);
    convCol.findOne.mockResolvedValue(null);
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.users[0].role).toBe('user');
  });

  it('falls back last_activity to last_login when no conversation', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const loginTime = new Date('2025-12-01T10:00:00Z');
    const usersCol = createMockCollection();
    usersCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            email: 'lonely@example.com',
            name: 'Lonely User',
            created_at: new Date('2025-01-01'),
            last_login: loginTime,
          },
        ]),
      }),
    });
    mockCollections['users'] = usersCol;

    const msgCol = createMockCollection();
    mockCollections['messages'] = msgCol;

    const convCol = createMockCollection();
    convCol.countDocuments.mockResolvedValue(0);
    convCol.findOne.mockResolvedValue(null); // no last conversation
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/users');
    const res = await GET(req);
    const body = await res.json();

    // last_activity should fall back to last_login
    expect(body.data.users[0].last_activity).toBe(loginTime.toISOString());
  });
});
