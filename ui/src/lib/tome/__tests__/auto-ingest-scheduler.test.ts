// Unit tests for the auto-ingest scheduler (GH #437). Mongo, credential
// resolution, and ingest dispatch are all mocked so these assert pure
// scheduling logic: cron due-ness, the per-minute cross-replica claim, the
// "no confirmed credential owner" skip, and that every fire records a
// `lastRun` status (never a silent failure).

const findToArray = jest.fn();
const updateOne = jest.fn();
const getCollection = jest.fn(async () => ({
  find: () => ({ toArray: findToArray }),
  updateOne,
}));

const claimAutoIngestFire = jest.fn();
const claimAutoIngestCredentialRefresh = jest.fn();
const refreshAutoIngestCredentialHealth = jest.fn();
const resolveCredentialsForSub = jest.fn();
const isIngestRunning = jest.fn();
const startIngestRun = jest.fn();
const auditTome = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...a: unknown[]) => getCollection(...a),
}));
jest.mock("../auto-ingest/cursor", () => ({
  claimAutoIngestFire: (...a: unknown[]) => claimAutoIngestFire(...a),
  claimAutoIngestCredentialRefresh: (...a: unknown[]) => claimAutoIngestCredentialRefresh(...a),
}));
jest.mock("../auto-ingest/credential-health", () => ({
  AUTO_INGEST_CREDENTIAL_REFRESH_INTERVAL_MS: 300_000,
  refreshAutoIngestCredentialHealth: (...a: unknown[]) => refreshAutoIngestCredentialHealth(...a),
}));
jest.mock("../agent-proxy", () => ({
  resolveCredentialsForSub: (...a: unknown[]) => resolveCredentialsForSub(...a),
}));
jest.mock("../ingest-runner", () => ({
  isIngestRunning: (...a: unknown[]) => isIngestRunning(...a),
  startIngestRun: (...a: unknown[]) => startIngestRun(...a),
}));
jest.mock("../audit", () => ({
  auditTome: (...a: unknown[]) => auditTome(...a),
}));

import { tickAutoIngestScheduler } from "../auto-ingest/scheduler";
import type { ProjectDocument } from "@/types/projects";

function project(overrides: Partial<ProjectDocument> = {}): ProjectDocument & { _id: string } {
  return {
    _id: "proj-1",
    slug: "demo",
    title: "Demo",
    description: "",
    team_id: "t1",
    team_slug: "t1",
    team_name: "Team",
    owner_id: "u1",
    member_ids: [],
    domain: "eng",
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  } as ProjectDocument & { _id: string };
}

const owner = { subject: "sub-1", email: "owner@example.com", name: "Owner", confirmedAt: "2026-01-01T00:00:00Z" };

beforeEach(() => {
  jest.clearAllMocks();
  claimAutoIngestFire.mockResolvedValue(true);
  claimAutoIngestCredentialRefresh.mockResolvedValue(true);
  refreshAutoIngestCredentialHealth.mockResolvedValue(undefined);
  isIngestRunning.mockResolvedValue(false);
  resolveCredentialsForSub.mockResolvedValue({ github: { access_token: "tok" } });
  startIngestRun.mockResolvedValue({ runId: "run-1" });
});

describe("tickAutoIngestScheduler", () => {
  const dueNow = new Date(Date.UTC(2026, 5, 16, 2, 0)); // 02:00 UTC

  it("fires when the cron matches and a credential owner is confirmed", async () => {
    findToArray.mockResolvedValue([
      project({ autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: owner } }),
    ]);

    await tickAutoIngestScheduler(dueNow);

    expect(claimAutoIngestFire).toHaveBeenCalledWith("proj-1", "2026-06-16T02:00");
    expect(startIngestRun).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1" }),
      { triggeredBy: "auto" },
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "proj-1" },
      { $set: { "autoIngest.lastRun": expect.objectContaining({ status: "success", runId: "run-1" }) } },
    );
  });

  it("claims one replica-safe window and refreshes auto-ingest credentials", async () => {
    const projects = [
      project({ autoIngest: { enabled: true, cron: "0 3 * * *", credentialOwner: owner } }),
    ];
    findToArray.mockResolvedValue(projects);

    await tickAutoIngestScheduler(dueNow);

    expect(claimAutoIngestCredentialRefresh).toHaveBeenCalledWith("5938584");
    expect(refreshAutoIngestCredentialHealth).toHaveBeenCalledWith(dueNow, projects);
  });

  it("does not refresh credentials when another replica owns the window", async () => {
    findToArray.mockResolvedValue([]);
    claimAutoIngestCredentialRefresh.mockResolvedValue(false);

    await tickAutoIngestScheduler(dueNow);

    expect(refreshAutoIngestCredentialHealth).not.toHaveBeenCalled();
  });

  it("continues evaluating schedules when background credential refresh fails", async () => {
    findToArray.mockResolvedValue([
      project({ autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: owner } }),
    ]);
    refreshAutoIngestCredentialHealth.mockRejectedValue(new Error("provider unavailable"));

    await tickAutoIngestScheduler(dueNow);

    expect(startIngestRun).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the cron doesn't match", async () => {
    findToArray.mockResolvedValue([
      project({ autoIngest: { enabled: true, cron: "0 3 * * *", credentialOwner: owner } }),
    ]);

    await tickAutoIngestScheduler(dueNow);

    expect(claimAutoIngestFire).not.toHaveBeenCalled();
    expect(startIngestRun).not.toHaveBeenCalled();
  });

  it("skips and records skipped_no_credential when no owner is confirmed", async () => {
    findToArray.mockResolvedValue([
      project({ autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: null } }),
    ]);

    await tickAutoIngestScheduler(dueNow);

    expect(claimAutoIngestFire).not.toHaveBeenCalled();
    expect(startIngestRun).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "proj-1" },
      { $set: { "autoIngest.lastRun": expect.objectContaining({ status: "skipped_no_credential" }) } },
    );
  });

  it("does not fire when the minute claim is lost (another replica won)", async () => {
    findToArray.mockResolvedValue([
      project({ autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: owner } }),
    ]);
    claimAutoIngestFire.mockResolvedValue(false);

    await tickAutoIngestScheduler(dueNow);

    expect(startIngestRun).not.toHaveBeenCalled();
  });

  it("records failed (not silent) when the owner has no connected credentials", async () => {
    findToArray.mockResolvedValue([
      project({ autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: owner } }),
    ]);
    resolveCredentialsForSub.mockResolvedValue({});

    await tickAutoIngestScheduler(dueNow);

    expect(startIngestRun).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "proj-1" },
      { $set: { "autoIngest.lastRun": expect.objectContaining({ status: "failed" }) } },
    );
  });

  it("records failed when startIngestRun throws", async () => {
    findToArray.mockResolvedValue([
      project({ autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: owner } }),
    ]);
    startIngestRun.mockRejectedValue(new Error("boom"));

    await tickAutoIngestScheduler(dueNow);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: "proj-1" },
      { $set: { "autoIngest.lastRun": expect.objectContaining({ status: "failed", reason: "boom" }) } },
    );
  });

  it("isolates per-project errors so one bad project doesn't block others", async () => {
    findToArray.mockResolvedValue([
      project({ _id: "proj-1", slug: "a", autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: owner } }),
      project({ _id: "proj-2", slug: "b", autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: owner } }),
    ]);
    claimAutoIngestFire.mockRejectedValueOnce(new Error("mongo blip")).mockResolvedValueOnce(true);

    await tickAutoIngestScheduler(dueNow);

    expect(startIngestRun).toHaveBeenCalledTimes(1);
  });

  it("does not fire when a run is already in progress", async () => {
    findToArray.mockResolvedValue([
      project({ autoIngest: { enabled: true, cron: "0 2 * * *", credentialOwner: owner } }),
    ]);
    isIngestRunning.mockResolvedValue(true);

    await tickAutoIngestScheduler(dueNow);

    expect(startIngestRun).not.toHaveBeenCalled();
  });
});
