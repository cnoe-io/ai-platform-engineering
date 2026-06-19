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

  it("paginates runs (skip/limit) and counts, scoped by provider_id", async () => {
    const toArray = jest.fn().mockResolvedValue([{ id: "r1" }]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    const countDocuments = jest.fn().mockResolvedValue(42);
    getRbacCollection.mockResolvedValue({ find, countDocuments });

    const { listIdpSyncRunsPage } = await import("../../idp-sync-store");
    const result = await listIdpSyncRunsPage("okta", { page: 3, pageSize: 10 });

    expect(find).toHaveBeenCalledWith({ provider_id: "okta" });
    expect(sort).toHaveBeenCalledWith({ started_at: -1 });
    // page 3, size 10 → skip 20, limit 10
    expect(skip).toHaveBeenCalledWith(20);
    expect(limit).toHaveBeenCalledWith(10);
    expect(countDocuments).toHaveBeenCalledWith({ provider_id: "okta" });
    expect(result).toEqual({ runs: [{ id: "r1" }], total: 42 });
  });

  it("clamps page/page_size to safe defaults", async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    const find = jest.fn().mockReturnValue({ sort });
    const countDocuments = jest.fn().mockResolvedValue(0);
    getRbacCollection.mockResolvedValue({ find, countDocuments });

    const { listIdpSyncRunsPage } = await import("../../idp-sync-store");
    // page below 1 floors to 1 (skip 0); page_size above 100 clamps to 100.
    await listIdpSyncRunsPage("duo", { page: 0, pageSize: 9999 });

    expect(find).toHaveBeenCalledWith({ provider_id: "duo" });
    expect(skip).toHaveBeenCalledWith(0);
    expect(limit).toHaveBeenCalledWith(100);
  });
});
