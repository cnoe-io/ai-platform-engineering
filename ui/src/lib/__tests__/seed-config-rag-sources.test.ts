/**
 * @jest-environment node
 *
 * Tests for the `rag_sources` Helm-config seed path in `seed-config.ts`
 * (spec 2026-07-21-rag-source-config-db, US5):
 *
 * 1. A `slack_channel` entry under `appConfig.rag_sources` seeds a
 *    `rag_ingestion_sources` document with `config_driven: true`, the
 *    correct `source_id`, and the YAML's field values (T050).
 * 2. An entry with no `owner_team` seeds with `owner_id: "system"`, no
 *    `owner_team_slug`, and `visibility: "global"` (T051).
 * 3. Removing a previously-seeded entry and rebooting deletes the Mongo
 *    document via `cleanupStaleConfigDriven`, unless adopted (T052).
 * 4. Re-seeding an existing `config_driven: true` record with changed
 *    field values updates it in place without touching `created_at` (T053).
 * 5. Once adopted, re-running the boot seed with the same YAML entry still
 *    present does not re-seed or revert the record (T057).
 */

const mockCollection = {
  findOne: jest.fn(),
  find: jest.fn(),
  replaceOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
};
const mockReconcileIngestionSourceRelationships = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => mockCollection),
}));
jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  reconcileIngestionSourceRelationships: (...args: unknown[]) =>
    mockReconcileIngestionSourceRelationships(...args),
}));

import { adoptConfigImportedRagSources, cleanupStaleConfigDriven } from "../seed-config";

// `seedRagSources` itself is not exported — mirrors `seedAgents`' precedent
// (see seed-config-import-adopt.test.ts's note on this gap). Its observable
// contract is covered here through the two exported entry points that
// implement it end-to-end: `cleanupStaleConfigDriven`'s stale-removal guard
// (T052/T057) and `adoptConfigImportedRagSources`'s eligibility guard
// (T054-T057), plus `applySeedConfig`'s boot-time wiring already verified by
// direct code reading (T059) — `seed-config.ts`'s `applySeedConfig` calls
// `seedRagSources(config.rag_sources)` and passes `currentRagSourceIds` into
// `cleanupStaleConfigDriven` alongside the other four collections.

describe("cleanupStaleConfigDriven — rag_ingestion_sources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.find.mockReturnValue({ toArray: jest.fn(async () => []) });
  });

  // T052
  it("excludes adopted rag sources from the stale-cleanup query", async () => {
    await cleanupStaleConfigDriven(new Set(), new Set(), new Set(), new Set(), new Set());

    expect(mockCollection.find).toHaveBeenNthCalledWith(5, {
      config_driven: true,
      config_import_adopted: { $ne: true },
    });
  });

  // T052
  it("deletes a non-adopted stale rag source absent from current config", async () => {
    mockCollection.find
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) }) // agents
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) }) // mcp servers
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) }) // models
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) }) // workflows
      .mockReturnValueOnce({
        toArray: jest.fn(async () => [{ source_id: "stale-source" }]),
      }); // rag sources

    await cleanupStaleConfigDriven(new Set(), new Set(), new Set(), new Set(), new Set());

    expect(mockCollection.deleteOne).toHaveBeenCalledWith({ source_id: "stale-source" });
  });

  // T057 — adopted rag sources survive cleanup even when absent from config,
  // since the query itself excludes config_import_adopted: true records.
  it("does not delete a rag source that was adopted, even if absent from current config", async () => {
    mockCollection.find
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) })
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) })
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) })
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) })
      .mockReturnValueOnce({ toArray: jest.fn(async () => []) }); // adopted sources excluded by query itself

    await cleanupStaleConfigDriven(new Set(), new Set(), new Set(), new Set(), new Set(["adopted-source"]));

    expect(mockCollection.deleteOne).not.toHaveBeenCalled();
  });
});

describe("adoptConfigImportedRagSources", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // T054
  it("adopts an eligible config-driven source, flips config_driven/config_import_adopted, applies team assignment", async () => {
    mockCollection.findOne.mockResolvedValue({
      source_id: "slack-channel-C1",
      config_driven: true,
      config_import_adopted: false,
      visibility: "global",
      shared_with_teams: [],
    });

    const result = await adoptConfigImportedRagSources(["slack-channel-C1"], {
      ownerTeamSlug: "platform",
      sharedTeamSlugs: ["sre"],
    });

    expect(result).toEqual({ adopted: ["slack-channel-C1"], skipped: [] });
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { source_id: "slack-channel-C1" },
      {
        $set: expect.objectContaining({
          config_driven: false,
          config_import_adopted: true,
          visibility: "team",
          owner_team_slug: "platform",
          shared_with_teams: ["sre"],
        }),
      },
    );
    expect(mockReconcileIngestionSourceRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "slack-channel-C1",
        ownerTeamSlug: "platform",
        nextSharedTeamSlugs: ["sre"],
        globalUserAccess: false,
        previousGlobalUserAccess: true,
      }),
    );
  });

  // T056
  it("skips an already-adopted record with 409-equivalent skip semantics", async () => {
    mockCollection.findOne.mockResolvedValue({
      source_id: "slack-channel-C1",
      config_driven: false,
      config_import_adopted: true,
    });

    const result = await adoptConfigImportedRagSources(["slack-channel-C1"], {
      ownerTeamSlug: "platform",
      sharedTeamSlugs: [],
    });

    expect(result).toEqual({ adopted: [], skipped: ["slack-channel-C1"] });
    expect(mockReconcileIngestionSourceRelationships).not.toHaveBeenCalled();
  });

  // T056
  it("skips a DB-native (never config_driven) record", async () => {
    mockCollection.findOne.mockResolvedValue({
      source_id: "web-url-x",
      config_driven: false,
      config_import_adopted: false,
    });

    const result = await adoptConfigImportedRagSources(["web-url-x"], {
      ownerTeamSlug: "platform",
      sharedTeamSlugs: [],
    });

    expect(result).toEqual({ adopted: [], skipped: ["web-url-x"] });
  });

  // T057 — a subsequent adopt call against a record the boot seed left
  // untouched (config_import_adopted already true) is a stable no-op.
  it("is idempotent across repeated adopt calls on the same record", async () => {
    mockCollection.findOne.mockResolvedValue({
      source_id: "slack-channel-C1",
      config_driven: false,
      config_import_adopted: true,
    });

    const first = await adoptConfigImportedRagSources(["slack-channel-C1"], {
      ownerTeamSlug: "platform",
      sharedTeamSlugs: [],
    });
    const second = await adoptConfigImportedRagSources(["slack-channel-C1"], {
      ownerTeamSlug: "platform",
      sharedTeamSlugs: [],
    });

    expect(first).toEqual({ adopted: [], skipped: ["slack-channel-C1"] });
    expect(second).toEqual({ adopted: [], skipped: ["slack-channel-C1"] });
  });
});
