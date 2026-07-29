/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockDeleteOne = jest.fn(async () => ({ deletedCount: 1 }));
const mockFindOne = jest.fn();
const mockGetTomeProjectPermissions = jest.fn();
const mockRunOnboardingDeletes = jest.fn(async () => []);
const mockRemoveTomeReadAccess = jest.fn(async () => undefined);
const mockReconcileDataSteward = jest.fn(async () => undefined);

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
  getCollection: jest.fn(async () => ({
    findOne: mockFindOne,
    deleteOne: mockDeleteOne,
  })),
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

import { DELETE } from "../route";

function request(slug: string): NextRequest {
  return new NextRequest(`http://example.test/api/projects/${slug}`, {
    method: "DELETE",
  });
}

async function deleteEntity(type: "project" | "area" | "bhag") {
  mockFindOne.mockResolvedValue({
    _id: `${type}-id`,
    slug: `example-${type}`,
    name: `Example ${type}`,
    title: `Example ${type}`,
    type,
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
