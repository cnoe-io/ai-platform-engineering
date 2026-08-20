/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockFindRun = jest.fn();
const mockGetEvaluation = jest.fn();
const mockInsertOverride = jest.fn();
const mockApproveDraftRun = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {},
  successResponse: (data: unknown) => Response.json(data),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ findOne: mockFindRun }),
}));

jest.mock("@/lib/tome/evaluation-store", () => ({
  fallbackQualityPolicy: () => ({
    version: 0,
    mode: "off",
    allow_steward_override: true,
    require_human_review: true,
  }),
  getArtifactEvaluation: (...args: unknown[]) => mockGetEvaluation(...args),
  insertQualityGateOverride: (...args: unknown[]) => mockInsertOverride(...args),
}));

jest.mock("@/lib/tome/ingest-runner", () => ({
  approveDraftRun: (...args: unknown[]) => mockApproveDraftRun(...args),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: () => ({ type: "user", id: "steward@example.test" }),
}));

describe("draft approval quality override", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-example",
      user: { email: "steward@example.test" },
      session: {},
    });
    mockFindRun.mockResolvedValue({
      _id: "run-example",
      project_id: "project-example",
      status: "awaiting_review",
      quality_evaluation_id: "evaluation-example",
      quality_policy_version: 7,
      quality_policy_mode: "enforce",
      quality_allow_steward_override: true,
      quality_require_human_review: true,
    });
    mockGetEvaluation.mockResolvedValue({
      status: "failed",
      rubrics: [{
        id: "grounding",
        enabled: true,
        blocking: true,
        passed: false,
        findings: [],
      }],
      blocking_findings: [],
    });
  });

  it("persists and audits actor, reason, failed rubric, and policy version", async () => {
    const { POST } = await import("../route");
    const request = new NextRequest("http://localhost/api/tome/projects/example/ingests/run-example/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ override_reason: "Reviewed against the source record." }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ slug: "example", runId: "run-example" }),
    });

    expect(response.status).toBe(200);
    expect(mockInsertOverride).toHaveBeenCalledWith({
      run_id: "run-example",
      project_id: "project-example",
      policy_version: 7,
      actor: "steward@example.test",
      reason: "Reviewed against the source record.",
      failed_rubrics: ["grounding"],
    });
    expect(mockAuditTome).toHaveBeenCalledWith(expect.objectContaining({
      action: "tome.quality.override",
      metadata: expect.objectContaining({ policy_version: 7, failed_rubrics: ["grounding"] }),
    }));
    expect(mockApproveDraftRun).toHaveBeenCalledWith("run-example", "steward@example.test");
  });
});
