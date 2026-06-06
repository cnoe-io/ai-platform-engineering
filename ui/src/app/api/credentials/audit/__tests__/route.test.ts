/**
 * @jest-environment node
 */

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: mockGetAuthFromBearerOrSession,
  };
});

jest.mock("@/lib/feature-flags/credentials", () => ({
  getCredentialFeatureConfig: jest.fn(() => ({ enabled: true })),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: mockGetCollection,
}));

describe("/api/credentials/audit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "alice-sub" } });
    mockGetCollection.mockResolvedValue({
      find: jest.fn(() => ({
        sort: jest.fn(() => ({
          limit: jest.fn(() => ({
            toArray: jest.fn(async () => [
              {
                action: "secret.create",
                actor: { type: "user", id: "alice-sub" },
                resource: { type: "secret_ref", id: "secret-1" },
                result: "success",
                details: { value: "***REDACTED***" },
              },
            ]),
          })),
        })),
      })),
    });
  });

  it("returns redacted audit events for the authenticated actor", async () => {
    const { GET } = await import("../route");
    const response = await GET({ headers: new Headers(), url: "http://localhost/api/credentials/audit" } as never);

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ action: "secret.create", details: { value: "***REDACTED***" } }],
    });
  });
});
