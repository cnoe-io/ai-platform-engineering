import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

/**
 * User Info API Endpoint - Proxy to RAG Server
 *
 * This endpoint proxies to the RAG server's /v1/user/info endpoint.
 * The RAG server determines role and permissions based on the RBAC headers
 * we inject from the NextAuth session.
 *
 * This ensures single source of truth for RBAC logic.
 */

function getRagServerUrl(): string {
  return process.env.RAG_SERVER_URL ||
         process.env.NEXT_PUBLIC_RAG_URL ||
         'http://localhost:9446';
}

async function getRbacHeaders(): Promise<Record<string, string>> {
  const session = await getServerSession(authOptions);
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Only inject headers if user is authenticated
  if (session?.user?.email) {
    headers['X-Forwarded-Email'] = session.user.email;
    headers['X-Forwarded-User'] = session.user.email;
    
    if (session.groups && session.groups.length > 0) {
      headers['X-Forwarded-Groups'] = session.groups.join(',');
    } else {
      headers['X-Forwarded-Groups'] = '';
    }
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

