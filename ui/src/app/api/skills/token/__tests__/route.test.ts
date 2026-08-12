/**
 * @jest-environment node
 */

const mockGetAuthenticatedUser = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockSignLocalSkillsToken = jest.fn();
const mockGetActiveSkillsApiKey = jest.fn();
const mockRegisterSkillsApiKey = jest.fn();

jest.mock('@/lib/api-middleware', () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
  requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
  handleApiError: (error: { statusCode?: number; message?: string; code?: string }) =>
    Response.json(
      { error: error.message, code: error.code },
      { status: error.statusCode ?? 500 },
    ),
}));

jest.mock('@/lib/jwt-validation', () => ({
  signLocalSkillsToken: (...args: unknown[]) => mockSignLocalSkillsToken(...args),
}));

jest.mock('@/lib/skills-api-keys', () => ({
  getActiveSkillsApiKey: (...args: unknown[]) => mockGetActiveSkillsApiKey(...args),
  registerSkillsApiKey: (...args: unknown[]) => mockRegisterSkillsApiKey(...args),
}));

import { GET, POST } from '../route';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAuthenticatedUser.mockResolvedValue({
    user: { email: 'owner@example.com', name: 'Owner', role: 'user' },
    session: { sub: 'owner-sub', role: 'user' },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockSignLocalSkillsToken.mockResolvedValue('signed-token');
  mockRegisterSkillsApiKey.mockResolvedValue(undefined);
});

describe('GET /api/skills/token', () => {
  it('returns active-key metadata without exposing the token', async () => {
    mockGetActiveSkillsApiKey.mockResolvedValue({
      created_at: new Date('2026-01-01T00:00:00Z'),
      expires_at: new Date('2026-04-01T00:00:00Z'),
    });

    const response = await GET(new Request('http://test.com/api/skills/token') as never);
    const body = await response.json();

    expect(mockRequireRbacPermission).toHaveBeenCalledWith(
      { sub: 'owner-sub', role: 'user' },
      'skill',
      'invoke',
    );
    expect(mockGetActiveSkillsApiKey).toHaveBeenCalledWith('owner@example.com');
    expect(body).toMatchObject({ has_active_key: true });
    expect(body).not.toHaveProperty('token');
  });
});

describe('POST /api/skills/token', () => {
  it('requires a cookie-backed NextAuth session and the skill invoke permission', async () => {
    const request = new Request('http://test.com/api/skills/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Caipe-Catalog-Key': 'sk_untrusted.secret',
        Authorization: 'Bearer local-token',
      },
      body: JSON.stringify({ expires_in_days: 30 }),
    });

    const response = await POST(request as never);

    expect(mockGetAuthenticatedUser).toHaveBeenCalledWith(request);
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(
      { sub: 'owner-sub', role: 'user' },
      'skill',
      'invoke',
    );
    expect(mockSignLocalSkillsToken).toHaveBeenCalledWith(
      'owner@example.com',
      'Owner',
      '30d',
      'owner-sub',
      expect.any(String),
    );
    expect(mockRegisterSkillsApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'owner@example.com',
        jti: expect.any(String),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('does not mint when no active session exists', async () => {
    mockGetAuthenticatedUser.mockRejectedValue(
      Object.assign(new Error('Sign in required'), {
        statusCode: 401,
        code: 'NOT_SIGNED_IN',
      }),
    );
    const request = new Request('http://test.com/api/skills/token', {
      method: 'POST',
      headers: { 'X-Caipe-Catalog-Key': 'sk_untrusted.secret' },
    });

    const response = await POST(request as never);

    expect(response.status).toBe(401);
    expect(mockRequireRbacPermission).not.toHaveBeenCalled();
    expect(mockSignLocalSkillsToken).not.toHaveBeenCalled();
  });
});
