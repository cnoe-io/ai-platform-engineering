/**
 * @jest-environment node
 */
/**
 * Tests for User Insights API Route
 *
 * Covers:
 * - GET /api/users/me/insights — personal prompt insights and usage analytics
 *
 * Features tested:
 * - Authentication: 401 when unauthenticated
 * - Overview stats: total conversations, messages, tokens, weekly activity,
 *   avg messages per conversation
 * - Skill usage: aggregated workflow_runs by category
 * - Recent prompts (backward compat): still returned alongside skill_usage
 * - Daily usage: 30-day breakdown with prompts vs responses
 * - Prompt patterns: avg/max length, peak hour, peak day of week
 * - Favorite agents: top 10 by agent_name
 * - Feedback given: positive/negative counts
 * - Edge case: user with no data returns safe defaults
 * - Data scoping: only returns data for the authenticated user's conversations
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
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
        toArray: jest.fn().mockResolvedValue([]),
      }),
      project: jest.fn().mockReturnValue({
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

function authenticatedSession(email = 'user@example.com') {
  return {
    user: { email, name: 'Test User' },
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

import { GET } from '../users/me/insights/route';

// ============================================================================
// Tests: Authentication
// ============================================================================

describe('GET /api/users/me/insights — Auth', () => {
  beforeEach(resetMocks);

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 for any authenticated user (no admin required)', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    // Auth middleware fallback check
    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    // Conversations for user — returns empty
    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    // Messages
    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Tests: MongoDB guard
// ============================================================================

describe('GET /api/users/me/insights — MongoDB Guard', () => {
  beforeEach(resetMocks);

  it('returns 503 when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
    expect(body.error).toMatch(/MongoDB not configured/i);
  });

  it('does not call getCollection when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const req = makeRequest('/api/users/me/insights');
    await GET(req);
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it('proceeds normally when MongoDB is configured', async () => {
    mockIsMongoDBConfigured = true;
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Tests: Overview stats
// ============================================================================

describe('GET /api/users/me/insights — Overview', () => {
  beforeEach(resetMocks);

  function setupUserWithConversations(email = 'user@example.com') {
    mockGetServerSession.mockResolvedValue(authenticatedSession(email));

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    const convIds = ['conv-1', 'conv-2', 'conv-3'];
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(
          convIds.map((id) => ({
            _id: id,
            title: `Conversation ${id}`,
            created_at: new Date(),
          }))
        ),
      }),
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    return { convCol, msgCol, convIds };
  }

  it('returns overview with correct fields', async () => {
    const { convCol, msgCol } = setupUserWithConversations();

    // totalConversations=3, totalMessages=45, convThisWeek=1, msgsThisWeek=10
    convCol.countDocuments
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    msgCol.countDocuments
      .mockResolvedValueOnce(45)
      .mockResolvedValueOnce(10);

    // Token aggregation
    msgCol.aggregate.mockImplementation((pipeline: any[]) => {
      // Tokens pipeline: $group with total_tokens
      const hasTokenGroup = pipeline.some(
        (stage: Record<string, any>) => stage.$group?.total_tokens
      );
      if (hasTokenGroup) {
        return {
          toArray: jest.fn().mockResolvedValue([
            { _id: null, total_tokens: 15000 },
          ]),
        };
      }
      return { toArray: jest.fn().mockResolvedValue([]) };
    });

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.overview.total_conversations).toBe(3);
    expect(body.data.overview.total_messages).toBe(45);
    expect(body.data.overview.total_tokens_used).toBe(15000);
    expect(body.data.overview.conversations_this_week).toBe(1);
    expect(body.data.overview.messages_this_week).toBe(10);
  });

  it('returns 0 tokens when no messages have token metadata', async () => {
    const { convCol, msgCol } = setupUserWithConversations();

    convCol.countDocuments.mockResolvedValue(0);
    msgCol.countDocuments.mockResolvedValue(0);

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.overview.total_tokens_used).toBe(0);
  });
});

// ============================================================================
// Tests: Skill usage
// ============================================================================

describe('GET /api/users/me/insights — Skill Usage', () => {
  beforeEach(resetMocks);

  function setupMinimalWithWorkflowRuns(
    workflowRunsAgg: any[] = [],
  ) {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    // workflow_runs collection
    const wfCol = createMockCollection();
    wfCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue(workflowRunsAgg),
    });
    mockCollections['workflow_runs'] = wfCol;

    return { convCol, msgCol, wfCol };
  }

  it('returns skill_usage with category breakdown', async () => {
    setupMinimalWithWorkflowRuns([
      { _id: 'AWS Operations', total_runs: 10, completed: 8, failed: 2, last_run: new Date() },
      { _id: 'GitHub Operations', total_runs: 5, completed: 5, failed: 0, last_run: new Date() },
    ]);

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.skill_usage).toHaveLength(2);
    expect(body.data.skill_usage[0].category).toBe('AWS Operations');
    expect(body.data.skill_usage[0].total_runs).toBe(10);
    expect(body.data.skill_usage[0].completed).toBe(8);
    expect(body.data.skill_usage[0].failed).toBe(2);
    expect(body.data.skill_usage[1].category).toBe('GitHub Operations');
    expect(body.data.skill_usage[1].total_runs).toBe(5);
  });

  it('returns empty array when no workflow runs exist', async () => {
    setupMinimalWithWorkflowRuns([]);

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.skill_usage).toEqual([]);
  });

  it('returns empty skill_usage gracefully if workflow_runs collection errors', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    // Simulate getCollection throwing for workflow_runs
    mockGetCollection.mockImplementation((name: string) => {
      if (name === 'workflow_runs') {
        throw new Error('Collection does not exist');
      }
      if (!mockCollections[name]) {
        mockCollections[name] = createMockCollection();
      }
      return Promise.resolve(mockCollections[name]);
    });

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    // Should succeed with empty skill_usage
    expect(res.status).toBe(200);
    expect(body.data.skill_usage).toEqual([]);
  });
});

// ============================================================================
// Tests: Recent prompts (backward compatibility — deprecated field)
// ============================================================================

describe('GET /api/users/me/insights — Recent Prompts (backward compat)', () => {
  beforeEach(resetMocks);

  it('still returns recent_prompts alongside skill_usage for backward compatibility', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: 'conv-1', title: 'K8s Debugging', created_at: new Date() },
        ]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(1);
    mockCollections['conversations'] = convCol;

    const now = new Date();
    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(5);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([
              {
                content: 'Why is my pod in CrashLoopBackOff?',
                conversation_id: 'conv-1',
                created_at: now,
              },
            ]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    // Both fields present
    expect(body.data).toHaveProperty('skill_usage');
    expect(body.data).toHaveProperty('recent_prompts');

    // recent_prompts has correct shape
    expect(body.data.recent_prompts).toHaveLength(1);
    expect(body.data.recent_prompts[0].content).toBe('Why is my pod in CrashLoopBackOff?');
    expect(body.data.recent_prompts[0].conversation_title).toBe('K8s Debugging');
    expect(body.data.recent_prompts[0]).toHaveProperty('timestamp');
    expect(body.data.recent_prompts[0]).toHaveProperty('content_length');
    expect(body.data.recent_prompts[0]).toHaveProperty('conversation_id');
  });

  it('truncates prompt content to 300 characters', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: 'conv-1', title: 'Long Prompt Test', created_at: new Date() },
        ]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(1);
    mockCollections['conversations'] = convCol;

    const longContent = 'A'.repeat(500);
    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(1);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([
              { content: longContent, conversation_id: 'conv-1', created_at: new Date() },
            ]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.recent_prompts[0].content).toHaveLength(300);
    expect(body.data.recent_prompts[0].content_length).toBe(500);
  });

  it('returns empty recent_prompts array when user has no prompts', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.recent_prompts).toEqual([]);
  });
});

// ============================================================================
// Tests: Daily usage
// ============================================================================

describe('GET /api/users/me/insights — Daily Usage', () => {
  beforeEach(resetMocks);

  function setupMinimal() {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    return { convCol, msgCol };
  }

  it('returns 30 days of usage data', async () => {
    setupMinimal();

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.daily_usage).toHaveLength(30);
  });

  it('each day has prompts and responses fields', async () => {
    setupMinimal();

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    for (const day of body.data.daily_usage) {
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('prompts');
      expect(day).toHaveProperty('responses');
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof day.prompts).toBe('number');
      expect(typeof day.responses).toBe('number');
    }
  });

  it('fills inactive days with 0', async () => {
    setupMinimal();

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    for (const day of body.data.daily_usage) {
      expect(day.prompts).toBe(0);
      expect(day.responses).toBe(0);
    }
  });
});

// ============================================================================
// Tests: Prompt patterns
// ============================================================================

describe('GET /api/users/me/insights — Prompt Patterns', () => {
  beforeEach(resetMocks);

  function setupMinimal() {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    return { msgCol };
  }

  it('returns prompt_patterns with all fields', async () => {
    setupMinimal();

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.prompt_patterns).toHaveProperty('avg_length');
    expect(body.data.prompt_patterns).toHaveProperty('max_length');
    expect(body.data.prompt_patterns).toHaveProperty('total_prompts');
    expect(body.data.prompt_patterns).toHaveProperty('peak_hour');
    expect(body.data.prompt_patterns).toHaveProperty('peak_hour_label');
    expect(body.data.prompt_patterns).toHaveProperty('peak_day');
  });

  it('returns safe defaults when no prompt data exists', async () => {
    setupMinimal();

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.prompt_patterns.avg_length).toBe(0);
    expect(body.data.prompt_patterns.max_length).toBe(0);
    expect(body.data.prompt_patterns.total_prompts).toBe(0);
    expect(body.data.prompt_patterns.peak_hour).toBeNull();
    expect(body.data.prompt_patterns.peak_hour_label).toBe('N/A');
    expect(body.data.prompt_patterns.peak_day).toBe('N/A');
  });
});

// ============================================================================
// Tests: Favorite agents
// ============================================================================

describe('GET /api/users/me/insights — Favorite Agents', () => {
  beforeEach(resetMocks);

  it('returns empty array when no agent data exists', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.favorite_agents).toEqual([]);
  });
});

// ============================================================================
// Tests: Feedback given
// ============================================================================

describe('GET /api/users/me/insights — Feedback', () => {
  beforeEach(resetMocks);

  it('returns feedback_given with positive, negative, total', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.feedback_given).toEqual({
      positive: 0,
      negative: 0,
      total: 0,
    });
  });
});

// ============================================================================
// Tests: Full response shape
// ============================================================================

describe('GET /api/users/me/insights — Response Shape', () => {
  beforeEach(resetMocks);

  it('returns all expected top-level keys', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    const res = await GET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('overview');
    expect(body.data).toHaveProperty('skill_usage');
    // Backward compat: recent_prompts still present
    expect(body.data).toHaveProperty('recent_prompts');
    expect(body.data).toHaveProperty('daily_usage');
    expect(body.data).toHaveProperty('prompt_patterns');
    expect(body.data).toHaveProperty('favorite_agents');
    expect(body.data).toHaveProperty('feedback_given');

    // overview sub-fields
    expect(body.data.overview).toHaveProperty('total_conversations');
    expect(body.data.overview).toHaveProperty('total_messages');
    expect(body.data.overview).toHaveProperty('total_tokens_used');
    expect(body.data.overview).toHaveProperty('conversations_this_week');
    expect(body.data.overview).toHaveProperty('messages_this_week');
    expect(body.data.overview).toHaveProperty('avg_messages_per_conversation');
  });

  it('scopes all data to the authenticated user only', async () => {
    mockGetServerSession.mockResolvedValue(authenticatedSession('alice@example.com'));

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const convCol = createMockCollection();
    convCol.find.mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    convCol.countDocuments.mockResolvedValue(0);
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const req = makeRequest('/api/users/me/insights');
    await GET(req);

    // Verify conversations.find was called with owner_id filter
    expect(convCol.find).toHaveBeenCalled();
    const findArg = convCol.find.mock.calls[0][0];
    expect(findArg).toEqual({ owner_id: 'alice@example.com' });

    // Verify countDocuments was called with owner_id filter
    expect(convCol.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: 'alice@example.com' })
    );
  });
});
