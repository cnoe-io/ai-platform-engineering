/**
 * @jest-environment node
 */
/**
 * Tests for Admin Feedback API Route
 *
 * Covers:
 * - GET /api/admin/feedback — paginated feedback entries for admin dashboard
 *
 * Features tested:
 * - Authentication: 401 when unauthenticated
 * - Authorization: 403 when non-admin
 * - MongoDB guard: 503 when MongoDB is not configured
 * - Pagination (page, limit, skip)
 * - Rating filter (positive, negative, all)
 * - Conversation title batch-fetching
 * - Content snippet truncation
 * - Response structure
 * - Empty database returns empty entries
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

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// ============================================================================
// Helpers
// ============================================================================

function createMockCollection() {
  const findReturnValue = {
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
    user: { email: 'admin@example.com', name: 'Admin' },
    role: 'admin',
    canViewAdmin: true,
  };
}

function userSession() {
  return {
    user: { email: 'user@example.com', name: 'User' },
    role: 'user',
    canViewAdmin: false,
  };
}

function makeFeedbackMessage(overrides: Partial<any> = {}) {
  return {
    _id: new ObjectId(),
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    content: 'Test assistant response content',
    role: 'assistant',
    feedback: {
      rating: 'positive',
      comment: 'Very Helpful',
      submitted_at: new Date('2026-03-01'),
      submitted_by: 'user@example.com',
    },
    created_at: new Date('2026-03-01'),
    owner_id: 'user@example.com',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('GET /api/admin/feedback', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
    mockGetCollection.mockClear();
    mockIsMongoDBConfigured = true;

    const mod = await import('@/app/api/admin/feedback/route');
    GET = mod.GET;
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(403);
  });

  it('returns 503 when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });

  it('returns empty entries on fresh database', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const msgCol = createMockCollection();
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    msgCol.countDocuments.mockResolvedValue(0);
    mockCollections['messages'] = msgCol;

    const convCol = createMockCollection();
    mockCollections['conversations'] = convCol;

    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.entries).toEqual([]);
    expect(body.data.pagination.total).toBe(0);
  });

  it('returns feedback entries with correct structure', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const msg = makeFeedbackMessage();
    const msgCol = createMockCollection();
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([msg]),
          }),
        }),
      }),
    });
    msgCol.countDocuments.mockResolvedValue(1);
    mockCollections['messages'] = msgCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ _id: 'conv-1', title: 'My Chat' }]),
    });
    mockCollections['conversations'] = convCol;

    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const entry = body.data.entries[0];
    expect(entry.message_id).toBe('msg-1');
    expect(entry.conversation_id).toBe('conv-1');
    expect(entry.conversation_title).toBe('My Chat');
    expect(entry.rating).toBe('positive');
    expect(entry.reason).toBe('Very Helpful');
    expect(entry.submitted_by).toBe('user@example.com');
    expect(entry.role).toBe('assistant');
  });

  it('truncates long content to 200 chars + ellipsis', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const longContent = 'x'.repeat(300);
    const msg = makeFeedbackMessage({ content: longContent });
    const msgCol = createMockCollection();
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([msg]),
          }),
        }),
      }),
    });
    msgCol.countDocuments.mockResolvedValue(1);
    mockCollections['messages'] = msgCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    mockCollections['conversations'] = convCol;

    const res = await GET(makeRequest('/api/admin/feedback'));
    const body = await res.json();
    expect(body.data.entries[0].content_snippet).toHaveLength(203); // 200 + '...'
    expect(body.data.entries[0].content_snippet).toMatch(/\.\.\.$/);
  });

  it('filters by positive rating', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const msgCol = createMockCollection();
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    msgCol.countDocuments.mockResolvedValue(0);
    mockCollections['messages'] = msgCol;
    mockCollections['conversations'] = createMockCollection();

    await GET(makeRequest('/api/admin/feedback?rating=positive'));
    const findCall = msgCol.find.mock.calls[0][0];
    expect(findCall['feedback.rating']).toBe('positive');
  });

  it('filters by negative rating', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const msgCol = createMockCollection();
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    msgCol.countDocuments.mockResolvedValue(0);
    mockCollections['messages'] = msgCol;
    mockCollections['conversations'] = createMockCollection();

    await GET(makeRequest('/api/admin/feedback?rating=negative'));
    const findCall = msgCol.find.mock.calls[0][0];
    expect(findCall['feedback.rating']).toBe('negative');
  });

  it('returns all ratings when no filter is set', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const msgCol = createMockCollection();
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    msgCol.countDocuments.mockResolvedValue(0);
    mockCollections['messages'] = msgCol;
    mockCollections['conversations'] = createMockCollection();

    await GET(makeRequest('/api/admin/feedback'));
    const findCall = msgCol.find.mock.calls[0][0];
    expect(findCall['feedback.rating']).toEqual({ $exists: true });
  });

  it('respects pagination parameters', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const msgCol = createMockCollection();
    const mockSkip = jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ skip: mockSkip }),
    });
    msgCol.countDocuments.mockResolvedValue(100);
    mockCollections['messages'] = msgCol;
    mockCollections['conversations'] = createMockCollection();

    const res = await GET(makeRequest('/api/admin/feedback?page=3&limit=10'));
    expect(mockSkip).toHaveBeenCalledWith(20); // (3-1)*10
    const body = await res.json();
    expect(body.data.pagination.page).toBe(3);
    expect(body.data.pagination.limit).toBe(10);
    expect(body.data.pagination.total).toBe(100);
    expect(body.data.pagination.total_pages).toBe(10);
  });
});
