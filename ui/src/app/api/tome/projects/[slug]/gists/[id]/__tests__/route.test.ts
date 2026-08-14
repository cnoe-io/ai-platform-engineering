/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
}));
jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeGistsCollection: jest.fn(async () => ({
    findOne: (...args: unknown[]) => mockFindOne(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
  })),
}));
jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: jest.fn().mockReturnValue({ type: "user", id: "editor-1" }),
}));

import { PATCH } from "../route";

const context = {
  params: Promise.resolve({ slug: "example-project", id: "gist-1" }),
};
const projectContext = {
  projectId: "project-1",
  project: { type: "project" },
  canEdit: true,
  user: { email: "editor@example.test" },
  session: { sub: "editor-1" },
};
const existingGist = {
  _id: "gist-1",
  project_id: "project-1",
  title: "Original title",
  body: "Original body",
  author: "author@example.test",
  created_at: new Date("2026-08-14T12:00:00.000Z"),
  tags: ["draft"],
};

describe("PATCH Tome gist", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadTomeProject.mockResolvedValue(projectContext);
    mockFindOne.mockResolvedValue(existingGist);
    mockUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it("updates supplied fields, records the editor, and audits the change", async () => {
    const response = await PATCH(
      new NextRequest("http://example.test/api/tome/projects/example-project/gists/gist-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: " Updated title ",
          body: "Updated body",
          tags: [" updated ", "updated", ""],
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockRequireTomeEditor).toHaveBeenCalledWith(projectContext);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "gist-1", project_id: "project-1" },
      {
        $set: expect.objectContaining({
          title: "Updated title",
          body: "Updated body",
          tags: ["updated"],
          updated_at: expect.any(Date),
          updated_by: "editor@example.test",
        }),
      },
    );
    expect(mockAuditTome).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tome.gist.update",
        projectSlug: "example-project",
        metadata: {
          gist_id: "gist-1",
          changed_fields: ["title", "body", "tags"],
        },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        gist: {
          id: "gist-1",
          title: "Updated title",
          body: "Updated body",
          author: "author@example.test",
          tags: ["updated"],
        },
      },
    });
  });

  it("rejects an empty patch", async () => {
    const response = await PATCH(
      new NextRequest("http://example.test/api/tome/projects/example-project/gists/gist-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("returns not found without updating another project's gist", async () => {
    mockFindOne.mockResolvedValue(null);
    const response = await PATCH(
      new NextRequest("http://example.test/api/tome/projects/example-project/gists/gist-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated title" }),
      }),
      context,
    );

    expect(response.status).toBe(404);
    expect(mockFindOne).toHaveBeenCalledWith({ _id: "gist-1", project_id: "project-1" });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});
