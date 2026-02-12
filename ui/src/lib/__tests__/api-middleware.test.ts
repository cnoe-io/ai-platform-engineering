/**
 * Tests for API middleware utilities
 * Covers error handling, validation, pagination, responses, and auth
 * @jest-environment node
 */

const mockNextResponseJson = jest.fn((data: unknown, init?: { status?: number }) => ({
  _isNextResponse: true,
  data,
  status: init?.status ?? 200,
}));
jest.mock('next/server', () => ({
  NextRequest: Request,
  NextResponse: {
    json: (...args: unknown[]) => mockNextResponseJson(...args),
  },
}));

import { NextRequest } from 'next/server';

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/mongodb', () => ({
  getCollection: jest.fn(),
}));

const mockGetServerSession = jest.requireMock('next-auth').getServerSession;
const mockGetCollection = jest.requireMock('@/lib/mongodb').getCollection;

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

import {
  ApiError,
  handleApiError,
  withErrorHandler,
  validateRequired,
  validateEmail,
  validateUUID,
  getPaginationParams,
  successResponse,
  paginatedResponse,
  errorResponse,
  requireOwnership,
  getAuthenticatedUser,
  withAuth,
} from '../api-middleware';

describe('ApiError', () => {
  it('creates with message and default status 500', () => {
    const err = new ApiError('Something went wrong');
    expect(err.message).toBe('Something went wrong');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBeUndefined();
  });

  it('creates with custom status', () => {
    const err = new ApiError('Not found', 404);
    expect(err.statusCode).toBe(404);
  });

  it('creates with custom code', () => {
    const err = new ApiError('Validation failed', 400, 'VALIDATION_ERROR');
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('name is ApiError', () => {
    const err = new ApiError('test');
    expect(err.name).toBe('ApiError');
  });

  it('is instanceof Error', () => {
    const err = new ApiError('test');
    expect(err instanceof Error).toBe(true);
  });
});

describe('handleApiError', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('handles ApiError → returns correct status and body', () => {
    const err = new ApiError('Resource not found', 404, 'NOT_FOUND');
    handleApiError(err);

    expect(mockNextResponseJson).toHaveBeenCalledWith(
      {
        success: false,
        error: 'Resource not found',
        code: 'NOT_FOUND',
      },
      { status: 404 }
    );
  });

  it('handles generic Error → returns 500', () => {
    const err = new Error('Database connection failed');
    handleApiError(err);

    expect(mockNextResponseJson).toHaveBeenCalledWith(
      {
        success: false,
        error: 'Database connection failed',
      },
      { status: 500 }
    );
  });

  it('handles unknown error → returns 500 with Internal server error', () => {
    handleApiError('string error');
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );

    mockNextResponseJson.mockClear();
    handleApiError(null);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  });
});

describe('withErrorHandler', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('calls handler normally', async () => {
    const mockHandler = jest.fn().mockResolvedValue({
      json: () => ({}),
      status: 200,
    });
    const wrapped = withErrorHandler(mockHandler);

    const req = new Request('http://test.com') as unknown as NextRequest;
    await wrapped(req);

    expect(mockHandler).toHaveBeenCalledWith(req, undefined);
  });

  it('catches errors and returns error response', async () => {
    const mockHandler = jest.fn().mockRejectedValue(new ApiError('Bad request', 400));
    const wrapped = withErrorHandler(mockHandler);

    const req = new Request('http://test.com') as unknown as NextRequest;
    const result = await wrapped(req);

    expect(result).toBeDefined();
    expect(result?._isNextResponse).toBe(true);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      { success: false, error: 'Bad request', code: undefined },
      { status: 400 }
    );
  });

  it('passes context to handler', async () => {
    const mockHandler = jest.fn().mockResolvedValue({ json: () => ({}) });
    const wrapped = withErrorHandler(mockHandler);

    const req = new Request('http://test.com') as unknown as NextRequest;
    const context = { params: { id: '123' } };
    await wrapped(req, context);

    expect(mockHandler).toHaveBeenCalledWith(req, context);
  });
});

describe('validateRequired', () => {
  it('passes when all fields present', () => {
    const data = { name: 'John', email: 'john@test.com' };
    expect(() => validateRequired(data, ['name', 'email'])).not.toThrow();
  });

  it('throws ApiError 400 for missing fields', () => {
    const data = { name: 'John' };
    expect(() => validateRequired(data, ['name', 'email'])).toThrow(ApiError);
    expect(() => validateRequired(data, ['name', 'email'])).toThrow('Missing required fields: email');
  });

  it('lists all missing fields in message', () => {
    const data = {};
    expect(() => validateRequired(data, ['a', 'b', 'c'])).toThrow('Missing required fields: a, b, c');
  });

  it('code is VALIDATION_ERROR', () => {
    const data = {};
    try {
      validateRequired(data, ['x']);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('VALIDATION_ERROR');
      expect((e as ApiError).statusCode).toBe(400);
    }
  });
});

describe('validateEmail', () => {
  it('valid emails return true', () => {
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('test.user@domain.co.uk')).toBe(true);
    expect(validateEmail('a@b.co')).toBe(true);
  });

  it('invalid emails return false - missing @', () => {
    expect(validateEmail('userexample.com')).toBe(false);
  });

  it('invalid emails return false - missing domain', () => {
    expect(validateEmail('user@')).toBe(false);
  });

  it('invalid emails return false - spaces', () => {
    expect(validateEmail('user @example.com')).toBe(false);
    expect(validateEmail('user@example.com ')).toBe(false);
  });

  it('invalid emails return false - no TLD', () => {
    expect(validateEmail('user@domain')).toBe(false);
  });
});

describe('validateUUID', () => {
  it('valid UUID returns true', () => {
    expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    expect(validateUUID('AAAAAAAA-BBBB-4CCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });

  it('invalid UUID returns false - wrong format', () => {
    expect(validateUUID('not-a-uuid')).toBe(false);
    expect(validateUUID('550e8400-e29b-41d4-a716')).toBe(false);
  });

  it('invalid UUID returns false - too short', () => {
    expect(validateUUID('550e8400-e29b-41d4-a71')).toBe(false);
  });

  it('invalid UUID returns false - invalid chars', () => {
    expect(validateUUID('550e8400-e29b-41d4-a716-44665544000g')).toBe(false);
  });
});

describe('getPaginationParams', () => {
  it('defaults to page 1, pageSize 20', () => {
    const req = new Request('http://test.com/api') as unknown as NextRequest;
    expect(getPaginationParams(req)).toEqual({ page: 1, pageSize: 20, skip: 0 });
  });

  it('parses custom page and page_size', () => {
    const req = new Request('http://test.com/api?page=3&page_size=50') as unknown as NextRequest;
    expect(getPaginationParams(req)).toEqual({ page: 3, pageSize: 50, skip: 100 });
  });

  it('throws for page < 1', () => {
    const req = new Request('http://test.com/api?page=0') as unknown as NextRequest;
    expect(() => getPaginationParams(req)).toThrow(ApiError);
    expect(() => getPaginationParams(req)).toThrow('Page must be >= 1');
  });

  it('throws for pageSize < 1 or > 100', () => {
    const req1 = new Request('http://test.com/api?page_size=0') as unknown as NextRequest;
    expect(() => getPaginationParams(req1)).toThrow('Page size must be between 1 and 100');

    const req2 = new Request('http://test.com/api?page_size=101') as unknown as NextRequest;
    expect(() => getPaginationParams(req2)).toThrow('Page size must be between 1 and 100');
  });

  it('calculates skip correctly', () => {
    const req = new Request('http://test.com/api?page=5&page_size=10') as unknown as NextRequest;
    expect(getPaginationParams(req)).toEqual({ page: 5, pageSize: 10, skip: 40 });
  });
});

describe('successResponse', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('returns success:true with data', () => {
    successResponse({ id: '123', name: 'test' });
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      { success: true, data: { id: '123', name: 'test' } },
      { status: 200 }
    );
  });

  it('default status 200', () => {
    successResponse({});
    expect(mockNextResponseJson).toHaveBeenCalledWith(expect.any(Object), { status: 200 });
  });

  it('custom status', () => {
    successResponse({ created: true }, 201);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      { success: true, data: { created: true } },
      { status: 201 }
    );
  });
});

describe('paginatedResponse', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('returns items, total, page, page_size', () => {
    paginatedResponse([{ id: 1 }, { id: 2 }], 50, 1, 20);
    expect(mockNextResponseJson).toHaveBeenCalledWith({
      success: true,
      data: {
        items: [{ id: 1 }, { id: 2 }],
        total: 50,
        page: 1,
        page_size: 20,
        has_more: true,
      },
    });
  });

  it('has_more true when more pages', () => {
    paginatedResponse([], 100, 1, 20);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ has_more: true }),
      })
    );
  });

  it('has_more false on last page', () => {
    paginatedResponse([{ id: 1 }, { id: 2 }], 22, 2, 20);
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ has_more: false }),
      })
    );
  });
});

describe('errorResponse', () => {
  beforeEach(() => {
    mockNextResponseJson.mockClear();
  });

  it('returns success:false with error message', () => {
    errorResponse('Something failed');
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      { success: false, error: 'Something failed', code: undefined },
      { status: 400 }
    );
  });

  it('includes status code', () => {
    errorResponse('Forbidden', 403);
    expect(mockNextResponseJson).toHaveBeenCalledWith(expect.any(Object), { status: 403 });
  });

  it('includes error code if provided', () => {
    errorResponse('Not found', 404, 'NOT_FOUND');
    expect(mockNextResponseJson).toHaveBeenCalledWith(
      { success: false, error: 'Not found', code: 'NOT_FOUND' },
      { status: 404 }
    );
  });
});

describe('requireOwnership', () => {
  it('passes when IDs match', () => {
    expect(() => requireOwnership('user-123', 'user-123')).not.toThrow();
  });

  it('throws ApiError 403 when IDs differ', () => {
    expect(() => requireOwnership('owner-1', 'user-2')).toThrow(ApiError);
    expect(() => requireOwnership('owner-1', 'user-2')).toThrow(
      'Forbidden: You do not own this resource'
    );
    try {
      requireOwnership('owner-1', 'user-2');
    } catch (e) {
      expect((e as ApiError).statusCode).toBe(403);
      expect((e as ApiError).code).toBe('FORBIDDEN');
    }
  });
});

describe('getAuthenticatedUser', () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockGetCollection.mockReset();
  });

  it('throws 401 when no session', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = new Request('http://test.com') as unknown as NextRequest;
    await expect(getAuthenticatedUser(req)).rejects.toThrow(ApiError);
    await expect(getAuthenticatedUser(req)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Unauthorized',
    });
  });

  it('throws 401 when session has no user email', async () => {
    mockGetServerSession.mockResolvedValue({ user: { name: 'Test' } });

    const req = new Request('http://test.com') as unknown as NextRequest;
    await expect(getAuthenticatedUser(req)).rejects.toThrow(
      'Unauthorized'
    );
  });

  it('returns user when session has email', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'user@test.com', name: 'Test User' },
      role: 'user',
    });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });

    const req = new Request('http://test.com') as unknown as NextRequest;
    const result = await getAuthenticatedUser(req);

    expect(result.user).toEqual({
      email: 'user@test.com',
      name: 'Test User',
      role: 'user',
    });
    expect(result.session).toBeDefined();
  });

  it('returns admin role from MongoDB when not in OIDC session', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'admin@test.com', name: 'Admin' },
      role: 'user',
    });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        email: 'admin@test.com',
        metadata: { role: 'admin' },
      }),
    });

    const req = new Request('http://test.com') as unknown as NextRequest;
    const result = await getAuthenticatedUser(req);

    expect(result.user.role).toBe('admin');
  });
});

describe('withAuth', () => {
  beforeEach(() => {
    mockGetServerSession.mockReset();
    mockGetCollection.mockReset();
  });

  it('calls handler with user and session when authenticated', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'user@test.com', name: 'User' },
      role: 'user',
    });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });

    const handler = jest.fn().mockResolvedValue('handler-result');
    const req = new Request('http://test.com') as unknown as NextRequest;

    const result = await withAuth(req, handler);

    expect(result).toBe('handler-result');
    expect(handler).toHaveBeenCalledWith(
      req,
      { email: 'user@test.com', name: 'User', role: 'user' },
      expect.objectContaining({ user: expect.any(Object), role: 'user' })
    );
  });

  it('throws when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const handler = jest.fn();
    const req = new Request('http://test.com') as unknown as NextRequest;

    await expect(withAuth(req, handler)).rejects.toThrow('Unauthorized');
    expect(handler).not.toHaveBeenCalled();
  });
});
