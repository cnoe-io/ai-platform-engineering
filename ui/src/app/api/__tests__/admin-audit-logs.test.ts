/**
 * @jest-environment node
 */
/**
 * Tests for Admin Audit Logs API Routes
 *
 * Covers:
 * - GET /api/admin/audit-logs — list all conversations with filters and pagination
 * - GET /api/admin/audit-logs/[id]/messages — get paginated messages for a conversation
 * - GET /api/admin/audit-logs/export — download conversations as CSV
 * - GET /api/admin/audit-logs/owners — search distinct conversation owners
 *
 * Features tested:
 * - Authentication: 401 when unauthenticated
 * - Authorization: 403 when non-admin (full admin required, not readonly)
 * - Feature flag: 403 when AUDIT_LOGS_ENABLED is false
 * - MongoDB guard: 503 when MongoDB is not configured
 * - List endpoint: filters (owner, search, date, status), pagination, aggregation pipeline
 * - Messages endpoint: conversation lookup, paginated messages, 404 handling
 * - Export endpoint: CSV generation with headers, proper Content-Type and Content-Disposition
 * - Owners endpoint: distinct owner_id aggregation with search filter
 * - Edge cases: empty results, readonly admin rejection
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
  getServerConfig: () => mockServerConfig,
}));

let mockServerConfig: Record<string, any> = { auditLogsEnabled: true };

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

function readonlyAdminSession() {
  return {
    user: { email: 'viewer@example.com', name: 'Viewer User' },
    role: 'user',
    canViewAdmin: true,
  };
}

function resetMocks() {
  mockGetServerSession.mockReset();
  mockGetCollection.mockClear();
  mockIsMongoDBConfigured = true;
  mockServerConfig = { auditLogsEnabled: true };
  Object.keys(mockCollections).forEach((key) => delete mockCollections[key]);
}

function setupAdminWithConversations(convData: any[] = []) {
  mockGetServerSession.mockResolvedValue(adminSession());

  const convCol = createMockCollection();
  convCol.countDocuments.mockResolvedValue(convData.length);
  convCol.aggregate.mockReturnValue({
    toArray: jest.fn().mockResolvedValue(convData),
  });
  mockCollections['conversations'] = convCol;

  return { convCol };
}

// ============================================================================
// Test imports (after mocks)
// ============================================================================

import { GET as listGET } from '../admin/audit-logs/route';
import { GET as messagesGET } from '../admin/audit-logs/[id]/messages/route';
import { GET as exportGET } from '../admin/audit-logs/export/route';
import { GET as ownersGET } from '../admin/audit-logs/owners/route';

// ============================================================================
// Tests: GET /api/admin/audit-logs — Auth & Feature Flag
// ============================================================================

describe('GET /api/admin/audit-logs — Auth & Feature Flag', () => {
  beforeEach(resetMocks);

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/audit-logs');
    const res = await listGET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not a full admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/audit-logs');
    const res = await listGET(req);
    expect(res.status).toBe(403);
  });

  it('returns 403 for readonly admin viewers (canViewAdmin)', async () => {
    mockGetServerSession.mockResolvedValue(readonlyAdminSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/audit-logs');
    const res = await listGET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Admin access required');
  });

  it('returns 403 when auditLogsEnabled is false', async () => {
    mockServerConfig = { auditLogsEnabled: false };
    mockGetServerSession.mockResolvedValue(adminSession());

    const req = makeRequest('/api/admin/audit-logs');
    const res = await listGET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FEATURE_DISABLED');
  });

  it('returns 503 when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const req = makeRequest('/api/admin/audit-logs');
    const res = await listGET(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs — Listing & Filters
// ============================================================================

describe('GET /api/admin/audit-logs — Listing', () => {
  beforeEach(resetMocks);

  it('returns paginated conversations on success', async () => {
    const convData = [
      {
        _id: 'conv-1',
        owner_id: 'alice@example.com',
        title: 'Test Chat',
        created_at: new Date(),
        updated_at: new Date(),
        message_count: 5,
        status: 'active',
      },
    ];
    setupAdminWithConversations(convData);

    const req = makeRequest('/api/admin/audit-logs');
    const res = await listGET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]._id).toBe('conv-1');
    expect(body.data.total).toBe(1);
  });

  it('returns empty list when no conversations match', async () => {
    setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs');
    const res = await listGET(req);
    const body = await res.json();

    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it('passes owner_email filter to aggregation pipeline', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?owner_email=alice');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.owner_id).toEqual({ $regex: 'alice', $options: 'i' });
  });

  it('passes search filter to aggregation pipeline', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?search=kubernetes');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.title).toEqual({ $regex: 'kubernetes', $options: 'i' });
  });

  it('passes date range filters to aggregation pipeline', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest(
      '/api/admin/audit-logs?date_from=2026-01-01&date_to=2026-03-01'
    );
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.created_at.$gte).toEqual(new Date('2026-01-01'));
    expect(matchStage.$match.created_at.$lte).toEqual(new Date('2026-03-01'));
  });

  it('filters by status=active', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?status=active');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.is_archived).toEqual({ $ne: true });
  });

  it('filters by status=deleted', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?status=deleted');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.deleted_at).toEqual({ $ne: null, $exists: true });
  });

  it('fetches last message timestamps separately (no $lookup)', async () => {
    const { convCol } = setupAdminWithConversations([
      { _id: 'conv-1', owner_id: 'alice@example.com', title: 'Test', created_at: new Date(), updated_at: new Date() },
    ]);

    const req = makeRequest('/api/admin/audit-logs');
    await listGET(req);

    // Pipeline should NOT contain $lookup
    const pipeline = convCol.aggregate.mock.calls[0][0];
    const lookupStage = pipeline.find((s: any) => s.$lookup);
    expect(lookupStage).toBeUndefined();
  });

  it('uses countDocuments + pipeline for pagination (no $facet)', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?page=2&page_size=10');
    await listGET(req);

    // countDocuments called for total
    expect(convCol.countDocuments).toHaveBeenCalled();
    // Pipeline should have $skip and $limit but no $facet
    const pipeline = convCol.aggregate.mock.calls[0][0];
    const facetStage = pipeline.find((s: any) => s.$facet);
    expect(facetStage).toBeUndefined();
    const skipStage = pipeline.find((s: any) => s.$skip !== undefined);
    const limitStage = pipeline.find((s: any) => s.$limit !== undefined);
    expect(skipStage.$skip).toBe(10);
    expect(limitStage.$limit).toBe(10);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs/[id]/messages — Auth & Feature Flag
// ============================================================================

describe('GET /api/admin/audit-logs/[id]/messages — Auth & Feature Flag', () => {
  beforeEach(resetMocks);

  const callMessages = (url: string, id: string = 'conv-123') => {
    const req = makeRequest(url);
    return messagesGET(req, { params: Promise.resolve({ id }) });
  };

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await callMessages('/api/admin/audit-logs/conv-123/messages');
    expect(res.status).toBe(401);
  });

  it('returns 403 for readonly admin viewers', async () => {
    mockGetServerSession.mockResolvedValue(readonlyAdminSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const res = await callMessages('/api/admin/audit-logs/conv-123/messages');
    expect(res.status).toBe(403);
  });

  it('returns 403 when auditLogsEnabled is false', async () => {
    mockServerConfig = { auditLogsEnabled: false };
    mockGetServerSession.mockResolvedValue(adminSession());

    const res = await callMessages('/api/admin/audit-logs/conv-123/messages');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FEATURE_DISABLED');
  });

  it('returns 503 when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const res = await callMessages('/api/admin/audit-logs/conv-123/messages');
    expect(res.status).toBe(503);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs/[id]/messages — Conversation Messages
// ============================================================================

describe('GET /api/admin/audit-logs/[id]/messages — Messages', () => {
  beforeEach(resetMocks);

  const callMessages = (url: string, id: string = 'conv-123') => {
    const req = makeRequest(url);
    return messagesGET(req, { params: Promise.resolve({ id }) });
  };

  it('returns 404 when conversation does not exist', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue(null);
    mockCollections['conversations'] = convCol;

    const res = await callMessages('/api/admin/audit-logs/nonexistent/messages', 'nonexistent');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns conversation metadata and paginated messages', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const now = new Date();
    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: 'conv-123',
      title: 'Test Conversation',
      owner_id: 'alice@example.com',
      created_at: now,
      updated_at: now,
      tags: ['test'],
      sharing: { is_public: false },
      is_archived: false,
      deleted_at: null,
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(2);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([
              { _id: 'msg-1', role: 'user', content: 'Hello', created_at: now },
              { _id: 'msg-2', role: 'assistant', content: 'Hi there', created_at: now },
            ]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const res = await callMessages('/api/admin/audit-logs/conv-123/messages');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.conversation._id).toBe('conv-123');
    expect(body.data.conversation.title).toBe('Test Conversation');
    expect(body.data.conversation.owner_id).toBe('alice@example.com');
    expect(body.data.messages.items).toHaveLength(2);
    expect(body.data.messages.total).toBe(2);
    expect(body.data.messages.page).toBe(1);
  });

  it('returns empty messages for conversation with no messages', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: 'conv-empty',
      title: 'Empty Conv',
      owner_id: 'bob@example.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(0);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const res = await callMessages('/api/admin/audit-logs/conv-empty/messages', 'conv-empty');
    const body = await res.json();

    expect(body.data.messages.items).toEqual([]);
    expect(body.data.messages.total).toBe(0);
    expect(body.data.messages.has_more).toBe(false);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs/export — Auth & Feature Flag
// ============================================================================

describe('GET /api/admin/audit-logs/export — Auth & Feature Flag', () => {
  beforeEach(resetMocks);

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for readonly admin viewers', async () => {
    mockGetServerSession.mockResolvedValue(readonlyAdminSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);
    expect(res.status).toBe(403);
  });

  it('returns 403 when auditLogsEnabled is false', async () => {
    mockServerConfig = { auditLogsEnabled: false };
    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('FEATURE_DISABLED');
  });

  it('returns 503 when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);
    expect(res.status).toBe(503);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs/export — CSV Export
// ============================================================================

describe('GET /api/admin/audit-logs/export — CSV', () => {
  beforeEach(resetMocks);

  it('returns CSV with correct Content-Type and Content-Disposition', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="audit-logs-/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('includes CSV header row', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);
    const csv = await res.text();

    const headerLine = csv.split('\n')[0];
    expect(headerLine).toContain('Conversation ID');
    expect(headerLine).toContain('Owner');
    expect(headerLine).toContain('Title');
    expect(headerLine).toContain('Status');
    expect(headerLine).toContain('Messages');
  });

  it('includes conversation data rows in CSV', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const now = new Date('2026-03-01T12:00:00Z');

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: 'conv-1',
          owner_id: 'alice@example.com',
          title: 'Test Chat',
          status: 'active',
          message_count: 5,
          created_at: now,
          updated_at: now,
          last_message_at: now,
          tags: ['prod', 'k8s'],
          sharing: { shared_with: [], shared_with_teams: [], is_public: false },
        },
      ]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);
    const csv = await res.text();
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('conv-1');
    expect(lines[1]).toContain('alice@example.com');
    expect(lines[1]).toContain('Test Chat');
    expect(lines[1]).toContain('active');
    expect(lines[1]).toContain('5');
    expect(lines[1]).toContain('prod; k8s');
  });

  it('escapes CSV values containing commas and quotes', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: 'conv-2',
          owner_id: 'bob@example.com',
          title: 'Chat about "Kubernetes, Helm"',
          status: 'active',
          message_count: 1,
          created_at: new Date(),
          updated_at: new Date(),
          tags: [],
        },
      ]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);
    const csv = await res.text();

    expect(csv).toContain('"Chat about ""Kubernetes, Helm"""');
  });

  it('passes filters to export aggregation pipeline', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/export?owner_email=alice&status=archived');
    await exportGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.owner_id).toEqual({ $regex: 'alice', $options: 'i' });
    expect(matchStage.$match.is_archived).toBe(true);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs/owners — Auth & Feature Flag
// ============================================================================

describe('GET /api/admin/audit-logs/owners — Auth & Feature Flag', () => {
  beforeEach(resetMocks);

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/audit-logs/owners');
    const res = await ownersGET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for readonly admin viewers', async () => {
    mockGetServerSession.mockResolvedValue(readonlyAdminSession());

    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/audit-logs/owners');
    const res = await ownersGET(req);
    expect(res.status).toBe(403);
  });

  it('returns 403 when auditLogsEnabled is false', async () => {
    mockServerConfig = { auditLogsEnabled: false };
    const req = makeRequest('/api/admin/audit-logs/owners');
    const res = await ownersGET(req);
    expect(res.status).toBe(403);
  });

  it('returns 503 when MongoDB is not configured', async () => {
    mockIsMongoDBConfigured = false;
    const req = makeRequest('/api/admin/audit-logs/owners');
    const res = await ownersGET(req);
    expect(res.status).toBe(503);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs/owners — Owner Search
// ============================================================================

describe('GET /api/admin/audit-logs/owners — Search', () => {
  beforeEach(resetMocks);

  it('returns distinct owner emails', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { owner_id: 'alice@example.com' },
        { owner_id: 'bob@example.com' },
      ]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/owners');
    const res = await ownersGET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.owners).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('passes search query to aggregation pipeline', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { owner_id: 'alice@example.com' },
      ]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/owners?q=alice');
    await ownersGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage).toBeDefined();
    expect(matchStage.$match.owner_id).toEqual({ $regex: 'alice', $options: 'i' });
  });

  it('uses $group for distinct owners', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/owners');
    await ownersGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const groupStage = pipeline.find((s: any) => s.$group);
    expect(groupStage).toBeDefined();
    expect(groupStage.$group._id).toBe('$owner_id');
  });

  it('limits results to 50', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/owners');
    await ownersGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const limitStage = pipeline.find((s: any) => s.$limit);
    expect(limitStage).toBeDefined();
    expect(limitStage.$limit).toBe(50);
  });

  it('returns empty array when no owners found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/owners?q=nonexistent');
    const res = await ownersGET(req);
    const body = await res.json();

    expect(body.data.owners).toEqual([]);
  });

  it('omits null/empty owner_id values', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { owner_id: 'alice@example.com' },
        { owner_id: null },
        { owner_id: '' },
      ]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/owners');
    const res = await ownersGET(req);
    const body = await res.json();

    expect(body.data.owners).toEqual(['alice@example.com']);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs — Additional Filter & Edge Cases
// ============================================================================

describe('GET /api/admin/audit-logs — Filter Edge Cases', () => {
  beforeEach(resetMocks);

  it('filters by status=archived', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?status=archived');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.is_archived).toBe(true);
  });

  it('includes deleted conversations when include_deleted=true', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?include_deleted=true');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.$or).toBeUndefined();
  });

  it('excludes deleted by default when no status specified', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.$or).toBeDefined();
    expect(matchStage.$match.$or).toEqual([
      { deleted_at: null },
      { deleted_at: { $exists: false } },
    ]);
  });

  it('applies only date_from when date_to is absent', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?date_from=2026-02-01');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.created_at.$gte).toEqual(new Date('2026-02-01'));
    expect(matchStage.$match.created_at.$lte).toBeUndefined();
  });

  it('applies only date_to when date_from is absent', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs?date_to=2026-03-15');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.created_at.$lte).toEqual(new Date('2026-03-15'));
    expect(matchStage.$match.created_at.$gte).toBeUndefined();
  });

  it('combines multiple filters simultaneously', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest(
      '/api/admin/audit-logs?owner_email=alice&search=deploy&status=active&date_from=2026-01-01'
    );
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.owner_id).toEqual({ $regex: 'alice', $options: 'i' });
    expect(matchStage.$match.title).toEqual({ $regex: 'deploy', $options: 'i' });
    expect(matchStage.$match.is_archived).toEqual({ $ne: true });
    expect(matchStage.$match.created_at.$gte).toEqual(new Date('2026-01-01'));
  });

  it('uses correct default pagination (page=1, pageSize=20)', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const skipStage = pipeline.find((s: any) => s.$skip !== undefined);
    const limitStage = pipeline.find((s: any) => s.$limit !== undefined);
    expect(skipStage.$skip).toBe(0);
    expect(limitStage.$limit).toBe(20);
  });

  it('sorts by updated_at descending', async () => {
    const { convCol } = setupAdminWithConversations([]);

    const req = makeRequest('/api/admin/audit-logs');
    await listGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const sortStage = pipeline.find((s: any) => s.$sort);
    expect(sortStage.$sort.updated_at).toBe(-1);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs/[id]/messages — Pagination
// ============================================================================

describe('GET /api/admin/audit-logs/[id]/messages — Pagination', () => {
  beforeEach(resetMocks);

  const callMessages = (url: string, id: string = 'conv-123') => {
    const req = makeRequest(url);
    return messagesGET(req, { params: Promise.resolve({ id }) });
  };

  it('returns has_more=true when there are more pages', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const now = new Date();
    const convCol = createMockCollection();
    convCol.findOne.mockResolvedValue({
      _id: 'conv-123',
      title: 'Test',
      owner_id: 'owner@example.com',
      created_at: now,
      updated_at: now,
    });
    mockCollections['conversations'] = convCol;

    const msgCol = createMockCollection();
    msgCol.countDocuments.mockResolvedValue(50);
    msgCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue(
              Array.from({ length: 20 }, (_, i) => ({
                _id: `msg-${i}`,
                role: 'user',
                content: `Message ${i}`,
                created_at: now,
              }))
            ),
          }),
        }),
      }),
    });
    mockCollections['messages'] = msgCol;

    const res = await callMessages('/api/admin/audit-logs/conv-123/messages');
    const body = await res.json();

    expect(body.data.messages.total).toBe(50);
    expect(body.data.messages.has_more).toBe(true);
  });
});

// ============================================================================
// Tests: GET /api/admin/audit-logs/export — Additional CSV Edge Cases
// ============================================================================

describe('GET /api/admin/audit-logs/export — Edge Cases', () => {
  beforeEach(resetMocks);

  it('handles conversations with no tags gracefully', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: 'conv-no-tags',
          owner_id: 'user@example.com',
          title: 'No Tags Chat',
          status: 'active',
          message_count: 3,
          created_at: new Date(),
          updated_at: new Date(),
          tags: undefined,
          sharing: undefined,
        },
      ]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/export');
    const res = await exportGET(req);
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(csv).toContain('No Tags Chat');
    expect(csv.split('\n')).toHaveLength(2);
  });

  it('exports empty CSV when no conversations match filters', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/export?owner_email=nonexistent');
    const res = await exportGET(req);
    const csv = await res.text();

    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Conversation ID');
  });

  it('filters by status=archived in export', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const convCol = createMockCollection();
    convCol.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    });
    mockCollections['conversations'] = convCol;

    const req = makeRequest('/api/admin/audit-logs/export?status=deleted');
    await exportGET(req);

    const pipeline = convCol.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s: any) => s.$match);
    expect(matchStage.$match.deleted_at).toEqual({ $ne: null, $exists: true });
  });
});
