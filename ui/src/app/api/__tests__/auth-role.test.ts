/**
 * @jest-environment node
 */
/**
 * Tests for GET /api/auth/role
 *
 * Covers:
 * - Returns role='user' when no session (unauthenticated)
 * - Returns role='user' when session has no email
 * - Returns role='admin' when session.role is 'admin' (no MongoDB call needed)
 * - Returns role='user' when session.role is 'user' and no MongoDB admin record
 * - Returns role='admin' when session.role is 'user' but MongoDB has admin metadata
 * - Returns role='user' when MongoDB lookup throws error (graceful fallback)
 * - Returns email in response when session is present
 */

import { NextRequest } from 'next/server';

// ============================================================================
// Mocks
// ============================================================================

const mockNextResponseJson = jest.fn((data: unknown, init?: { status?: number }) => ({
  json: async () => data,
  status: init?.status ?? 200,
}));

jest.mock('next/server', () => ({
  NextRequest: Request,
  NextResponse: { json: (...args: unknown[]) => mockNextResponseJson(...args) },
}));

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
const mockGetServerSession = jest.requireMock<{ getServerSession: jest.Mock }>('next-auth')
  .getServerSession;

jest.mock('@/lib/mongodb', () => ({ getCollection: jest.fn() }));
const mockGetCollection = jest.requireMock<{ getCollection: jest.Mock }>('@/lib/mongodb')
  .getCollection;

jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: '',
}));

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// ============================================================================
// Helpers
// ============================================================================

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

// Import GET handler AFTER all mocks
import { GET } from '../auth/role/route';

// ============================================================================
// Tests
// ============================================================================

describe('GET /api/auth/role', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when no session (unauthenticated)', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = makeRequest('/api/auth/role');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it('returns 401 when session has no email', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { name: 'Test User' },
      role: 'user',
    });

    const req = makeRequest('/api/auth/role');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it('returns role="admin" when session.role is "admin" (no MongoDB call needed)', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());

    const req = makeRequest('/api/auth/role');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ role: 'admin', email: 'admin@example.com' });
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it('returns role="user" when session.role is "user" and no MongoDB admin record', async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const mockFindOne = jest.fn().mockResolvedValue(null);
    mockGetCollection.mockResolvedValue({ findOne: mockFindOne });

    const req = makeRequest('/api/auth/role');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ role: 'user', email: 'user@example.com' });
    expect(mockGetCollection).toHaveBeenCalledWith('users');
    expect(mockFindOne).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('returns role="admin" when session.role is "user" but MongoDB has admin metadata', async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const mockFindOne = jest.fn().mockResolvedValue({
      email: 'user@example.com',
      metadata: { role: 'admin' },
    });
    mockGetCollection.mockResolvedValue({ findOne: mockFindOne });

    const req = makeRequest('/api/auth/role');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ role: 'admin', email: 'user@example.com' });
    expect(mockGetCollection).toHaveBeenCalledWith('users');
    expect(mockFindOne).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('returns role="user" when MongoDB lookup throws error (graceful fallback)', async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const mockFindOne = jest.fn().mockRejectedValue(new Error('MongoDB connection failed'));
    mockGetCollection.mockResolvedValue({ findOne: mockFindOne });

    const req = makeRequest('/api/auth/role');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ role: 'user', email: 'user@example.com' });
    expect(console.warn).toHaveBeenCalledWith(
      '[Auth Role API] Could not check MongoDB for admin role:',
      expect.any(Error)
    );
  });

  it('returns email in response when session is present', async () => {
    mockGetServerSession.mockResolvedValue(userSession());

    const mockFindOne = jest.fn().mockResolvedValue(null);
    mockGetCollection.mockResolvedValue({ findOne: mockFindOne });

    const req = makeRequest('/api/auth/role');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('email', 'user@example.com');
    expect(body).toHaveProperty('role', 'user');
  });
});
