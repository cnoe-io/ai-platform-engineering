/**
 * @jest-environment node
 */

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth/dev-auth-provider', () => ({
  getDevAnonymousSession: jest.fn(),
  isDevAnonymousAuthEnabled: jest.fn().mockReturnValue(false),
}));

const mockGetAuthFromBearerOrSession = jest.fn();

jest.mock('@/lib/api-middleware', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
      public code?: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
  };
});

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { resolveRagProxySession } from '@/lib/rag-proxy-session';

function makeRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/rag/v1/user/info', {
    headers,
  });
}

describe('resolveRagProxySession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses Bearer JWT when Authorization header is present', async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: 'cli@example.com', name: 'CLI', role: 'user' },
      session: {
        sub: 'sub-123',
        org: 'caipe',
        accessToken: 'kc-access-token',
        role: 'user',
      },
    });

    const session = await resolveRagProxySession(
      makeRequest({ Authorization: 'Bearer kc-access-token' }),
    );

    expect(mockGetAuthFromBearerOrSession).toHaveBeenCalled();
    expect(getServerSession).not.toHaveBeenCalled();
    expect(session.accessToken).toBe('kc-access-token');
    expect(session.sub).toBe('sub-123');
    expect(session.user?.email).toBe('cli@example.com');
  });

  it('falls back to NextAuth session when no Bearer header', async () => {
    jest.mocked(getServerSession).mockResolvedValue({
      sub: 'browser-sub',
      org: 'caipe',
      accessToken: 'browser-token',
      role: 'user',
      user: { email: 'browser@example.com', name: 'Browser' },
    } as unknown);

    const session = await resolveRagProxySession(makeRequest());

    expect(mockGetAuthFromBearerOrSession).not.toHaveBeenCalled();
    expect(session.accessToken).toBe('browser-token');
    expect(session.user?.email).toBe('browser@example.com');
  });
});
