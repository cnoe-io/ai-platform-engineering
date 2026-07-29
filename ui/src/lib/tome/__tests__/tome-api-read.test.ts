import type { NextRequest } from "next/server";

import {
  loadTomeProject,
  requireTomeEditor,
  type TomeProjectContext,
} from "@/lib/tome/tome-api";
import type { ProjectDocument } from "@/types/projects";

const mockGetAuth = jest.fn();
const mockGetCollection = jest.fn();
const mockGetPermissions = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class MockApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public code: string,
    ) {
      super(message);
    }
  },
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/tome/guard", () => ({
  isTomeServerEnabled: () => true,
}));

jest.mock("@/lib/tome/data-steward", () => ({
  getTomeProjectPermissions: (...args: unknown[]) => mockGetPermissions(...args),
}));

const project: ProjectDocument = {
  _id: "project-id",
  type: "project",
  slug: "example",
  name: "Example",
  title: "Example",
  description: "",
  team_id: "team-id",
  team_slug: "example-team",
  team_name: "Example Team",
  owner_id: "owner@example.test",
  member_ids: [],
  domain: "default",
  tags: [],
  status: "active",
  catalog: {} as ProjectDocument["catalog"],
  components: [],
  onboarding: {},
  integrations: {},
  created_at: new Date(),
  updated_at: new Date(),
};

describe("loadTomeProject read enforcement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuth.mockResolvedValue({
      user: { email: "viewer@example.test" },
      session: { sub: "viewer-sub" },
    });
    mockGetCollection.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(project),
    });
  });

  it("rejects an authenticated caller without OpenFGA can_read", async () => {
    mockGetPermissions.mockResolvedValue({
      canRead: false,
      canEdit: false,
      canManageSteward: false,
    });

    await expect(
      loadTomeProject({} as NextRequest, "example"),
    ).rejects.toMatchObject({
      status: 403,
      code: "TOME_READ_REQUIRED",
    });
  });

  it("returns the scoped context after OpenFGA allows reading", async () => {
    mockGetPermissions.mockResolvedValue({
      canRead: true,
      canEdit: false,
      canManageSteward: false,
    });

    await expect(
      loadTomeProject({} as NextRequest, "example"),
    ).resolves.toMatchObject({
      projectId: "project-id",
      canRead: true,
      canEdit: false,
    });
  });

  it("rejects writes when the resolved OpenFGA context is read-only", () => {
    let error: unknown;
    try {
      requireTomeEditor({ canEdit: false } as TomeProjectContext);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      status: 403,
      code: "DATA_STEWARD_REQUIRED",
    });
  });

  it("allows writes when the resolved OpenFGA context can edit", () => {
    expect(() =>
      requireTomeEditor({ canEdit: true } as TomeProjectContext),
    ).not.toThrow();
  });
});
