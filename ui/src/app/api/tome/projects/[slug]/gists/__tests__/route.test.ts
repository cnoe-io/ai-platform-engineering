/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockInsertOne = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));
jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeGistsCollection: jest.fn(async () => ({
    insertOne: (...args: unknown[]) => mockInsertOne(...args),
  })),
}));
jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: jest.fn().mockReturnValue({ type: "user", id: "reader-1" }),
}));
jest.mock("@/lib/tome/mycelium", () => ({
  isMyceliumConfigured: jest.fn().mockReturnValue(false),
  postEvent: jest.fn(),
}));

import { POST } from "../route";

const context = {
  params: Promise.resolve({ slug: "example-project" }),
};

describe("POST Tome gist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue({
      projectId: "project-1",
      project: { type: "project" },
      canRead: true,
      canEdit: false,
      user: { email: "reader@example.test" },
      session: { sub: "reader-1" },
    });
    mockInsertOne.mockResolvedValue({ acknowledged: true });
  });

  it("allows an authorized project reader to create a gist", async () => {
    const response = await POST(
      new NextRequest("http://example.test/api/tome/projects/example-project/gists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: " Example gist ",
          body: "Useful context",
          tags: [" example ", "example"],
        }),
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(mockInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.any(String),
        project_id: "project-1",
        title: "Example gist",
        body: "Useful context",
        author: "reader@example.test",
        tags: ["example"],
        created_at: expect.any(Date),
      }),
    );
    expect(mockAuditTome).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tome.gist.create",
        projectSlug: "example-project",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        gist: {
          title: "Example gist",
          author: "reader@example.test",
          tags: ["example"],
        },
      },
    });
  });
});
