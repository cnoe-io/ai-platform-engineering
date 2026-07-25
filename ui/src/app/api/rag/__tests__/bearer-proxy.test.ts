/**
 * @jest-environment node
 *
 * Ensures /api/rag/* accepts OIDC Bearer tokens (CLI / automation), not only
 * browser NextAuth cookies.
 */

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: '',
}));

jest.mock('@/lib/auth/dev-auth-provider', () => ({
  getDevAnonymousSession: jest.fn(),
  isDevAnonymousAuthEnabled: jest.fn().mockReturnValue(false),
}));

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();

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
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    handleApiError: (error: unknown) =>
      Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'error',
        },
        { status: (error as { statusCode?: number }).statusCode ?? 500 },
      ),
  };
});

jest.mock('@/lib/rbac/resource-authz', () => ({
  requireResourcePermission: jest.fn(),
  filterResourcesByPermission: jest.fn(async (_s, r) => r),
}));

jest.mock('@/lib/rbac/openfga-owned-resources-reconcile', () => ({
  reconcileKnowledgeBaseRelationships: jest.fn(),
  reconcileDataSourceRelationships: jest.fn(),
  reconcileMcpToolRelationships: jest.fn(),
  deleteAllMcpToolRelationshipTuples: jest.fn(),
}));

jest.mock('@/lib/rbac/openfga', () => ({
  checkOpenFgaTuple: jest.fn(),
}));

import { NextRequest } from 'next/server';

describe('RAG proxy Bearer auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: 'cli@example.com', name: 'CLI', role: 'user' },
      session: {
        sub: 'sub-cli',
        org: 'caipe',
        accessToken: 'kc-token',
        role: 'user',
        user: { email: 'cli@example.com', name: 'CLI' },
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ email: 'cli@example.com', role: 'readonly' }),
    }) as unknown as typeof fetch;
  });

  it('GET /api/rag/v1/user/info forwards Bearer token to RAG server', async () => {
    const { GET } = await import('@/app/api/rag/[...path]/route');
    const request = new NextRequest('http://localhost:3000/api/rag/v1/user/info', {
      headers: { Authorization: 'Bearer kc-token' },
    });

    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'user', 'info'] }),
    });

    expect(response.status).toBe(200);
    expect(mockGetAuthFromBearerOrSession).toHaveBeenCalled();
    expect(mockRequireRbacPermission).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'kc-token', sub: 'sub-cli' }),
      'rag',
      'query',
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/user/info'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer kc-token',
        }),
      }),
    );
  });
});
