/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetCollection = jest.fn();
const mockResolveDataSteward = jest.fn();
const mockReconcileDataSteward = jest.fn();
const mockReconcileTomeReadAccess = jest.fn();
const mockAuditTome = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/rbac/tome-admin", () => ({
  isTomeAdmin: jest.fn(async () => false),
}));

jest.mock("@/lib/tome/data-steward", () => ({
  reconcileDataSteward: (...args: unknown[]) =>
    mockReconcileDataSteward(...args),
  resolveDataSteward: (...args: unknown[]) => mockResolveDataSteward(...args),
  tomeSessionSubject: jest.fn(() => "creator-subject"),
}));

jest.mock("@/lib/tome/access", () => ({
  listReadableTomeProjects: jest.fn(async () => []),
  reconcileTomeReadAccess: (...args: unknown[]) =>
    mockReconcileTomeReadAccess(...args),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: (...args: unknown[]) => mockAuditTome(...args),
  tomeActorFromAuth: jest.fn(() => ({
    type: "user",
    id: "creator-subject",
    email: "creator@example.test",
  })),
}));

import { POST } from "../route";

describe("POST /api/projects access setup failures", () => {
  const deleteOne = jest.fn();
  const projects = {
    findOne: jest.fn(),
    insertOne: jest.fn(),
    deleteOne,
  };
  const teams = {
    findOne: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "creator@example.test" },
      session: {
        sub: "creator-subject",
        user: { email: "creator@example.test" },
      },
    });
    teams.findOne.mockResolvedValue({
      _id: "team-id",
      slug: "example-team",
      name: "Example Team",
    });
    projects.findOne.mockResolvedValue(null);
    projects.insertOne.mockResolvedValue({ insertedId: "project-id" });
    deleteOne.mockResolvedValue({ deletedCount: 1 });
    mockGetCollection.mockImplementation((name: string) => {
      if (name === "teams") return teams;
      if (name === "projects") return projects;
      throw new Error(`Unexpected collection: ${name}`);
    });
    mockResolveDataSteward.mockResolvedValue({
      type: "user",
      id: "creator-subject",
      name: "Example Creator",
      email: "creator@example.test",
    });
    mockReconcileDataSteward.mockResolvedValue(undefined);
  });

  it("rolls back and returns a sanitized recovery response for OpenFGA failures", async () => {
    const internalMessage =
      "OpenFGA tuple write failed: 400 private tuple and deployment details";
    mockReconcileTomeReadAccess.mockRejectedValue(
      Object.assign(new Error(internalMessage), {
        name: "OpenFgaWriteError",
        status: 400,
        details: {
          code: "validation_error",
          message: "internal validation response",
        },
      }),
    );
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const request = new NextRequest("http://example.test/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Example Project",
        team_id: "example-team",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      code: "TOME_ACCESS_SETUP_FAILED",
      error:
        "Project access setup is temporarily unavailable. A Tome administrator can repair the authorization model from Projects and retry.",
    });
    expect(JSON.stringify(body)).not.toContain("private tuple");
    expect(deleteOne).toHaveBeenCalledWith({ _id: "project-id" });
    expect(mockReconcileDataSteward).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: "example-project" }),
      null,
    );
    expect(mockAuditTome).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
