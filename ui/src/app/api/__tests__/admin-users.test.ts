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
const mockListOpenFgaObjects = jest.fn();
jest.mock('@/lib/rbac/openfga', () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  listOpenFgaObjects: (...args: unknown[]) => mockListOpenFgaObjects(...args),
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
const mockGetRealmUserById = jest.fn();
const mockIsValidTeamSlug = jest.fn();
const mockFindRealmUsersByExactEmail = jest.fn();

jest.mock('@/lib/rbac/keycloak-admin', () => ({
  searchRealmUsers: (...args: unknown[]) => mockSearchRealmUsers(...args),
  countRealmUsers: (...args: unknown[]) => mockCountRealmUsers(...args),
  listUsersWithRole: (...args: unknown[]) => mockListUsersWithRole(...args),
  listRealmRoleMappingsForUser: (...args: unknown[]) =>
    mockListRealmRoleMappingsForUser(...args),
  getUserFederatedIdentities: (...args: unknown[]) =>
    mockGetUserFederatedIdentities(...args),
  getRealmUserById: (...args: unknown[]) => mockGetRealmUserById(...args),
  isValidTeamSlug: (...args: unknown[]) => mockIsValidTeamSlug(...args),
  findRealmUsersByExactEmail: (...args: unknown[]) =>
    mockFindRealmUsersByExactEmail(...args),
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
  mockGetCollection.mockReset();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
  mockGetCollection.mockImplementation((name: string) => {
    if (!mockCollections[name]) {
      mockCollections[name] = {
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
        findOne: jest.fn().mockResolvedValue(null),
      };
    }
    return Promise.resolve(mockCollections[name]);
  });
  mockSearchRealmUsers.mockReset();
  mockCountRealmUsers.mockReset();
  mockListUsersWithRole.mockReset();
  mockListRealmRoleMappingsForUser.mockReset();
  mockGetUserFederatedIdentities.mockReset();
  mockGetRealmUserById.mockReset();
  mockIsValidTeamSlug.mockReset();
  mockFindRealmUsersByExactEmail.mockReset();
  mockFindRealmUsersByExactEmail.mockResolvedValue([]);
  mockCheckPermission.mockReset();
  mockCheckOpenFgaTuple.mockReset();
  mockListOpenFgaObjects.mockReset();
  mockCheckPermission.mockResolvedValue({ allowed: true, reason: 'OK' });
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true, reason: 'OK' });
  mockListOpenFgaObjects.mockResolvedValue({ objects: [] });
  mockListRealmRoleMappingsForUser.mockResolvedValue([{ name: 'user' }]);
  mockGetUserFederatedIdentities.mockResolvedValue([]);
  mockIsValidTeamSlug.mockReturnValue(true);
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

    const res = await GET(makeRequest('/api/admin/users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({
      id: 'u1',
      email: 'alice@example.com',
      slack_link_status: 'unlinked',
      webex_link_status: 'unlinked',
    });
    // Roles are NOT included by default — `includeRoles=true` is opt-in.
    expect(body.users[0]).not.toHaveProperty('roles');
    expect(body.users[0]).not.toHaveProperty('raw_roles');
    expect(body.users[0]).not.toHaveProperty('role_classifications');
    expect(body.users[0]).not.toHaveProperty('hidden_role_count');
    expect(mockListRealmRoleMappingsForUser).not.toHaveBeenCalled();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it('includes curated role fields when includeRoles=true', async () => {
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

    const res = await GET(makeRequest('/api/admin/users?includeRoles=true'));
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
    expect(mockListRealmRoleMappingsForUser).toHaveBeenCalledWith('u1');
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

  it('filters users by Webex link status from webex_user_id attribute', async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const raw = [
      {
        id: 'u1',
        username: 'alice',
        email: 'alice@example.com',
        attributes: { webex_user_id: ['person-abc'] },
      },
      {
        id: 'u2',
        username: 'bob',
        email: 'bob@example.com',
        attributes: {},
      },
    ];
    mockSearchRealmUsers
      .mockResolvedValueOnce(raw)
      .mockResolvedValueOnce([]);
    mockListRealmRoleMappingsForUser.mockResolvedValue([]);

    const res = await GET(makeRequest('/api/admin/users?webexStatus=linked'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({
      id: 'u1',
      email: 'alice@example.com',
      webex_link_status: 'linked',
    });
    expect(body.total).toBe(1);
  });
});

describe("GET /api/admin/users — non-admin team-scoped view", () => {
  // Mock pattern: baseline `admin_surface:users#can_read` allows; the
  // org-level `admin_ui#view` (relation `can_audit` on `organization:caipe`)
  // denies — so the route enters the `!hasAdminView` branch.
  function mockNonAdminAuth() {
    mockCheckOpenFgaTuple.mockImplementation(
      async (t: { user: string; relation: string; object: string }) => ({
        allowed: t.relation === 'can_read' && t.object === 'admin_surface:users',
      })
    );
  }

  // The route probes OpenFGA twice: `team#admin` (to widen team admins to the
  // full-list view) and `team#member` (the plain-member self/team scope). These
  // tests exercise the plain-member path, so the caller administers no teams —
  // only the `member` probe returns the user's teams.
  function setMemberTeams(slugs: string[]) {
    mockListOpenFgaObjects.mockImplementation(
      async (q: { relation: string }) => ({
        objects: q.relation === 'member' ? slugs : [],
      })
    );
  }

  // Membership is resolved via `listActiveTeamMembershipSourcesBySlug`, which
  // queries `team_membership_sources` by { team_slug, status: 'active' } — NOT
  // by team_id. Keying these mocks by slug guards the prod bug where the slug
  // from OpenFGA was passed to a team_id-keyed lookup and matched nobody.
  function setMembershipBySlug(
    bySlug: Record<string, string[]>
  ) {
    mockGetCollection.mockImplementation((name: string) => {
      if (name === 'team_membership_sources') {
        return Promise.resolve({
          find: jest.fn().mockImplementation((filter: { team_slug?: string }) => {
            const emails = bySlug[filter?.team_slug ?? ''] ?? [];
            const docs = emails.map((user_email) => ({ user_email, status: 'active' }));
            return { sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(docs) }) };
          }),
        });
      }
      return Promise.resolve({
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
          project: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
        }),
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      });
    });
  }

  // Resolve each member email to a realm user via the indexed exact-email
  // lookup (mirrors prod, where we no longer scan the whole realm).
  function resolveUsersByEmail(byEmail: Record<string, { id: string }>) {
    mockFindRealmUsersByExactEmail.mockImplementation(async (email: string) => {
      const u = byEmail[email];
      return u ? [{ id: u.id, username: email.split('@')[0], email, attributes: {} }] : [];
    });
  }

  beforeEach(() => {
    resetMocks();
    mockGetServerSession.mockResolvedValue(userSession());
    mockNonAdminAuth();
  });

  it("returns scoped:'team' with the members of the user's team", async () => {
    setMemberTeams(['team:platform-eng']);
    setMembershipBySlug({
      'platform-eng': ['alice@example.com', 'bob@example.com'],
    });
    resolveUsersByEmail({
      'alice@example.com': { id: 'u-alice' },
      'bob@example.com': { id: 'u-bob' },
    });

    const res = await GET(makeRequest('/api/admin/users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoped).toBe('team');
    const emails = body.users.map((u: { email: string }) => u.email).sort();
    expect(emails).toEqual(['alice@example.com', 'bob@example.com']);
    expect(body.total).toBe(2);
    // Perf contract: members are resolved by exact email, never by a full
    // realm scan.
    expect(mockFindRealmUsersByExactEmail).toHaveBeenCalledWith('alice@example.com');
    expect(mockSearchRealmUsers).not.toHaveBeenCalled();
  });

  it("returns scoped:'self' for non-admin with no team memberships", async () => {
    mockListOpenFgaObjects.mockResolvedValue({ objects: [] });
    mockGetRealmUserById.mockResolvedValue({
      id: 'user-sub',
      email: 'user@example.com',
      username: 'user',
      enabled: true,
      attributes: {},
    });

    const res = await GET(makeRequest('/api/admin/users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoped).toBe('self');
    expect(body.total).toBe(1);
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe('user@example.com');
    expect(mockSearchRealmUsers).not.toHaveBeenCalled();
  });

  it("returns scoped:'self' when team memberships resolve to zero members", async () => {
    // OpenFGA reports a team, but the canonical store has no active members for
    // its slug (e.g. the slug→id keying bug, or all members deactivated). The
    // route must fall back to self rather than return an empty list.
    setMemberTeams(['team:ghost-team']);
    setMembershipBySlug({});
    mockGetRealmUserById.mockResolvedValue({
      id: 'user-sub',
      email: 'user@example.com',
      username: 'user',
      enabled: true,
      attributes: {},
    });

    const res = await GET(makeRequest('/api/admin/users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoped).toBe('self');
    expect(body.users.map((u: { email: string }) => u.email)).toEqual(['user@example.com']);
  });

  it("unions members across teams and de-duplicates users in multiple teams", async () => {
    setMemberTeams(['team:team-a', 'team:team-b']);
    setMembershipBySlug({
      'team-a': ['alice@example.com', 'dave@example.com'],
      'team-b': ['alice@example.com', 'erin@example.com'],
    });
    resolveUsersByEmail({
      'alice@example.com': { id: 'u-alice' },
      'dave@example.com': { id: 'u-dave' },
      'erin@example.com': { id: 'u-erin' },
    });

    const res = await GET(makeRequest('/api/admin/users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scoped).toBe('team');
    const emails = body.users.map((u: { email: string }) => u.email).sort();
    // alice is in both teams but appears once.
    expect(emails).toEqual(['alice@example.com', 'dave@example.com', 'erin@example.com']);
    expect(body.total).toBe(3);
  });
});
