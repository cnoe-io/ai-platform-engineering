/** @jest-environment node */

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

import {
  deleteTerminalExperiments,
  TOME_ARTIFACT_EVALUATIONS_COLLECTION,
  TOME_ARTIFACT_FILE_EVALUATIONS_COLLECTION,
  TOME_EVIDENCE_BUNDLES_COLLECTION,
  TOME_EXPERIMENT_ARTIFACTS_COLLECTION,
  TOME_EXPERIMENTS_COLLECTION,
} from "@/lib/tome/evaluation-store";

const terminalExperiment = {
  _id: "experiment-example",
  project_slug: "example-project",
  evidence_bundle_id: "evidence-example",
  status: "completed",
};

function deletionCollections(input?: {
  evidenceReferences?: number;
  artifactFailure?: Error;
}) {
  const find = jest.fn()
    .mockReturnValueOnce({ toArray: async () => [terminalExperiment] })
    .mockReturnValueOnce({ toArray: async () => [terminalExperiment] });
  const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const experiments = {
    find,
    findOne: jest.fn(),
    updateMany,
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(input?.evidenceReferences ?? 0),
  };
  const artifacts = {
    deleteMany: input?.artifactFailure
      ? jest.fn().mockRejectedValue(input.artifactFailure)
      : jest.fn().mockResolvedValue({ deletedCount: 2 }),
  };
  const evaluations = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }) };
  const fileEvaluations = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 12 }) };
  const evidence = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
  const collections: Record<string, unknown> = {
    [TOME_EXPERIMENTS_COLLECTION]: experiments,
    [TOME_EXPERIMENT_ARTIFACTS_COLLECTION]: artifacts,
    [TOME_ARTIFACT_EVALUATIONS_COLLECTION]: evaluations,
    [TOME_ARTIFACT_FILE_EVALUATIONS_COLLECTION]: fileEvaluations,
    [TOME_EVIDENCE_BUNDLES_COLLECTION]: evidence,
  };
  mockGetCollection.mockImplementation(async (name: string) => collections[name]);
  return { experiments, artifacts, evaluations, fileEvaluations, evidence, updateMany };
}

describe("TOME experiment deletion", () => {
  beforeEach(() => jest.clearAllMocks());

  it("locks terminal runs and cascades all run-owned records", async () => {
    const collections = deletionCollections();

    await expect(deleteTerminalExperiments({
      actor: "admin@example.test",
      experimentId: terminalExperiment._id,
    })).resolves.toEqual({
      deleted_experiments: 1,
      deleted_artifacts: 2,
      deleted_evaluations: 2,
      deleted_file_evaluations: 12,
      deleted_evidence_bundles: 1,
      deleted_run_ids: [terminalExperiment._id],
      project_slugs: [terminalExperiment.project_slug],
    });
    expect(collections.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: [terminalExperiment._id] },
        status: { $in: expect.arrayContaining(["completed", "failed", "stopped_by_user"]) },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ deletion_started_by: "admin@example.test" }),
      }),
    );
    expect(collections.artifacts.deleteMany).toHaveBeenCalledWith({
      experiment_id: { $in: [terminalExperiment._id] },
    });
    expect(collections.evidence.deleteOne).toHaveBeenCalledWith({ _id: "evidence-example" });
  });

  it("keeps a frozen evidence bundle that another run still references", async () => {
    const collections = deletionCollections({ evidenceReferences: 1 });

    const result = await deleteTerminalExperiments({ actor: "admin@example.test" });

    expect(result.deleted_evidence_bundles).toBe(0);
    expect(collections.evidence.deleteOne).not.toHaveBeenCalled();
  });

  it("rejects active runs before deleting dependent records", async () => {
    const find = jest.fn().mockReturnValue({ toArray: async () => [] });
    const findOne = jest.fn().mockResolvedValue({ ...terminalExperiment, status: "running" });
    mockGetCollection.mockResolvedValue({ find, findOne });

    await expect(deleteTerminalExperiments({
      actor: "admin@example.test",
      experimentId: terminalExperiment._id,
    })).rejects.toThrow("Active experiments must be stopped before deletion");
    expect(mockGetCollection).toHaveBeenCalledTimes(1);
  });

  it("leaves a retryable cleanup marker when a cascade step fails", async () => {
    const collections = deletionCollections({ artifactFailure: new Error("storage unavailable") });

    await expect(deleteTerminalExperiments({ actor: "admin@example.test" }))
      .rejects.toThrow("storage unavailable");
    expect(collections.updateMany).toHaveBeenLastCalledWith(
      { deletion_token: expect.any(String) },
      {
        $set: { deletion_failed_at: expect.any(String) },
        $unset: {
          deletion_token: "",
          deletion_started_by: "",
        },
      },
    );
  });
});
