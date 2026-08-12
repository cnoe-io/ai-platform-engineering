/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuth = jest.fn();
const mockFetchBackstageSystems = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
  };
});

jest.mock("@/lib/projects/backstage-client", () => ({
  isBackstageConfigured: jest.fn(() => true),
  fetchBackstageSystems: (...args: unknown[]) => mockFetchBackstageSystems(...args),
}));

import { GET } from "../route";

describe("Backstage project lookup principal boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(["catalog_api_key", "skills_api_key"])(
    "rejects a %s principal",
    async (principalType) => {
      mockGetAuth.mockResolvedValue({
        user: { email: "catalog-user@example.test" },
        session: { principalType, sub: "catalog-user" },
      });

      const response = await GET(
        new NextRequest("http://example.test/api/projects/backstage/lookup"),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "TOME_INTERACTIVE_PRINCIPAL_REQUIRED",
      });
      expect(mockFetchBackstageSystems).not.toHaveBeenCalled();
    },
  );

  it("allows an interactive principal and filters the trusted catalog response", async () => {
    mockGetAuth.mockResolvedValue({
      user: { email: "viewer@example.test" },
      session: { principalType: "oidc_user", sub: "viewer-subject" },
    });
    mockFetchBackstageSystems.mockResolvedValue([
      {
        slug: "primary-system",
        title: "Primary System",
        description: "Example result",
        tags: ["example"],
        catalog: {
          metadata: {
            annotations: { "github.com/project-slug": "example/primary" },
          },
        },
      },
      {
        slug: "secondary-system",
        title: "Secondary System",
        description: "Filtered result",
        tags: [],
        catalog: { metadata: { annotations: {} } },
      },
    ]);

    const response = await GET(
      new NextRequest(
        "http://example.test/api/projects/backstage/lookup?q=PRIMARY",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        configured: true,
        results: [
          {
            slug: "primary-system",
            repos: ["https://github.com/example/primary"],
          },
        ],
      },
    });
    expect(mockFetchBackstageSystems).toHaveBeenCalledTimes(1);
  });
});
