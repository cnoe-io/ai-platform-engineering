const mockRetrieve = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: jest.fn(async () => ({
    user: { email: "svc@example.test", name: "Service", role: "user" },
    session: { sub: "service-sub" },
  })),
  successResponse: (data: unknown, status = 200) => ({
    status,
    json: async () => ({ success: true, data }),
  }),
  withErrorHandler: (handler: unknown) => handler,
}));

jest.mock("@/lib/credentials/retrieval-service-factory", () => ({
  getCredentialRetrievalService: () => ({
    retrieve: mockRetrieve,
  }),
}));

function request(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    json: async () => body,
    url: "http://localhost/api/credentials/retrieve",
  } as never;
}

describe("/api/credentials/retrieve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
  });

  it("returns credential material only for service API callers", async () => {
    const { POST } = await import("../route");
    mockRetrieve.mockResolvedValue({
      secret_ref: "secret-1",
      credential: "github-token-value",
    });

    const response = await POST(
      request(
        { secret_ref: "secret-1", intended_use: "mcp_server" },
        {
          authorization: "Bearer service-token",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "caipe-credential-service",
        },
      ),
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        secret_ref: "secret-1",
        credential: "github-token-value",
      },
    });
  });
});
