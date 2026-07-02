/**
 * @jest-environment node
 *
 * Tests for reconcileSaConversationWriterGrants:
 *  - Conversation with created_by_service_account but missing tuple → backfilled
 *  - Conversation whose tuple already exists → idempotent noop (writeOpenFgaTuples
 *    de-dupes by returning writes=0 for already-existing tuples)
 *  - More than MAX conversations → capped + warning
 *  - MongoDB unavailable → skipped gracefully (no throw)
 *  - writeOpenFgaTuples throws → warning collected, no throw
 */

const mockGetCollection = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

function makeConversationsCollection(docs: Array<Record<string, unknown>>) {
  return {
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(docs),
    }),
  };
}

describe("reconcileSaConversationWriterGrants", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  });

  it("backfills missing writer tuple for an SA-created conversation", async () => {
    const doc = { _id: "conv-abc", created_by_service_account: "sa-sub-123" };
    mockGetCollection.mockResolvedValue(makeConversationsCollection([doc]));

    const { reconcileSaConversationWriterGrants } = await import("../sa-conversation-reconcile");
    const result = await reconcileSaConversationWriterGrants({ actor: "test" });

    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(1);
    expect(result.capped).toBe(false);
    expect(result.warnings).toHaveLength(0);

    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith(
      expect.objectContaining({
        writes: expect.arrayContaining([
          expect.objectContaining({
            user: "service_account:sa-sub-123",
            relation: "writer",
            object: "conversation:conv-abc",
          }),
        ]),
        deletes: [],
      }),
    );
  });

  it("is a noop when writeOpenFgaTuples reports writes=0 (tuple already exists)", async () => {
    const doc = { _id: "conv-xyz", created_by_service_account: "sa-sub-456" };
    mockGetCollection.mockResolvedValue(makeConversationsCollection([doc]));
    // Simulate OpenFGA filtering out the existing tuple — writes=0
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 0 });

    const { reconcileSaConversationWriterGrants } = await import("../sa-conversation-reconcile");
    const result = await reconcileSaConversationWriterGrants({ actor: "test" });

    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(result.warnings).toHaveLength(0);
    // writeOpenFgaTuples was still called — idempotency is handled inside it
    expect(mockWriteOpenFgaTuples).toHaveBeenCalled();
  });

  it("skips docs with empty/invalid created_by_service_account", async () => {
    const docs = [
      { _id: "conv-1", created_by_service_account: "  " },       // whitespace-only
      { _id: "conv-2", created_by_service_account: "" },          // empty string
      { _id: "conv-3", created_by_service_account: null },        // null
      { _id: "conv-4" },                                           // field absent
    ];
    mockGetCollection.mockResolvedValue(makeConversationsCollection(docs));

    const { reconcileSaConversationWriterGrants } = await import("../sa-conversation-reconcile");
    const result = await reconcileSaConversationWriterGrants({ actor: "test" });

    // scanned = 4 (all returned by mongo), but none pass the filter → no write
    expect(result.scanned).toBe(4);
    expect(result.backfilled).toBe(0);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("collects a warning and returns without throwing when writeOpenFgaTuples fails", async () => {
    const doc = { _id: "conv-fail", created_by_service_account: "sa-sub-789" };
    mockGetCollection.mockResolvedValue(makeConversationsCollection([doc]));
    mockWriteOpenFgaTuples.mockRejectedValue(new Error("OpenFGA unavailable"));

    const { reconcileSaConversationWriterGrants } = await import("../sa-conversation-reconcile");
    const result = await reconcileSaConversationWriterGrants({ actor: "test" });

    expect(result.backfilled).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/OpenFGA unavailable/);
  });

  it("caps at MAX_SA_CONVERSATIONS and emits a warning", async () => {
    // Generate 501 docs to exceed the 500-doc cap.
    const docs = Array.from({ length: 501 }, (_, i) => ({
      _id: `conv-${i}`,
      created_by_service_account: `sa-sub-${i}`,
    }));
    mockGetCollection.mockResolvedValue(makeConversationsCollection(docs));

    const { reconcileSaConversationWriterGrants } = await import("../sa-conversation-reconcile");
    const result = await reconcileSaConversationWriterGrants({ actor: "test" });

    expect(result.capped).toBe(true);
    expect(result.scanned).toBe(500);         // trimmed to 500
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Capped at 500/);
    // writeOpenFgaTuples was called with exactly 500 tuples
    const writtenTuples = mockWriteOpenFgaTuples.mock.calls[0][0].writes as unknown[];
    expect(writtenTuples).toHaveLength(500);
  });

  it("returns skipped status when MongoDB is not configured", async () => {
    // Reset module registry so we can re-mock isMongoDBConfigured.
    jest.resetModules();
    jest.doMock("@/lib/mongodb", () => ({
      isMongoDBConfigured: false,
      getCollection: mockGetCollection,
    }));
    jest.doMock("@/lib/rbac/openfga", () => ({
      writeOpenFgaTuples: mockWriteOpenFgaTuples,
    }));

    const { reconcileSaConversationWriterGrants } = await import("../sa-conversation-reconcile");
    const result = await reconcileSaConversationWriterGrants({ actor: "test" });

    expect(result.scanned).toBe(0);
    expect(result.backfilled).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/MongoDB not configured/);
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("SEC-7: handles non-string _id (ObjectId-like) without throwing — skips, not throw", async () => {
    // Re-establish standard mocks after jest.resetModules() calls in prior tests.
    jest.resetModules();
    jest.doMock("@/lib/mongodb", () => ({
      isMongoDBConfigured: true,
      getCollection: mockGetCollection,
    }));
    jest.doMock("@/lib/rbac/openfga", () => ({
      writeOpenFgaTuples: mockWriteOpenFgaTuples,
    }));

    // Simulate a MongoDB ObjectId-like object with a toString() method.
    const objectIdLike = { toString: () => "conv-objectid-123" };
    const docs = [
      { _id: objectIdLike as unknown as string, created_by_service_account: "sa-sub-obj" },
    ];
    mockGetCollection.mockResolvedValue(makeConversationsCollection(docs));
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });

    const { reconcileSaConversationWriterGrants } = await import("../sa-conversation-reconcile");
    // Should not throw
    const result = await reconcileSaConversationWriterGrants({ actor: "test" });

    expect(result.scanned).toBe(1);
    // The non-string _id coerces via String() → "conv-objectid-123" which is non-empty → included
    expect(result.backfilled).toBe(1);
    expect(result.warnings).toHaveLength(0);
    const writtenTuples = mockWriteOpenFgaTuples.mock.calls[0][0].writes as Array<{object: string}>;
    expect(writtenTuples[0].object).toBe("conversation:conv-objectid-123");
  });

  it("collects a warning and returns without throwing when MongoDB scan fails", async () => {
    // Restore the standard isMongoDBConfigured=true mock so getCollection is called.
    jest.resetModules();
    jest.doMock("@/lib/mongodb", () => ({
      isMongoDBConfigured: true,
      getCollection: mockGetCollection,
    }));
    jest.doMock("@/lib/rbac/openfga", () => ({
      writeOpenFgaTuples: mockWriteOpenFgaTuples,
    }));
    mockGetCollection.mockRejectedValue(new Error("DB connection failed"));

    const { reconcileSaConversationWriterGrants } = await import("../sa-conversation-reconcile");
    const result = await reconcileSaConversationWriterGrants({ actor: "test" });

    expect(result.scanned).toBe(0);
    expect(result.backfilled).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/DB connection failed/);
  });
});
