const getRbacCollection = jest.fn();
const readOpenFgaTuples = jest.fn();
const writeOpenFgaTuples = jest.fn();
const deleteExactOpenFgaTuples = jest.fn();

jest.mock("../mongo-collections", () => ({
  getRbacCollection: (...args: unknown[]) => getRbacCollection(...args),
}));
jest.mock("../openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => readOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => writeOpenFgaTuples(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) => deleteExactOpenFgaTuples(...args),
}));

import {
  deleteLegacyWebexBotOwnership,
  migrateLegacyWebexBotOwnership,
  probeLegacyWebexBotOwnership,
} from "../webex-bot-migration";

describe("legacy Webex bot ownership migration", () => {
  const originalEnv = process.env;
  const mapping = {
    _id: "mapping-1",
    webex_workspace_id: "workspace-1",
    webex_space_id: "space-1",
    space_name: "Example space",
    team_id: "team-1",
    team_slug: "platform-engineering",
  };
  const route = {
    _id: "route-1",
    workspace_id: "workspace-1",
    space_id: "space-1",
    agent_id: "agent-1",
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      WEBEX_INTEGRATION_BOTS_JSON: JSON.stringify([
        { id: "primary", name: "Primary", tokenEnv: "PRIMARY_TOKEN" },
        { id: "secondary", name: "Secondary", tokenEnv: "SECONDARY_TOKEN" },
      ]),
    };
    delete process.env.WEBEX_WORKSPACE_ALIAS;
    getRbacCollection.mockReset();
    readOpenFgaTuples.mockReset();
    writeOpenFgaTuples.mockReset();
    deleteExactOpenFgaTuples.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("probes botless Mongo records and physical-space OpenFGA grants", async () => {
    getRbacCollection
      .mockResolvedValueOnce({ find: () => ({ toArray: async () => [mapping] }) })
      .mockResolvedValueOnce({ find: () => ({ toArray: async () => [route] }) });
    readOpenFgaTuples.mockResolvedValue({
      tuples: [
        {
          key: {
            user: "webex_space:workspace-1--space-1",
            relation: "user",
            object: "agent:agent-1",
          },
        },
        {
          key: {
            user: "team:platform#member",
            relation: "user",
            object: "agent:unrelated-agent",
          },
        },
        {
          key: {
            user: "webex_space:workspace-1--",
            relation: "user",
            object: "agent:malformed-agent",
          },
        },
      ],
    });

    await expect(probeLegacyWebexBotOwnership()).resolves.toEqual([{
      workspace_id: "workspace-1",
      space_id: "space-1",
      space_name: "Example space",
      team_mapping_count: 1,
      route_count: 1,
      mongo_agent_ids: ["agent-1"],
      openfga_agent_ids: ["agent-1"],
      mapping_details: [{ team_id: "team-1", team_slug: "platform-engineering" }],
      mongo_route_details: [{ agent_id: "agent-1" }],
      openfga_grants: [{
        user: "webex_space:workspace-1--space-1",
        relation: "user",
        object: "agent:agent-1",
      }],
    }]);
    expect(readOpenFgaTuples).toHaveBeenCalledWith({ pageSize: 100 });
  });

  it("migrates only to the bot explicitly selected by the admin", async () => {
    const mappingUpdate = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const routeUpdate = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const routeUpsert = jest.fn().mockResolvedValue({ upsertedCount: 0 });
    getRbacCollection
      .mockResolvedValueOnce({
        find: () => ({ toArray: async () => [mapping] }),
        updateMany: mappingUpdate,
      })
      .mockResolvedValueOnce({
        find: () => ({ toArray: async () => [route] }),
        updateMany: routeUpdate,
        updateOne: routeUpsert,
      });
    readOpenFgaTuples.mockResolvedValue({
      tuples: [{
        key: {
          user: "webex_space:workspace-1--space-1",
          relation: "user",
          object: "agent:agent-1",
        },
      }],
    });
    writeOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 3, deletes: 0 });
    deleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });

    const result = await migrateLegacyWebexBotOwnership([{
      workspace_id: "workspace-1",
      space_id: "space-1",
      bot_id: "secondary",
    }]);

    expect(result).toEqual({
      spaces_migrated: 1,
      team_mappings_updated: 1,
      agent_routes_updated: 1,
      agent_routes_created: 0,
      openfga_tuples_written: 3,
      legacy_openfga_tuples_deleted: 1,
    });
    expect(writeOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        {
          user: "webex_bot_installation:secondary--workspace-1--space-1",
          relation: "user",
          object: "agent:agent-1",
        },
      ]),
      deletes: [],
    });
    expect(mappingUpdate.mock.calls[0][1].$set.bot_id).toBe("secondary");
    expect(routeUpdate.mock.calls[0][1].$set.bot_id).toBe("secondary");
  });

  it("deletes only selected botless records and their exact legacy tuples", async () => {
    const mappingDelete = jest.fn().mockResolvedValue({ deletedCount: 1 });
    const routeDelete = jest.fn().mockResolvedValue({ deletedCount: 1 });
    getRbacCollection
      .mockResolvedValueOnce({
        find: () => ({ toArray: async () => [mapping] }),
        deleteMany: mappingDelete,
      })
      .mockResolvedValueOnce({
        find: () => ({ toArray: async () => [route] }),
        deleteMany: routeDelete,
      });
    const legacyTuple = {
      user: "webex_space:workspace-1--space-1",
      relation: "user",
      object: "agent:agent-1",
    };
    readOpenFgaTuples.mockResolvedValue({ tuples: [{ key: legacyTuple }] });
    deleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });

    await expect(deleteLegacyWebexBotOwnership([{
      workspace_id: "workspace-1",
      space_id: "space-1",
    }])).resolves.toEqual({
      spaces_cleaned: 1,
      team_mappings_deleted: 1,
      agent_routes_deleted: 1,
      legacy_openfga_tuples_deleted: 1,
    });
    expect(deleteExactOpenFgaTuples).toHaveBeenCalledWith([legacyTuple]);
    expect(mappingDelete).toHaveBeenCalledWith({ _id: { $in: ["mapping-1"] } });
    expect(routeDelete).toHaveBeenCalledWith({ _id: { $in: ["route-1"] } });
  });

  it("does not rewrite a selected legacy workspace to the configured alias", async () => {
    process.env.WEBEX_WORKSPACE_ALIAS = "CAIPE-WEBEX";
    const mappingDelete = jest.fn();
    const routeDelete = jest.fn();
    getRbacCollection
      .mockResolvedValueOnce({
        find: () => ({ toArray: async () => [mapping] }),
        deleteMany: mappingDelete,
      })
      .mockResolvedValueOnce({
        find: () => ({ toArray: async () => [route] }),
        deleteMany: routeDelete,
      });
    const selectedTuple = {
      user: "webex_space:unknown--space-1",
      relation: "user",
      object: "agent:selected-agent",
    };
    const otherWorkspaceTuple = {
      user: "webex_space:CAIPE-WEBEX--space-1",
      relation: "user",
      object: "agent:other-agent",
    };
    readOpenFgaTuples.mockResolvedValue({
      tuples: [{ key: selectedTuple }, { key: otherWorkspaceTuple }],
    });
    deleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });

    await expect(deleteLegacyWebexBotOwnership([{
      workspace_id: "unknown",
      space_id: "space-1",
    }])).resolves.toEqual({
      spaces_cleaned: 1,
      team_mappings_deleted: 0,
      agent_routes_deleted: 0,
      legacy_openfga_tuples_deleted: 1,
    });
    expect(deleteExactOpenFgaTuples).toHaveBeenCalledWith([selectedTuple]);
    expect(mappingDelete).not.toHaveBeenCalled();
    expect(routeDelete).not.toHaveBeenCalled();
  });

  it("migrates from the exact legacy workspace into the canonical destination", async () => {
    process.env.WEBEX_WORKSPACE_ALIAS = "CAIPE-WEBEX";
    const routeUpsert = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    getRbacCollection
      .mockResolvedValueOnce({ find: () => ({ toArray: async () => [] }) })
      .mockResolvedValueOnce({
        find: () => ({ toArray: async () => [] }),
        updateOne: routeUpsert,
      });
    const selectedTuple = {
      user: "webex_space:unknown--space-1",
      relation: "user",
      object: "agent:selected-agent",
    };
    readOpenFgaTuples.mockResolvedValue({ tuples: [
      { key: selectedTuple },
      {
        key: {
          user: "webex_space:CAIPE-WEBEX--space-1",
          relation: "user",
          object: "agent:other-agent",
        },
      },
    ] });
    writeOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 3, deletes: 0 });
    deleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });

    await expect(migrateLegacyWebexBotOwnership([{
      workspace_id: "unknown",
      space_id: "space-1",
      bot_id: "secondary",
    }])).resolves.toEqual({
      spaces_migrated: 1,
      team_mappings_updated: 0,
      agent_routes_updated: 0,
      agent_routes_created: 1,
      openfga_tuples_written: 3,
      legacy_openfga_tuples_deleted: 1,
    });
    expect(writeOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([{
        user: "webex_bot_installation:secondary--CAIPE-WEBEX--space-1",
        relation: "user",
        object: "agent:selected-agent",
      }]),
      deletes: [],
    });
    expect(deleteExactOpenFgaTuples).toHaveBeenCalledWith([selectedTuple]);
    expect(routeUpsert.mock.calls[0][0]).toMatchObject({
      workspace_id: "CAIPE-WEBEX",
      agent_id: "selected-agent",
    });
  });
});
