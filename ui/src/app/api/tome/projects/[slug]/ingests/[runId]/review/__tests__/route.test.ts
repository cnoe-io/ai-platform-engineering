/** @jest-environment node */

import { NextRequest } from "next/server";

import type { PageRevision } from "@/types/tome";

const mockLoadTomeProject = jest.fn();
const mockFindRun = jest.fn();
const mockListTouchedPaths = jest.fn();
const mockPageHistory = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {},
  successResponse: (data: unknown) => Response.json(data),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));

jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeIngestRunsCollection: async () => ({ findOne: mockFindRun }),
}));

jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: async () => ({
    listTouchedPaths: (...args: unknown[]) => mockListTouchedPaths(...args),
    pageHistory: (...args: unknown[]) => mockPageHistory(...args),
  }),
}));

import { GET } from "../route";

const CURRENT_REPORT = "report-current";
const PATH = "architecture.md";
const context = {
  params: Promise.resolve({ slug: "example-area", runId: "run-current" }),
};

function revision(
  markdown: string,
  options: Partial<PageRevision> = {},
): PageRevision {
  return {
    project_id: "project-example",
    path: PATH,
    markdown,
    author: "example-agent",
    message: "example write",
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...options,
  };
}

async function review(history: PageRevision[]) {
  mockPageHistory.mockResolvedValue(history);
  const response = await GET(
    new NextRequest(
      "http://localhost/api/tome/projects/example-area/ingests/run-current/review",
    ),
    context,
  );
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadTomeProject.mockResolvedValue({ projectId: "project-example" });
  mockFindRun.mockResolvedValue({
    _id: "run-current",
    project_id: "project-example",
    report_id: CURRENT_REPORT,
  });
  mockListTouchedPaths.mockResolvedValue([PATH]);
});

describe("GET ingest review baseline", () => {
  it.each([
    ["rejected", "rejected"],
    ["pending", "draft"],
  ] as const)(
    "treats a page with only a prior %s draft as new",
    async (_label, status) => {
      const body = await review([
        revision("# Current draft", { report_id: CURRENT_REPORT, status: "draft" }),
        revision("# Earlier draft", { report_id: "report-earlier", status }),
      ]);

      expect(body.pages).toEqual([
        {
          path: PATH,
          oldBody: "",
          newBody: "# Current draft",
          isNewPage: true,
        },
      ]);
    },
  );

  it("compares the final write with the live page before the report's first write", async () => {
    const body = await review([
      revision("# Final draft", { report_id: CURRENT_REPORT, status: "draft" }),
      revision("# Intermediate draft", { report_id: CURRENT_REPORT, status: "draft" }),
      revision("# Live before ingest", { report_id: "report-live", status: "live" }),
    ]);

    expect(body.pages[0]).toEqual({
      path: PATH,
      oldBody: "# Live before ingest",
      newBody: "# Final draft",
      isNewPage: false,
    });
  });

  it("uses a prior legacy live revision with no status", async () => {
    const body = await review([
      revision("# Current draft", { report_id: CURRENT_REPORT, status: "draft" }),
      revision("# Rejected draft", { report_id: "report-rejected", status: "rejected" }),
      revision("# Legacy live page", { report_id: "report-live" }),
    ]);

    expect(body.pages[0]).toEqual({
      path: PATH,
      oldBody: "# Legacy live page",
      newBody: "# Current draft",
      isNewPage: false,
    });
  });

  it("treats a page whose latest prior live revision is a tombstone as new", async () => {
    const body = await review([
      revision("# Recreated draft", { report_id: CURRENT_REPORT, status: "draft" }),
      revision("", { deleted: true, status: "live" }),
      revision("# Live before deletion", { status: "live" }),
    ]);

    expect(body.pages[0]).toEqual({
      path: PATH,
      oldBody: "",
      newBody: "# Recreated draft",
      isNewPage: true,
    });
  });
});
