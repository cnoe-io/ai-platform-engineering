/**
 * @jest-environment node
 */
/**
 * Tests for Admin Team Management API Routes
 *
 * Covers:
 * - GET /api/admin/teams — list all teams
 * - POST /api/admin/teams — create a team
 * - GET /api/admin/teams/[id] — get team details
 * - PATCH /api/admin/teams/[id] — update team
 * - DELETE /api/admin/teams/[id] — delete team
 * - POST /api/admin/teams/[id]/members — add member
 * - DELETE /api/admin/teams/[id]/members — remove member
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
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// Mock auth config
jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
}));

// Mock MongoDB
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
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
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

const TEST_TEAM_ID = new ObjectId();
const TEST_TEAM = {
  _id: TEST_TEAM_ID,
  name: 'Platform Engineering',
  description: 'The platform team',
  owner_id: 'admin@example.com',
  created_at: new Date(),
  updated_at: new Date(),
  members: [
    { user_id: 'admin@example.com', role: 'owner', added_at: new Date(), added_by: 'admin@example.com' },
    { user_id: 'member@example.com', role: 'member', added_at: new Date(), added_by: 'admin@example.com' },
  ],
};

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  // Clear mock collections
  Object.keys(mockCollections).forEach(key => delete mockCollections[key]);
});

// ============================================================================
// GET /api/admin/teams — List teams
// ============================================================================

describe('GET /api/admin/teams', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/teams/route');
    GET = mod.GET;
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/teams');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest('/api/admin/teams');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('returns teams list for admin', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([TEST_TEAM]),
      }),
    });
    mockCollections['teams'] = teamsCol;

    const req = makeRequest('/api/admin/teams');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.teams).toHaveLength(1);
    expect(body.data.teams[0].name).toBe('Platform Engineering');
  });
});

// ============================================================================
// POST /api/admin/teams — Create team
// ============================================================================

describe('POST /api/admin/teams', () => {
  let POST: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/teams/route');
    POST = mod.POST;
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Team' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 when not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test Team' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when name is missing', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates a team successfully', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null); // No duplicate
    mockCollections['teams'] = teamsCol;

    const req = makeRequest('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({
        name: 'New Team',
        description: 'A new team',
        members: ['user1@example.com'],
      }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe('Team created successfully');
    expect(teamsCol.insertOne).toHaveBeenCalledTimes(1);

    // Verify the inserted team has the creator as owner
    const insertedTeam = teamsCol.insertOne.mock.calls[0][0];
    expect(insertedTeam.name).toBe('New Team');
    expect(insertedTeam.members).toHaveLength(2); // user1 + creator
    expect(insertedTeam.members.some((m: any) => m.role === 'owner' && m.user_id === 'admin@example.com')).toBe(true);
  });

  it('rejects duplicate team name', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM); // Duplicate exists
    mockCollections['teams'] = teamsCol;

    const req = makeRequest('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({ name: 'Platform Engineering' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('already exists');
  });
});

// ============================================================================
// GET /api/admin/teams/[id] — Get team details
// ============================================================================

describe('GET /api/admin/teams/[id]', () => {
  let GET: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/teams/[id]/route');
    GET = mod.GET;
  });

  const makeContext = (id: string) => ({
    params: Promise.resolve({ id }),
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`);
    const res = await GET(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(401);
  });

  it('returns 403 when not admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`);
    const res = await GET(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid ID format', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest('/api/admin/teams/not-a-valid-id');
    const res = await GET(req, makeContext('not-a-valid-id'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when team not found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`);
    const res = await GET(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(404);
  });

  it('returns team details for admin', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`);
    const res = await GET(req, makeContext(TEST_TEAM_ID.toString()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.team.name).toBe('Platform Engineering');
  });
});

// ============================================================================
// PATCH /api/admin/teams/[id] — Update team
// ============================================================================

describe('PATCH /api/admin/teams/[id]', () => {
  let PATCH: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/teams/[id]/route');
    PATCH = mod.PATCH;
  });

  const makeContext = (id: string) => ({
    params: Promise.resolve({ id }),
  });

  it('returns 404 when team not found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    const res = await PATCH(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(404);
  });

  it('updates team name and description', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    // First findOne: team exists; second findOne (duplicate check): no dup; third findOne: return updated
    teamsCol.findOne
      .mockResolvedValueOnce(TEST_TEAM) // exists check
      .mockResolvedValueOnce(null)       // duplicate name check
      .mockResolvedValueOnce({ ...TEST_TEAM, name: 'Updated Team', description: 'New desc' }); // return updated
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Team', description: 'New desc' }),
    });
    const res = await PATCH(req, makeContext(TEST_TEAM_ID.toString()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
  });

  it('rejects empty team name', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: '   ' }),
    });
    const res = await PATCH(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(400);
  });

  it('rejects duplicate team name', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne
      .mockResolvedValueOnce(TEST_TEAM)                    // exists check
      .mockResolvedValueOnce({ ...TEST_TEAM, _id: new ObjectId() }); // duplicate found
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Existing Team' }),
    });
    const res = await PATCH(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('already exists');
  });
});

// ============================================================================
// DELETE /api/admin/teams/[id] — Delete team
// ============================================================================

describe('DELETE /api/admin/teams/[id]', () => {
  let DELETE: any;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/app/api/admin/teams/[id]/route');
    DELETE = mod.DELETE;
  });

  const makeContext = (id: string) => ({
    params: Promise.resolve({ id }),
  });

  it('returns 404 when team not found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`, { method: 'DELETE' });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(404);
  });

  it('deletes team and cleans up conversation references', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const convsCol = createMockCollection();
    mockCollections['conversations'] = convsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}`, { method: 'DELETE' });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID.toString()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);
    expect(teamsCol.deleteOne).toHaveBeenCalledTimes(1);
    // Should clean up conversation shared_with_teams
    expect(convsCol.updateMany).toHaveBeenCalledTimes(1);
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
      body: JSON.stringify({ user_id: 'new@example.com' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(401);
  });

  it('returns 400 when user_id is missing', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email format', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 'not-an-email' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid role', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 'new@example.com', role: 'superadmin' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(400);
  });

  it('returns 404 when team not found', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(null);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 'new@example.com' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(404);
  });

  it('returns 400 when member already exists', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 'member@example.com' }), // Already in TEST_TEAM
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('already a member');
  });

  it('adds a new member successfully', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne
      .mockResolvedValueOnce(TEST_TEAM)  // team exists
      .mockResolvedValueOnce({ ...TEST_TEAM, members: [...TEST_TEAM.members, { user_id: 'new@example.com', role: 'member' }] }); // after update
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 'new@example.com', role: 'admin' }),
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID.toString()));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
  });

  it('defaults role to member when not specified', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne
      .mockResolvedValueOnce(TEST_TEAM)
      .mockResolvedValueOnce(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: 'new@example.com' }), // No role specified
    });
    const res = await POST(req, makeContext(TEST_TEAM_ID.toString()));

    expect(res.status).toBe(201);
    // Check the $push call contains role: 'member'
    const updateCall = teamsCol.updateOne.mock.calls[0];
    const pushOp = updateCall[1].$push;
    expect(pushOp.members.role).toBe('member');
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

  it('returns 400 when user_id query param is missing', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID.toString()));
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
    const res = await DELETE(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(404);
  });

  it('returns 400 when trying to remove the owner', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members?user_id=admin@example.com`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('owner');
  });

  it('returns 404 when member does not exist in team', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne.mockResolvedValue(TEST_TEAM);
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members?user_id=nonexistent@example.com`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID.toString()));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not a member');
  });

  it('removes a member successfully', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const teamsCol = createMockCollection();
    teamsCol.findOne
      .mockResolvedValueOnce(TEST_TEAM)  // team exists with member@example.com
      .mockResolvedValueOnce({ ...TEST_TEAM, members: [TEST_TEAM.members[0]] }); // after removal
    mockCollections['teams'] = teamsCol;

    const req = makeRequest(`/api/admin/teams/${TEST_TEAM_ID}/members?user_id=member@example.com`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, makeContext(TEST_TEAM_ID.toString()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(teamsCol.updateOne).toHaveBeenCalledTimes(1);
  });
});
