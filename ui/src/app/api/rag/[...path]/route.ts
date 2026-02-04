import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

/**
 * RAG API Proxy with Hybrid Authentication
 *
 * Proxies requests from /api/rag/* to the RAG server with authentication.
 * Supports both JWT Bearer tokens and OAuth2Proxy-style headers.
 *
 * Authentication (in order of preference):
 * 1. Authorization: Bearer {access_token} (JWT from OIDC)
 * 2. X-Forwarded-Email, X-Forwarded-Groups (OAuth2Proxy style)
 *
 * Example:
 *   /api/rag/healthz -> RAG_SERVER_URL/healthz (with auth headers)
 *   /api/rag/v1/query -> RAG_SERVER_URL/v1/query (with auth headers)
 */

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL ||
         process.env.NEXT_PUBLIC_RAG_URL ||
         'http://localhost:9446';
}

/**
 * Get auth headers from the current session
 * 
 * Tries JWT Bearer token first, falls back to OAuth2Proxy headers if JWT not available.
 * This supports both JWT-based RBAC and OAuth2Proxy deployments.
 * 
 * @returns Headers object with authentication for RAG server
 */
async function getRbacHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const session = await getServerSession(authOptions);
    
    // Prefer JWT Bearer token if available (most secure, includes all claims)
    if (session?.accessToken) {
      headers['Authorization'] = `Bearer ${session.accessToken}`;
      return headers;
    }
    
    // Fall back to OAuth2Proxy-style headers
    // The RAG server expects X-Forwarded-Email and X-Forwarded-Groups headers
    if (session?.user?.email) {
      headers['X-Forwarded-Email'] = session.user.email;
      
      // Forward groups if available (from session.groups or session.user.groups)
      const groups = (session as any).groups || (session.user as any).groups || [];
      if (Array.isArray(groups) && groups.length > 0) {
        headers['X-Forwarded-Groups'] = groups.join(',');
      }
      
      // Also forward user name if available
      if (session.user.name) {
        headers['X-Forwarded-User'] = session.user.name;
      }
    }
  } catch (error) {
    // If session retrieval fails, continue without auth headers
    // This allows unauthenticated access when ALLOW_UNAUTHENTICATED=true on RAG server
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
