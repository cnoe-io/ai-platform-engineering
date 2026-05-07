/**
 * @jest-environment node
 */
// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for the /api/autonomous/[...path] proxy admin gating (IMP-19).
 *
 * Covers:
 *  - GET requires admin-view (`requireAdminView`)
 *      * unauthenticated → 401
 *      * user role + no view group → 403
 *      * user role + view group → 200, upstream forwarded
 *      * admin role → 200, upstream forwarded
 *  - Mutations (POST / PUT / PATCH / DELETE) require full admin
 *      * user role + view group → 403 (view alone is not enough)
 *      * admin role → 200, upstream forwarded
 *  - The proxy never opens an upstream connection when authz fails
 *    (regression guard: a slow/failing autonomous-agents service must
 *    not be reachable as a probe oracle by unauthorised users).
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
const mockGetServerSession = jest.requireMock<{ getServerSession: jest.Mock }>(
  'next-auth',
).getServerSession;

jest.mock('@/lib/auth-config', () => ({ authOptions: {} }));

// MongoDB fallback inside `getAuthenticatedUser` -- we don't want it to
// quietly upgrade a user-role session to admin via a stub document, and
// we don't want test runs to depend on a real Mongo connection. Return
// a collection whose `findOne` resolves to null (no DB-side admin).
jest.mock('@/lib/mongodb', () => ({
  getCollection: jest.fn().mockResolvedValue({
    findOne: jest.fn().mockResolvedValue(null),
  }),
}));

// `getConfig('ssoEnabled')` controls the anonymous fallback inside
// `withAuth`. Force SSO=on so missing sessions reliably 401, mirroring
// production.
let mockAutonomousAgentsEnabled = true;
jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => {
    if (key === 'ssoEnabled') return true;
    if (key === 'autonomousAgentsEnabled') return mockAutonomousAgentsEnabled;
    return undefined;
  },
}));

// Upstream HTTP client -- the proxy uses global `fetch`. We replace it
// per-test so we can assert it was (or was not) called.
const mockFetch = jest.fn();
beforeAll(() => {
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

// Quiet expected error logs from the proxy's catch path.
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// Import handlers AFTER mocks. Square-bracket dir name needs the literal
// path; jest resolves it fine via the moduleNameMapper.
import {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
} from '../[...path]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
): NextRequest {
  const url = new URL(`/api/autonomous/${path}`, 'http://localhost:3000');
  const init: RequestInit & { duplex?: string } = { method };
  if (body !== undefined) {
    // Compute the actual byte length so this stays correct if a future
    // Node release starts validating Content-Length against the real
    // payload (caught by Copilot review). The proxy itself doesn't
    // currently care, but a brittle hard-coded '99' is a trap waiting
    // to bite the next person who adds a larger fixture.
    const serializedBody = JSON.stringify(body);
    init.headers = {
      'Content-Type': 'application/json',
      'content-length': Buffer.byteLength(serializedBody).toString(),
    };
    init.body = serializedBody;
    // Node 20+ requires this for streamable bodies in fetch-style Requests.
    init.duplex = 'half';
  }
  return new NextRequest(url, init as RequestInit);
}

function paramsFor(path: string) {
  return { params: Promise.resolve({ path: path.split('/') }) };
}

function adminSession() {
  return {
    user: { email: 'admin@example.com', name: 'Admin' },
    role: 'admin',
    canViewAdmin: true,
  };
}

function viewOnlySession() {
  return {
    user: { email: 'oncall@example.com', name: 'On-call' },
    role: 'user',
    canViewAdmin: true,
  };
}

function plainUserSession() {
  return {
    user: { email: 'user@example.com', name: 'User' },
    role: 'user',
    canViewAdmin: false,
  };
}

function okJsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAutonomousAgentsEnabled = true;
});

// ---------------------------------------------------------------------------
// GET (admin-view sufficient)
// ---------------------------------------------------------------------------

describe('GET /api/autonomous/[...path]', () => {
  it('404 when the autonomous agents feature flag is disabled', async () => {
    mockAutonomousAgentsEnabled = false;
    mockGetServerSession.mockResolvedValue(adminSession());
    const res = await GET(makeRequest('GET', 'tasks'), paramsFor('tasks'));
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('401 when there is no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest('GET', 'tasks'), paramsFor('tasks'));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('403 when user lacks admin and admin-view groups', async () => {
    mockGetServerSession.mockResolvedValue(plainUserSession());
    const res = await GET(makeRequest('GET', 'tasks'), paramsFor('tasks'));
    expect(res.status).toBe(403);
    // Critical: the upstream service must NOT be hit. Otherwise an
    // anonymous-ish user could probe its availability or exfil error
    // shapes via timing.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('200 when user has admin-view but not admin (read-only operator)', async () => {
    mockGetServerSession.mockResolvedValue(viewOnlySession());
    mockFetch.mockResolvedValue(okJsonResponse([{ id: 'demo' }]));
    const res = await GET(makeRequest('GET', 'tasks'), paramsFor('tasks'));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/tasks');
  });

  it('200 when user is admin', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    mockFetch.mockResolvedValue(okJsonResponse({ id: 'demo' }));
    const res = await GET(
      makeRequest('GET', 'tasks/demo/runs'),
      paramsFor('tasks/demo/runs'),
    );
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('200 when user is admin even if canViewAdmin is false (MongoDB-promoted admin)', async () => {
    // Regression guard for the Codex P1 finding on PR #12: admins
    // promoted via the /api/auth/role MongoDB fallback can have
    // role='admin' without ever picking up the OIDC view-group claim
    // that drives `canViewAdmin`. The proxy must still let them in;
    // otherwise the corresponding UI gate (`hasViewAccess = isAdmin
    // || canViewAdmin`) would be diverging from the server.
    mockGetServerSession.mockResolvedValue({
      user: { email: 'mongo-admin@example.com', name: 'Mongo Admin' },
      role: 'admin',
      canViewAdmin: false,
    });
    mockFetch.mockResolvedValue(okJsonResponse([{ id: 'demo' }]));
    const res = await GET(makeRequest('GET', 'tasks'), paramsFor('tasks'));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Mutations (full admin required)
// ---------------------------------------------------------------------------

describe.each([
  { name: 'POST', handler: POST, body: { id: 'x', name: 'X' } },
  { name: 'PUT', handler: PUT, body: { id: 'x', name: 'X' } },
  { name: 'PATCH', handler: PATCH, body: { enabled: false } },
  { name: 'DELETE', handler: DELETE, body: undefined },
])('$name /api/autonomous/[...path]', ({ name, handler, body }) => {
  it('401 when there is no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await handler(
      makeRequest(name, 'tasks/x', body),
      paramsFor('tasks/x'),
    );
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('403 for view-only operators (admin-view alone is NOT enough)', async () => {
    // This is the meat of IMP-19: a read-only ops user must not be
    // able to fire/edit/delete tasks even though they can see them.
    mockGetServerSession.mockResolvedValue(viewOnlySession());
    const res = await handler(
      makeRequest(name, 'tasks/x', body),
      paramsFor('tasks/x'),
    );
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards to the upstream service when caller is admin', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    mockFetch.mockResolvedValue(okJsonResponse({ ok: true }));
    const res = await handler(
      makeRequest(name, 'tasks/x', body),
      paramsFor('tasks/x'),
    );
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/tasks/x');
    expect(options.method).toBe(name);
  });
});

// ---------------------------------------------------------------------------
// Manual trigger -- a POST to /tasks/{id}/run is a write-equivalent
// side effect (LLM cost, downstream actions). Make sure that lives on
// the admin side of the line, not the view-only side.
// ---------------------------------------------------------------------------

describe('POST /tasks/:id/run', () => {
  it('rejects view-only users (LLM-cost guard)', async () => {
    mockGetServerSession.mockResolvedValue(viewOnlySession());
    const res = await POST(
      makeRequest('POST', 'tasks/demo/run'),
      paramsFor('tasks/demo/run'),
    );
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows admins to trigger a run', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    mockFetch.mockResolvedValue(
      okJsonResponse({ status: 'queued', task_id: 'demo' }),
    );
    const res = await POST(
      makeRequest('POST', 'tasks/demo/run'),
      paramsFor('tasks/demo/run'),
    );
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
