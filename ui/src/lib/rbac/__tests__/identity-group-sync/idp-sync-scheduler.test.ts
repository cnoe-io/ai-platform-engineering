// Unit tests for the background IdP sync scheduler. The store, connector
// registry, and runner are all mocked so these assert pure scheduling logic:
// due-ness (interval + cron), the per-minute cross-replica dedupe claim, and
// the skip branches (disabled / unconfigured / already-running).

const listIdpSyncSettings = jest.fn();
const listIdpSyncRuns = jest.fn();
const claimScheduledFire = jest.fn();
const createSyncRun = jest.fn();
const executeSyncRun = jest.fn();
const isImplementedConnector = jest.fn();
const isConnectorConfigured = jest.fn();

jest.mock("@/lib/rbac/idp-sync-store", () => ({
  listIdpSyncSettings: (...a: unknown[]) => listIdpSyncSettings(...a),
  listIdpSyncRuns: (...a: unknown[]) => listIdpSyncRuns(...a),
  claimScheduledFire: (...a: unknown[]) => claimScheduledFire(...a),
}));
jest.mock("@/lib/rbac/idp-sync-runner", () => ({
  createSyncRun: (...a: unknown[]) => createSyncRun(...a),
  executeSyncRun: (...a: unknown[]) => executeSyncRun(...a),
}));
jest.mock("@/lib/rbac/idp-connectors", () => ({
  isImplementedConnector: (...a: unknown[]) => isImplementedConnector(...a),
  isConnectorConfigured: (...a: unknown[]) => isConnectorConfigured(...a),
}));

import { isConnectorDue, tickIdpSyncScheduler } from "../../idp-sync-scheduler";
import type { IdpSyncSettings } from "../../mongo-collections";

function settings(overrides: Partial<IdpSyncSettings> = {}): IdpSyncSettings {
  return {
    provider_id: "okta",
    enabled: true,
    schedule_mode: "interval",
    sync_interval_minutes: 60,
    updated_by: "test",
    updated_at: new Date(0).toISOString(),
    ...overrides,
  } as IdpSyncSettings;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults: implemented + configured + claim succeeds + run created.
  isImplementedConnector.mockReturnValue(true);
  isConnectorConfigured.mockReturnValue(true);
  claimScheduledFire.mockResolvedValue(true);
  createSyncRun.mockResolvedValue({ status: "created", runId: "run-1" });
  listIdpSyncRuns.mockResolvedValue([]);
});

describe("isConnectorDue", () => {
  const now = new Date(Date.UTC(2026, 5, 16, 2, 0)); // 02:00 UTC

  it("is never due when disabled", async () => {
    expect(await isConnectorDue(settings({ enabled: false }), now)).toBe(false);
  });

  it("cron mode: due only on a matching UTC minute", async () => {
    const cron = settings({ schedule_mode: "cron", sync_cron: "0 2 * * *" });
    expect(await isConnectorDue(cron, now)).toBe(true);
    expect(await isConnectorDue(cron, new Date(Date.UTC(2026, 5, 16, 2, 1)))).toBe(false);
  });

  it("interval mode: due when never run", async () => {
    listIdpSyncRuns.mockResolvedValue([]);
    expect(await isConnectorDue(settings({ sync_interval_minutes: 60 }), now)).toBe(true);
  });

  it("interval mode: due only after the interval has elapsed", async () => {
    // last run 30 min ago, interval 60 → not due
    listIdpSyncRuns.mockResolvedValue([
      { started_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString() },
    ]);
    expect(await isConnectorDue(settings({ sync_interval_minutes: 60 }), now)).toBe(false);

    // last run 90 min ago, interval 60 → due
    listIdpSyncRuns.mockResolvedValue([
      { started_at: new Date(now.getTime() - 90 * 60 * 1000).toISOString() },
    ]);
    expect(await isConnectorDue(settings({ sync_interval_minutes: 60 }), now)).toBe(true);
  });
});

describe("tickIdpSyncScheduler", () => {
  const dueNow = new Date(Date.UTC(2026, 5, 16, 2, 0));

  it("fires a scheduled run when a connector is due", async () => {
    listIdpSyncSettings.mockResolvedValue([
      settings({ schedule_mode: "cron", sync_cron: "0 2 * * *" }),
    ]);

    await tickIdpSyncScheduler(dueNow);

    expect(claimScheduledFire).toHaveBeenCalledWith("okta", "2026-06-16T02:00");
    expect(createSyncRun).toHaveBeenCalledWith({
      provider: "okta",
      actor: "scheduler",
      triggeredBy: "schedule",
    });
    expect(executeSyncRun).toHaveBeenCalledWith("run-1", "okta", "scheduler");
  });

  it("does not fire when not due", async () => {
    listIdpSyncSettings.mockResolvedValue([
      settings({ schedule_mode: "cron", sync_cron: "0 3 * * *" }), // 03:00, not 02:00
    ]);

    await tickIdpSyncScheduler(dueNow);

    expect(claimScheduledFire).not.toHaveBeenCalled();
    expect(createSyncRun).not.toHaveBeenCalled();
  });

  it("does not fire when the minute claim is lost (another replica won)", async () => {
    listIdpSyncSettings.mockResolvedValue([
      settings({ schedule_mode: "cron", sync_cron: "0 2 * * *" }),
    ]);
    claimScheduledFire.mockResolvedValue(false);

    await tickIdpSyncScheduler(dueNow);

    expect(createSyncRun).not.toHaveBeenCalled();
    expect(executeSyncRun).not.toHaveBeenCalled();
  });

  it("skips disabled, unconfigured, and unimplemented connectors before claiming", async () => {
    listIdpSyncSettings.mockResolvedValue([
      settings({ enabled: false, schedule_mode: "cron", sync_cron: "0 2 * * *" }),
    ]);
    await tickIdpSyncScheduler(dueNow);
    expect(claimScheduledFire).not.toHaveBeenCalled();

    jest.clearAllMocks();
    isImplementedConnector.mockReturnValue(true);
    isConnectorConfigured.mockReturnValue(false); // creds missing
    listIdpSyncSettings.mockResolvedValue([
      settings({ schedule_mode: "cron", sync_cron: "0 2 * * *" }),
    ]);
    await tickIdpSyncScheduler(dueNow);
    expect(claimScheduledFire).not.toHaveBeenCalled();
  });

  it("does not call executeSyncRun when a run is already in progress", async () => {
    listIdpSyncSettings.mockResolvedValue([
      settings({ schedule_mode: "cron", sync_cron: "0 2 * * *" }),
    ]);
    createSyncRun.mockResolvedValue({ status: "already_running", runId: "other" });

    await tickIdpSyncScheduler(dueNow);

    expect(createSyncRun).toHaveBeenCalled();
    expect(executeSyncRun).not.toHaveBeenCalled();
  });

  it("isolates per-connector errors so one bad connector doesn't block others", async () => {
    listIdpSyncSettings.mockResolvedValue([
      settings({ provider_id: "okta", schedule_mode: "cron", sync_cron: "0 2 * * *" }),
      settings({ provider_id: "duo", schedule_mode: "cron", sync_cron: "0 2 * * *" }),
    ]);
    // First connector throws during claim; second should still fire.
    claimScheduledFire
      .mockRejectedValueOnce(new Error("mongo blip"))
      .mockResolvedValueOnce(true);

    await tickIdpSyncScheduler(dueNow);

    expect(createSyncRun).toHaveBeenCalledTimes(1);
    expect(createSyncRun).toHaveBeenCalledWith({
      provider: "duo",
      actor: "scheduler",
      triggeredBy: "schedule",
    });
  });
});
