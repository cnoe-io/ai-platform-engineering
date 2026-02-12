import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

/**
 * User Info API Endpoint - Proxy to RAG Server
 *
 * This endpoint proxies to the RAG server's /v1/user/info endpoint.
 * The RAG server determines role and permissions based on JWT Bearer token.
 * 
 * Authentication:
 * - Authorization: Bearer {access_token} (OIDC JWT access token)
 * - X-Identity-Token: {id_token} (OIDC JWT ID token for claims extraction)
 * 
 * The RAG server does not support OAuth2Proxy headers.
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
    
    // Debug logging
    console.log('[User Info] Session state:', {
      hasSession: !!session,
      hasUser: !!session?.user,
      userEmail: session?.user?.email,
      hasAccessToken: !!session?.accessToken,
      hasIdToken: !!session?.idToken,
      accessTokenPrefix: session?.accessToken ? session.accessToken.substring(0, 20) + '...' : 'MISSING',
      expiresAt: session?.expiresAt ? new Date((session.expiresAt as number) * 1000).toISOString() : 'N/A'
    });
    
    // Pass JWT access token as Bearer token
    // RAG server validates JWT and uses it for authentication
    if (session?.accessToken) {
      headers['Authorization'] = `Bearer ${session.accessToken}`;
    } else {
      console.warn('[User Info] ⚠️  No accessToken in session - RAG server will use trusted network or anonymous');
    }

    // Pass ID token for claims extraction (email, groups)
    // Some OIDC providers only include user claims in the ID token, not the access token
    if (session?.idToken) {
      headers['X-Identity-Token'] = session.idToken;
    }
  } catch (error) {
    console.error('[User Info] Error retrieving session:', error);
  }

  return headers;
}

export async function GET() {
  const ragServerUrl = getRagServerUrl();
  const targetUrl = `${ragServerUrl}/v1/user/info`;
  const headers = await getRbacHeaders();

  // Debug logging
  console.log('[User Info] Request headers:', {
    hasAuthorization: !!headers['Authorization'],
    authHeader: headers['Authorization'] ? `${headers['Authorization'].substring(0, 20)}...` : 'MISSING'
  });

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    
    // Debug logging
    console.log('[User Info] RAG response:', {
      status: response.status,
      is_authenticated: data.is_authenticated,
      role: data.role,
      permissions: data.permissions,
      email: data.email
    });
    
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[User Info] Error fetching from RAG server:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user info from RAG server', details: String(error) },
      { status: 502 }
    );
  }
}

