import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

/**
 * RAG API Proxy with RBAC Header Injection
 *
 * Proxies requests from /api/rag/* to the RAG server with RBAC headers.
 * This enforces authentication server-side and injects required headers
 * for the RAG server's RBAC system.
 *
 * RBAC Headers Injected:
 * - X-Forwarded-Email: User's email from SSO session
 * - X-Forwarded-Groups: Comma-separated list of user's groups
 * - X-Forwarded-User: User's email (duplicate for compatibility)
 *
 * Example:
 *   /api/rag/healthz -> RAG_SERVER_URL/healthz (with headers)
 *   /api/rag/v1/query -> RAG_SERVER_URL/v1/query (with headers)
 */

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL ||
         process.env.NEXT_PUBLIC_RAG_URL ||
         'http://localhost:9446';
}

/**
 * Get RBAC headers from the current session
 * 
 * @returns Headers object with X-Forwarded-* headers for RAG server RBAC
 */
async function getRbacHeaders(): Promise<Record<string, string>> {
  const session = await getServerSession(authOptions);
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Only inject headers if user is authenticated
  if (session?.user?.email) {
    // X-Forwarded-Email: Primary user identifier
    headers['X-Forwarded-Email'] = session.user.email;
    
    // X-Forwarded-User: Duplicate for compatibility
    headers['X-Forwarded-User'] = session.user.email;
    
    // X-Forwarded-Groups: Comma-separated list of groups
    if (session.groups && session.groups.length > 0) {
      headers['X-Forwarded-Groups'] = session.groups.join(',');
    } else {
      // Empty groups means no group-based role assignment
      headers['X-Forwarded-Groups'] = '';
    }
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

  // Get RBAC headers from session
  const headers = await getRbacHeaders();

  try {
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

  // Get RBAC headers from session
  const headers = await getRbacHeaders();

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

  // Get RBAC headers from session
  const headers = await getRbacHeaders();

  try {
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
