/**
 * @jest-environment node
 */
/**
 * Tests for GET /api/admin/users — Keycloak realm user list (search + filters).
 */

import { NextRequest } from 'next/server';

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: '',
}));

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => key === 'ssoEnabled',
}));

const mockCheckPermission = jest.fn();
jest.mock('@/lib/rbac/keycloak-authz', () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));

const mockCheckOpenFgaTuple = jest.fn();
jest.mock('@/lib/rbac/openfga', () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock('@/lib/rbac/audit', () => ({
  logAuthzDecision: jest.fn(),
}));

const mockCollections: Record<string, { find: jest.Mock; findOne: jest.Mock }> = {};
const mockGetCollection = jest.fn((name: string) => {
  if (!mockCollections[name]) {
    mockCollections[name] = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockResolvedValue(null),
    };
  }
  return Promise.resolve(mockCollections[name]);
});

let mockIsMongoDBConfigured = true;
jest.mock('@/lib/mongodb', () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
}));

const mockSearchRealmUsers = jest.fn();
const mockCountRealmUsers = jest.fn();
const mockListUsersWithRole = jest.fn();
const mockListRealmRoleMappingsForUser = jest.fn();
const mockGetUserFederatedIdentities = jest.fn();

jest.mock('@/lib/rbac/keycloak-admin', () => ({
  searchRealmUsers: (...args: unknown[]) => mockSearchRealmUsers(...args),
  countRealmUsers: (...args: unknown[]) => mockCountRealmUsers(...args),
  listUsersWithRole: (...args: unknown[]) => mockListUsersWithRole(...args),
  listRealmRoleMappingsForUser: (...args: unknown[]) =>
    mockListRealmRoleMappingsForUser(...args),
  getUserFederatedIdentities: (...args: unknown[]) =>
    mockGetUserFederatedIdentities(...args),
}));

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

function adminSession() {
  return {
    user: { email: 'admin@example.com', name: 'Admin' },
    role: 'admin' as const,
    sub: 'admin-sub',
    accessToken: 'admin-token',
  };
}

function userSession() {
  return {
    user: { email: 'user@example.com', name: 'User' },
    role: 'user' as const,
    sub: 'user-sub',
    accessToken: 'user-token',
  };
}

function resetMocks() {
  mockGetServerSession.mockReset();
  mockGetCollection.mockClear();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
  mockSearchRealmUsers.mockReset();
  mockCountRealmUsers.mockReset();
  mockListUsersWithRole.mockReset();
  mockListRealmRoleMappingsForUser.mockReset();
  mockGetUserFederatedIdentities.mockReset();
  mockCheckPermission.mockReset();
  mockCheckOpenFgaTuple.mockReset();
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: 'OK' });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true, reason: 'OK' });
  mockListRealmRoleMappingsForUser.mockResolvedValue([{ name: 'user' }]);
  mockGetUserFederatedIdentities.mockResolvedValue([]);
}

import { GET } from '../admin/users/route';

describe('GET /api/admin/users — Auth', () => {
  beforeEach(() => {
    resetMocks();
    mockSearchRealmUsers.mockResolvedValue([]);
    mockCountRealmUsers.mockResolvedValue(0);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest('/api/admin/users'));
    expect(res.status).toBe(401);
  });

  it('returns 200 for authenticated non-admin', async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const res = await GET(makeRequest('/api/admin/users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns 503 when team filter set and MongoDB not configured', async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession());
    const res = await GET(makeRequest('/api/admin/users?team=team1'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MONGODB_NOT_CONFIGURED');
  });
});

describe('GET /api/admin/users — Keycloak list', () => {
  beforeEach(() => {
    resetMocks();
    mockSearchRealmUsers.mockResolvedValue([]);
    mockCountRealmUsers.mockResolvedValue(0);
  });

  it('returns users and total from searchRealmUsers / countRealmUsers', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const raw = [
      {
        id: 'u1',
        username: 'alice',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'A',
        enabled: true,
        attributes: {},
      },
    ];
    mockSearchRealmUsers.mockResolvedValue(raw);
    mockCountRealmUsers.mockResolvedValue(1);
    mockListRealmRoleMappingsForUser.mockResolvedValue([
      { name: 'admin' },
      { name: 'offline_access' },
      { name: 'default-roles-caipe' },
      { name: 'team_member:manual-u2-1778604473704-qjkzq' },
      { name: 'agent_admin:1-april-2025' },
    ]);

    const res = await GET(makeRequest('/api/admin/users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({
      id: 'u1',
      email: 'alice@example.com',
      roles: ['admin'],
      raw_roles: [
        'admin',
        'offline_access',
        'default-roles-caipe',
        'team_member:manual-u2-1778604473704-qjkzq',
        'agent_admin:1-april-2025',
      ],
      hidden_role_count: 4,
    });
    expect(body.users[0].role_classifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'offline_access', kind: 'system' }),
        expect.objectContaining({
          role: 'team_member:manual-u2-1778604473704-qjkzq',
          kind: 'team',
          transition_state: 'transitional',
        }),
        expect.objectContaining({
          role: 'agent_admin:1-april-2025',
          kind: 'resource',
          resource_type: 'agent',
        }),
      ])
    );
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it('returns empty list when role filter matches no users', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    mockListUsersWithRole.mockResolvedValue([]);
    const res = await GET(makeRequest('/api/admin/users?role=nobody'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
    expect(body.total).toBe(0);
    expect(mockSearchRealmUsers).not.toHaveBeenCalled();
  });

  it('filters Slack pending users from active link nonces', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const raw = [
      {
        id: 'u1',
        username: 'alice',
        email: 'alice@example.com',
        attributes: { slack_user_id: ['U_PENDING'] },
      },
      {
        id: 'u2',
        username: 'bob',
        email: 'bob@example.com',
        attributes: { slack_user_id: ['U_LINKED'] },
      },
    ];
    mockSearchRealmUsers
      .mockResolvedValueOnce(raw)
      .mockResolvedValueOnce([]);
    mockCollections.slack_link_nonces = {
      find: jest.fn().mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ slack_user_id: 'U_PENDING' }]),
        }),
      }),
      findOne: jest.fn(),
    } as any;

    const res = await GET(makeRequest('/api/admin/users?slackStatus=pending'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({
      id: 'u1',
      email: 'alice@example.com',
      slack_link_status: 'pending',
    });
    expect(body.total).toBe(1);
  });
});
