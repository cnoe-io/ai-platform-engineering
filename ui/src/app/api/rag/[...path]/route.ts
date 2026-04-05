import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

/**
 * RAG API Proxy
 *
 * Proxies requests from /api/rag/* to the RAG server.
 *
 * Authentication strategy depends on whether the RAG server is internal or external:
 *
 * - Internal cluster URL (svc.cluster.local, localhost, private IP):
 *   No Authorization header is sent. The RAG server's trusted-network middleware
 *   (TRUSTED_NETWORK_CIDRS=10.0.0.0/8) authenticates requests from the Next.js
 *   pod by source IP and grants TRUSTED_NETWORK_DEFAULT_ROLE.
 *   Sending a Bearer token here causes persistent 401s: the Duo OIDC access_token
 *   is signed with a key that is not published in Duo's public JWKS, so the
 *   rag-server can never validate it via the standard JWKS flow.
 *
 * - External URL (public hostname):
 *   Authorization: Bearer {access_token} is forwarded so the RAG server can
 *   authenticate and fetch per-user claims from the OIDC userinfo endpoint.
 *
 * Example:
 *   /api/rag/healthz              -> RAG_SERVER_URL/healthz
 *   /api/rag/v1/mcp/custom-tools  -> RAG_SERVER_URL/v1/mcp/custom-tools
 */

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL ||
         process.env.NEXT_PUBLIC_RAG_URL ||
         'http://localhost:9446';
}

/**
 * Returns true when the RAG server URL resolves to an in-cluster or loopback
 * address. In that case the Next.js pod (10.x.x.x) is already inside the
 * rag-server's trusted network — no Bearer token needed or wanted.
 */
function isInternalRagServer(): boolean {
  const url = getRagServerUrl();
  return (
    url.includes('svc.cluster.local') ||
    url.includes('localhost') ||
    /http:\/\/10\.\d+\.\d+\.\d+/.test(url) ||
    /http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/.test(url) ||
    /http:\/\/192\.168\.\d+\.\d+/.test(url)
  );
}

/**
 * Build request headers for the upstream RAG server.
 *
 * For internal URLs the Authorization header is intentionally omitted —
 * the rag-server's trusted-network check handles auth by source IP.
 */
async function getRbacHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isInternalRagServer()) {
    // Internal service: rely on trusted-network auth in the rag-server.
    // Sending a Bearer token that fails JWKS validation causes 401 on every call.
    return headers;
  }

  try {
    const session = await getServerSession(authOptions);
    if (session?.accessToken) {
      headers['Authorization'] = `Bearer ${session.accessToken}`;
    }
  } catch (error) {
    console.debug('[RAG Proxy] Could not retrieve session, proceeding without auth headers:', error);
  }

  return headers;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const ragServerUrl = getRagServerUrl();
  const targetPath = path.join('/');
  const targetUrl = new URL(`${ragServerUrl}/${targetPath}`);

  // Forward query parameters (important for pagination, filters, etc.)
  const searchParams = request.nextUrl.searchParams;
  searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  try {
    // Get auth headers from session
    const headers = await getRbacHeaders();
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error(`[RAG Proxy] Error fetching ${targetUrl}:`, error);
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
  const { path } = await params;
  const ragServerUrl = getRagServerUrl();
  const targetPath = path.join('/');
  const targetUrl = `${ragServerUrl}/${targetPath}`;

  try {
    // Handle empty body POST requests (e.g., terminate job)
    let body: unknown = undefined;
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 0) {
      try {
        body = await request.json();
      } catch {
        // Body is not JSON or empty, that's OK for some endpoints
        body = undefined;
      }
    }

    // Get auth headers from session
    const headers = await getRbacHeaders();
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers,
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Handle 204 No Content responses
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error(`[RAG Proxy] Error posting to ${targetUrl}:`, error);
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
  const { path } = await params;
  const ragServerUrl = getRagServerUrl();
  const targetPath = path.join('/');
  const targetUrl = `${ragServerUrl}/${targetPath}`;

  try {
    let body: unknown = undefined;
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 0) {
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
    }

    const headers = await getRbacHeaders();
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
    console.error(`[RAG Proxy] Error putting to ${targetUrl}:`, error);
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
  const { path } = await params;
  const ragServerUrl = getRagServerUrl();
  const targetPath = path.join('/');
  const targetUrl = new URL(`${ragServerUrl}/${targetPath}`);

  // Forward query parameters
  const searchParams = request.nextUrl.searchParams;
  searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  try {
    // Get auth headers from session
    const headers = await getRbacHeaders();
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
    console.error(`[RAG Proxy] Error deleting ${targetUrl}:`, error);
    return NextResponse.json(
      { error: 'Failed to connect to RAG server', details: String(error) },
      { status: 502 }
    );
  }
}
