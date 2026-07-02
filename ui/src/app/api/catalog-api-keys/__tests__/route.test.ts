/**
 * @jest-environment node
 */

const mockCreate = jest.fn();
const mockList = jest.fn();
const mockResolveOwner = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 500) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    ApiError,
    withAuth: async (
      _req: unknown,
      handler: (
        req: unknown,
        user: { email: string },
        session: { sub: string },
      ) => Promise<Response>,
    ) =>
      handler(_req, { email: "user@example.com", role: "user" }, { sub: "kc-sub-abc" }),
    withErrorHandler: (handler: unknown) => handler,
  };
});

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/catalog-api-keys", () => ({
  createCatalogApiKey: (...args: unknown[]) => mockCreate(...args),
  listCatalogApiKeys: (...args: unknown[]) => mockList(...args),
  resolveCatalogApiKeyOwnerId: (...args: unknown[]) => mockResolveOwner(...args),
}));

describe("catalog-api-keys routes (BFF)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveOwner.mockReturnValue("kc-sub-abc");
  });

  it("POST mints through the BFF", async () => {
    mockCreate.mockResolvedValue({
      key: "sk_abc123.secretpart",
      key_id: "sk_abc123",
    });

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost:3000/api/catalog-api-keys", {
        method: "POST",
      }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ key: "sk_abc123.secretpart", key_id: "sk_abc123" });
    expect(mockCreate).toHaveBeenCalledWith("kc-sub-abc", ["catalog:read"]);
  });

  it("GET lists keys for session owner", async () => {
    mockList.mockResolvedValue([
      {
        key_id: "sk_abc123",
        owner_user_id: "kc-sub-abc",
        scopes: ["catalog:read"],
        created_at: 1,
        revoked_at: null,
      },
    ]);

    const { GET } = await import("../route");
    const res = await GET(
      new Request("http://localhost:3000/api/catalog-api-keys") as never,
    );
    const body = await res.json();

    expect(body.keys).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith("kc-sub-abc");
  });
});
