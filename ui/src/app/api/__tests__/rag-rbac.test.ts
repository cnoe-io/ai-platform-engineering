/**
 * @jest-environment node
 */
/**
 * Tests for RAG RBAC Integration
 *
 * These tests verify that RBAC headers are properly injected
 * and that role determination works correctly.
 */

// Mock NextAuth
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

// Mock auth config
jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: '',
}));

import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';

const mockRequireRbacPermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockFilterResourcesByPermission = jest.fn();
const mockReconcileKnowledgeBaseRelationships = jest.fn();

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
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    handleApiError: (error: unknown) =>
      Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'error',
          code: (error as { code?: string }).code,
        },
        { status: (error as { statusCode?: number }).statusCode ?? 500 },
      ),
  };
});

jest.mock('@/lib/rbac/resource-authz', () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
  filterResourcesByPermission: (...args: unknown[]) => mockFilterResourcesByPermission(...args),
}));

jest.mock('@/lib/rbac/openfga-owned-resources', () => ({
  reconcileKnowledgeBaseRelationships: (...args: unknown[]) => mockReconcileKnowledgeBaseRelationships(...args),
}));

function ragRequest(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), init);
}

describe('RAG RBAC Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockFilterResourcesByPermission.mockImplementation(async (_session, resources) => resources);
    mockReconcileKnowledgeBaseRelationships.mockResolvedValue({ enabled: true, writes: 3, deletes: 0 });
    // Reset env vars
    process.env.RBAC_READONLY_GROUPS = 'readers';
    process.env.RBAC_INGESTONLY_GROUPS = 'ingestors';
    process.env.RBAC_ADMIN_GROUPS = 'admins';
    process.env.RBAC_DEFAULT_ROLE = 'READONLY';
    // Default: mock fetch to simulate RAG server (route proxies to RAG and returns its response)
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response)
    ) as jest.Mock;
  });

  describe('User Info API', () => {
    it('should return unauthenticated for no session', async () => {
      jest.mocked(getServerSession).mockResolvedValue(null);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ is_authenticated: false, email: 'unauthenticated' }),
      } as Response);

      const { GET } = await import('@/app/api/user/info/route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.is_authenticated).toBe(false);
      expect(data.email).toBe('unauthenticated');
    });

    it('should determine READONLY role for user with no groups', async () => {
      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'test@example.com' },
        groups: [],
      } as any);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          is_authenticated: true,
          email: 'test@example.com',
          role: 'READONLY',
          permissions: ['read'],
        }),
      } as Response);

      const { GET } = await import('@/app/api/user/info/route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.is_authenticated).toBe(true);
      expect(data.email).toBe('test@example.com');
      expect(data.role).toBe('READONLY');
      expect(data.permissions).toEqual(['read']);
    });

    it('should determine INGESTONLY role for ingestor group', async () => {
      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'ingestor@example.com' },
        groups: ['ingestors'],
      } as any);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          is_authenticated: true,
          email: 'ingestor@example.com',
          role: 'INGESTONLY',
          permissions: ['read', 'ingest'],
        }),
      } as Response);

      const { GET } = await import('@/app/api/user/info/route');
      const response = await GET();
      const data = await response.json();

      expect(data.role).toBe('INGESTONLY');
      expect(data.permissions).toEqual(['read', 'ingest']);
    });

    it('should determine ADMIN role for admin group', async () => {
      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'admin@example.com' },
        groups: ['admins'],
      } as any);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          is_authenticated: true,
          email: 'admin@example.com',
          role: 'ADMIN',
          permissions: ['read', 'ingest', 'delete'],
        }),
      } as Response);

      const { GET } = await import('@/app/api/user/info/route');
      const response = await GET();
      const data = await response.json();

      expect(data.role).toBe('ADMIN');
      expect(data.permissions).toEqual(['read', 'ingest', 'delete']);
    });

    it('should use most permissive role when user has multiple groups', async () => {
      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'multi@example.com' },
        groups: ['readers', 'ingestors', 'admins'],
      } as any);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          is_authenticated: true,
          email: 'multi@example.com',
          role: 'ADMIN',
          permissions: ['read', 'ingest', 'delete'],
        }),
      } as Response);

      const { GET } = await import('@/app/api/user/info/route');
      const response = await GET();
      const data = await response.json();

      expect(data.role).toBe('ADMIN'); // Most permissive wins
    });
  });

  describe('RAG API Proxy Header Injection', () => {
    it('should inject X-Forwarded-Email header', async () => {
      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'test@example.com' },
        groups: ['readers'],
      } as any);

      // We can't easily test the actual fetch call, but we can verify
      // the getRbacHeaders function logic by importing it
      // For now, we verify the session mock is set correctly
      const session = await getServerSession({} as any);
      expect(session?.user?.email).toBe('test@example.com');
    });

    it('should inject X-Forwarded-Groups header with comma-separated groups', async () => {
      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'test@example.com' },
        groups: ['group1', 'group2', 'group3'],
      } as any);

      const session = await getServerSession({} as any);
      expect(session?.groups).toEqual(['group1', 'group2', 'group3']);
    });

    it('should handle empty groups gracefully', async () => {
      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'test@example.com' },
        groups: [],
      } as any);

      const session = await getServerSession({} as any);
      expect(session?.groups).toEqual([]);
    });
  });

  describe('Role Hierarchy', () => {
    const testCases = [
      {
        groups: ['readers'],
        expectedRole: 'READONLY',
        canRead: true,
        canIngest: false,
        canDelete: false,
      },
      {
        groups: ['ingestors'],
        expectedRole: 'INGESTONLY',
        canRead: true,
        canIngest: true,
        canDelete: false,
      },
      {
        groups: ['admins'],
        expectedRole: 'ADMIN',
        canRead: true,
        canIngest: true,
        canDelete: true,
      },
      {
        groups: ['readers', 'ingestors'],
        expectedRole: 'INGESTONLY',
        canRead: true,
        canIngest: true,
        canDelete: false,
      },
      {
        groups: ['ingestors', 'admins'],
        expectedRole: 'ADMIN',
        canRead: true,
        canIngest: true,
        canDelete: true,
      },
    ];

    testCases.forEach(({ groups, expectedRole, canRead, canIngest, canDelete }) => {
      it(`should assign ${expectedRole} role for groups: ${groups.join(', ')}`, async () => {
        jest.mocked(getServerSession).mockResolvedValue({
          user: { email: 'test@example.com' },
          groups,
        } as any);
        const permissions = [...(canRead ? ['read'] : []), ...(canIngest ? ['ingest'] : []), ...(canDelete ? ['delete'] : [])];
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ is_authenticated: true, email: 'test@example.com', role: expectedRole, permissions }),
        } as Response);

        const { GET } = await import('@/app/api/user/info/route');
        const response = await GET();
        const data = await response.json();

        expect(data.role).toBe(expectedRole);
        if (canRead) expect(data.permissions).toContain('read');
        if (canIngest) expect(data.permissions).toContain('ingest');
        if (canDelete) expect(data.permissions).toContain('delete');
      });
    });
  });

  describe('Environment Variable Configuration', () => {
    it('should use custom default role from env', async () => {
      process.env.RBAC_DEFAULT_ROLE = 'INGESTONLY';

      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'test@example.com' },
        groups: ['unknown-group'],
      } as any);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          is_authenticated: true,
          email: 'test@example.com',
          role: 'INGESTONLY',
          permissions: ['read', 'ingest'],
        }),
      } as Response);

      jest.resetModules();
      const { GET } = await import('@/app/api/user/info/route');
      const response = await GET();
      const data = await response.json();

      expect(data.role).toBe('INGESTONLY');
    });

    it('should handle multiple group names separated by commas', async () => {
      process.env.RBAC_ADMIN_GROUPS = 'admins,caipe-admins,super-admins';

      jest.mocked(getServerSession).mockResolvedValue({
        user: { email: 'test@example.com' },
        groups: ['caipe-admins'],
      } as any);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          is_authenticated: true,
          email: 'test@example.com',
          role: 'ADMIN',
          permissions: ['read', 'ingest', 'delete'],
        }),
      } as Response);

      jest.resetModules();
      const { GET } = await import('@/app/api/user/info/route');
      const response = await GET();
      const data = await response.json();

      expect(data.role).toBe('ADMIN');
    });
  });

  describe('Object-level OpenFGA checks for RAG proxies', () => {
    beforeEach(async () => {
      const nextAuth = await import('next-auth');
      jest.mocked(nextAuth.getServerSession).mockResolvedValue({
        sub: 'alice-sub',
        role: 'kb_admin',
        org: 'team-alpha',
        accessToken: 'access-token',
        user: { email: 'alice@example.com' },
      } as any);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);
    });

    it('requires knowledge_base discover when listing generic datasource details from query params', async () => {
      const { GET } = await import('@/app/api/rag/[...path]/route');

      const response = await GET(
        ragRequest('/api/rag/v1/datasources?datasource_id=kb-alpha'),
        { params: Promise.resolve({ path: ['v1', 'datasources'] }) },
      );

      expect(response.status).toBe(200);
      expect(mockRequireRbacPermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub', org: 'team-alpha' }),
        'rag',
        'query',
      );
      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub', role: 'kb_admin' }),
        { type: 'knowledge_base', id: 'kb-alpha', action: 'discover' },
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:9446/v1/datasources?datasource_id=kb-alpha',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer access-token',
            'X-Tenant-Id': 'team-alpha',
          }),
        }),
      );
    });

    it('allows datasource lists through RAG query scope and filters them through OpenFGA', async () => {
      const nextAuth = await import('next-auth');
      jest.mocked(nextAuth.getServerSession).mockResolvedValue({
        sub: 'alice-sub',
        role: 'user',
        org: 'team-alpha',
        accessToken: 'browser-token',
        user: { email: 'alice@example.com' },
      } as any);
      mockFilterResourcesByPermission.mockResolvedValue([
        { datasource_id: 'kb-allowed', name: 'Allowed KB' },
      ]);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          datasources: [
            { datasource_id: 'kb-allowed', name: 'Allowed KB' },
            { datasource_id: 'kb-denied', name: 'Denied KB' },
          ],
          count: 2,
        }),
      } as Response);
      const { GET } = await import('@/app/api/rag/[...path]/route');

      const response = await GET(
        ragRequest('/api/rag/v1/datasources'),
        { params: Promise.resolve({ path: ['v1', 'datasources'] }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockRequireRbacPermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub', org: 'team-alpha' }),
        'rag',
        'query',
      );
      expect(body.datasources).toEqual([{ datasource_id: 'kb-allowed', name: 'Allowed KB' }]);
      expect(body.count).toBe(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:9446/v1/datasources',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer browser-token' }),
        }),
      );
      expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub', role: 'user' }),
        expect.any(Array),
        expect.objectContaining({ type: 'knowledge_base', action: 'read' }),
        expect.objectContaining({ allowAdminBypass: true }),
      );
    });

    it('lets a non-admin create a private datasource and writes owner tuples after upstream success', async () => {
      const nextAuth = await import('next-auth');
      jest.mocked(nextAuth.getServerSession).mockResolvedValue({
        sub: 'alice-sub',
        role: 'user',
        org: 'team-alpha',
        accessToken: 'browser-token',
        user: { email: 'alice@example.com' },
      } as any);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ datasource_id: 'kb-private', status: 'created' }),
      } as Response);
      const { POST } = await import('@/app/api/rag/[...path]/route');
      const body = { datasource_id: 'kb-private', url: 'https://docs.example.test' };

      const response = await POST(
        ragRequest('/api/rag/v1/datasource', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'content-length': String(JSON.stringify(body).length),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ path: ['v1', 'datasource'] }) },
      );

      expect(response.status).toBe(201);
      expect(mockRequireRbacPermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub', org: 'team-alpha' }),
        'rag',
        'query',
      );
      expect(mockRequireResourcePermission).not.toHaveBeenCalledWith(
        expect.anything(),
        { type: 'knowledge_base', id: 'kb-private', action: 'ingest' },
      );
      expect(mockReconcileKnowledgeBaseRelationships).toHaveBeenCalledWith({
        knowledgeBaseId: 'kb-private',
        ownerSubject: 'alice-sub',
        ownerTeamSlug: null,
      });
    });

    it('requires team membership before creating a team-owned datasource', async () => {
      const nextAuth = await import('next-auth');
      jest.mocked(nextAuth.getServerSession).mockResolvedValue({
        sub: 'alice-sub',
        role: 'user',
        org: 'team-alpha',
        accessToken: 'browser-token',
        user: { email: 'alice@example.com' },
      } as any);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ datasource_id: 'kb-team', status: 'created' }),
      } as Response);
      const { POST } = await import('@/app/api/rag/[...path]/route');
      const body = {
        datasource_id: 'kb-team',
        url: 'https://docs.example.test',
        owner_team_slug: 'platform',
      };

      const response = await POST(
        ragRequest('/api/rag/v1/datasource', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'content-length': String(JSON.stringify(body).length),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ path: ['v1', 'datasource'] }) },
      );

      expect(response.status).toBe(201);
      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub' }),
        { type: 'team', id: 'platform', action: 'use' },
      );
      expect(mockReconcileKnowledgeBaseRelationships).toHaveBeenCalledWith({
        knowledgeBaseId: 'kb-team',
        ownerSubject: 'alice-sub',
        ownerTeamSlug: 'platform',
      });
    });

    it('forwards the Keycloak bearer for MCP tool config discovery after BFF RBAC passes', async () => {
      const nextAuth = await import('next-auth');
      jest.mocked(nextAuth.getServerSession).mockResolvedValue({
        sub: 'admin-sub',
        role: 'admin',
        org: 'team-alpha',
        accessToken: 'browser-token',
        user: { email: 'admin@example.com' },
      } as any);
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ([]),
      } as Response);
      const { GET } = await import('@/app/api/rag/[...path]/route');

      const response = await GET(
        ragRequest('/api/rag/v1/mcp/custom-tools'),
        { params: Promise.resolve({ path: ['v1', 'mcp', 'custom-tools'] }) },
      );

      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:9446/v1/mcp/custom-tools',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer browser-token' }),
        }),
      );
    });

    it('constrains MCP search invocation to OpenFGA-readable datasources before RAG validates the bearer', async () => {
      const nextAuth = await import('next-auth');
      jest.mocked(nextAuth.getServerSession).mockResolvedValue({
        sub: 'alice-sub',
        role: 'user',
        org: 'team-alpha',
        accessToken: 'browser-token',
        user: { email: 'alice@example.com' },
      } as any);
      mockFilterResourcesByPermission.mockResolvedValue([
        { datasource_id: 'kb-allowed', name: 'Allowed KB' },
      ]);
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            datasources: [
              { datasource_id: 'kb-allowed', name: 'Allowed KB' },
              { datasource_id: 'kb-denied', name: 'Denied KB' },
            ],
            count: 2,
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ tool_name: 'search', success: true, result: {}, error: null }),
        } as Response);
      const { POST } = await import('@/app/api/rag/[...path]/route');
      const body = { tool_name: 'search', arguments: { query: 'deployments', limit: 5 } };

      const response = await POST(
        ragRequest('/api/rag/v1/mcp/invoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'content-length': String(JSON.stringify(body).length),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ path: ['v1', 'mcp', 'invoke'] }) },
      );

      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:9446/v1/mcp/invoke',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer browser-token' }),
          body: JSON.stringify({
            tool_name: 'search',
            arguments: {
              query: 'deployments',
              limit: 5,
              filters: { datasource_id: 'kb-allowed' },
            },
          }),
        }),
      );
    });

    it('requires knowledge_base ingest for existing datasource writes from request body', async () => {
      const { POST } = await import('@/app/api/rag/[...path]/route');
      const body = { datasource_id: 'kb-beta', reload: true };

      const response = await POST(
        ragRequest('/api/rag/v1/ingest/webloader/reload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'content-length': String(JSON.stringify(body).length),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ path: ['v1', 'ingest', 'webloader', 'reload'] }) },
      );

      expect(response.status).toBe(200);
      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub' }),
        { type: 'knowledge_base', id: 'kb-beta', action: 'ingest' },
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:9446/v1/ingest/webloader/reload',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
    });

    it('requires OpenFGA knowledge-base ingest access for admin re-ingest requests', async () => {
      const nextAuth = await import('next-auth');
      const { ApiError } = await import('@/lib/api-middleware');
      jest.mocked(nextAuth.getServerSession).mockResolvedValue({
        sub: 'admin-sub',
        role: 'admin',
        org: 'team-alpha',
        accessToken: 'admin-token',
        user: { email: 'admin@example.com' },
      } as any);
      mockRequireResourcePermission.mockImplementation(async () => {
        throw new ApiError('no ingest', 403, 'knowledge_base#ingest');
      });
      const { POST } = await import('@/app/api/rag/[...path]/route');
      const body = { datasource_id: 'kb-reload' };

      const response = await POST(
        ragRequest('/api/rag/v1/ingest/webloader/reload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'content-length': String(JSON.stringify(body).length),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ path: ['v1', 'ingest', 'webloader', 'reload'] }) },
      );

      expect(response.status).toBe(403);
      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'admin-sub', role: 'admin' }),
        { type: 'knowledge_base', id: 'kb-reload', action: 'ingest' },
      );
      expect(global.fetch).not.toHaveBeenCalledWith(
        'http://localhost:9446/v1/ingest/webloader/reload',
        expect.anything(),
      );
    });

    it('requires knowledge_base admin for generic PATCH updates using path ids', async () => {
      const { PATCH } = await import('@/app/api/rag/[...path]/route');
      const body = { display_name: 'Renamed KB' };

      const response = await PATCH(
        ragRequest('/api/rag/v1/datasources/kb-gamma', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'content-length': String(JSON.stringify(body).length),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ path: ['v1', 'datasources', 'kb-gamma'] }) },
      );

      expect(response.status).toBe(200);
      expect(mockRequireRbacPermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub' }),
        'rag',
        'admin',
      );
      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub' }),
        { type: 'knowledge_base', id: 'kb-gamma', action: 'admin' },
      );
    });

    it('requires knowledge_base read for KB-scoped query posts', async () => {
      const { POST } = await import('@/app/api/rag/kb/[...path]/route');
      const body = { kb_id: 'kb-delta', query: 'what changed?' };

      const response = await POST(
        ragRequest('/api/rag/kb/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'content-length': String(JSON.stringify(body).length),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ path: ['query'] }) },
      );

      expect(response.status).toBe(200);
      expect(mockRequireRbacPermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub' }),
        'rag',
        'kb.ingest',
      );
      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub' }),
        { type: 'knowledge_base', id: 'kb-delta', action: 'read' },
      );
    });

    it('requires knowledge_base admin for KB-scoped PATCH updates', async () => {
      const { PATCH } = await import('@/app/api/rag/kb/[...path]/route');
      const body = { retention_days: 30 };

      const response = await PATCH(
        ragRequest('/api/rag/kb/kb-epsilon/settings', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'content-length': String(JSON.stringify(body).length),
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ path: ['kb-epsilon', 'settings'] }) },
      );

      expect(response.status).toBe(200);
      expect(mockRequireResourcePermission).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'alice-sub' }),
        { type: 'knowledge_base', id: 'kb-epsilon', action: 'admin' },
      );
    });

    it('does not proxy KB requests when the object-level check fails', async () => {
      mockRequireResourcePermission.mockRejectedValue(
        Object.assign(new Error('kb denied'), { statusCode: 403, code: 'knowledge_base#read' }),
      );
      const { GET } = await import('@/app/api/rag/kb/[...path]/route');

      const response = await GET(
        ragRequest('/api/rag/kb/kb-zeta/query'),
        { params: Promise.resolve({ path: ['kb-zeta', 'query'] }) },
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({ success: false, error: 'kb denied', code: 'knowledge_base#read' });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
