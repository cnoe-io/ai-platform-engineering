const getRbacCollection = jest.fn();

jest.mock("../../mongo-collections", () => ({
  getRbacCollection: (...args: unknown[]) => getRbacCollection(...args),
}));

// These assert the core invariant of the provider-scoped refactor: settings
// and runs are isolated per connector via `provider_id` (not a global
// singleton), so two connectors never share a schedule or run history.
describe("idp sync store (provider-scoped)", () => {
  beforeEach(() => {
    jest.resetModules();
    getRbacCollection.mockReset();
  });

  it("returns connector defaults when no settings doc exists", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    getRbacCollection.mockResolvedValue({ findOne });

    const { getIdpSyncSettings } = await import("../../idp-sync-store");
    const settings = await getIdpSyncSettings("okta");

    expect(findOne).toHaveBeenCalledWith({ provider_id: "okta" });
    expect(settings).toMatchObject({
      provider_id: "okta",
      enabled: false,
      schedule_mode: "interval",
      sync_interval_minutes: 60,
    });
  });

  it("upserts settings keyed by provider_id", async () => {
    const updateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    getRbacCollection.mockResolvedValue({ updateOne });

    const { upsertIdpSyncSettings } = await import("../../idp-sync-store");
    await upsertIdpSyncSettings("okta", { enabled: true });

    expect(updateOne).toHaveBeenCalledWith(
      { provider_id: "okta" },
      { $set: { enabled: true, provider_id: "okta" } },
      { upsert: true }
    );
  });

  it("lists runs filtered by provider_id", async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    getRbacCollection.mockResolvedValue({ find });

    const { listIdpSyncRuns } = await import("../../idp-sync-store");
    await listIdpSyncRuns("okta", 20);

    expect(find).toHaveBeenCalledWith({ provider_id: "okta" });
    expect(sort).toHaveBeenCalledWith({ started_at: -1 });
  });
});
