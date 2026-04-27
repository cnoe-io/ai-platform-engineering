/**
 * @jest-environment node
 */
/**
 * Tests for Admin Write API Routes
 *
 * Covers:
 * - PATCH /api/admin/users/[email]/role — update user role
 * - POST /api/admin/teams/[id]/members — add member to team
 * - DELETE /api/admin/teams/[id]/members — remove member from team
 * - POST /api/admin/migrate-conversations — migrate conversations
 *
 * Auth patterns tested:
 * - 401 when not authenticated
 * - 403 when not admin
 * - Success when admin
 */

import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';

// ============================================================================
// Mocks
// ============================================================================

// Mock NextAuth
const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// Mock auth config
jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
}));

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => key === 'ssoEnabled',
}));

// Mock MongoDB - use getter for isMongoDBConfigured to support 503 tests
let mockIsMongoDBConfigured = true;
const mockCollections: Record<string, any> = {};
const mockGetCollection = jest.fn((name: string) => {
  if (!mockCollections[name]) {
    mockCollections[name] = createMockCollection();
  }
  return Promise.resolve(mockCollections[name]);
});

jest.mock('@/lib/mongodb', () => ({
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// ============================================================================
// Helpers
// ============================================================================

function createMockCollection() {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    insertMany: jest.fn().mockResolvedValue({ insertedCount: 0 }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  };
}

function makeRequest(url: string, options: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options);
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

const TEST_TEAM_ID = '507f1f77bcf86cd799439011';
const TEST_TEAM = {
  _id: new ObjectId(TEST_TEAM_ID),
  name: 'Platform Engineering',
  description: 'The platform team',
  owner_id: 'admin@example.com',
  created_at: new Date(),
  updated_at: new Date(),
  members: [
    {
      user_id: 'admin@example.com',
      role: 'owner',
      added_at: new Date(),
      added_by: 'admin@example.com',
    },
    {
      user_id: 'member@example.com',
      role: 'member',
      added_at: new Date(),
      added_by: 'admin@example.com',
    },
  ],
};

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach(key => delete mockCollections[key]);
});

// ============================================================================
// PATCH /api/admin/users/[email]/role — Update user role
// ============================================================================

describe('PATCH /api/admin/users/[email]/role', () => {
  let PATCH: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/users/[email]/role/route');
    PATCH = mod.PATCH;
  });

  const makeContext = (email: string) => ({
    params: Promise.resolve({ email }),
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/users/user@example.com/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    const res = await PATCH(req, makeContext('user@example.com'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest('/api/admin/users/user@example.com/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    const res = await PATCH(req, makeContext('user@example.com'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Admin access required');
  });

  it('returns 503 when MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest('/api/admin/users/user@example.com/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    const res = await PATCH(req, makeContext('user@example.com'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('MongoDB not configured');
  });

  it('returns 400 for invalid role', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue({ email: 'user@example.com' });
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/users/user@example.com/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'superadmin' }),
    });
    const res = await PATCH(req, makeContext('user@example.com'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid role');
  });

  it('returns 404 when target user not found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue(null);
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/users/nonexistent@example.com/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    const res = await PATCH(req, makeContext('nonexistent@example.com'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  it('returns 200 and updates role successfully', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const usersCol = createMockCollection();
    usersCol.findOne.mockResolvedValue({ email: 'user@example.com', metadata: { role: 'user' } });
    usersCol.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mockCollections['users'] = usersCol;

    const req = makeRequest('/api/admin/users/user@example.com/role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    const res = await PATCH(req, makeContext('user@example.com'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('user@example.com');
    expect(body.data.role).toBe('admin');
    expect(body.data.message).toContain('admin');
    expect(usersCol.updateOne).toHaveBeenCalledWith(
      { email: 'user@example.com' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.role': 'admin',
        }),
      })
    );
  });

  it('properly decodes email from URL params', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const usersCol = createMockCollection();
    const encodedEmail = 'user%2Btest%40example.com';
    const decodedEmail = 'user+test@example.com';
    usersCol.findOne.mockResolvedValue({ email: decodedEmail });
    usersCol.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    // countDocuments must return ≥1 so the last-admin safety net doesn't block
    usersCol.countDocuments.mockResolvedValue(1);
    mockCollections['users'] = usersCol;

    const req = makeRequest(`/api/admin/users/${encodedEmail}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user' }),
    });
    const res = await PATCH(req, makeContext(encodedEmail));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.email).toBe(decodedEmail);
    expect(usersCol.updateOne).toHaveBeenCalledWith(
      { email: decodedEmail },
      expect.any(Object)
    );
  });
});

// ============================================================================
// POST /api/admin/teams/[id]/members — Add member
// ============================================================================

describe('POST /api/admin/teams/[id]/members', () => {
  let POST: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/teams/[id]/members/route');
    POST = mod.POST;
  });

  const makeContext = (id: string) => ({
    params: Promise.resolve({ id }),
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'new@example.com' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(401);
  });

  it('returns 403 when not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'new@example.com' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Admin access required');
  });

  it('returns 400 when user_id is missing', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('user_id');
  });

  it('returns 400 for invalid email format', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'not-an-email' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid email');
  });

  it('returns 404 when team not found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'new@example.com' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Team not found');
  });

  it('returns 400 when member already exists', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'member@example.com' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('already a member');
  });

  it('returns 201 when member added successfully', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne
      .mockResolvedValueOnce(TEST_TEAM)
      .mockResolvedValueOnce({
        ...TEST_TEAM,
        members: [
          ...TEST_TEAM.members,
          { user_id: 'new@example.com', role: 'admin', added_at: new Date(), added_by: 'admin@example.com' },
        ],
      });
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'new@example.com', role: 'admin' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.team).toBeDefined();
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
    const updateCall = teamsCol.updateOne.mock.calls[0];
    expect(updateCall[1].$push.members.user_id).toBe('new@example.com');
    expect(updateCall[1].$push.members.role).toBe('admin');
  });
});

// ============================================================================
// DELETE /api/admin/teams/[id]/members — Remove member
// ============================================================================

describe('DELETE /api/admin/teams/[id]/members', () => {
  let DELETE: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/teams/[id]/members/route');
    DELETE = mod.DELETE;
  });

  const makeContext = (id: string) => ({
    params: Promise.resolve({ id }),
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members?user_id=member@example.com`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(401);
  });

  it('returns 403 when not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members?user_id=member@example.com`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Admin access required');
  });

  it('returns 400 when user_id query param is missing', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('user_id');
  });

  it('returns 404 when team not found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members?user_id=member@example.com`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Team not found');
  });

  it('returns 400 when trying to remove team owner', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members?user_id=admin@example.com`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('owner');
  });

  it('returns 404 when member not in team', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(
      `/api/admin/teams/${TEST_TEAM_ID}/members?user_id=nonexistent@example.com`,
      { method: 'DELETE' }
    );
    const res = await DELETE(req, makeContext(TEST_TEAM_ID));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not a member');
  });

  it('returns 200 when member removed successfully', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne
      .mockResolvedValueOnce(TEST_TEAM)
      .mockResolvedValueOnce({
        ...TEST_TEAM,
        members: [TEST_TEAM.members[0]],
      });
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members?user_id=member@example.com`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.team).toBeDefined();
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// POST /api/admin/migrate-conversations — Migrate conversations
// ============================================================================

describe('POST /api/admin/migrate-conversations', () => {
  let POST: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/migrate-conversations/route');
    POST = mod.POST;
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/migrate-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest('/api/admin/migrate-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Admin access required');
  });

  it('returns 503 when MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest('/api/admin/migrate-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations: [{ id: 'conv-1', title: 'Test', createdAt: new Date().toISOString(), messages: [] }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain('MongoDB not configured');
  });

  it('returns success with 0 migrated when no conversations', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest('/api/admin/migrate-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations: [] }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.migrated).toBe(0);
    expect(body.data.skipped).toBe(0);
    expect(body.data.message).toContain('No conversations');
  });

  it('migrates new conversations successfully', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const convsCol = createMockCollection();
    const messagesCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(null); // No existing
    messagesCol.insertMany.mockResolvedValue({ insertedCount: 2 });
    mockCollections['conversations'] = convsCol;
    mockCollections['messages'] = messagesCol;

    const conversations = [
      {
        id: 'conv-123',
        title: 'Test Conversation',
        createdAt: '2024-01-15T10:00:00.000Z',
        messages: [
          { role: 'user', content: 'Hello', created_at: '2024-01-15T10:00:00.000Z' },
          { role: 'assistant', content: 'Hi there', created_at: '2024-01-15T10:00:01.000Z' },
        ],
      },
    ];

    const req = makeRequest('/api/admin/migrate-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.migrated).toBe(1);
    expect(body.data.skipped).toBe(0);
    expect(convsCol.insertOne).toHaveBeenCalledTimes(1);
    expect(messagesCol.insertMany).toHaveBeenCalledTimes(1);
    const insertedConv = convsCol.insertOne.mock.calls[0][0];
    expect(insertedConv._id).toBe('conv-123');
    expect(insertedConv.title).toBe('Test Conversation');
    expect(insertedConv.owner_id).toBe('admin@example.com');
  });

  it('skips existing conversations', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const convsCol = createMockCollection();
    const messagesCol = createMockCollection();
    convsCol.findOne
      .mockResolvedValueOnce({ _id: 'conv-existing' }) // First conv exists
      .mockResolvedValueOnce(null); // Second conv is new
    messagesCol.insertMany.mockResolvedValue({ insertedCount: 0 });
    mockCollections['conversations'] = convsCol;
    mockCollections['messages'] = messagesCol;

    const conversations = [
      { id: 'conv-existing', title: 'Existing', createdAt: '2024-01-15T10:00:00.000Z', messages: [] },
      { id: 'conv-new', title: 'New', createdAt: '2024-01-15T10:00:00.000Z', messages: [] },
    ];

    const req = makeRequest('/api/admin/migrate-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.migrated).toBe(1);
    expect(body.data.skipped).toBe(1);
  });

  it('reports errors for failed migrations', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const convsCol = createMockCollection();
    const messagesCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(null);
    convsCol.insertOne.mockRejectedValueOnce(new Error('DB write failed'));
    mockCollections['conversations'] = convsCol;
    mockCollections['messages'] = messagesCol;

    const conversations = [
      {
        id: 'conv-fail',
        title: 'Failing Conv',
        createdAt: '2024-01-15T10:00:00.000Z',
        messages: [],
      },
    ];

    const req = makeRequest('/api/admin/migrate-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversations }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.migrated).toBe(0);
    expect(body.data.skipped).toBe(0);
    expect(body.data.errors).toBeDefined();
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0]).toContain('Failing Conv');
    expect(body.data.errors[0]).toContain('DB write failed');
  });
});
