/**
 * @jest-environment node
 *
 * Regression test for `cleanupStaleConfigDriven` in `seed-config.ts`.
 *
 * AgentGateway-discovered MCP servers carry `config_driven: true` (managed,
 * not user-editable) but are NOT part of the seed YAML — they're provisioned at
 * runtime by MCP discovery/sync. The stale-cleanup must therefore exclude
 * `source: "agentgateway"` docs; otherwise every UI restart wiped them (the
 * seed config declares no `mcp_servers`), silently removing e.g. the
 * `knowledge-base` server and reintroducing the empty-Bearer 401.
 *
 * assisted-by Cursor claude-opus-4-8
 */

const collections: Record<string, { find: jest.Mock; deleteOne: jest.Mock }> = {};

function makeCollection() {
  return {
    find: jest.fn(() => ({ toArray: jest.fn(async () => []) })),
    deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
  };
}

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async (name: string) => {
    if (!collections[name]) collections[name] = makeCollection();
    return collections[name];
  }),
}));

import { cleanupStaleConfigDriven } from "../seed-config";

describe("cleanupStaleConfigDriven — MCP server source guard", () => {
  beforeEach(() => {
    for (const key of Object.keys(collections)) delete collections[key];
  });

  it("excludes AgentGateway-discovered servers from the stale-cleanup query", async () => {
    await cleanupStaleConfigDriven(new Set(), new Set(), new Set(), new Set(), new Set());

    const servers = collections["mcp_servers"];
    expect(servers).toBeDefined();
    expect(servers.find).toHaveBeenCalledTimes(1);

    // The query must scope to seed-driven docs only — discovered servers
    // (source: "agentgateway") are runtime-provisioned and must be preserved.
    const filter = servers.find.mock.calls[0][0];
    expect(filter).toEqual({
      config_driven: true,
      source: { $ne: "agentgateway" },
    });
  });

  it("deletes a seed-driven server absent from the current config", async () => {
    // Arrange a seed-driven (non-discovered) stale server.
    collections["mcp_servers"] = {
      find: jest.fn(() => ({
        toArray: jest.fn(async () => [{ _id: "old-seed-server" }]),
      })),
      deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
    };

    await cleanupStaleConfigDriven(new Set(), new Set(), new Set(), new Set(), new Set());

    expect(collections["mcp_servers"].deleteOne).toHaveBeenCalledWith({
      _id: "old-seed-server",
    });
  });

  it("keeps a seed-driven server still present in the current config", async () => {
    collections["mcp_servers"] = {
      find: jest.fn(() => ({
        toArray: jest.fn(async () => [{ _id: "kept-server" }]),
      })),
      deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
    };

    await cleanupStaleConfigDriven(
      new Set(),
      new Set(["kept-server"]),
      new Set(),
      new Set(),
      new Set(),
    );

    expect(collections["mcp_servers"].deleteOne).not.toHaveBeenCalled();
  });
});
