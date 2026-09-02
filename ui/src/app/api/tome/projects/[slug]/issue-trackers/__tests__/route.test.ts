/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockReadTrackers = jest.fn();
const mockAddTracker = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));
jest.mock("@/lib/tome/issue-tracker-store", () => ({
  readTomeCustomIssueTrackers: (...args: unknown[]) => mockReadTrackers(...args),
  addTomeCustomIssueTracker: (...args: unknown[]) => mockAddTracker(...args),
}));

import { GET, POST } from "../route";

const endpoint = "http://example.test/api/tome/projects/example-project/issue-trackers";
const context = { params: Promise.resolve({ slug: "example-project" }) };

describe("TOME issue trackers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({ projectId: "project-1", canEdit: true });
    mockReadTrackers.mockResolvedValue(["tome:security-review"]);
    mockAddTracker.mockResolvedValue(["tome:security-review"]);
  });

  it("returns project-wide custom trackers to readable users", async () => {
    const response = await GET(new NextRequest(endpoint), context);

    expect(mockReadTrackers).toHaveBeenCalledWith("project-1");
    await expect(response.json()).resolves.toMatchObject({
      data: {
        trackers: [{
          id: "security-review",
          label: "tome:security-review",
          title: "Security Review",
        }],
      },
    });
  });

  it("creates a tracker from an unprefixed suffix", async () => {
    const response = await POST(new NextRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suffix: "security-review" }),
    }), context);

    expect(mockRequireTomeEditor).toHaveBeenCalled();
    expect(mockAddTracker).toHaveBeenCalledWith("project-1", "tome:security-review");
    expect(response.status).toBe(200);
  });

  it("rejects prefixes and unsupported label characters", async () => {
    const response = await POST(new NextRequest(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suffix: "tome:security review" }),
    }), context);

    expect(response.status).toBe(400);
    expect(mockAddTracker).not.toHaveBeenCalled();
  });
});
