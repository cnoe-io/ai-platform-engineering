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
import {
  reconcileDataSourceRelationships,
  reconcileKnowledgeBaseRelationships,
  reconcileMcpToolRelationships,
} from '@/lib/rbac/openfga-owned-resources';
import { checkOpenFgaTuple } from '@/lib/rbac/openfga';
import { organizationObjectId } from '@/lib/rbac/organization';
import { getDevAnonymousSession, isDevAnonymousAuthEnabled } from '@/lib/auth/dev-auth-provider';

/**
 * RAG API Proxy with JWT Bearer Token Authentication
 *
 * Proxies requests from /api/rag/* to the RAG server with JWT authentication.
 * The RAG server validates the JWT token and uses the subject for OpenFGA
 * checks. Static IdP/AD groups are not consumed by RAG authorization.
 *
 * Authentication:
 * - Authorization: Bearer {access_token} (OIDC JWT access token)
 *
 * The RAG server uses the access_token to authenticate the caller and
 * derive OpenFGA subjects for resource checks.
 *
 * This is the standards-compliant OAuth approach - only the access_token is
 * passed downstream, and user claims are fetched server-side from the
 * authoritative source (OIDC provider's userinfo endpoint).
 *
 * Example:
 *   /api/rag/healthz -> RAG_SERVER_URL/healthz (with Bearer token)
 *   /api/rag/v1/query -> RAG_SERVER_URL/v1/query (with Bearer token)
 *
 * The Web UI backend enforces coarse RAG access before proxying and
 * checks object-level OpenFGA relationships where the request identifies
 * a knowledge base, data source, or MCP tool.
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
    return method === 'GET' || method === 'POST' ? 'query' : 'admin';
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

function resourceTypeForRagRequest(pathSegments: string[]): 'data_source' | 'knowledge_base' {
  const path = pathSegments.join('/').toLowerCase();
  if (
    path === 'v1/query' ||
    path === 'v1/mcp/invoke' ||
    path.startsWith('v1/ingest/') ||
    path === 'v1/datasource' ||
    path.startsWith('v1/datasource/') ||
    path === 'v1/datasources' ||
    path.startsWith('v1/datasources/')
  ) {
    return 'data_source';
  }
  return 'knowledge_base';
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
  pendingKnowledgeBaseOwnership?: {
    knowledgeBaseId: string;
    ownerSubject: string | null;
    ownerTeamSlug: string | null;
  };
  /**
   * Populated for `PUT /v1/mcp/custom-tools/<tool_id>`. The proxy
   * writes the `mcp_tool:<tool_id>` tuples after a successful upstream
   * response so the new tool is visible to the owner team's members in
   * the filtered list endpoint.
   */
  pendingMcpToolOwnership?: {
    toolId: string;
    ownerSubject: string | null;
    ownerTeamSlug: string | null;
  };
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isDatasourceCreateRequest(method: string, pathSegments: string[]): boolean {
  const path = pathSegments.join('/').toLowerCase();
  return method === 'POST' && (path === 'v1/datasource' || path === 'v1/datasources');
}

/**
 * Detect `PUT /v1/mcp/custom-tools/<tool_id>` — the RAG server's upsert
 * endpoint for custom MCP tools. The path's last segment is the
 * tool id when this returns true, mirroring `extractMcpToolId`.
 */
function isMcpToolUpsertRequest(method: string, pathSegments: string[]): boolean {
  const path = pathSegments.join('/').toLowerCase();
  return (
    method === 'PUT' &&
    path.startsWith('v1/mcp/custom-tools/') &&
    pathSegments.length === 4
  );
}

/**
 * Return the `tool_id` for an MCP-tool upsert path
 * (`v1/mcp/custom-tools/<tool_id>`). Returns null when the path doesn't
 * match the upsert pattern.
 */
function extractMcpToolId(pathSegments: string[]): string | null {
  if (
    pathSegments.length === 4 &&
    pathSegments[0] === 'v1' &&
    pathSegments[1] === 'mcp' &&
    pathSegments[2] === 'custom-tools'
  ) {
    const candidate = pathSegments[3]?.trim();
    return candidate && candidate.length > 0 ? candidate : null;
  }
  return null;
}

async function getAuthorizedRagContext(
  method: string,
  pathSegments: string[],
  request: NextRequest,
  body?: unknown,
): Promise<AuthorizedRagContext> {
  const session = await getServerSession(authOptions) ?? (
    isDevAnonymousAuthEnabled() ? getDevAnonymousSession() : null
  );
  if (!session?.user?.email) {
    throw new ApiError('Unauthorized', 401);
  }
  if (!session.accessToken && !isDevAnonymousAuthEnabled()) {
    throw new ApiError('A Keycloak access token is required for RAG access.', 401, 'NOT_SIGNED_IN');
  }

  await requireRbacPermission(
    { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
    'rag',
    scopeForRagProxyMethod(method, pathSegments),
  );

  const kbId = extractKnowledgeBaseId(request, pathSegments, body);
  let pendingKnowledgeBaseOwnership: AuthorizedRagContext['pendingKnowledgeBaseOwnership'];
  if (kbId && isDatasourceCreateRequest(method, pathSegments)) {
    const ownerTeamSlug = isRecord(body) ? normalizeString(body.owner_team_slug) : null;
    if (ownerTeamSlug) {
      await requireResourcePermission(
        { sub: session.sub, role: session.role, user: session.user },
        { type: 'team', id: ownerTeamSlug, action: 'use' },
      );
    }
    const ownerSubject = normalizeString(session.sub);
    if (!ownerSubject) {
      throw new ApiError('A stable user subject is required for knowledge base ownership.', 401, 'NO_SUBJECT');
    }
    pendingKnowledgeBaseOwnership = {
      knowledgeBaseId: kbId,
      ownerSubject,
      ownerTeamSlug,
    };
  } else if (kbId) {
    const authzSession = { sub: session.sub, role: session.role, user: session.user };
    const target = {
      type: resourceTypeForRagRequest(pathSegments),
      id: kbId,
      action: actionForRagRequest(method, pathSegments),
    };
    await requireResourcePermission(authzSession, target, { bypassForOrgAdmin: true });
  }

  let pendingMcpToolOwnership: AuthorizedRagContext['pendingMcpToolOwnership'];
  if (isMcpToolUpsertRequest(method, pathSegments)) {
    const toolId = extractMcpToolId(pathSegments);
    if (toolId) {
      const ownerTeamSlug = isRecord(body) ? normalizeString(body.owner_team_slug) : null;
      if (ownerTeamSlug) {
        await requireResourcePermission(
          { sub: session.sub, role: session.role, user: session.user },
          { type: 'team', id: ownerTeamSlug, action: 'use' },
        );
      }
      const ownerSubject = normalizeString(session.sub);
      pendingMcpToolOwnership = {
        toolId,
        ownerSubject,
        ownerTeamSlug,
      };
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }
  if (session.org) {
    headers['X-Tenant-Id'] = session.org;
  }
  // RAG derives the user's team membership from OpenFGA at request time
  // using the bearer-token subject (see `_kb_cel_context` on the server
  // side), so this proxy does not forward X-Team-Id or active_team.
  return { headers, session, pendingKnowledgeBaseOwnership, pendingMcpToolOwnership };
}

function isDatasourceListRequest(method: string, pathSegments: string[]): boolean {
  return method === 'GET' && pathSegments.join('/') === 'v1/datasources';
}

function datasourceId(resource: Record<string, unknown>): string {
  const value = resource.datasource_id ?? resource.id;
  return typeof value === 'string' ? value : '';
}

/**
 * Detect `GET /v1/mcp/custom-tools`. Used by `filterMcpToolListResponse`
 * to gate the BFF response on `mcp_tool#can_read` per row, with
 * org-admin bypass enabled. The RAG server doesn't yet enforce per-tool
 * ReBAC, so the filtering is BFF-side until PR4-server.
 */
function isMcpToolListRequest(method: string, pathSegments: string[]): boolean {
  return method === 'GET' && pathSegments.join('/') === 'v1/mcp/custom-tools';
}

function mcpToolIdOf(resource: Record<string, unknown>): string {
  const value = resource.tool_id ?? resource.id;
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
  const candidates = envelope.datasources.filter((resource) => datasourceId(resource));
  const datasources = await filterResourcesByPermission(
    session,
    candidates,
    {
      type: 'data_source',
      action: 'read',
      id: datasourceId,
    },
    { bypassForOrgAdmin: true },
  );

  return { ...envelope, datasources, count: datasources.length };
}

/**
 * Filter the `GET /v1/mcp/custom-tools` response to only the tools a
 * non-admin caller has `mcp_tool#can_read` on. Org admins see every
 * row (via `bypassForOrgAdmin: true`). RAG server returns a bare JSON
 * array of `MCPToolConfig`, so we filter the array in place and pass
 * through the array (rather than wrapping it in an envelope) to avoid
 * a breaking schema change for the UI.
 *
 * If the kill switch `RAG_ADMIN_BYPASS_DISABLED` is on, admins go
 * through the same per-tool filter as everyone else.
 * assisted-by Cursor claude-opus-4-7
 */
async function filterMcpToolListResponse(
  session: AuthorizedRagContext['session'],
  pathSegments: string[],
  data: unknown,
): Promise<unknown> {
  if (!isMcpToolListRequest('GET', pathSegments) || !Array.isArray(data)) {
    return data;
  }
  const candidates = (data as Array<Record<string, unknown>>).filter(
    (resource) => isRecord(resource) && mcpToolIdOf(resource).length > 0,
  );
  if (candidates.length === 0) return data;

  return await filterResourcesByPermission(
    session,
    candidates,
    {
      type: 'mcp_tool',
      action: 'read',
      id: mcpToolIdOf,
    },
    { bypassForOrgAdmin: true },
  );
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
      type: 'data_source',
      action: 'read',
      id: datasourceId,
    },
    { bypassForOrgAdmin: true },
  );

  return datasources.map(datasourceId).filter(Boolean);
}

function constrainDatasourceFilter(
  value: Record<string, unknown>,
  allowedDatasourceIds: string[],
): Record<string, unknown> {
  if (allowedDatasourceIds.length === 0) {
    throw new ApiError('No readable data sources are assigned to this user.', 403, 'data_source#read');
  }

  const filters = isRecord(value.filters) ? { ...value.filters } : {};
  const existing = filters.datasource_id ?? value.datasource_id;

  if (typeof existing === 'string') {
    if (!allowedDatasourceIds.includes(existing)) {
      throw new ApiError('You do not have permission to search this data source.', 403, 'data_source#read');
    }
    filters.datasource_id = existing;
  } else if (Array.isArray(existing)) {
    const intersection = existing.filter(
      (candidate): candidate is string =>
        typeof candidate === 'string' && allowedDatasourceIds.includes(candidate),
    );
    if (intersection.length === 0) {
      throw new ApiError('You do not have permission to search these data sources.', 403, 'data_source#read');
    }
    filters.datasource_id = intersection.length === 1 ? intersection[0] : intersection;
  } else {
    filters.datasource_id = allowedDatasourceIds.length === 1 ? allowedDatasourceIds[0] : allowedDatasourceIds;
  }

  const { datasource_id, ...rest } = value;
  void datasource_id;
  return { ...rest, filters };
}

function isOrgAdminBypassKillSwitchEnabled(): boolean {
  const raw = process.env.RAG_ADMIN_BYPASS_DISABLED;
  if (!raw) return false;
  return raw === '1' || raw.trim().toLowerCase() === 'true';
}

async function isOrgAdminSession(session: AuthorizedRagContext['session']): Promise<boolean> {
  if (isOrgAdminBypassKillSwitchEnabled()) return false;
  const subject = typeof session.sub === 'string' && session.sub.trim() ? session.sub.trim() : null;
  if (!subject) return false;
  try {
    const result = await checkOpenFgaTuple({
      user: `user:${subject}`,
      relation: 'can_manage',
      object: organizationObjectId(),
    });
    return result.allowed === true;
  } catch {
    return false;
  }
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

  // Org admins (per OpenFGA `organization#admin`) skip the per-KB filter
  // injection on KB-aware search. The kill-switch env var disables this
  // bypass. See `bypassForOrgAdmin` in resource-authz.ts.
  if (await isOrgAdminSession(session)) {
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
    let filteredData = await filterDatasourceListResponse(session, path, data);
    filteredData = await filterMcpToolListResponse(session, path, filteredData);
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

    const { headers, session, pendingKnowledgeBaseOwnership } = await getAuthorizedRagContext('POST', path, request, body);
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
    if (response.ok && pendingKnowledgeBaseOwnership) {
      // KB-backed datasources use the same identifier for data_source and
      // knowledge_base relationships, so keep both resource graphs aligned.
      // assisted-by Cursor claude-opus-4-7
      await reconcileKnowledgeBaseRelationships(pendingKnowledgeBaseOwnership);
      await reconcileDataSourceRelationships({
        dataSourceId: pendingKnowledgeBaseOwnership.knowledgeBaseId,
        ownerSubject: pendingKnowledgeBaseOwnership.ownerSubject,
        ownerTeamSlug: pendingKnowledgeBaseOwnership.ownerTeamSlug,
      });
    }
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

    const { headers, pendingMcpToolOwnership } = await getAuthorizedRagContext('PUT', path, request, body);
    const fetchOptions: RequestInit = {
      method: 'PUT',
      headers,
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    if (response.status === 204) {
      if (pendingMcpToolOwnership) {
        await reconcileMcpToolRelationships(pendingMcpToolOwnership);
      }
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    if (response.ok && pendingMcpToolOwnership) {
      await reconcileMcpToolRelationships(pendingMcpToolOwnership);
    }
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
