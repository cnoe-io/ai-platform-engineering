/**
 * @jest-environment node
 *
 * Unit tests for `selfHealDiscoveredMcpServersIfEmpty` in `seed-config.ts`.
 *
 * Context (the recurring "No MCP Servers Yet" bug): AgentGateway-discovered MCP
 * servers carry `source: "agentgateway"` and are only ever written by an
 * explicit Sync. The YAML seed never declares them and the credential backfill
 * only UPDATES existing docs, so once the collection loses its discovered rows
 * (e.g. wiped by an older build without the cleanup guard) the MCP Servers tab
 * stays empty until a human clicks Sync. This safety net runs ONE discovery
 * pass at startup, but only when the discovered set is empty.
 *
 * Behaviors under test:
 * 1. No-op when discovered servers already exist (never re-syncs a healthy DB).
 * 2. Runs exactly one sync when the discovered set is empty, returning the
 *    added+migrated count.
 * 3. Best-effort: a thrown/unreachable AgentGateway is swallowed (returns 0,
 *    never throws) so startup is never blocked.
 * 4. Returns 0 without touching Mongo when MongoDB is not configured.
 *
 * assisted-by Cursor claude-opus-4-8
 */

const mockCollection = {
  countDocuments: jest.fn(),
};

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => mockCollection),
}));

const mockSync = jest.fn();
jest.mock("@/app/api/mcp-servers/agentgateway/_lib", () => ({
  syncSelectedAgentGatewayMcpServers: (...args: unknown[]) => mockSync(...args),
}));

import { selfHealDiscoveredMcpServersIfEmpty } from "../seed-config";
import { getCollection } from "@/lib/mongodb";

function syncResult(added: number, migrated = 0) {
  return {
    added: [],
    migrated: [],
    refreshed: [],
    skipped: [],
    summary: {
      added,
      existing: 0,
      migrated,
      refreshed: 0,
      conflicts: 0,
      skipped: 0,
    },
    conflicts: [],
    migration_warnings: [],
    targets: [],
  };
}

describe("selfHealDiscoveredMcpServersIfEmpty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("is a no-op when discovered servers already exist", async () => {
    mockCollection.countDocuments.mockResolvedValue(14);

    const healed = await selfHealDiscoveredMcpServersIfEmpty();

    expect(healed).toBe(0);
    // The count query must scope to discovered (agentgateway) docs only.
    expect(mockCollection.countDocuments).toHaveBeenCalledWith({
      source: "agentgateway",
    });
    // A healthy collection is never re-synced.
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("runs one discovery sync when the discovered set is empty", async () => {
    mockCollection.countDocuments.mockResolvedValue(0);
    mockSync.mockResolvedValue(syncResult(14));

    const healed = await selfHealDiscoveredMcpServersIfEmpty();

    expect(mockSync).toHaveBeenCalledTimes(1);
    // Full discovery (no id filter) so every AgentGateway target is restored.
    expect(mockSync).toHaveBeenCalledWith();
    expect(healed).toBe(14);
  });

  it("counts both added and migrated servers as healed", async () => {
    mockCollection.countDocuments.mockResolvedValue(0);
    mockSync.mockResolvedValue(syncResult(10, 4));

    await expect(selfHealDiscoveredMcpServersIfEmpty()).resolves.toBe(14);
  });

  it("swallows a failing/unreachable AgentGateway and never throws", async () => {
    mockCollection.countDocuments.mockResolvedValue(0);
    mockSync.mockRejectedValue(new Error("AgentGateway config request failed"));

    await expect(selfHealDiscoveredMcpServersIfEmpty()).resolves.toBe(0);
  });
});

describe("selfHealDiscoveredMcpServersIfEmpty when MongoDB is unconfigured", () => {
  it("returns 0 without touching the collection", async () => {
    jest.resetModules();
    jest.doMock("@/lib/mongodb", () => ({
      isMongoDBConfigured: false,
      getCollection: jest.fn(),
    }));
    const { selfHealDiscoveredMcpServersIfEmpty: healNoMongo } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../seed-config");
    const { getCollection: getCollectionNoMongo } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/lib/mongodb");

    await expect(healNoMongo()).resolves.toBe(0);
    expect(getCollectionNoMongo).not.toHaveBeenCalled();
  });
});

// Guard against an accidental import-direction regression: the heal must reuse
// the real Sync entry point (added in the same change), not duplicate fetch
// logic.
describe("selfHealDiscoveredMcpServersIfEmpty wiring", () => {
  it("reuses getCollection from the shared mongodb module", async () => {
    mockCollection.countDocuments.mockResolvedValue(1);
    await selfHealDiscoveredMcpServersIfEmpty();
    expect(getCollection).toHaveBeenCalledWith("mcp_servers");
  });
});
