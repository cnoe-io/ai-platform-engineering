// API middleware for Next.js API routes
// Provides authentication, error handling, and validation

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';
import { getConfig } from '@/lib/config';
import { getCollection } from '@/lib/mongodb';
import type { User } from '@/types/mongodb';
import { validateBearerJWT, validateLocalSkillsJWT } from '@/lib/jwt-validation';

// ============================================================================
// Authentication Middleware
// ============================================================================

export interface AuthenticatedRequest extends NextRequest {
  user?: {
    email: string;
    name: string;
    role: string;
  };
}

export interface GetAuthenticatedUserOptions {
  /**
   * When true and SSO is disabled, no session returns a fallback anonymous user
   * (for local dev / no-SSO). When false (default), no session always throws 401.
   */
  allowAnonymous?: boolean;
}

/**
 * Get authenticated user from session
 * Returns user info and full session, or throws 401 error
 *
 * Protected routes (via withAuth) require a real session: no session → 401.
 * Optional allowAnonymous allows a fallback user when SSO is disabled for
 * routes that explicitly permit unauthenticated access in local dev.
 *
 * Admin role is determined by:
 * 1. OIDC group membership (session.role from auth-config)
 * 2. MongoDB user.metadata.role === 'admin' (fallback)
 */
export async function getAuthenticatedUser(
  request: NextRequest,
  options: GetAuthenticatedUserOptions = {}
) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.email) {
    const { allowAnonymous = false } = options;
    if (allowAnonymous && !getConfig('ssoEnabled')) {
      const fallbackUser = { email: 'anonymous@local', name: 'Anonymous', role: 'admin' };
      return { user: fallbackUser, session: { role: 'admin', canViewAdmin: true } };
    }
    throw new ApiError('Unauthorized', 401);
  }

  let role = session.role || 'user'; // Get role from OIDC session first

  // Fallback: Check MongoDB user profile if not admin via OIDC
  if (role !== 'admin') {
    try {
      const users = await getCollection<User>('users');
      const dbUser = await users.findOne({ email: session.user.email });

      if (dbUser?.metadata?.role === 'admin') {
        role = 'admin';
        console.log(`[Auth] User ${session.user.email} is admin via MongoDB profile`);
      }
    } catch (error) {
      // MongoDB not available or error - continue with OIDC role
      console.warn('[Auth] Could not check MongoDB for admin role:', error);
    }
  }

  const user = {
    email: session.user.email,
    name: session.user.name || session.user.email,
    role,
  };

  return { user, session: { ...session, role, canViewAdmin: session.canViewAdmin ?? false } };
}

/**
 * Require authentication for API route
 * Use this as a wrapper for protected endpoints.
 * allowAnonymous is set to !ssoEnabled: anonymous fallback only fires when SSO is off.
 * When SSO is enabled, no session → 401.
 */
export async function withAuth<T>(
  request: NextRequest,
  handler: (
    request: NextRequest,
    user: { email: string; name: string; role: string },
    session: any
  ) => Promise<T>
): Promise<T> {
  const { user, session } = await getAuthenticatedUser(request, { allowAnonymous: !getConfig('ssoEnabled') });
  return handler(request, user, session);
}

/**
 * Authenticate via Bearer JWT token or NextAuth session (dual-auth).
 *
 * 1. If `Authorization: Bearer <token>` header is present, validate the JWT.
 * 2. Otherwise fall back to `getServerSession(authOptions)` (cookie auth).
 * 3. If neither succeeds, throws 401.
 *
 * Returns a minimal user object compatible with the existing withAuth handler
 * signature, plus the raw session when available.
 */
export async function getAuthFromBearerOrSession(
  request: NextRequest,
): Promise<{ user: { email: string; name: string; role: string }; session: any }> {
  const authHeader = request.headers.get('Authorization');

  // Path 1: Bearer JWT
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    // Try local skills API token first (fast HS256, no network)
    const localIdentity = await validateLocalSkillsJWT(token);
    if (localIdentity) {
      return {
        user: { email: localIdentity.email, name: localIdentity.name, role: 'user' },
        session: { role: 'user', canViewAdmin: false },
      };
    }

    // Fall through to OIDC JWKS validation
    const identity = await validateBearerJWT(token);
    // Bearer users get 'user' role by default; admin escalation is session-only
    const user = { email: identity.email, name: identity.name, role: 'user' };
    return { user, session: { role: 'user', canViewAdmin: false } };
  }

  // Path 2: Session cookie (existing NextAuth flow)
  const { user, session } = await getAuthenticatedUser(request, { allowAnonymous: !getConfig('ssoEnabled') });
  return { user, session };
}

/**
 * Require admin role for write operations.
 * Throws 403 if user is not admin.
 */
export function requireAdmin(session: { role?: string }): void {
  if (session.role !== 'admin') {
    throw new ApiError('Admin access required - must be member of admin group', 403);
  }
}

/**
 * Require admin view access for read-only admin endpoints.
 * Checks session.canViewAdmin (set from OIDC_REQUIRED_ADMIN_VIEW_GROUP).
 * Admin users always have view access.
 * Throws 403 if user lacks the required group.
 */
export function requireAdminView(session: { role?: string; canViewAdmin?: boolean }): void {
  if (session.role === 'admin') return;
  if (session.canViewAdmin !== true) {
    throw new ApiError('Admin view access required - must be member of admin view group', 403);
  }
}

// ============================================================================
// Error Handling
// ============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Handle API errors and return appropriate response
 */
export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);

  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
      },
      { status: error.statusCode }
    );
  }

  if (error instanceof Error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Internal server error',
    },
    { status: 500 }
  );
}

/**
 * Wrap API route handler with error handling
 */
export function withErrorHandler<T>(
  handler: (request: NextRequest, context?: any) => Promise<NextResponse<T>>
) {
  return async (request: NextRequest, context?: any): Promise<NextResponse<T>> => {
    try {
      return await handler(request, context);
    } catch (error) {
      return handleApiError(error) as NextResponse<T>;
    }
  };
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate required fields in request body
 */
export function validateRequired(data: any, fields: string[]): void {
  const missing = fields.filter((field) => data[field] === undefined || data[field] === null);

  if (missing.length > 0) {
    throw new ApiError(
      `Missing required fields: ${missing.join(', ')}`,
      400,
      'VALIDATION_ERROR'
    );
  }
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate UUID format
 */
export function validateUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Parse and validate pagination parameters
 */
export function getPaginationParams(request: NextRequest) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('page_size') || '20');

  if (page < 1) {
    throw new ApiError('Page must be >= 1', 400);
  }

  if (pageSize < 1 || pageSize > 100) {
    throw new ApiError('Page size must be between 1 and 100', 400);
  }

  return { page, pageSize, skip: (page - 1) * pageSize };
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Create success response
 */
export function successResponse<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status }
  );
}

/**
 * Create paginated response
 */
export function paginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number
): NextResponse {
  return NextResponse.json({
    success: true,
    data: {
      items,
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
    },
  });
}

/**
 * Create error response
 */
export function errorResponse(
  message: string,
  statusCode: number = 400,
  code?: string
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code,
    },
    { status: statusCode }
  );
}

// ============================================================================
// Authorization Helpers
// ============================================================================

/**
 * Check if user owns a resource
 */
export function requireOwnership(ownerId: string, userId: string) {
  if (ownerId !== userId) {
    throw new ApiError('Forbidden: You do not own this resource', 403, 'FORBIDDEN');
  }
}

/**
 * Resolve all team IDs that a user belongs to.
 * Looks up the teams collection for teams where the user is a member.
 */
export async function getUserTeamIds(userEmail: string): Promise<string[]> {
  try {
    const teams = await getCollection('teams');
    const userTeams = await teams
      .find({ 'members.user_id': userEmail })
      .project({ _id: 1 })
      .toArray();
    return userTeams.map((t: any) => t._id.toString());
  } catch {
    return [];
  }
}

export type ConversationAccessLevel = 'owner' | 'shared' | 'shared_readonly' | 'admin_audit';

interface ConversationAccessResult {
  conversation: any;
  access_level: ConversationAccessLevel;
}

/**
 * Check if user has access to a conversation (owner, shared with directly,
 * shared with one of their teams, via sharing_access records, or admin audit).
 *
 * When `session` is provided and the user is an admin, they receive read-only
 * audit access even if they are not the owner or a share recipient.
 */
export async function requireConversationAccess(
  conversationId: string,
  userId: string,
  getCollectionFn: (name: string) => Promise<any>,
  session?: { role?: string; canViewAdmin?: boolean }
): Promise<ConversationAccessResult> {
  const conversations = await getCollectionFn('conversations');
  const conversation = await conversations.findOne({ _id: conversationId });

  if (!conversation) {
    throw new ApiError('Conversation not found', 404, 'NOT_FOUND');
  }

  // Check if user is owner
  if (conversation.owner_id === userId) {
    return { conversation, access_level: 'owner' };
  }

  // Check if conversation is public (shared with everyone).
  // Default to read-only ('view') so non-owners cannot send messages in
  // public conversations — prevents cross-user context_id collisions.
  if (conversation.sharing?.is_public) {
    const perm = conversation.sharing?.public_permission ?? 'view';
    return {
      conversation,
      access_level: perm === 'comment' ? 'shared' : 'shared_readonly',
    };
  }

  // Check if conversation is shared with user directly
  if (conversation.sharing?.shared_with?.includes(userId)) {
    const sharingAccess = await getCollectionFn('sharing_access');
    const accessRecord = await sharingAccess.findOne({
      conversation_id: conversationId,
      granted_to: userId,
      revoked_at: null,
    });
    // Default to 'comment' (full access) for backward compatibility with
    // shares created before permissions were introduced
    const perm = accessRecord?.permission ?? 'comment';
    return {
      conversation,
      access_level: perm === 'comment' ? 'shared' : 'shared_readonly',
    };
  }

  // Check if conversation is shared with one of the user's teams
  const sharedTeams = conversation.sharing?.shared_with_teams;
  if (sharedTeams && sharedTeams.length > 0) {
    const userTeamIds = await getUserTeamIds(userId);
    if (userTeamIds.length > 0) {
      const matchedTeamId = sharedTeams.find((teamId: string) =>
        userTeamIds.includes(teamId)
      );
      if (matchedTeamId) {
        const teamPerms = conversation.sharing?.team_permissions;
        const perm = teamPerms?.[matchedTeamId] ?? 'comment';
        return {
          conversation,
          access_level: perm === 'comment' ? 'shared' : 'shared_readonly',
        };
      }
    }
  }

  // Check sharing_access collection (link-based or other grants)
  const sharingAccess = await getCollectionFn('sharing_access');
  const access = await sharingAccess.findOne({
    conversation_id: conversationId,
    granted_to: userId,
    revoked_at: null,
  });

  if (access) {
    const perm = access.permission ?? 'comment';
    return {
      conversation,
      access_level: perm === 'comment' ? 'shared' : 'shared_readonly',
    };
  }

  // Admins get read-only audit access to any conversation
  if (session?.role === 'admin' || session?.canViewAdmin === true) {
    return { conversation, access_level: 'admin_audit' };
  }

  throw new ApiError('Forbidden: You do not have access to this conversation', 403, 'FORBIDDEN');
}
