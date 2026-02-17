import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

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
 */

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL ||
         process.env.NEXT_PUBLIC_RAG_URL ||
         'http://localhost:9446';
}

/**
 * Get auth headers from the current session
 * 
 * Extracts JWT access token from session and sends to RAG server.
 * The RAG server uses this token to authenticate and fetch user claims
 * from the OIDC userinfo endpoint (with caching).
 * 
 * @returns Headers object with Authorization Bearer token for RAG server
 */
async function getRbacHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const session = await getServerSession(authOptions);
    
    // Pass JWT access token as Bearer token
    // RAG server validates JWT and fetches user claims from OIDC userinfo endpoint
    if (session?.accessToken) {
      headers['Authorization'] = `Bearer ${session.accessToken}`;
    }
  } catch (error) {
    // If session retrieval fails, continue without auth headers
    // RAG server may still allow access from trusted networks or anonymous users
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
