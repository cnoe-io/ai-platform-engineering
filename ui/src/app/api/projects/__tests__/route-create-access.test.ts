/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetCollection = jest.fn();
const mockResolveDataSteward = jest.fn();
const mockReconcileDataSteward = jest.fn();
const mockReconcileTomeReadAccess = jest.fn();
const mockRemoveTomeReadAccess = jest.fn();
const mockAuditTome = jest.fn();
const mockCanAssignProjectToTeam = jest.fn();
const mockInvalidateTomeReadAccessCatalogCache = jest.fn();
const reservationInsertOne = jest.fn();
const reservationDeleteOne = jest.fn();

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

jest.mock("@/lib/projects/project-admin", () => ({
  canAssignProjectToTeam: (...args: unknown[]) =>
    mockCanAssignProjectToTeam(...args),
  canManageProjectsOrganization: jest.fn(async () => false),
}));

jest.mock("@/lib/auth-config", () => ({
  isBootstrapAdmin: jest.fn(() => false),
}));

jest.mock("@/lib/tome/data-steward", () => ({
  reconcileDataSteward: (...args: unknown[]) =>
    mockReconcileDataSteward(...args),
  resolveDataSteward: (...args: unknown[]) => mockResolveDataSteward(...args),
  tomeSessionSubject: jest.fn(() => "creator-subject"),
}));

jest.mock("@/lib/tome/access", () => ({
  invalidateTomeReadAccessCatalogCache: () =>
    mockInvalidateTomeReadAccessCatalogCache(),
  listReadableTomeProjects: jest.fn(async () => []),
  reconcileTomeReadAccess: (...args: unknown[]) =>
    mockReconcileTomeReadAccess(...args),
  removeTomeReadAccess: (...args: unknown[]) =>
    mockRemoveTomeReadAccess(...args),
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
    reservationInsertOne.mockResolvedValue({ insertedId: "example-project" });
    reservationDeleteOne.mockResolvedValue({ deletedCount: 1 });
    mockGetCollection.mockImplementation((name: string) => {
      if (name === "teams") return teams;
      if (name === "projects") return projects;
      if (name === "project_slug_reservations") {
        return { insertOne: reservationInsertOne, deleteOne: reservationDeleteOne };
      }
      throw new Error(`Unexpected collection: ${name}`);
    });
    mockResolveDataSteward.mockResolvedValue({
      type: "user",
      id: "creator-subject",
      name: "Example Creator",
      email: "creator@example.test",
    });
    mockReconcileDataSteward.mockResolvedValue(undefined);
    mockRemoveTomeReadAccess.mockResolvedValue(undefined);
    mockCanAssignProjectToTeam.mockResolvedValue(true);
  });

  function createRequest(
    overrides: Record<string, unknown> = {},
  ): NextRequest {
    return new NextRequest("http://example.test/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Example Project",
        team_id: "example-team",
        ...overrides,
      }),
    });
  }

  it("creates one immutable-ID authorization object and returns the same id", async () => {
    const response = await POST(createRequest());
    const body = await response.json();
    const inserted = projects.insertOne.mock.calls[0][0];
    const immutableId = String(inserted._id);

    expect(response.status).toBe(201);
    expect(body.data.project._id).toBe(immutableId);
    expect(inserted).toMatchObject({
      slug: "example-project",
      tome_authorization_version: 2,
      team_id: "team-id",
      team_slug: "example-team",
    });
    expect(reservationInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "example-project",
        project_id: immutableId,
      }),
    );
    expect(mockReconcileDataSteward).toHaveBeenCalledWith(
      expect.objectContaining({ _id: inserted._id, data_steward: undefined }),
      expect.objectContaining({ id: "creator-subject" }),
    );
    expect(mockReconcileTomeReadAccess).toHaveBeenCalledWith(
      expect.objectContaining({ _id: inserted._id }),
    );
    expect(mockInvalidateTomeReadAccessCatalogCache).toHaveBeenCalledTimes(1);
    expect(deleteOne).not.toHaveBeenCalled();
    expect(reservationDeleteOne).not.toHaveBeenCalled();
    expect(mockAuditTome).toHaveBeenCalledTimes(1);
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
    expect(deleteOne).toHaveBeenCalledWith({
      _id: projects.insertOne.mock.calls[0][0]._id,
    });
    expect(reservationDeleteOne).toHaveBeenCalledWith({
      _id: "example-project",
      project_id: String(projects.insertOne.mock.calls[0][0]._id),
    });
    expect(mockRemoveTomeReadAccess).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "example-project" }),
    );
    expect(mockReconcileDataSteward).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: "example-project" }),
      null,
    );
    expect(mockAuditTome).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("denies creation for a team the caller does not belong to", async () => {
    mockCanAssignProjectToTeam.mockResolvedValue(false);
    const response = await POST(
      new NextRequest("http://example.test/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Example Project", team_id: "example-team" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROJECT_TEAM_ASSIGNMENT_REQUIRED",
    });
    expect(projects.insertOne).not.toHaveBeenCalled();
  });

  it("enforces one slug namespace across teams", async () => {
    projects.findOne.mockResolvedValue({
      slug: "example-project",
      type: "project",
      team_id: "another-team-id",
    });
    const response = await POST(
      new NextRequest("http://example.test/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Example Project",
          team_id: "example-team",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(projects.findOne).toHaveBeenCalledWith({ slug: "example-project" });
    expect(projects.insertOne).not.toHaveBeenCalled();
  });

  it.each(["catalog_api_key", "skills_api_key"])(
    "rejects scoped %s principals before creating a project",
    async (principalType) => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "catalog-user@example.test" },
      session: { sub: "catalog-user", principalType },
    });
    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "TOME_INTERACTIVE_PRINCIPAL_REQUIRED",
    });
    expect(teams.findOne).not.toHaveBeenCalled();
    expect(projects.insertOne).not.toHaveBeenCalled();
    },
  );

  it("turns a concurrent slug reservation collision into PROJECT_EXISTS", async () => {
    reservationInsertOne.mockRejectedValue(Object.assign(new Error("duplicate"), { code: 11000 }));
    const response = await POST(
      new NextRequest("http://example.test/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Example Project", team_id: "example-team" }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "PROJECT_EXISTS" });
    expect(projects.insertOne).not.toHaveBeenCalled();
  });

  it("releases the slug reservation when the Mongo project insert fails", async () => {
    projects.insertOne.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    expect(reservationDeleteOne).toHaveBeenCalledWith({
      _id: "example-project",
      project_id: String(projects.insertOne.mock.calls[0][0]._id),
    });
    expect(deleteOne).not.toHaveBeenCalled();
    expect(mockReconcileDataSteward).not.toHaveBeenCalled();
    expect(mockRemoveTomeReadAccess).not.toHaveBeenCalled();
    expect(mockAuditTome).not.toHaveBeenCalled();
  });

  it("does not reserve a slug when the requested steward cannot be verified", async () => {
    mockResolveDataSteward.mockResolvedValue(null);
    const response = await POST(
      createRequest({
        data_steward: { type: "user", email: "missing@example.test" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "DATA_STEWARD_REQUIRED",
    });
    expect(reservationInsertOne).not.toHaveBeenCalled();
    expect(projects.insertOne).not.toHaveBeenCalled();
    expect(mockReconcileDataSteward).not.toHaveBeenCalled();
  });
});
