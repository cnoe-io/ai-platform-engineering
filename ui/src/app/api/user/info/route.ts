import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

/**
 * User Info API Endpoint - Proxy to RAG Server
 *
 * This endpoint proxies to the RAG server's /v1/user/info endpoint.
 * The RAG server determines role and permissions based on the JWT token
 * we pass via Authorization header.
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

  // Pass access token as Bearer token
  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
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

