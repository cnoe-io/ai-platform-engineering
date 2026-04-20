/**
 * @jest-environment node
 */
/**
 * Tests for Admin Stats API Route
 *
 * Covers:
 * - GET /api/admin/stats — platform-wide usage statistics
 *
 * Features tested:
 * - Authentication: 401 when unauthenticated
 * - Authorization: 403 when non-admin (OIDC + MongoDB fallback)
 * - MongoDB guard: 503 when MongoDB is not configured
 * - Overview stats: total users, conversations, messages, DAU, MAU, shared,
 *   avg messages per conversation
 * - Daily activity: optimized 30-day aggregation (3 pipelines vs 90 queries)
 * - Top users by conversations: direct owner_id group
 * - Top users by messages: $lookup fallback for legacy messages without owner_id
 * - Top agents by usage
 * - Feedback summary: positive/negative counts
 * - Response time: avg/min/max latency_ms
 * - Hourly activity heatmap: all 24 hours, zero-filled
 * - Full response structure validation
 * - Edge case: empty database returns safe defaults
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
    distinct: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
  };
}

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

/**
 * Admin session via OIDC role — getAuthenticatedUser sees session.role === 'admin'
 * and skips the MongoDB fallback check entirely.
 */
function adminSession() {
  return {
    user: { email: 'admin@example.com', name: 'Admin User' },
    role: 'admin',
  };
}

/**
 * Regular user session — getAuthenticatedUser will check MongoDB users
 * collection for metadata.role === 'admin' as a fallback.
 */
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

/**
 * Setup admin session with properly configured mock collections.
 * The admin route calls getCollection('users'), getCollection('conversations'),
 * getCollection('messages'), getCollection('feedback'), and optionally
 * getCollection('platform_config'). The auth middleware also calls
 * getCollection('users') for the MongoDB admin fallback (skipped for OIDC admins).
 */
function setupAdminWithCollections() {
  mockGetServerSession.mockResolvedValue(adminSession());

  // Users collection — no findOne needed for OIDC admin (session.role = 'admin')
  const usersCol = createMockCollection();
  usersCol.countDocuments.mockResolvedValue(0);
  mockCollections['users'] = usersCol;

  const convCol = createMockCollection();
  convCol.countDocuments.mockResolvedValue(0);
  mockCollections['conversations'] = convCol;

  const msgCol = createMockCollection();
  msgCol.countDocuments.mockResolvedValue(0);
  mockCollections['messages'] = msgCol;

  const feedbackCol = createMockCollection();
  feedbackCol.countDocuments.mockResolvedValue(0);
  mockCollections['feedback'] = feedbackCol;

  const platformConfigCol = createMockCollection();
  mockCollections['platform_config'] = platformConfigCol;

  return { usersCol, convCol, msgCol, feedbackCol };
}

// ============================================================================
// Test imports (after mocks)
// ============================================================================

import { GET } from '../admin/stats/route';

// ============================================================================
// Tests: Authentication & Authorization
// ============================================================================

describe('GET /api/admin/stats — Authentication & Authorization', () => {
  beforeEach(resetMocks);

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks admin view group', async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Admin view access required');
  });

  it('allows non-admin users with view access to read stats (readonly)', async () => {
    mockGetServerSession.mockResolvedValue({ ...userSession(), canViewAdmin: true });

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    usersCol.countDocuments.mockResolvedValue(5);
    usersCol.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.countDocuments.mockResolvedValue(10);
    convCol.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(50);
    msgCol.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    mockCollections['messages'] = msgCol;

    const feedbackCol = createMockCollection();
    feedbackCol.countDocuments.mockResolvedValue(0);
    mockCollections['feedback'] = feedbackCol;
    mockCollections['platform_config'] = createMockCollection();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('grants access when user is admin via MongoDB fallback', async () => {
    // Session says 'user' but MongoDB has admin role
    mockGetServerSession.mockResolvedValue(userSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue({
      email: 'user@example.com',
      metadata: { role: 'admin' },
    });
    usersCol.countDocuments.mockResolvedValue(5);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.countDocuments.mockResolvedValue(10);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(50);
    mockCollections['messages'] = msgCol;

    const feedbackCol = createMockCollection();
    feedbackCol.countDocuments.mockResolvedValue(0);
    mockCollections['feedback'] = feedbackCol;
    mockCollections['platform_config'] = createMockCollection();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('returns 503 when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });
});

// ============================================================================
// Tests: Overview Statistics
// ============================================================================

describe('GET /api/admin/stats — Overview', () => {
  beforeEach(resetMocks);

  it('returns overview with correct counts', async () => {
    const { usersCol, convCol, msgCol } = setupAdminWithCollections();

    // Promise.all order (no filters):
    // users: totalUsers, dau, mau
    // conversations: totalConversations, conversationsToday, sharedConversations
    // messages: webTotalMessages, slackTotalMessages, webMessagesToday, slackMessagesToday
    usersCol.countDocuments
      .mockResolvedValueOnce(15)   // totalUsers
      .mockResolvedValueOnce(3)    // dau
      .mockResolvedValueOnce(10);  // mau

    convCol.countDocuments
      .mockResolvedValueOnce(50)   // totalConversations
      .mockResolvedValueOnce(5)    // conversationsToday
      .mockResolvedValueOnce(2);   // sharedConversations

    msgCol.countDocuments
      .mockResolvedValueOnce(180)  // webTotalMessages
      .mockResolvedValueOnce(20)   // slackTotalMessages
      .mockResolvedValueOnce(15)   // webMessagesToday
      .mockResolvedValueOnce(5);   // slackMessagesToday

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.overview).toEqual(
      expect.objectContaining({
        total_users: 15,
        total_conversations: 50,
        total_messages: 200,        // 180 web + 20 slack
        dau: 3,
        mau: 10,
        conversations_today: 5,
        messages_today: 20,         // 15 web + 5 slack
        shared_conversations: 2,
      })
    );
  });

  it('computes avg_messages_per_conversation correctly', async () => {
    const { usersCol, convCol, msgCol } = setupAdminWithCollections();

    usersCol.countDocuments.mockResolvedValue(5);
    convCol.countDocuments
      .mockResolvedValueOnce(4)   // totalConversations
      .mockResolvedValueOnce(0)   // conversationsToday
      .mockResolvedValueOnce(0);  // sharedConversations
    msgCol.countDocuments
      .mockResolvedValueOnce(8)   // webTotalMessages
      .mockResolvedValueOnce(2)   // slackTotalMessages
      .mockResolvedValueOnce(0)   // webMessagesToday
      .mockResolvedValueOnce(0);  // slackMessagesToday

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    // (8 + 2) / 4 = 2.5
    expect(body.data.overview.avg_messages_per_conversation).toBe(2.5);
  });

  it('returns avg_messages_per_conversation = 0 when no conversations', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.overview.avg_messages_per_conversation).toBe(0);
  });
});

// ============================================================================
// Tests: Daily Activity (30-day aggregation)
// ============================================================================

describe('GET /api/admin/stats — Daily Activity', () => {
  beforeEach(resetMocks);

  it('returns 30 days of daily activity', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.daily_activity).toHaveLength(30);
  });

  it('each day has correct structure', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    for (const day of body.data.daily_activity) {
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('active_users');
      expect(day).toHaveProperty('conversations');
      expect(day).toHaveProperty('messages');
      expect(typeof day.date).toBe('string');
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof day.active_users).toBe('number');
      expect(typeof day.conversations).toBe('number');
      expect(typeof day.messages).toBe('number');
    }
  });

  it('fills missing days with zeros', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    // With empty aggregation results, all days should be 0
    for (const day of body.data.daily_activity) {
      expect(day.active_users).toBe(0);
      expect(day.conversations).toBe(0);
      expect(day.messages).toBe(0);
    }
  });

  it('uses aggregate instead of 90 individual countDocuments queries', async () => {
    const { usersCol, convCol, msgCol } = setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    await GET(req);

    // Each collection should have aggregate called (for daily activity)
    expect(usersCol.aggregate).toHaveBeenCalled();
    expect(convCol.aggregate).toHaveBeenCalled();
    expect(msgCol.aggregate).toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: Top Users (the $lookup fix for messages)
// ============================================================================

describe('GET /api/admin/stats — Top Users', () => {
  beforeEach(resetMocks);

  it('includes both by_conversations and by_messages in response', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.top_users).toHaveProperty('by_conversations');
    expect(body.data.top_users).toHaveProperty('by_messages');
    expect(Array.isArray(body.data.top_users.by_conversations)).toBe(true);
    expect(Array.isArray(body.data.top_users.by_messages)).toBe(true);
  });

  it('top users by messages uses $lookup through conversations', async () => {
    const { msgCol } = setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    await GET(req);

    // Verify at least one aggregate call on messages uses $lookup from conversations
    const aggregateCalls = msgCol.aggregate.mock.calls;
    const hasLookupPipeline = aggregateCalls.some((call: any[]) => {
      const pipeline = call[0];
      return (
        Array.isArray(pipeline) &&
        pipeline.some(
          (stage: Record<string, any>) =>
            stage.$lookup && stage.$lookup.from === 'conversations'
        )
      );
    });
    expect(hasLookupPipeline).toBe(true);
  });

  it('top users by messages pipeline uses $ifNull for backward compat', async () => {
    const { msgCol } = setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    await GET(req);

    // The pipeline should include $addFields with $ifNull to coalesce owner_id
    const aggregateCalls = msgCol.aggregate.mock.calls;
    const hasIfNull = aggregateCalls.some((call: any[]) => {
      const pipeline = call[0];
      return (
        Array.isArray(pipeline) &&
        pipeline.some(
          (stage: Record<string, any>) =>
            stage.$addFields && stage.$addFields._owner?.$ifNull
        )
      );
    });
    expect(hasIfNull).toBe(true);
  });

  it('returns empty arrays when no data exists', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.top_users.by_conversations).toEqual([]);
    expect(body.data.top_users.by_messages).toEqual([]);
  });
});

// ============================================================================
// Tests: Enhanced Analytics — top agents, feedback, response time, heatmap
// ============================================================================

describe('GET /api/admin/stats — Top Agents', () => {
  beforeEach(resetMocks);

  it('queries assistant messages with metadata.agent_name', async () => {
    const { msgCol } = setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    await GET(req);

    // Find the aggregate call that matches on role=assistant and agent_name
    const aggregateCalls = msgCol.aggregate.mock.calls;
    const hasAgentPipeline = aggregateCalls.some((call: any[]) => {
      const pipeline = call[0];
      return (
        Array.isArray(pipeline) &&
        pipeline.some(
          (stage: Record<string, any>) =>
            stage.$match?.role === 'assistant' &&
            stage.$match?.['metadata.agent_name']?.$exists === true
        )
      );
    });
    expect(hasAgentPipeline).toBe(true);
  });

  it('returns top_agents as an array', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(Array.isArray(body.data.top_agents)).toBe(true);
  });
});

describe('GET /api/admin/stats — Feedback Summary', () => {
  beforeEach(resetMocks);

  it('returns feedback_summary with positive, negative, total', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.feedback_summary).toHaveProperty('positive');
    expect(body.data.feedback_summary).toHaveProperty('negative');
    expect(body.data.feedback_summary).toHaveProperty('total');
    expect(typeof body.data.feedback_summary.positive).toBe('number');
    expect(typeof body.data.feedback_summary.negative).toBe('number');
    expect(typeof body.data.feedback_summary.total).toBe('number');
  });

  it('returns zeros when no feedback exists', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.feedback_summary).toEqual(
      expect.objectContaining({
        positive: 0,
        negative: 0,
        total: 0,
      })
    );
  });

  it('returns enhanced feedback with by_source and categories from unified feedback collection', async () => {
    const { usersCol, convCol, msgCol } = setupAdminWithCollections();
    usersCol.countDocuments.mockResolvedValue(1);
    convCol.countDocuments.mockResolvedValue(0);
    msgCol.countDocuments.mockResolvedValue(0);

    // Set up feedback collection with data
    const feedbackCol = createMockCollection();
    feedbackCol.countDocuments.mockResolvedValue(10); // non-zero triggers unified path
    feedbackCol.aggregate.mockReturnValue({
      toArray: jest.fn()
        .mockResolvedValueOnce([  // fbOverall
          { _id: 'positive', count: 7 },
          { _id: 'negative', count: 3 },
        ])
        .mockResolvedValueOnce([  // fbBySource
          { _id: { source: 'web', rating: 'positive' }, count: 5 },
          { _id: { source: 'web', rating: 'negative' }, count: 1 },
          { _id: { source: 'slack', rating: 'positive' }, count: 2 },
          { _id: { source: 'slack', rating: 'negative' }, count: 2 },
        ])
        .mockResolvedValueOnce([  // fbCategories
          { _id: 'wrong_answer', count: 2 },
          { _id: 'too_verbose', count: 1 },
        ])
        .mockResolvedValueOnce([  // fbDaily
        ]),
    });
    mockCollections['feedback'] = feedbackCol;

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    const fb = body.data.feedback_summary;
    expect(fb.positive).toBe(7);
    expect(fb.negative).toBe(3);
    expect(fb.total).toBe(10);
    expect(fb.satisfaction_rate).toBe(70);
    expect(fb.by_source.web).toEqual({ positive: 5, negative: 1 });
    expect(fb.by_source.slack).toEqual({ positive: 2, negative: 2 });
    expect(fb.categories).toEqual([
      { category: 'wrong_answer', count: 2 },
      { category: 'too_verbose', count: 1 },
    ]);
  });
});

describe('GET /api/admin/stats — Response Time', () => {
  beforeEach(resetMocks);

  it('returns response_time with avg/min/max/sample_count', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.response_time).toHaveProperty('avg_ms');
    expect(body.data.response_time).toHaveProperty('min_ms');
    expect(body.data.response_time).toHaveProperty('max_ms');
    expect(body.data.response_time).toHaveProperty('sample_count');
  });

  it('returns zeros when no latency data exists', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.response_time).toEqual({
      avg_ms: 0,
      min_ms: 0,
      max_ms: 0,
      sample_count: 0,
    });
  });
});

describe('GET /api/admin/stats — Hourly Heatmap', () => {
  beforeEach(resetMocks);

  it('returns exactly 24 hour entries', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.hourly_heatmap).toHaveLength(24);
  });

  it('every hour has { hour, count } structure', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    for (let h = 0; h < 24; h++) {
      expect(body.data.hourly_heatmap[h]).toEqual({
        hour: h,
        count: expect.any(Number),
      });
    }
  });

  it('fills missing hours with 0', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    // All aggregate calls return [] by default → every hour = 0
    for (const entry of body.data.hourly_heatmap) {
      expect(entry.count).toBe(0);
    }
  });
});

// ============================================================================
// Tests: Complete response shape
// ============================================================================

describe('GET /api/admin/stats — Full Response Shape', () => {
  beforeEach(resetMocks);

  it('returns all expected top-level keys', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data).toHaveProperty('overview');
    expect(body.data).toHaveProperty('daily_activity');
    expect(body.data).toHaveProperty('top_users');
    expect(body.data).toHaveProperty('top_agents');
    expect(body.data).toHaveProperty('feedback_summary');
    expect(body.data).toHaveProperty('response_time');
    expect(body.data).toHaveProperty('hourly_heatmap');
    expect(body.data).toHaveProperty('platform_summary');
    expect(body.data).toHaveProperty('completed_workflows');
  });

  it('overview has all required sub-fields', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    const overview = body.data.overview;
    expect(overview).toHaveProperty('total_users');
    expect(overview).toHaveProperty('total_conversations');
    expect(overview).toHaveProperty('total_messages');
    expect(overview).toHaveProperty('shared_conversations');
    expect(overview).toHaveProperty('dau');
    expect(overview).toHaveProperty('mau');
    expect(overview).toHaveProperty('conversations_today');
    expect(overview).toHaveProperty('messages_today');
    expect(overview).toHaveProperty('avg_messages_per_conversation');
  });
});

// ============================================================================
// Tests: parseRange — from/to support and sub-day presets
// ============================================================================

describe('GET /api/admin/stats — Custom Date Range (from/to)', () => {
  beforeEach(resetMocks);

  it('uses from/to ISO dates to compute the range instead of preset', async () => {
    setupAdminWithCollections();

    // 10-day custom range
    const from = '2026-03-01T00:00:00.000Z';
    const to = '2026-03-11T00:00:00.000Z';
    const req = makeRequest(`/api/admin/stats?from=${from}&to=${to}`);
    const res = await GET(req);
    const body = await res.json();

    // daily_activity length should be 10 days
    expect(body.data.daily_activity).toHaveLength(10);
    expect(body.data.days).toBe(10);
  });

  it('supports sub-day presets like 1h and 12h (clamped to minimum 1 day of activity)', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats?range=1h');
    const res = await GET(req);
    const body = await res.json();

    // 1h = 1 day minimum for daily_activity
    expect(body.data.daily_activity).toHaveLength(1);
    expect(body.data.days).toBe(1);
  });
});

// ============================================================================
// Tests: Platform Summary
// ============================================================================

describe('GET /api/admin/stats — Platform Summary', () => {
  beforeEach(resetMocks);

  it('includes platform_summary with questions, users, satisfaction, hours', async () => {
    setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.platform_summary).toBeDefined();
    expect(body.data.platform_summary).toHaveProperty('satisfaction_rate');
    expect(body.data.platform_summary).toHaveProperty('estimated_hours_automated');
    expect(typeof body.data.platform_summary.satisfaction_rate).toBe('number');
  });
});

// ============================================================================
// Tests: Source/User Filtering
// ============================================================================

describe('GET /api/admin/stats — Source & User Filters', () => {
  beforeEach(resetMocks);

  it('applies source=slack filter to conversation queries', async () => {
    const { convCol } = setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats?source=slack');
    await GET(req);

    // When source=slack, conversations should be filtered with source: 'slack'
    const convCountCalls = convCol.countDocuments.mock.calls;
    const hasSlackFilter = convCountCalls.some(
      (call: any[]) => call[0]?.source === 'slack'
    );
    expect(hasSlackFilter).toBe(true);

    // Web messages should be skipped (resolved to 0) — check that messages
    // countDocuments was called fewer times or with different filters
    // When source=slack, web message counts resolve to 0 without querying
  });

  it('applies user filter to owner_id on conversation and message queries', async () => {
    const { convCol } = setupAdminWithCollections();

    const req = makeRequest('/api/admin/stats?user=alice@co.com,bob@co.com');
    await GET(req);

    // Conversations should include owner_id filter
    const convCountCalls = convCol.countDocuments.mock.calls;
    const hasUserFilter = convCountCalls.some(
      (call: any[]) => call[0]?.owner_id?.$in?.includes('alice@co.com')
    );
    expect(hasUserFilter).toBe(true);
  });
});
