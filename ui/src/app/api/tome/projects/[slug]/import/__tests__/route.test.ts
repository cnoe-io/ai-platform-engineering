/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockRequireTomeEditor = jest.fn();
const mockGuardNotLocked = jest.fn();
const mockWritePages = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
  requireTomeEditor: (...args: unknown[]) => mockRequireTomeEditor(...args),
  guardNotLocked: (...args: unknown[]) => mockGuardNotLocked(...args),
}));
jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: jest.fn().mockImplementation(async () => ({
    writePages: (...args: unknown[]) => mockWritePages(...args),
  })),
}));
jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: jest.fn().mockReturnValue({ type: "user", id: "user-1" }),
}));

import { POST } from "@/app/api/tome/projects/[slug]/import/route";

const context = { params: Promise.resolve({ slug: "example-project" }) };

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    project: { locked: false },
    user: { email: "test-user@example.com" },
    session: { sub: "user-1" },
  });
  mockGuardNotLocked.mockResolvedValue(undefined);
  mockWritePages.mockResolvedValue(undefined);
});

describe("POST Tome document import", () => {
  it("converts and writes a document batch", async () => {
    const form = new FormData();
    form.append("files", new File(["Decision: proceed."], "decision.txt", { type: "text/plain" }));
    form.append("paths", "notes/decision.txt");
    const response = await POST(
      new NextRequest("http://localhost/api/tome/projects/example-project/import", {
        method: "POST",
        body: form,
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mockRequireTomeEditor).toHaveBeenCalled();
    expect(mockGuardNotLocked).toHaveBeenCalledWith("project-1", false);
    expect(mockWritePages).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        "notes/decision.md": expect.stringContaining("Decision: proceed."),
      }),
      expect.objectContaining({ author: "test-user@example.com" }),
    );
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: true,
        data: { imported: [{ path: "notes/decision.md", warnings: [] }] },
      }),
    );
  });

  it("rejects requests without files", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/tome/projects/example-project/import", {
        method: "POST",
        body: new FormData(),
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mockWritePages).not.toHaveBeenCalled();
  });
});
