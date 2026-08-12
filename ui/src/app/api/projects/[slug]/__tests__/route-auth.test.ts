/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockDeleteOne = jest.fn(async () => ({ deletedCount: 1 }));
const mockFindOne = jest.fn();
const mockFindBySlug = jest.fn();
const mockGetTomeProjectPermissions = jest.fn();
const mockRunOnboardingDeletes = jest.fn(async () => []);
const mockRemoveTomeReadAccess = jest.fn(async () => undefined);
const mockReconcileDataSteward = jest.fn(async () => undefined);
const mockInvalidateTomeReadAccessCatalogCache = jest.fn();
const mockDeleteReservation = jest.fn(async () => ({ deletedCount: 1 }));

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: jest.fn(async () => ({
      user: { email: "steward@example.test" },
      session: {
        sub: "steward-subject",
        user: { email: "steward@example.test" },
      },
    })),
  };
});

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async (name: string) =>
    name === "project_slug_reservations"
      ? { deleteOne: mockDeleteReservation }
      : {
          findOne: mockFindOne,
          find: mockFindBySlug,
          deleteOne: mockDeleteOne,
        },
  ),
}));

jest.mock("@/lib/tome/data-steward", () => ({
  dataStewardOpenFgaSubject: jest.fn(),
  getTomeProjectPermissions: (...args: unknown[]) =>
    mockGetTomeProjectPermissions(...args),
  reconcileDataSteward: (...args: unknown[]) =>
    mockReconcileDataSteward(...args),
  resolveDataSteward: jest.fn(async () => null),
}));

jest.mock("@/lib/tome/access", () => ({
  getTomeReadConfiguration: jest.fn(),
  invalidateTomeReadAccessCatalogCache: () =>
    mockInvalidateTomeReadAccessCatalogCache(),
  reconcileTomeReadAccess: jest.fn(),
  removeTomeReadAccess: (...args: unknown[]) =>
    mockRemoveTomeReadAccess(...args),
}));

jest.mock("@/lib/projects/onboarding-providers", () => ({
  runOnboardingDeletes: (...args: unknown[]) =>
    mockRunOnboardingDeletes(...args),
  runOnboardingUpdates: jest.fn(),
}));

jest.mock("@/lib/tome/audit", () => ({
  auditTome: jest.fn(),
  tomeActorFromAuth: jest.fn(() => ({
    subject: "steward-subject",
    email: "steward@example.test",
  })),
}));

import { DELETE, GET } from "../route";

function request(slug: string): NextRequest {
  return new NextRequest(`http://example.test/api/projects/${slug}`, {
    method: "DELETE",
  });
}

async function deleteEntity(type: "project" | "area" | "bhag") {
  const project = {
    _id: `${type}-id`,
    slug: `example-${type}`,
    name: `Example ${type}`,
    title: `Example ${type}`,
    type,
  };
  mockFindBySlug.mockReturnValue({
    limit: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([project]),
    }),
  });
  return DELETE(request(`example-${type}`), {
    params: Promise.resolve({ slug: `example-${type}` }),
  });
}

describe("DELETE /api/projects/[slug] authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTomeProjectPermissions.mockResolvedValue({
      canRead: true,
      canEdit: true,
      canManageSteward: false,
    });
  });

  it.each(["bhag", "area"] as const)(
    "denies a non-admin data steward deleting a %s",
    async (type) => {
      const response = await deleteEntity(type);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        success: false,
        code: "TOME_ADMIN_REQUIRED",
      });
      expect(mockRunOnboardingDeletes).not.toHaveBeenCalled();
      expect(mockDeleteOne).not.toHaveBeenCalled();
    },
  );

  it("allows a data steward to delete a regular project", async () => {
    const response = await deleteEntity("project");

    expect(response.status).toBe(200);
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: "project-id" });
    expect(mockDeleteReservation).toHaveBeenCalledWith({
      _id: "example-project",
      project_id: "project-id",
    });
    expect(mockInvalidateTomeReadAccessCatalogCache).toHaveBeenCalledTimes(1);
  });

  it("allows a Tome admin to delete a BHAG", async () => {
    mockGetTomeProjectPermissions.mockResolvedValue({
      canRead: true,
      canEdit: true,
      canManageSteward: true,
    });

    const response = await deleteEntity("bhag");

    expect(response.status).toBe(200);
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: "bhag-id" });
  });
});

describe("slug collision boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ["GET", GET],
    ["DELETE", DELETE],
  ] as const)("fails closed for ambiguous %s requests before authorization", async (_method, handler) => {
    mockFindBySlug.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: "first-id", slug: "duplicate", type: "project" },
          { _id: "second-id", slug: "duplicate", type: "project" },
        ]),
      }),
    });

    const response = await handler(request("duplicate"), {
      params: Promise.resolve({ slug: "duplicate" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROJECT_SLUG_AMBIGUOUS",
    });
    expect(mockGetTomeProjectPermissions).not.toHaveBeenCalled();
    expect(mockDeleteOne).not.toHaveBeenCalled();
  });
});
