/** @jest-environment node */

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

import {
  defaultRubricPolicy,
  insertQualityGateOverride,
  qualityPolicyId,
  requestExperimentCancellation,
  resolveQualityPolicy,
  saveQualityPolicy,
} from "@/lib/tome/evaluation-store";

describe("TOME quality policy store", () => {
  beforeEach(() => jest.clearAllMocks());

  it("resolves exact before entity type and global", async () => {
    const findOne = jest.fn(async ({ _id }: { _id: string }) =>
      _id === "exact:entity-1"
        ? { _id, scope_kind: "exact", scope_id: "entity-1", version: 4, mode: "enforce" }
        : null,
    );
    mockGetCollection.mockResolvedValue({ findOne });
    await expect(resolveQualityPolicy({ entityId: "entity-1", entityType: "project" }))
      .resolves.toMatchObject({ source: "exact", policy: { version: 4, mode: "enforce" } });
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("falls through to type then global", async () => {
    const findOne = jest.fn(async ({ _id }: { _id: string }) =>
      _id === "type:area"
        ? { _id, scope_kind: "type", scope_id: "area", version: 2, mode: "observe" }
        : null,
    );
    mockGetCollection.mockResolvedValue({ findOne });
    await expect(resolveQualityPolicy({ entityId: "entity-2", entityType: "area" }))
      .resolves.toMatchObject({ source: "type", policy: { version: 2 } });
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it("versions updates at a stable scope id", async () => {
    const findOne = jest.fn().mockResolvedValue({ version: 6 });
    const replaceOne = jest.fn();
    mockGetCollection.mockResolvedValue({ findOne, replaceOne });
    const saved = await saveQualityPolicy({
      scope_kind: "global",
      scope_id: null,
      mode: "enforce",
      evaluator_model: "evaluator-model",
      rubrics: defaultRubricPolicy(),
      require_human_review: true,
      allow_steward_override: true,
      updated_by: "admin@example.test",
    });
    expect(qualityPolicyId("global", null)).toBe("global:*");
    expect(saved.version).toBe(7);
    expect(replaceOne).toHaveBeenCalledWith(
      { _id: "global:*" },
      expect.objectContaining({ version: 7, evaluator_model: "evaluator-model" }),
      { upsert: true },
    );
  });

  it("timestamps audited quality-gate overrides", async () => {
    const insertOne = jest.fn();
    mockGetCollection.mockResolvedValue({ insertOne });

    const override = await insertQualityGateOverride({
      run_id: "run-example",
      project_id: "project-example",
      policy_version: 4,
      actor: "steward@example.test",
      reason: "Verified through a separate source.",
      failed_rubrics: ["grounding"],
    });

    expect(override._id).toBeTruthy();
    expect(Number.isNaN(Date.parse(override.created_at))).toBe(false);
    expect(insertOne).toHaveBeenCalledWith(override);
  });

  it("atomically stops only active experiments", async () => {
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    mockGetCollection.mockResolvedValue({ updateOne });

    await expect(requestExperimentCancellation({
      id: "experiment-example",
      actor: "admin@example.test",
    })).resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      {
        _id: "experiment-example",
        status: { $in: ["queued", "running", "evaluating"] },
      },
      { $set: expect.objectContaining({
        status: "stopped_by_user",
        cancel_requested_by: "admin@example.test",
      }) },
    );
  });
});
