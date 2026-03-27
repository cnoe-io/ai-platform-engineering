// API middleware for Next.js API routes
// Provides authentication, error handling, and validation

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, isBootstrapAdmin, REQUIRED_ADMIN_GROUP } from '@/lib/auth-config';
import { getConfig } from '@/lib/config';
import { getCollection } from '@/lib/mongodb';
import type { User } from '@/types/mongodb';
import { validateBearerJWT, validateLocalSkillsJWT } from '@/lib/jwt-validation';

// ============================================================================
// Helpers
// ============================================================================

function decodeJwtPayloadForAuth(accessToken: string): Record<string, unknown> {
  const parts = accessToken.split('.');
  if (parts.length < 2) return {};
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

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
      const fallbackUser = { email: 'anonymous@local', name: 'Anonymous', role: 'user' };
      return { user: fallbackUser, session: { role: 'user' } };
    }
    throw new ApiError('Unauthorized', 401);
  }

  let role = session.role || 'user'; // Get role from OIDC session first

  if (role !== 'admin') {
    // Fallback 1: Check access token realm_access.roles for the admin group.
    // session.role is only set during initial sign-in; if the user signed in
    // before the admin role was assigned, the stale JWT still says 'user'.
    // Reading the live access token is authoritative.
    if (session.accessToken) {
      try {
        const payload = decodeJwtPayloadForAuth(session.accessToken);
        const realmRoles: string[] =
          (payload.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
        if (
          REQUIRED_ADMIN_GROUP &&
          realmRoles.some((r: string) => r.toLowerCase() === REQUIRED_ADMIN_GROUP.toLowerCase())
        ) {
          role = 'admin';
          console.log(`[Auth] User ${session.user.email} is admin via access-token realm role`);
        }
      } catch {
        // Token decode failed — continue with other fallbacks
      }
    }
  }

  if (role !== 'admin') {
    // Fallback 2: Bootstrap admin emails (env-based, for initial setup)
    if (isBootstrapAdmin(session.user.email)) {
      role = 'admin';
      console.log(`[Auth] User ${session.user.email} is admin via BOOTSTRAP_ADMIN_EMAILS`);
    }
  }

  if (role !== 'admin') {
    // Fallback 3: Check MongoDB user profile
    try {
      const users = await getCollection<User>('users');
      const dbUser = await users.findOne({ email: session.user.email });

      if (dbUser?.metadata?.role === 'admin') {
        role = 'admin';
        console.log(`[Auth] User ${session.user.email} is admin via MongoDB profile`);
      }
    } catch (error) {
      console.warn('[Auth] Could not check MongoDB for admin role:', error);
    }
  }

  const user = {
    email: session.user.email,
    name: session.user.name || session.user.email,
    role,
  };

  return { user, session: { ...session, role } };
}

/**
 * Require authentication for API route
 * Use this as a wrapper for protected endpoints.
 * No session → 401 (never uses anonymous fallback).
 */
export async function withAuth<T>(
  request: NextRequest,
  handler: (
    request: NextRequest,
    user: { email: string; name: string; role: string },
    session: any
  ) => Promise<T>
): Promise<T> {
  const { user, session } = await getAuthenticatedUser(request, { allowAnonymous: false });
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
        session: { role: 'user' },
      };
    }

    // Fall through to OIDC JWKS validation
    const identity = await validateBearerJWT(token);
    // Bearer users get 'user' role by default; admin escalation is session-only
    const user = { email: identity.email, name: identity.name, role: 'user' };
    return { user, session: { role: 'user' } };
  }

  // Path 2: Session cookie (existing NextAuth flow)
  const { user, session } = await getAuthenticatedUser(request, { allowAnonymous: false });
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


// ============================================================================
// Enterprise RBAC (098) — Keycloak Authorization Services
// ============================================================================

import { checkPermission } from '@/lib/rbac/keycloak-authz';
import { logAuthzDecision } from '@/lib/rbac/audit';
import { deniedApiResponse } from '@/lib/rbac/error-responses';
import { evaluate as evalCel } from '@/lib/rbac/cel-evaluator';
import type { RbacResource, RbacScope } from '@/lib/rbac/types';

function parseCelRbacExpressions(): Record<string, string> {
  const raw = process.env.CEL_RBAC_EXPRESSIONS?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
      }
      return out;
    }
  } catch (e) {
    console.warn('[CEL] Invalid CEL_RBAC_EXPRESSIONS JSON — ignoring map:', e);
  }
  return {};
}

function decodeJwtPayload(accessToken: string): Record<string, unknown> {
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return {};
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildRbacCelContext(
  session: { accessToken?: string; sub?: string; org?: string },
  resource: RbacResource,
  scope: RbacScope,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const payload = session.accessToken ? decodeJwtPayload(session.accessToken) : {};
  const ra = (payload.realm_access as { roles?: string[] } | undefined)?.roles;
  const roles = Array.isArray(ra) ? [...ra] : [];
  const teams: string[] = [];
  const baseResource = {
    id: '',
    type: resource,
    visibility: '',
    owner_id: '',
    shared_with_teams: teams as string[],
  };
  const resourceObj =
    extra?.resource && typeof extra.resource === 'object'
      ? { ...baseResource, ...(extra.resource as Record<string, unknown>) }
      : baseResource;
  return {
    user: {
      email: String(payload.email ?? payload.preferred_username ?? session.sub ?? ''),
      teams,
      roles,
    },
    resource: resourceObj,
    action: typeof extra?.action === 'string' ? extra.action : scope,
  };
}

/**
 * Minimum realm role required per resource when falling back from Keycloak
 * AuthZ Services to token-based role checking.
 */
const RESOURCE_ROLE_FALLBACK: Partial<Record<RbacResource, string>> = {
  admin_ui: 'admin',
  supervisor: 'chat_user',
  rag: 'chat_user',
};

/**
 * Check whether the access token's realm_access.roles (or bootstrap emails)
 * satisfy the minimum role required for the given resource.
 */
function hasRoleFallback(
  accessToken: string,
  resource: RbacResource,
  email?: string,
): boolean {
  const requiredRole = RESOURCE_ROLE_FALLBACK[resource];
  if (!requiredRole) return false;

  if (requiredRole === 'admin' && isBootstrapAdmin(email)) return true;

  try {
    const payload = decodeJwtPayloadForAuth(accessToken);
    const realmRoles: string[] =
      (payload.realm_access as { roles?: string[] } | undefined)?.roles ?? [];
    return realmRoles.some((r: string) => r.toLowerCase() === requiredRole.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Require a specific RBAC permission via Keycloak AuthZ Services (PDP-1).
 *
 * Calls Keycloak's UMA ticket grant to verify the user's access token has
 * the required {resource}#{scope} permission. When the PDP is unavailable or
 * the Authorization Services are not configured, falls back to checking the
 * access token's realm_access.roles for the minimum required role. This
 * allows gradual rollout of fine-grained AuthZ without breaking access for
 * existing admins. Logs an audit event for every allow/deny decision.
 */
export async function requireRbacPermission(
  session: { accessToken?: string; sub?: string; org?: string; user?: { email?: string } },
  resource: RbacResource,
  scope: RbacScope,
  celContext?: Record<string, unknown>
): Promise<void> {
  const accessToken = session.accessToken;
  const email = session.user?.email;

  if (!accessToken) {
    logAuthzDecision({
      tenantId: session.org ?? 'unknown',
      sub: session.sub ?? 'unknown',
      resource,
      scope,
      outcome: 'deny',
      reasonCode: 'DENY_NO_TOKEN',
      pdp: 'keycloak',
      email,
    });
    throw new ApiError('Authentication required', 401);
  }

  const result = await checkPermission({ resource, scope, accessToken });

  if (result.allowed) {
    logAuthzDecision({
      tenantId: session.org ?? 'unknown',
      sub: session.sub ?? 'unknown',
      resource,
      scope,
      outcome: 'allow',
      reasonCode: 'OK',
      pdp: 'keycloak',
      email,
    });
  } else {
    // PDP denied or unavailable — attempt role-based fallback so that
    // environments without Keycloak AuthZ Services still work.
    const fallbackAllowed = hasRoleFallback(accessToken, resource, email);
    if (fallbackAllowed) {
      logAuthzDecision({
        tenantId: session.org ?? 'unknown',
        sub: session.sub ?? 'unknown',
        resource,
        scope,
        outcome: 'allow',
        reasonCode: 'OK_ROLE_FALLBACK',
        pdp: 'local',
        email,
      });
      console.log(
        `[RBAC] Keycloak AuthZ denied/unavailable for ${resource}#${scope} — ` +
        `allowed via role fallback (${RESOURCE_ROLE_FALLBACK[resource]})`
      );
    } else {
      const reasonCode = result.reason === 'DENY_PDP_UNAVAILABLE'
        ? 'DENY_PDP_UNAVAILABLE' : 'DENY_NO_CAPABILITY';
      logAuthzDecision({
        tenantId: session.org ?? 'unknown',
        sub: session.sub ?? 'unknown',
        resource,
        scope,
        outcome: 'deny',
        reasonCode,
        pdp: 'keycloak',
        email,
      });
      if (result.reason === 'DENY_PDP_UNAVAILABLE') {
        throw new ApiError('Authorization service unavailable — access denied (fail-closed)', 503);
      }
      const denial = deniedApiResponse(resource, scope);
      throw new ApiError(denial.message, 403, denial.capability);
    }
  }

  // Supplementary CEL policy layer (applied after PDP or role-fallback allow)
  const celMap = parseCelRbacExpressions();
  const celKey = `${resource}#${scope}`;
  const celExpr = celMap[celKey];
  if (celExpr) {
    const ctx = buildRbacCelContext(session, resource, scope, celContext);
    const ok = evalCel(celExpr, ctx);
    if (!ok) {
      logAuthzDecision({
        tenantId: session.org ?? 'unknown',
        sub: session.sub ?? 'unknown',
        resource,
        scope,
        outcome: 'deny',
        reasonCode: 'DENY_CEL',
        pdp: 'keycloak',
        email,
      });
      throw new ApiError('Policy denied (CEL)', 403, 'CEL_DENIED');
    }
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
  session?: { role?: string }
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
  if (session?.role === 'admin') {
    return { conversation, access_level: 'admin_audit' };
  }

  throw new ApiError('Forbidden: You do not have access to this conversation', 403, 'FORBIDDEN');
}
