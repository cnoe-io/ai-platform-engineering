/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/skills/token — key status check and generation.
 * Stubs @/lib/api-middleware (withAuth passes through with a fixed user) and
 * @/lib/skills-api-keys so the route logic is exercised without Mongo.
 */

jest.mock('@/lib/api-middleware', () => {
  class FakeApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    ApiError: FakeApiError,
    handleApiError: (err: unknown) => {
      throw err;
    },
    withAuth: jest.fn(
      async (_req: unknown, handler: (req: unknown, user: { email: string; name: string; role: string }) => unknown) =>
        handler(_req, { email: 'user@test.com', name: 'Test User', role: 'user' }),
    ),
  };
});

jest.mock('@/lib/jwt-validation', () => ({
  signLocalSkillsToken: jest.fn().mockResolvedValue('signed.jwt.token'),
}));

const mockGetActiveSkillsApiKey = jest.fn();
const mockRegisterSkillsApiKey = jest.fn();
jest.mock('@/lib/skills-api-keys', () => ({
  getActiveSkillsApiKey: (...args: unknown[]) => mockGetActiveSkillsApiKey(...args),
  registerSkillsApiKey: (...args: unknown[]) => mockRegisterSkillsApiKey(...args),
}));

import { NextRequest } from 'next/server';

import { signLocalSkillsToken } from '@/lib/jwt-validation';

import { GET, POST } from '../route';

const mockSign = signLocalSkillsToken as jest.Mock;

beforeEach(() => {
  mockGetActiveSkillsApiKey.mockReset();
  mockRegisterSkillsApiKey.mockReset();
  mockSign.mockClear();
});

describe('GET /api/skills/token', () => {
  it('reports no active key', async () => {
    mockGetActiveSkillsApiKey.mockResolvedValue(null);
    const res = await GET(new Request('http://test.com/api/skills/token') as unknown as NextRequest);
    const body = await res.json();
    expect(body).toEqual({ has_active_key: false });
  });

  it('reports active key metadata without the raw token', async () => {
    const created_at = new Date('2026-01-01');
    const expires_at = new Date('2026-04-01');
    mockGetActiveSkillsApiKey.mockResolvedValue({ created_at, expires_at });

    const res = await GET(new Request('http://test.com/api/skills/token') as unknown as NextRequest);
    const body = await res.json();
    expect(body.has_active_key).toBe(true);
    expect(body.created_at).toBeDefined();
    expect(body.expires_at).toBeDefined();
    expect(body.token).toBeUndefined();
  });
});

describe('POST /api/skills/token', () => {
  it('mints a token, registers its jti, and returns it', async () => {
    const req = new Request('http://test.com/api/skills/token', {
      method: 'POST',
      body: JSON.stringify({ expires_in_days: 30 }),
    }) as unknown as NextRequest;

    const res = await POST(req);
    const body = await res.json();

    expect(body.token).toBe('signed.jwt.token');
    expect(mockSign).toHaveBeenCalledWith('user@test.com', 'Test User', '30d', expect.any(String));
    expect(mockRegisterSkillsApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: 'user@test.com', jti: expect.any(String) }),
    );
  });

  it('rejects an out-of-range expires_in_days', async () => {
    const req = new Request('http://test.com/api/skills/token', {
      method: 'POST',
      body: JSON.stringify({ expires_in_days: 365 }),
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockRegisterSkillsApiKey).not.toHaveBeenCalled();
  });
});
