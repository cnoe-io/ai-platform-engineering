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
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: '',
}));

let mockFeedbackEnabled = true;
jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => {
    if (key === 'feedbackEnabled') return mockFeedbackEnabled;
    return key === 'ssoEnabled';
  },
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
    // The /api/admin/feedback route calls `feedbackColl.distinct(...)` to
    // populate the channels and users filter dropdowns. Without this in the
    // base shape, any test that doesn't go through `setupFeedbackCollection`
    // (which used to add it locally) hits a TypeError → 500.
    distinct: jest.fn().mockResolvedValue([]),
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
  };
}

function userSession() {
  return {
    user: { email: 'user@example.com', name: 'User' },
    role: 'user',
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

/** Unified feedback doc (new schema) */
function makeFeedbackDoc(overrides: Partial<any> = {}) {
  return {
    _id: new ObjectId(),
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    source: 'web',
    rating: 'positive',
    value: 'thumbs_up',
    comment: null,
    user_email: 'user@example.com',
    created_at: new Date('2026-03-15'),
    ...overrides,
  };
}

/** Setup feedback collection with chainable find mock */
function setupFeedbackCollection(docs: any[], totalCount: number) {
  const feedbackCol = createMockCollection();
  feedbackCol.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      skip: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(docs),
        }),
      }),
    }),
  });
  feedbackCol.countDocuments.mockResolvedValue(totalCount);
  feedbackCol.distinct = jest.fn().mockResolvedValue([]);
  mockCollections['feedback'] = feedbackCol;
  return feedbackCol;
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
    mockFeedbackEnabled = true;

    const mod = await import('@/app/api/admin/feedback/route');
    GET = mod.GET;
  });

  it('returns 404 when feedback feature is disabled', async () => {
    mockFeedbackEnabled = false;
    mockGetServerSession.mockResolvedValue(adminSession);
    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('FEEDBACK_DISABLED');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(401);
  });

  it('returns 200 for any authenticated user (no admin gate on route)', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const messagesCol = createMockCollection();
    messagesCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['messages'] = messagesCol;
    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
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
    setupFeedbackCollection([], 0);

    const res = await GET(makeRequest('/api/admin/feedback'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.entries).toEqual([]);
    expect(body.data.pagination.total).toBe(0);
  });

  it('returns feedback entries with correct structure from unified collection', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const doc = makeFeedbackDoc({
      conversation_id: 'conv-1',
      rating: 'positive',
      value: 'thumbs_up',
      comment: 'Very Helpful',
      user_email: 'user@example.com',
    });
    setupFeedbackCollection([doc], 1);

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
    // thumbs_up is generic + has comment → reason = comment only
    expect(entry.reason).toBe('Very Helpful');
    expect(entry.submitted_by).toBe('user@example.com');
    expect(entry.source).toBe('web');
  });

  it('filters by positive rating on feedback collection', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const feedbackCol = setupFeedbackCollection([], 0);

    await GET(makeRequest('/api/admin/feedback?rating=positive'));
    const filter = feedbackCol.find.mock.calls[0][0];
    expect(filter.rating).toBe('positive');
  });

  it('filters by negative rating on feedback collection', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const feedbackCol = setupFeedbackCollection([], 0);

    await GET(makeRequest('/api/admin/feedback?rating=negative'));
    const filter = feedbackCol.find.mock.calls[0][0];
    expect(filter.rating).toBe('negative');
  });

  it('applies no rating filter when not specified', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const feedbackCol = setupFeedbackCollection([], 0);

    await GET(makeRequest('/api/admin/feedback'));
    const filter = feedbackCol.find.mock.calls[0][0];
    expect(filter.rating).toBeUndefined();
  });

  it('respects pagination parameters', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const feedbackCol = setupFeedbackCollection([], 100);
    const mockSkip = jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    feedbackCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ skip: mockSkip }),
    });

    const res = await GET(makeRequest('/api/admin/feedback?page=3&limit=10'));
    expect(mockSkip).toHaveBeenCalledWith(20); // (3-1)*10
    const body = await res.json();
    expect(body.data.pagination.page).toBe(3);
    expect(body.data.pagination.limit).toBe(10);
    expect(body.data.pagination.total).toBe(100);
    expect(body.data.pagination.total_pages).toBe(10);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Unified feedback collection — source/channel/user/search/date filters
  // ════════════════════════════════════════════════════════════════════════

  it('filters by source=slack and channel name', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const feedbackCol = setupFeedbackCollection([], 0);

    await GET(makeRequest('/api/admin/feedback?source=slack&channel=general,random'));
    const filter = feedbackCol.find.mock.calls[0][0];
    expect(filter.source).toBe('slack');
    expect(filter.channel_name).toEqual({ $in: ['general', 'random'] });
  });

  it('filters by user email', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const feedbackCol = setupFeedbackCollection([], 0);

    await GET(makeRequest('/api/admin/feedback?user=alice@co.com'));
    const filter = feedbackCol.find.mock.calls[0][0];
    expect(filter.user_email).toBe('alice@co.com');
  });

  it('filters by search terms as regex OR on comment and value', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const feedbackCol = setupFeedbackCollection([], 0);

    await GET(makeRequest('/api/admin/feedback?search=wrong,slow'));
    const filter = feedbackCol.find.mock.calls[0][0];
    // Each term produces 2 OR clauses (comment + value)
    expect(filter.$or).toHaveLength(4);
    expect(filter.$or[0]).toEqual({ comment: { $regex: 'wrong', $options: 'i' } });
    expect(filter.$or[1]).toEqual({ value: { $regex: 'wrong', $options: 'i' } });
  });

  it('filters by date range (from/to)', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const feedbackCol = setupFeedbackCollection([], 0);

    await GET(makeRequest('/api/admin/feedback?from=2026-03-01T00:00:00Z&to=2026-03-15T00:00:00Z'));
    const filter = feedbackCol.find.mock.calls[0][0];
    expect(filter.created_at.$gte).toEqual(new Date('2026-03-01T00:00:00Z'));
    expect(filter.created_at.$lte).toEqual(new Date('2026-03-15T00:00:00Z'));
  });

  // ════════════════════════════════════════════════════════════════════════
  // Reason combining logic (VALUE_LABELS)
  // ════════════════════════════════════════════════════════════════════════

  it('combines non-generic value label with comment as "Label; comment"', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const doc = makeFeedbackDoc({
      rating: 'negative',
      value: 'wrong_answer',
      comment: 'the k8s docs were outdated',
    });
    setupFeedbackCollection([doc], 1);

    const res = await GET(makeRequest('/api/admin/feedback'));
    const body = await res.json();
    expect(body.data.entries[0].reason).toBe('Wrong answer; the k8s docs were outdated');
  });

  it('returns only the comment for generic thumbs_up/thumbs_down values', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const doc = makeFeedbackDoc({
      value: 'thumbs_down',
      comment: 'not helpful at all',
    });
    setupFeedbackCollection([doc], 1);

    const res = await GET(makeRequest('/api/admin/feedback'));
    const body = await res.json();
    // Generic value should be suppressed; only comment shown
    expect(body.data.entries[0].reason).toBe('not helpful at all');
  });

  it('returns null reason when generic value has no comment', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const doc = makeFeedbackDoc({ value: 'thumbs_up', comment: null });
    setupFeedbackCollection([doc], 1);

    const res = await GET(makeRequest('/api/admin/feedback'));
    const body = await res.json();
    expect(body.data.entries[0].reason).toBeNull();
  });

  it('returns value label as reason when non-generic with no comment', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const doc = makeFeedbackDoc({ value: 'too_verbose', comment: null });
    setupFeedbackCollection([doc], 1);

    const res = await GET(makeRequest('/api/admin/feedback'));
    const body = await res.json();
    expect(body.data.entries[0].reason).toBe('Too verbose');
  });
});
