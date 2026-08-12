/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockRequireAgentToken = jest.fn();
const mockResolveProject = jest.fn();
const mockGetPageStore = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockGetTomeIngestRunsCollection = jest.fn();

jest.mock("@/lib/tome/internal-api", () => ({
  requireAgentToken: (...args: unknown[]) => mockRequireAgentToken(...args),
  resolveProject: (...args: unknown[]) => mockResolveProject(...args),
}));

jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: () => mockGetPageStore(),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/tome/access", () => ({
  tomeDataObject: (project: { _id: string; type?: string }) =>
    `document:tome/${project.type ?? "project"}/${project._id}`,
}));

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeIngestRunsCollection: () => mockGetTomeIngestRunsCollection(),
}));

const PROJECT = { _id: "proj-1", slug: "quantum", type: "project" };

function postRequest(body: Record<string, unknown>, token = "agent-tok"): NextRequest {
  return new NextRequest(
    new URL("/api/tome/api/internal/projects/proj-1/pages", "http://localhost:3000"),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function ctx() {
  return { params: Promise.resolve({ id: "proj-1" }) };
}

describe("internal pages POST — FGA enforcement for chat-initiated writes", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.TOME_AGENT_TOKEN = "agent-tok";
    mockRequireAgentToken.mockReturnValue(undefined);
    mockResolveProject.mockResolvedValue(PROJECT);
    mockGetPageStore.mockResolvedValue({
      writePage: jest.fn().mockResolvedValue(undefined),
    });
    mockGetTomeIngestRunsCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });
  });

  it("returns 403 when no actor_sub and no report_id (chat write, identity missing)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      postRequest({ path: "pages/test.md", body: "# Hello" }),
      ctx(),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("DATA_STEWARD_REQUIRED");
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
  });

  it("returns 403 when actor_sub is present but FGA denies can_write", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    const { POST } = await import("../route");
    const res = await POST(
      postRequest({
        path: "pages/test.md",
        body: "# Hello",
        actor_sub: "viewer-sub-123",
      }),
      ctx(),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("DATA_STEWARD_REQUIRED");
    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:viewer-sub-123",
      relation: "can_write",
      object: "document:tome/project/proj-1",
    });
  });

  it("writes and returns 200 when actor_sub has can_write", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
    const mockWritePage = jest.fn().mockResolvedValue(undefined);
    mockGetPageStore.mockResolvedValue({ writePage: mockWritePage });

    const { POST } = await import("../route");
    const res = await POST(
      postRequest({
        path: "pages/test.md",
        body: "# Hello",
        actor_sub: "steward-sub-456",
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(mockWritePage).toHaveBeenCalledWith(
      "proj-1",
      "pages/test.md",
      "# Hello",
      expect.objectContaining({ author: "tome-agent" }),
    );
  });

  it("skips FGA check for ingest writes (report_id present)", async () => {
    const mockWritePage = jest.fn().mockResolvedValue(undefined);
    mockGetPageStore.mockResolvedValue({ writePage: mockWritePage });
    mockGetTomeIngestRunsCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ dispatch: { skipReview: false } }),
    });

    const { POST } = await import("../route");
    const res = await POST(
      postRequest({
        path: "pages/test.md",
        body: "# Hello",
        report_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        // no actor_sub — ingest writes don't carry it
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
    expect(mockWritePage).toHaveBeenCalledWith(
      "proj-1",
      "pages/test.md",
      "# Hello",
      expect.objectContaining({ status: "draft" }),
    );
  });
});
