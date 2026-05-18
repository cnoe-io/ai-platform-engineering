import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import {
  ApiError,
  requireRbacPermission,
  handleApiError,
} from '@/lib/api-middleware';
import type { RbacScope } from '@/lib/rbac/types';
import {
  filterResourcesByPermission,
  requireResourcePermission,
  type ResourcePermissionAction,
} from '@/lib/rbac/resource-authz';

/**
 * RAG API Proxy with JWT Bearer Token Authentication
 *
 * Proxies requests from /api/rag/* to the RAG server with JWT authentication.
 * The RAG server validates the JWT token and fetches user claims (email, groups)
 * from the OIDC userinfo endpoint, caching them in Redis.
 *
 * Authentication:
 * - Authorization: Bearer {access_token} (OIDC JWT access token)
 *
 * The RAG server uses the access_token to:
 * 1. Authenticate the request (validate JWT signature, expiry, audience)
 * 2. Fetch user claims from OIDC userinfo endpoint (cached in Redis)
 * 3. Determine user role based on group membership
 *
 * This is the standards-compliant OAuth approach - only the access_token is
 * passed downstream, and user claims are fetched server-side from the
 * authoritative source (OIDC provider's userinfo endpoint).
 *
 * Example:
 *   /api/rag/healthz -> RAG_SERVER_URL/healthz (with Bearer token)
 *   /api/rag/v1/query -> RAG_SERVER_URL/v1/query (with Bearer token)
 *
 * RBAC (098): Web UI backend enforces Keycloak AuthZ on `rag` before proxying —
 * GET/POST use `query` (read/search); PUT/DELETE use `admin` (098 matrix).
 */

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL ||
         process.env.NEXT_PUBLIC_RAG_URL ||
         'http://localhost:9446';
}

function scopeForRagProxyMethod(method: string, pathSegments: string[] = []): RbacScope {
  const path = pathSegments.join('/').toLowerCase();
  if (
    path === 'v1/datasources' ||
    path.startsWith('v1/datasources/') ||
    path === 'v1/datasource' ||
    path.startsWith('v1/datasource/')
  ) {
    return 'admin';
  }
  switch (method) {
    case 'GET':
    case 'POST':
      return 'query';
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return 'admin';
    default:
      return 'query';
  }
}

function actionForRagRequest(method: string, pathSegments: string[]): ResourcePermissionAction {
  const path = pathSegments.join('/').toLowerCase();
  if (method === 'GET') return path.includes('query') || path.includes('search') ? 'read' : 'discover';
  if (method === 'POST') {
    if (path.includes('ingest') || path.includes('upload') || path.includes('datasource')) return 'ingest';
    return 'read';
  }
  return 'admin';
}

function extractKnowledgeBaseId(
  request: NextRequest,
  pathSegments: string[],
  body?: unknown,
): string | null {
  for (const key of ['kb_id', 'knowledge_base_id', 'knowledgeBaseId', 'datasource_id', 'datasourceId']) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) return value;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const bodyValue = (body as Record<string, unknown>)[key];
      if (typeof bodyValue === 'string' && bodyValue.trim()) return bodyValue.trim();
    }
  }

  const marker = pathSegments.findIndex((segment) =>
    ['kb', 'knowledge-bases', 'knowledge_base', 'datasources', 'data-sources'].includes(segment.toLowerCase())
  );
  if (marker >= 0 && pathSegments[marker + 1]) return pathSegments[marker + 1];
  return null;
}

/**
 * Require RBAC for the proxy, then build headers for the upstream RAG server.
 */
interface AuthorizedRagContext {
  headers: Record<string, string>;
  session: {
    accessToken?: string;
    sub?: unknown;
    org?: string;
    role?: string;
    user?: { email?: string | null };
  };
}

async function getAuthorizedRagContext(
  method: string,
  pathSegments: string[],
  request: NextRequest,
  body?: unknown,
): Promise<AuthorizedRagContext> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new ApiError('Unauthorized', 401);
  }
  if (!session.accessToken) {
    throw new ApiError('A Keycloak access token is required for RAG access.', 401, 'NOT_SIGNED_IN');
  }

  await requireRbacPermission(
    { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
    'rag',
    scopeForRagProxyMethod(method, pathSegments),
  );

  const kbId = extractKnowledgeBaseId(request, pathSegments, body);
  if (kbId) {
    const authzSession = { sub: session.sub, role: session.role, user: session.user };
    const target = { type: 'knowledge_base' as const, id: kbId, action: actionForRagRequest(method, pathSegments) };
    if (session.role === 'admin') {
      await requireResourcePermission(authzSession, target, { allowAdminBypass: true });
    } else {
      await requireResourcePermission(authzSession, target);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  headers['Authorization'] = `Bearer ${session.accessToken}`;
  if (session.org) {
    headers['X-Tenant-Id'] = session.org;
  }
  // Spec 104: team scope is now carried by the `active_team` JWT claim,
  // not the X-Team-Id header. The RAG server reads it directly from the
  // bearer token via its JwtAuthMiddleware.
  return { headers, session };
}

function isDatasourceListRequest(method: string, pathSegments: string[]): boolean {
  return method === 'GET' && pathSegments.join('/') === 'v1/datasources';
}

function datasourceId(resource: Record<string, unknown>): string {
  const value = resource.datasource_id ?? resource.id;
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function filterDatasourceListResponse(
  session: AuthorizedRagContext['session'],
  pathSegments: string[],
  data: unknown,
): Promise<unknown> {
  if (
    !isDatasourceListRequest('GET', pathSegments) ||
    !data ||
    typeof data !== 'object' ||
    !Array.isArray((data as { datasources?: unknown }).datasources)
  ) {
    return data;
  }

  const envelope = data as { datasources: Array<Record<string, unknown>>; count?: number };
  if (session.role === 'admin') {
    return { ...envelope, count: envelope.datasources.length };
  }

  const candidates = envelope.datasources.filter((resource) => datasourceId(resource));
  const datasources = await filterResourcesByPermission(
    session,
    candidates,
    {
      type: 'knowledge_base',
      action: 'read',
      id: datasourceId,
    },
    { allowAdminBypass: true },
  );

  return { ...envelope, datasources, count: datasources.length };
}

async function loadReadableDatasourceIds(
  session: AuthorizedRagContext['session'],
  headers: Record<string, string>,
): Promise<string[]> {
  const targetUrl = `${getRagServerUrl()}/v1/datasources`;
  const response = await fetch(targetUrl, { method: 'GET', headers });
  if (!response.ok) {
    throw new ApiError(`Failed to resolve readable data sources: ${response.status}`, response.status);
  }

  const data = await response.json();
  if (!isRecord(data) || !Array.isArray(data.datasources)) return [];

  const candidates = data.datasources
    .filter(isRecord)
    .filter((resource) => datasourceId(resource));
  const datasources = await filterResourcesByPermission(
    session,
    candidates,
    {
      type: 'knowledge_base',
      action: 'read',
      id: datasourceId,
    },
    { allowAdminBypass: true },
  );

  return datasources.map(datasourceId).filter(Boolean);
}

function constrainDatasourceFilter(
  value: Record<string, unknown>,
  allowedDatasourceIds: string[],
): Record<string, unknown> {
  if (allowedDatasourceIds.length === 0) {
    throw new ApiError('No readable knowledge bases are assigned to this user.', 403, 'knowledge_base#read');
  }

  const filters = isRecord(value.filters) ? { ...value.filters } : {};
  const existing = filters.datasource_id ?? value.datasource_id;

  if (typeof existing === 'string') {
    if (!allowedDatasourceIds.includes(existing)) {
      throw new ApiError('You do not have permission to search this data source.', 403, 'knowledge_base#read');
    }
    filters.datasource_id = existing;
  } else if (Array.isArray(existing)) {
    const intersection = existing.filter(
      (candidate): candidate is string =>
        typeof candidate === 'string' && allowedDatasourceIds.includes(candidate),
    );
    if (intersection.length === 0) {
      throw new ApiError('You do not have permission to search these data sources.', 403, 'knowledge_base#read');
    }
    filters.datasource_id = intersection.length === 1 ? intersection[0] : intersection;
  } else {
    filters.datasource_id = allowedDatasourceIds.length === 1 ? allowedDatasourceIds[0] : allowedDatasourceIds;
  }

  const { datasource_id: _legacyDatasourceId, ...rest } = value;
  return { ...rest, filters };
}

async function constrainSearchBody(
  session: AuthorizedRagContext['session'],
  headers: Record<string, string>,
  pathSegments: string[],
  body: unknown,
): Promise<unknown> {
  if (session.role === 'admin' || !isRecord(body)) {
    return body;
  }

  const targetPath = pathSegments.join('/');
  if (targetPath !== 'v1/query' && targetPath !== 'v1/mcp/invoke') {
    return body;
  }

  const allowedDatasourceIds = await loadReadableDatasourceIds(session, headers);
  if (targetPath === 'v1/query') {
    return constrainDatasourceFilter(body, allowedDatasourceIds);
  }

  const args = body.arguments;
  if (!isRecord(args) || typeof args.query !== 'string') {
    return body;
  }

  return {
    ...body,
    arguments: constrainDatasourceFilter(args, allowedDatasourceIds),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const ragServerUrl = getRagServerUrl();
    const targetPath = path.join('/');
    const targetUrl = new URL(`${ragServerUrl}/${targetPath}`);

    const searchParams = request.nextUrl.searchParams;
    searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    const { headers, session } = await getAuthorizedRagContext('GET', path, request);
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    const filteredData = await filterDatasourceListResponse(session, path, data);
    return NextResponse.json(filteredData, { status: response.status });
  } catch (error) {
    if (error instanceof ApiError) {
      return handleApiError(error);
    }
    console.error('[RAG Proxy] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to RAG server', details: String(error) },
      { status: 502 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const ragServerUrl = getRagServerUrl();
    const targetPath = path.join('/');
    const targetUrl = `${ragServerUrl}/${targetPath}`;

    let body: unknown = undefined;
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 0) {
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
    }

    const { headers, session } = await getAuthorizedRagContext('POST', path, request, body);
    body = await constrainSearchBody(session, headers, path, body);
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof ApiError) {
      return handleApiError(error);
    }
    console.error('[RAG Proxy] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to RAG server', details: String(error) },
      { status: 502 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const ragServerUrl = getRagServerUrl();
    const targetPath = path.join('/');
    const targetUrl = `${ragServerUrl}/${targetPath}`;

    let body: unknown = undefined;
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 0) {
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
    }

    const { headers } = await getAuthorizedRagContext('PUT', path, request, body);
    const fetchOptions: RequestInit = {
      method: 'PUT',
      headers,
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof ApiError) {
      return handleApiError(error);
    }
    console.error('[RAG Proxy] PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to RAG server', details: String(error) },
      { status: 502 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const ragServerUrl = getRagServerUrl();
    const targetPath = path.join('/');
    const targetUrl = new URL(`${ragServerUrl}/${targetPath}`);

    const searchParams = request.nextUrl.searchParams;
    searchParams.forEach((value, key) => {
      targetUrl.searchParams.append(key, value);
    });

    const { headers } = await getAuthorizedRagContext('DELETE', path, request);
    const response = await fetch(targetUrl.toString(), {
      method: 'DELETE',
      headers,
    });

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof ApiError) {
      return handleApiError(error);
    }
    console.error('[RAG Proxy] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to RAG server', details: String(error) },
      { status: 502 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const ragServerUrl = getRagServerUrl();
    const targetPath = path.join('/');
    const targetUrl = `${ragServerUrl}/${targetPath}`;

    let body: unknown = undefined;
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 0) {
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
    }

    const { headers } = await getAuthorizedRagContext('PATCH', path, request, body);
    const fetchOptions: RequestInit = { method: 'PATCH', headers };
    if (body !== undefined) fetchOptions.body = JSON.stringify(body);

    const response = await fetch(targetUrl, fetchOptions);
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof ApiError) return handleApiError(error);
    console.error('[RAG Proxy] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to RAG server', details: String(error) },
      { status: 502 }
    );
  }
}
