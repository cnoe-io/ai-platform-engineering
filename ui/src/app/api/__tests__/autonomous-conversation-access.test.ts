/**
 * @jest-environment node
 */
/**
 * Tests that autonomous conversations follow standard per-user ownership rules
 * rather than being accessible to all authenticated users.
 *
 * After the fix: removing the `source === 'autonomous'` bypass in
 * `requireConversationAccess`, autonomous conversations use the same owner-check
 * as every other conversation type. New conversations have the task owner's real
 * email; legacy ones have `autonomous@system` (admin-only).
 */

// ============================================================================
// Mocks
// ============================================================================

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth-config', () => ({
  authOptions: {},
}));

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => key === 'ssoEnabled',
}));

jest.mock('@/lib/mongodb', () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: true,
}));

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// ============================================================================
// Helpers
// ============================================================================

function createMockCollection() {
  return {
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440001';

function makeAutonomousConversation(overrides: Record<string, any> = {}) {
  return {
    _id: VALID_UUID,
    title: '[Autonomous] My Task',
    owner_id: 'alice@example.com',
    source: 'autonomous',
    created_at: new Date(),
    updated_at: new Date(),
    sharing: {
      is_public: false,
      shared_with: [],
      shared_with_teams: [],
      share_link_enabled: false,
    },
    tags: ['autonomous', 'task-123'],
    is_archived: false,
    is_pinned: false,
    ...overrides,
  };
}

function makeMockGetCollection(collections: Record<string, any>) {
  return jest.fn().mockImplementation((name: string) => {
    return Promise.resolve(collections[name] ?? createMockCollection());
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('requireConversationAccess — autonomous conversations', () => {
  let requireConversationAccess: (
    conversationId: string,
    userId: string,
    getCollectionFn: (name: string) => Promise<any>,
    session?: { role?: string; canViewAdmin?: boolean }
  ) => Promise<any>;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/lib/api-middleware');
    requireConversationAccess = mod.requireConversationAccess;
  });

  it('grants owner access to their own autonomous conversation', async () => {
    const conv = makeAutonomousConversation({ owner_id: 'alice@example.com' });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);

    const getCollectionFn = makeMockGetCollection({ conversations: convsCol });

    const result = await requireConversationAccess(VALID_UUID, 'alice@example.com', getCollectionFn);

    expect(result.access_level).toBe('owner');
    expect(result.conversation._id).toBe(VALID_UUID);
  });

  it('denies access to a different non-admin user for an autonomous conversation', async () => {
    const conv = makeAutonomousConversation({ owner_id: 'alice@example.com' });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const getCollectionFn = makeMockGetCollection({
      conversations: convsCol,
      sharing_access: sharingAccessCol,
      teams: teamsCol,
    });

    await expect(
      requireConversationAccess(VALID_UUID, 'bob@example.com', getCollectionFn)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('grants admin_audit access to admin users for autonomous conversations they do not own', async () => {
    const conv = makeAutonomousConversation({ owner_id: 'alice@example.com' });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const getCollectionFn = makeMockGetCollection({
      conversations: convsCol,
      sharing_access: sharingAccessCol,
      teams: teamsCol,
    });

    const result = await requireConversationAccess(
      VALID_UUID,
      'admin@example.com',
      getCollectionFn,
      { role: 'admin' }
    );

    expect(result.access_level).toBe('admin_audit');
  });

  it('grants admin_audit for legacy autonomous conversations (owner_id = autonomous@system)', async () => {
    const conv = makeAutonomousConversation({ owner_id: 'autonomous@system' });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const getCollectionFn = makeMockGetCollection({
      conversations: convsCol,
      sharing_access: sharingAccessCol,
      teams: teamsCol,
    });

    const result = await requireConversationAccess(
      VALID_UUID,
      'admin@example.com',
      getCollectionFn,
      { role: 'admin' }
    );

    expect(result.access_level).toBe('admin_audit');
  });

  it('denies access to legacy autonomous conversations for non-admin users', async () => {
    const conv = makeAutonomousConversation({ owner_id: 'autonomous@system' });
    const convsCol = createMockCollection();
    convsCol.findOne.mockResolvedValue(conv);
    const sharingAccessCol = createMockCollection();
    sharingAccessCol.findOne.mockResolvedValue(null);
    const teamsCol = createMockCollection();
    teamsCol.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const getCollectionFn = makeMockGetCollection({
      conversations: convsCol,
      sharing_access: sharingAccessCol,
      teams: teamsCol,
    });

    await expect(
      requireConversationAccess(VALID_UUID, 'alice@example.com', getCollectionFn)
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
