const getRbacCollection = jest.fn();

jest.mock("../mongo-collections", () => ({
  getRbacCollection: (...args: unknown[]) => getRbacCollection(...args),
}));

describe("legacy Webex bot ownership migration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    getRbacCollection.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("assigns legacy space records to the explicit default bot", async () => {
    process.env.WEBEX_INTEGRATION_BOTS_JSON = JSON.stringify([
      { id: "primary", name: "Primary", tokenEnv: "PRIMARY_TOKEN", default: true },
      { id: "secondary", name: "Secondary", tokenEnv: "SECONDARY_TOKEN" },
    ]);
    const mappingUpdate = jest.fn().mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });
    const routeUpdate = jest.fn().mockResolvedValue({ matchedCount: 3, modifiedCount: 3 });
    getRbacCollection
      .mockResolvedValueOnce({ updateMany: mappingUpdate })
      .mockResolvedValueOnce({ updateMany: routeUpdate });

    const { migrateLegacyWebexBotOwnership } = await import("../webex-bot-migration");
    const result = await migrateLegacyWebexBotOwnership();

    expect(result).toEqual({
      default_bot_id: "primary",
      skipped: false,
      legacy_records_found: 5,
      team_mappings_updated: 2,
      agent_routes_updated: 3,
    });
    expect(mappingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ $or: expect.any(Array) }),
      { $set: { bot_id: "primary" } },
    );
    expect(routeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ $or: expect.any(Array) }),
      { $set: { bot_id: "primary" } },
    );
  });

  it("leaves legacy records unchanged when multi-bot ownership is ambiguous", async () => {
    process.env.WEBEX_INTEGRATION_BOTS_JSON = JSON.stringify([
      { id: "primary", name: "Primary", tokenEnv: "PRIMARY_TOKEN" },
      { id: "secondary", name: "Secondary", tokenEnv: "SECONDARY_TOKEN" },
    ]);
    const mappingCount = jest.fn().mockResolvedValue(2);
    const routeCount = jest.fn().mockResolvedValue(1);
    const mappingUpdate = jest.fn();
    const routeUpdate = jest.fn();
    getRbacCollection
      .mockResolvedValueOnce({ countDocuments: mappingCount, updateMany: mappingUpdate })
      .mockResolvedValueOnce({ countDocuments: routeCount, updateMany: routeUpdate });

    const { migrateLegacyWebexBotOwnership } = await import("../webex-bot-migration");
    const result = await migrateLegacyWebexBotOwnership();

    expect(result).toEqual({
      skipped: true,
      legacy_records_found: 3,
      team_mappings_updated: 0,
      agent_routes_updated: 0,
    });
    expect(mappingUpdate).not.toHaveBeenCalled();
    expect(routeUpdate).not.toHaveBeenCalled();
  });
});
