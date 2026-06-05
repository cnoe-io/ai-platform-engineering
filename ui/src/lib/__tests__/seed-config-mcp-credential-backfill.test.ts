/**
 * @jest-environment node
 *
 * Unit tests for `backfillBuiltinMcpCredentialSources` in `seed-config.ts`.
 *
 * The backfill is an idempotent self-migration that runs on every server
 * startup: it sets `credential_sources` on built-in MCP servers
 * (e.g. `knowledge-base`) that were persisted by AgentGateway discovery
 * before discovery learned to attach them. Without it, transform-based routes
 * emit an empty Bearer and the upstream 401s.
 *
 * Behaviors under test:
 * 1. Updates each built-in id with a guard that only matches missing/empty
 *    credential_sources (so it never clobbers admin customizations).
 * 2. Counts only documents actually modified.
 * 3. Returns 0 (no DB access) when MongoDB is not configured.
 *
 * assisted-by Cursor claude-opus-4-8
 */

const mockCollection = {
  updateOne: jest.fn(),
};

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => mockCollection),
}));

import { backfillBuiltinMcpCredentialSources } from "../seed-config";
import { BUILTIN_MCP_CREDENTIAL_SOURCES } from "@/lib/rbac/agentgateway-mcp-discovery";

const BUILTIN_IDS = Object.keys(BUILTIN_MCP_CREDENTIAL_SOURCES);

describe("backfillBuiltinMcpCredentialSources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("issues one guarded updateOne per built-in MCP server", async () => {
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 0 });

    await backfillBuiltinMcpCredentialSources();

    expect(mockCollection.updateOne).toHaveBeenCalledTimes(BUILTIN_IDS.length);

    // Every call must guard on missing OR empty credential_sources so it is
    // idempotent and never overwrites an admin-customized array.
    for (const call of mockCollection.updateOne.mock.calls) {
      const [filter, update] = call;
      expect(BUILTIN_IDS).toContain(filter._id);
      expect(filter.$or).toEqual([
        { credential_sources: { $exists: false } },
        { credential_sources: { $size: 0 } },
      ]);
      expect(update.$set.credential_sources).toEqual(
        BUILTIN_MCP_CREDENTIAL_SOURCES[filter._id],
      );
      expect(typeof update.$set.updated_at).toBe("string");
    }
  });

  it("knowledge-base backfills the caller_token source for the RAG route", async () => {
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await backfillBuiltinMcpCredentialSources();

    const kbCall = mockCollection.updateOne.mock.calls.find(
      ([filter]) => filter._id === "knowledge-base",
    );
    expect(kbCall).toBeDefined();
    expect(kbCall![1].$set.credential_sources).toEqual([
      {
        kind: "caller_token",
        name: "X-CAIPE-Provider-Token",
        target: "header",
        fallback_client_credentials: true,
      },
    ]);
  });

  it("returns the total number of documents actually modified", async () => {
    // First built-in updates, the rest are already populated (no-op).
    mockCollection.updateOne
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValue({ modifiedCount: 0 });

    const updated = await backfillBuiltinMcpCredentialSources();

    expect(updated).toBe(1);
  });
});

describe("backfillBuiltinMcpCredentialSources when MongoDB is unconfigured", () => {
  it("returns 0 without touching the collection", async () => {
    jest.resetModules();
    jest.doMock("@/lib/mongodb", () => ({
      isMongoDBConfigured: false,
      getCollection: jest.fn(),
    }));
    const { backfillBuiltinMcpCredentialSources: backfillNoMongo } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../seed-config");
    const { getCollection } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/lib/mongodb");

    await expect(backfillNoMongo()).resolves.toBe(0);
    expect(getCollection).not.toHaveBeenCalled();
  });
});
