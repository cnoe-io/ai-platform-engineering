/**
 * @jest-environment node
 */
/**
 * Verifies that the autonomous proxy injects X-Authenticated-User-Email
 * and X-Authenticated-User-Is-Admin headers when forwarding requests to
 * the autonomous-agents service.
 */

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));

jest.mock('@/lib/auth-config', () => ({ authOptions: {} }));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue(true),
  getServerConfig: jest.fn().mockReturnValue({ autonomousAgentsEnabled: true }),
}));

jest.mock('@/lib/mongodb', () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { NextRequest } from 'next/server';
import { GET } from '../[...path]/route';

const mockGetServerSession = jest.requireMock<{ getServerSession: jest.Mock }>('next-auth').getServerSession;

function makeGetRequest(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/autonomous/${path}`));
}

describe('Autonomous proxy header injection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { email: 'alice@example.com', name: 'Alice' },
      role: 'admin',
      canViewAdmin: true,
    });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('injects X-Authenticated-User-Email on GET /tasks', async () => {
    const req = makeGetRequest('tasks');
    await GET(req, { params: Promise.resolve({ path: ['tasks'] }) });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, fetchInit] = mockFetch.mock.calls[0];
    expect(fetchInit.headers['X-Authenticated-User-Email']).toBe('alice@example.com');
  });

  it('injects X-Authenticated-User-Is-Admin=true when session role is admin', async () => {
    const req = makeGetRequest('tasks');
    await GET(req, { params: Promise.resolve({ path: ['tasks'] }) });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, fetchInit] = mockFetch.mock.calls[0];
    expect(fetchInit.headers['X-Authenticated-User-Is-Admin']).toBe('true');
  });

  it('injects X-Authenticated-User-Is-Admin=false for non-admin sessions', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'bob@example.com', name: 'Bob' },
      role: 'user',
      canViewAdmin: true,
    });

    const req = makeGetRequest('tasks');
    await GET(req, { params: Promise.resolve({ path: ['tasks'] }) });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, fetchInit] = mockFetch.mock.calls[0];
    expect(fetchInit.headers['X-Authenticated-User-Email']).toBe('bob@example.com');
    expect(fetchInit.headers['X-Authenticated-User-Is-Admin']).toBe('false');
  });
});
