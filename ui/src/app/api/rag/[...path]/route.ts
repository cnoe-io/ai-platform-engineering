import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import {
  ApiError,
  requireRbacPermission,
  handleApiError,
} from '@/lib/api-middleware';
import type { RbacScope } from '@/lib/rbac/types';

function decodeJwtPayloadForTeam(accessToken: string | undefined): Record<string, unknown> {
  if (!accessToken) return {};
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return {};
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractTeamIdFromAccessToken(accessToken: string | undefined): string | undefined {
  const roles = (decodeJwtPayloadForTeam(accessToken).realm_access as { roles?: string[] } | undefined)
    ?.roles;
  if (!Array.isArray(roles)) return undefined;
  for (const role of roles) {
    const match = String(role).match(/^team_member\((.+)\)$/);
    if (match) return match[1];
  }
  return undefined;
}

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
 * RBAC (098): BFF enforces Keycloak AuthZ on `rag` before proxying —
 * GET/POST use `query` (read/search); PUT/DELETE use `admin` (098 matrix).
 */

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL ||
         process.env.NEXT_PUBLIC_RAG_URL ||
         'http://localhost:9446';
}

function scopeForRagProxyMethod(method: string): RbacScope {
  switch (method) {
    case 'GET':
    case 'POST':
      return 'query';
    case 'PUT':
    case 'DELETE':
      return 'admin';
    default:
      return 'query';
  }
}

/**
 * Require RBAC for the proxy, then build headers for the upstream RAG server.
 */
async function getAuthorizedRagHeaders(method: string): Promise<Record<string, string>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new ApiError('Unauthorized', 401);
  }

  await requireRbacPermission(
    { accessToken: session.accessToken, sub: session.sub, org: session.org, user: session.user },
    'rag',
    scopeForRagProxyMethod(method),
  );

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }
  if (session.org) {
    headers['X-Tenant-Id'] = session.org;
  }
  const teamId = extractTeamIdFromAccessToken(session.accessToken);
  if (teamId) {
    headers['X-Team-Id'] = teamId;
  }
  return headers;
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

    const headers = await getAuthorizedRagHeaders('GET');
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
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

    const headers = await getAuthorizedRagHeaders('POST');
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

    const headers = await getAuthorizedRagHeaders('PUT');
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

    const headers = await getAuthorizedRagHeaders('DELETE');
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
