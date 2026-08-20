/** @jest-environment node */

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockTestTomeModel = jest.fn();
const mockUpdateModelConfig = jest.fn();
const mockResolveAllModelConfigs = jest.fn();
const mockGetScopeModelConfigs = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));
jest.mock("@/lib/tome/model-check", () => ({
  testTomeModel: (...args: unknown[]) => mockTestTomeModel(...args),
}));
jest.mock("@/lib/tome/model-config-store", () => ({
  AGENT_ROLES: ["ingest", "chat", "synthesize", "compact", "presentation"],
  ModelConfigValidationFailure: class ModelConfigValidationFailure extends Error {},
  deleteModelConfig: jest.fn(),
  getScopeModelConfigs: (...args: unknown[]) => mockGetScopeModelConfigs(...args),
  resolveAllModelConfigs: (...args: unknown[]) => mockResolveAllModelConfigs(...args),
  updateModelConfig: (...args: unknown[]) => mockUpdateModelConfig(...args),
}));

import { NextRequest } from "next/server";
import { GET, PATCH } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };
const projectContext = {
  projectId: "entity-1",
  project: { type: "project" },
  canEdit: true,
  user: { email: "steward@example.test" },
};

describe("entity model config API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue(projectContext);
    mockGetScopeModelConfigs.mockResolvedValue([]);
    mockResolveAllModelConfigs.mockResolvedValue([]);
  });

  it("loads exact settings and effective resolution for the entity", async () => {
    await GET(new NextRequest("http://example.test/api/tome/projects/example-project/model-config"), context);
    expect(mockGetScopeModelConfigs).toHaveBeenCalledWith({ kind: "exact", id: "entity-1" });
    expect(mockResolveAllModelConfigs).toHaveBeenCalledWith({
      entityId: "entity-1",
      entityType: "project",
    });
  });

  it("requires edit permission and a successful model test before exact save", async () => {
    mockTestTomeModel.mockResolvedValue({ ok: false, error: "unavailable" });
    const response = await PATCH(
      new NextRequest("http://example.test/api/tome/projects/example-project/model-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "chat", model: "model-candidate" }),
      }),
      context,
    );
    expect(mockRequireTomeEditor).toHaveBeenCalledWith(projectContext);
    expect(response.status).toBe(422);
    expect(mockUpdateModelConfig).not.toHaveBeenCalled();
  });

  it("stores a tested exact model under the immutable entity id", async () => {
    mockTestTomeModel.mockResolvedValue({ ok: true });
    mockUpdateModelConfig.mockResolvedValue({ _id: "exact:entity-1:chat" });
    const response = await PATCH(
      new NextRequest("http://example.test/api/tome/projects/example-project/model-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "chat", model: "model-candidate" }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mockUpdateModelConfig).toHaveBeenCalledWith(
      { kind: "exact", id: "entity-1" },
      "chat",
      "model-candidate",
      "steward@example.test",
      expect.any(String),
    );
  });
});
