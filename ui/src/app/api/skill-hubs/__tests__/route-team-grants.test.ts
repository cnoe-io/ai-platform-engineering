/**
 * @jest-environment node
 */

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    validateCredentialsRef: jest.fn((value) => value ?? null),
    getAuthFromBearerOrSession: jest.fn(async () => ({
      user: { email: "admin@example.com", role: "admin" },
      session: { sub: "admin-sub", role: "admin" },
    })),
    requireRbacPermission: jest.fn(async () => undefined),
    withErrorHandler:
      <T,>(handler: (request: Request, context?: unknown) => Promise<T>) =>
      async (request: Request, context?: unknown) => {
        try {
          return await handler(request, context);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "error" },
            { status: (error as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});

describe("skill hubs team grants config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persists selected teams when registering a hub", async () => {
    const insertOne = jest.fn().mockResolvedValue({ insertedId: "hub" });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
      insertOne,
    });
    const { POST } = await import("../route");

    const response = await POST(
      new Request("http://localhost/api/skill-hubs", {
        method: "POST",
        body: JSON.stringify({
          type: "github",
          location: "owner/repo",
          shared_with_teams: ["platform", "platform", "sre"],
        }),
      }) as never,
    );

    expect(response.status).toBe(201);
    expect(insertOne.mock.calls[0][0].shared_with_teams).toEqual(["platform", "sre"]);
  });
});
