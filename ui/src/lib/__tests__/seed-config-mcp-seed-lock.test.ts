/**
 * @jest-environment node
 *
 * seedMCPServers must skip documents marked seed_config_locked so Repair
 * AgentGateway + explicit admin confirmation survives pod restarts.
 */

const mockCollection = {
  findOne: jest.fn(),
  replaceOne: jest.fn(),
};

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => mockCollection),
}));
jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  reconcileConfigDrivenMcpServerRelationships: jest.fn(),
}));

import { seedMCPServers } from "../seed-config";

describe("seedMCPServers — seed_config_locked guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("skips MCP servers already marked seed_config_locked", async () => {
    mockCollection.findOne.mockResolvedValue({
      _id: "jira",
      seed_config_locked: true,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const count = await seedMCPServers([
      {
        id: "jira",
        name: "Jira",
        transport: "http",
        endpoint: "http://agentgateway:4000/mcp/jira",
        source: "agentgateway",
      },
    ]);

    expect(count).toBe(0);
    expect(mockCollection.replaceOne).not.toHaveBeenCalled();
  });

  it("upserts MCP servers that are not seed locked", async () => {
    mockCollection.findOne.mockResolvedValue(null);
    mockCollection.replaceOne.mockResolvedValue({ modifiedCount: 1 });

    const count = await seedMCPServers([
      {
        id: "jira",
        name: "Jira",
        transport: "http",
        endpoint: "http://agentgateway:4000/mcp/jira",
        source: "agentgateway",
      },
    ]);

    expect(count).toBe(1);
    expect(mockCollection.replaceOne).toHaveBeenCalledWith(
      { _id: "jira" },
      expect.objectContaining({
        _id: "jira",
        endpoint: "http://agentgateway:4000/mcp/jira",
      }),
      { upsert: true },
    );
  });
});
