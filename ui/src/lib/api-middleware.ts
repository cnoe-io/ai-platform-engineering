// API middleware for Next.js API routes
// Provides authentication, error handling, and validation

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-config';

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

/**
 * Get authenticated user from session
 * Returns user info or throws 401 error
 */
export async function getAuthenticatedUser(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.email) {
    throw new ApiError('Unauthorized', 401);
  }

  return {
    email: session.user.email,
    name: session.user.name || session.user.email,
    role: 'user', // TODO: Get from session if available
  };
}

/**
 * Require authentication for API route
 * Use this as a wrapper for protected endpoints
 */
export async function withAuth<T>(
  request: NextRequest,
  handler: (request: NextRequest, user: { email: string; name: string; role: string }) => Promise<T>
): Promise<T> {
  const user = await getAuthenticatedUser(request);
  return handler(request, user);
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
  const missing = fields.filter((field) => !data[field]);

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
 * Check if user has access to a conversation (owner or shared with)
 */
export async function requireConversationAccess(
  conversationId: string,
  userId: string,
  getCollection: (name: string) => Promise<any>
) {
  const conversations = await getCollection('conversations');
  const conversation = await conversations.findOne({ _id: conversationId });

  if (!conversation) {
    throw new ApiError('Conversation not found', 404, 'NOT_FOUND');
  }

  // Check if user is owner
  if (conversation.owner_id === userId) {
    return conversation;
  }

  // Check if conversation is shared with user
  if (conversation.sharing?.shared_with?.includes(userId)) {
    return conversation;
  }

  // Check sharing_access collection
  const sharingAccess = await getCollection('sharing_access');
  const access = await sharingAccess.findOne({
    conversation_id: conversationId,
    granted_to: userId,
    revoked_at: null,
  });

  if (access) {
    return conversation;
  }

  throw new ApiError('Forbidden: You do not have access to this conversation', 403, 'FORBIDDEN');
}
