import { getServerSession } from 'next-auth';
import type { NextRequest } from 'next/server';
import { ApiError, getAuthFromBearerOrSession } from '@/lib/api-middleware';
import { authOptions } from '@/lib/auth-config';
import { getDevAnonymousSession, isDevAnonymousAuthEnabled } from '@/lib/auth/dev-auth-provider';

/** Session shape used by /api/rag/* BFF proxies before forwarding to the RAG server. */
export type RagProxySession = {
  accessToken?: string;
  sub?: unknown;
  org?: string;
  role?: string;
  user?: { email?: string | null; name?: string | null };
};

/**
 * Resolve the caller for RAG BFF routes.
 *
 * - `Authorization: Bearer` → OIDC JWT (CLI, automation, first-party services)
 * - otherwise → NextAuth cookie session (browser), with dev-anonymous fallback
 */
export async function resolveRagProxySession(request: NextRequest): Promise<RagProxySession> {
  if (request.headers.get('Authorization')?.startsWith('Bearer ')) {
    const { user, session } = await getAuthFromBearerOrSession(request);
    const email = session.user?.email ?? user.email;
    if (!email) {
      throw new ApiError('Unauthorized', 401);
    }
    return {
      accessToken: session.accessToken,
      sub: session.sub,
      org: session.org,
      role: session.role ?? user.role,
      user: {
        email,
        name: session.user?.name ?? user.name,
      },
    };
  }

  const session = await getServerSession(authOptions) ?? (
    isDevAnonymousAuthEnabled() ? getDevAnonymousSession() : null
  );
  if (!session?.user?.email) {
    throw new ApiError('Unauthorized', 401);
  }

  return {
    accessToken: session.accessToken,
    sub: session.sub,
    org: session.org,
    role: session.role,
    user: session.user,
  };
}
