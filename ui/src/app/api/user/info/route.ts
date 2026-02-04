import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

/**
 * User Info API Endpoint - Proxy to RAG Server
 *
 * This endpoint proxies to the RAG server's /v1/user/info endpoint.
 * The RAG server determines role and permissions based on auth headers.
 * 
 * Supports hybrid authentication:
 * 1. JWT Bearer token (preferred)
 * 2. OAuth2Proxy-style headers (fallback)
 */

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL ||
         process.env.NEXT_PUBLIC_RAG_URL ||
         'http://localhost:9446';
}

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
    if (session?.user?.email) {
      headers['X-Forwarded-Email'] = session.user.email;
      
      const groups = (session as any).groups || (session.user as any).groups || [];
      if (Array.isArray(groups) && groups.length > 0) {
        headers['X-Forwarded-Groups'] = groups.join(',');
      }
      
      if (session.user.name) {
        headers['X-Forwarded-User'] = session.user.name;
      }
    }
  } catch (error) {
    console.debug('[User Info] Could not retrieve session, proceeding without auth headers:', error);
  }

  return headers;
}

export async function GET() {
  const ragServerUrl = getRagServerUrl();
  const targetUrl = `${ragServerUrl}/v1/user/info`;
  const headers = await getRbacHeaders();

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[User Info] Error fetching from RAG server:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user info from RAG server', details: String(error) },
      { status: 502 }
    );
  }
}

