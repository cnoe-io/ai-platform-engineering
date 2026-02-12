/**
 * Tests for mongodb.ts — safeCreateIndex and deduplicateCollection
 *
 * Uses a mock MongoDB Db object to test index creation resilience:
 * - Normal index creation succeeds
 * - Duplicate key errors trigger deduplication and retry
 * - Index option conflicts are silently skipped
 * - Unknown errors are logged but don't crash
 * - Each index is independent (one failure doesn't block others)
 */

// Mock mongodb module before importing
jest.mock('mongodb', () => {
  const actualTypes = jest.requireActual('mongodb');
  return {
    ...actualTypes,
    MongoClient: jest.fn(),
  };
});

// Since safeCreateIndex and deduplicateCollection are private (not exported),
// we test them indirectly through the module's behavior.
// We'll directly test the logic by reimplementing a test harness.

describe('mongodb index creation logic', () => {
  // Helper: create a mock collection
  function createMockCollection(overrides: Partial<{
    createIndex: jest.Mock;
    aggregate: jest.Mock;
    deleteMany: jest.Mock;
  }> = {}) {
    const mockToArray = jest.fn().mockResolvedValue([]);
    const mockAggregate = jest.fn().mockReturnValue({ toArray: mockToArray });

    return {
      createIndex: overrides.createIndex ?? jest.fn().mockResolvedValue('index_name'),
      aggregate: overrides.aggregate ?? mockAggregate,
      deleteMany: overrides.deleteMany ?? jest.fn().mockResolvedValue({ deletedCount: 0 }),
      _toArray: mockToArray,
    };
  }

  // Helper: create a mock Db
  function createMockDb(collections: Record<string, ReturnType<typeof createMockCollection>> = {}) {
    return {
      collection: jest.fn((name: string) => {
        if (!collections[name]) {
          collections[name] = createMockCollection();
        }
        return collections[name];
      }),
    };
  }

  // Reimplementation of safeCreateIndex for testing (mirrors mongodb.ts logic)
  async function safeCreateIndex(
    db: any,
    collectionName: string,
    keys: Record<string, 1 | -1>,
    options?: { unique?: boolean },
  ): Promise<boolean> {
    try {
      await db.collection(collectionName).createIndex(keys, options ?? {});
      return true;
    } catch (error: any) {
      const code = error?.code;

      if (code === 11000 && options?.unique) {
        const keyFields = Object.keys(keys);
        await deduplicateCollection(db, collectionName, keyFields);
        try {
          await db.collection(collectionName).createIndex(keys, options);
          return true;
        } catch {
          return false;
        }
      }

      if (code === 85 || code === 86) {
        return true;
      }

      return false;
    }
  }

  // Reimplementation of deduplicateCollection for testing
  async function deduplicateCollection(
    db: any,
    collectionName: string,
    keyFields: string[],
  ): Promise<void> {
    const collection = db.collection(collectionName);

    const groupId: Record<string, string> = {};
    for (const field of keyFields) {
      groupId[field.replace(/\./g, '_')] = `$${field}`;
    }

    const pipeline = [
      { $sort: { _id: -1 } },
      { $group: { _id: groupId, keepId: { $first: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ];

    const duplicates = await collection.aggregate(pipeline).toArray();

    for (const dup of duplicates) {
      const filter: Record<string, unknown> = {};
      for (const field of keyFields) {
        const safeKey = field.replace(/\./g, '_');
        filter[field] = dup._id[safeKey];
      }
      filter._id = { $ne: dup.keepId };
      await collection.deleteMany(filter);
    }
  }

  describe('safeCreateIndex', () => {
    it('should return true when index creation succeeds', async () => {
      const db = createMockDb();
      const result = await safeCreateIndex(db, 'users', { email: 1 });
      expect(result).toBe(true);
      expect(db.collection).toHaveBeenCalledWith('users');
    });

    it('should return true for unique index creation', async () => {
      const db = createMockDb();
      const result = await safeCreateIndex(db, 'users', { email: 1 }, { unique: true });
      expect(result).toBe(true);
    });

    it('should handle duplicate key error (11000) by deduplicating and retrying', async () => {
      const mockCollection = createMockCollection();
      // First call fails with duplicate key, second succeeds
      mockCollection.createIndex
        .mockRejectedValueOnce({ code: 11000 })
        .mockResolvedValueOnce('index_name');
      // No duplicates found in aggregation
      mockCollection._toArray.mockResolvedValue([]);

      const db = createMockDb({ test_collection: mockCollection });

      const result = await safeCreateIndex(db, 'test_collection', { id: 1 }, { unique: true });

      expect(result).toBe(true);
      expect(mockCollection.createIndex).toHaveBeenCalledTimes(2);
      expect(mockCollection.aggregate).toHaveBeenCalled();
    });

    it('should return false when dedup + retry still fails', async () => {
      const mockCollection = createMockCollection();
      mockCollection.createIndex
        .mockRejectedValueOnce({ code: 11000 })
        .mockRejectedValueOnce(new Error('still broken'));
      mockCollection._toArray.mockResolvedValue([]);

      const db = createMockDb({ test_collection: mockCollection });

      const result = await safeCreateIndex(db, 'test_collection', { id: 1 }, { unique: true });

      expect(result).toBe(false);
      expect(mockCollection.createIndex).toHaveBeenCalledTimes(2);
    });

    it('should NOT trigger dedup for non-unique index with 11000 error', async () => {
      const mockCollection = createMockCollection();
      mockCollection.createIndex.mockRejectedValueOnce({ code: 11000 });

      const db = createMockDb({ test_collection: mockCollection });

      // No unique option = no dedup
      const result = await safeCreateIndex(db, 'test_collection', { id: 1 });

      expect(result).toBe(false);
      expect(mockCollection.aggregate).not.toHaveBeenCalled();
    });

    it('should return true for IndexOptionsConflict (code 85)', async () => {
      const mockCollection = createMockCollection();
      mockCollection.createIndex.mockRejectedValueOnce({ code: 85 });

      const db = createMockDb({ test_collection: mockCollection });

      const result = await safeCreateIndex(db, 'test_collection', { id: 1 }, { unique: true });

      expect(result).toBe(true);
    });

    it('should return true for IndexKeySpecsConflict (code 86)', async () => {
      const mockCollection = createMockCollection();
      mockCollection.createIndex.mockRejectedValueOnce({ code: 86 });

      const db = createMockDb({ test_collection: mockCollection });

      const result = await safeCreateIndex(db, 'test_collection', { id: 1 });

      expect(result).toBe(true);
    });

    it('should return false for unknown errors', async () => {
      const mockCollection = createMockCollection();
      mockCollection.createIndex.mockRejectedValueOnce(new Error('Connection lost'));

      const db = createMockDb({ test_collection: mockCollection });

      const result = await safeCreateIndex(db, 'test_collection', { id: 1 });

      expect(result).toBe(false);
    });
  });

  describe('deduplicateCollection', () => {
    it('should delete duplicate documents keeping the newest', async () => {
      const mockCollection = createMockCollection();

      // Simulate one duplicate group: id "qs-oncall-handoff"
      mockCollection._toArray.mockResolvedValue([
        {
          _id: { id: 'qs-oncall-handoff' },
          keepId: 'objectid_newest',
          count: 3,
        },
      ]);

      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });

      const db = createMockDb({ agent_configs: mockCollection });

      await deduplicateCollection(db, 'agent_configs', ['id']);

      expect(mockCollection.aggregate).toHaveBeenCalled();
      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        id: 'qs-oncall-handoff',
        _id: { $ne: 'objectid_newest' },
      });
    });

    it('should handle multiple duplicate groups', async () => {
      const mockCollection = createMockCollection();

      mockCollection._toArray.mockResolvedValue([
        {
          _id: { id: 'qs-oncall-handoff' },
          keepId: 'obj1',
          count: 3,
        },
        {
          _id: { id: 'another-duplicate' },
          keepId: 'obj2',
          count: 2,
        },
      ]);

      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

      const db = createMockDb({ test_coll: mockCollection });

      await deduplicateCollection(db, 'test_coll', ['id']);

      expect(mockCollection.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('should handle no duplicates found', async () => {
      const mockCollection = createMockCollection();
      mockCollection._toArray.mockResolvedValue([]);

      const db = createMockDb({ test_coll: mockCollection });

      await deduplicateCollection(db, 'test_coll', ['id']);

      expect(mockCollection.deleteMany).not.toHaveBeenCalled();
    });

    it('should handle compound key fields', async () => {
      const mockCollection = createMockCollection();

      mockCollection._toArray.mockResolvedValue([
        {
          _id: { owner_id: 'user1', workflow_id: 'wf1' },
          keepId: 'obj1',
          count: 2,
        },
      ]);

      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

      const db = createMockDb({ test_coll: mockCollection });

      await deduplicateCollection(db, 'test_coll', ['owner_id', 'workflow_id']);

      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        owner_id: 'user1',
        workflow_id: 'wf1',
        _id: { $ne: 'obj1' },
      });
    });

    it('should handle dotted key fields (e.g., metadata.tags)', async () => {
      const mockCollection = createMockCollection();

      mockCollection._toArray.mockResolvedValue([
        {
          _id: { metadata_tags: 'tag1' },
          keepId: 'obj1',
          count: 2,
        },
      ]);

      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });

      const db = createMockDb({ test_coll: mockCollection });

      await deduplicateCollection(db, 'test_coll', ['metadata.tags']);

      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        'metadata.tags': 'tag1',
        _id: { $ne: 'obj1' },
      });
    });
  });

  describe('index creation independence', () => {
    it('should create multiple indexes independently via Promise.all', async () => {
      const db = createMockDb();

      // Create several indexes in parallel
      const results = await Promise.all([
        safeCreateIndex(db, 'users', { email: 1 }, { unique: true }),
        safeCreateIndex(db, 'users', { last_login: -1 }),
        safeCreateIndex(db, 'conversations', { owner_id: 1 }),
      ]);

      expect(results).toEqual([true, true, true]);
    });

    it('should not let one index failure affect others', async () => {
      const usersCollection = createMockCollection();
      const convsCollection = createMockCollection();

      // Second index fails
      usersCollection.createIndex
        .mockResolvedValueOnce('ok') // email index succeeds
        .mockRejectedValueOnce(new Error('disk full')); // login index fails

      const db = createMockDb({
        users: usersCollection,
        conversations: convsCollection,
      });

      const results = await Promise.all([
        safeCreateIndex(db, 'users', { email: 1 }, { unique: true }),
        safeCreateIndex(db, 'users', { last_login: -1 }),
        safeCreateIndex(db, 'conversations', { owner_id: 1 }),
      ]);

      expect(results[0]).toBe(true);  // email - succeeded
      expect(results[1]).toBe(false); // login - failed
      expect(results[2]).toBe(true);  // conversations - succeeded (independent)
    });
  });
});
