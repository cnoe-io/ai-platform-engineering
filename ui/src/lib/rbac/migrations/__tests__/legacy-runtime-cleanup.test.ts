import {
  applyLegacyRuntimeCleanupMigration,
  deriveLegacyRuntimeCleanupPlan,
  isOrphanedCheckpointCollection,
  PRESERVED_CHECKPOINT_COLLECTIONS,
} from "../legacy-runtime-cleanup";

const now = "2026-06-04T06:00:00.000Z";

const ALL_COLLECTIONS = [
  "conversations",
  "messages",
  "checkpoints_conversation",
  "checkpoint_writes_conversation",
  "workflow_checkpoints",
  "workflow_checkpoints_writes",
  "checkpoints_caipe_supervisor",
  "checkpoint_writes_caipe_supervisor",
  "checkpoints_aws",
  "checkpoint_writes_aws",
  "system.indexes",
];

describe("isOrphanedCheckpointCollection", () => {
  it("preserves the unified conversation + workflow checkpoint collections", () => {
    for (const name of PRESERVED_CHECKPOINT_COLLECTIONS) {
      expect(isOrphanedCheckpointCollection(name)).toBe(false);
    }
  });

  it("flags orphaned per-agent checkpoint collections", () => {
    expect(isOrphanedCheckpointCollection("checkpoints_caipe_supervisor")).toBe(true);
    expect(isOrphanedCheckpointCollection("checkpoint_writes_caipe_supervisor")).toBe(true);
    expect(isOrphanedCheckpointCollection("checkpoints_aws")).toBe(true);
  });

  it("ignores unrelated and system collections", () => {
    expect(isOrphanedCheckpointCollection("conversations")).toBe(false);
    expect(isOrphanedCheckpointCollection("messages")).toBe(false);
    expect(isOrphanedCheckpointCollection("system.indexes")).toBe(false);
  });
});

describe("deriveLegacyRuntimeCleanupPlan", () => {
  it("counts orphaned collections and dead fields, warns on irreversible drop", () => {
    const plan = deriveLegacyRuntimeCleanupPlan({
      collectionNames: ALL_COLLECTIONS,
      conversationsWithDeprecatedFields: 12,
      messagesWithA2aEvents: 34,
    });

    expect(plan.counts).toMatchObject({
      orphaned_checkpoint_collections: 4,
      conversations_with_deprecated_fields: 12,
      messages_with_a2a_events: 34,
      tuple_writes_planned: 0,
    });
    expect(plan.release).toBe("0.6.0");
    expect(plan.schema_area).toBe("legacy_runtime_cleanup");
    expect(plan.warnings.join(" ")).toMatch(/irreversible/i);
    // Sample diffs include each orphaned collection plus the field strips.
    expect(plan.sample_diffs.some((d) => d.collection === "checkpoints_aws")).toBe(true);
    expect(plan.sample_diffs.some((d) => d.collection === "conversations")).toBe(true);
    expect(plan.sample_diffs.some((d) => d.collection === "messages")).toBe(true);
  });

  it("produces no warning and no drops on an already-clean database", () => {
    const plan = deriveLegacyRuntimeCleanupPlan({
      collectionNames: [
        "conversations",
        "messages",
        "checkpoints_conversation",
        "workflow_checkpoints",
      ],
      conversationsWithDeprecatedFields: 0,
      messagesWithA2aEvents: 0,
    });

    expect(plan.counts.orphaned_checkpoint_collections).toBe(0);
    expect(plan.warnings).toEqual([]);
  });
});

describe("applyLegacyRuntimeCleanupMigration", () => {
  it("drops only orphaned collections and strips dead fields", async () => {
    const dropped: string[] = [];
    const conversationsUpdate = jest.fn().mockResolvedValue({ modifiedCount: 12 });
    const messagesUpdate = jest.fn().mockResolvedValue({ modifiedCount: 34 });

    const result = await applyLegacyRuntimeCleanupMigration({
      actor: "admin@example.com",
      now,
      collections: {
        conversations: {
          countDocuments: jest.fn().mockResolvedValue(12),
          updateMany: conversationsUpdate,
        },
        messages: {
          countDocuments: jest.fn().mockResolvedValue(34),
          updateMany: messagesUpdate,
        },
        listCollectionNames: jest.fn().mockResolvedValue(ALL_COLLECTIONS),
        dropCollection: jest.fn(async (name: string) => {
          dropped.push(name);
          return true;
        }),
      },
    });

    expect(dropped.sort()).toEqual([
      "checkpoint_writes_aws",
      "checkpoint_writes_caipe_supervisor",
      "checkpoints_aws",
      "checkpoints_caipe_supervisor",
    ]);
    // Never drops the preserved collections.
    expect(dropped).not.toContain("checkpoints_conversation");
    expect(dropped).not.toContain("workflow_checkpoints");

    expect(conversationsUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $unset: { "metadata.agent_version": "", "metadata.model_used": "" },
      }),
    );
    expect(messagesUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ $unset: { a2a_events: "" } }),
    );

    expect(result.applied_counts).toMatchObject({
      checkpoint_collections_dropped: 4,
      conversations_cleaned: 12,
      messages_cleaned: 34,
      tuple_writes_applied: 0,
    });
    expect(result.applied_by).toBe("admin@example.com");
  });
});
