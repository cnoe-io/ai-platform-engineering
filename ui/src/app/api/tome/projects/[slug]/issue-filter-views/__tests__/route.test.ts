/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockReadViews = jest.fn();
const mockWriteViews = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));
jest.mock("@/lib/tome/user-preferences-store", () => ({
  readTomeIssueFilterViews: (...args: unknown[]) => mockReadViews(...args),
  writeTomeIssueFilterViews: (...args: unknown[]) => mockWriteViews(...args),
}));

import { GET, PUT } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };
const endpoint = "http://example.test/api/tome/projects/example-project/issue-filter-views";

describe("TOME saved issue filter views", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-1",
      session: { sub: "user-1", org: "tenant-1" },
    });
    mockReadViews.mockResolvedValue({
      version: 1,
      custom: [],
      order: ["decision", "critical"],
    });
    mockWriteViews.mockImplementation(async (_tenant, _user, _project, value) => value);
  });

  it("loads preferences using the signed-in user and immutable project id", async () => {
    const response = await GET(new NextRequest(endpoint), context);

    expect(mockReadViews).toHaveBeenCalledWith("tenant-1", "user-1", "project-1");
    await expect(response.json()).resolves.toMatchObject({
      data: { custom: [], order: ["decision", "critical"] },
    });
  });

  it("normalizes and saves a full filter definition", async () => {
    const response = await PUT(new NextRequest(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        custom: [{
          id: "open-bugs",
          title: "Open bugs",
          filters: { state: "open", label: "bug", repository: "example/service" },
        }],
        order: ["open-bugs", "decision", "critical"],
      }),
    }), context);

    expect(response.status).toBe(200);
    expect(mockWriteViews).toHaveBeenCalledWith(
      "tenant-1",
      "user-1",
      "project-1",
      expect.objectContaining({
        custom: [expect.objectContaining({
          id: "open-bugs",
          filters: expect.objectContaining({
            state: "open",
            label: "bug",
            repository: "example/service",
            priority: "all",
          }),
        })],
      }),
    );
  });
});
