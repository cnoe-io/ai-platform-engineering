const mockDeleteSecret = jest.fn();
const mockGetSecretMetadata = jest.fn();
const mockRotateSecret = jest.fn();
const mockShareSecret = jest.fn();
const mockRevokeSecretShare = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode = 500, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: jest.fn(async () => ({
      user: { email: "alice@example.test", name: "Alice", role: "user" },
      session: { sub: "alice-sub", user: { email: "alice@example.test" } },
    })),
    successResponse: (data: unknown, status = 200) => ({
      status,
      json: async () => ({ success: true, data }),
    }),
    withErrorHandler: (handler: unknown) => handler,
  };
});

jest.mock("@/lib/credentials/secret-service-factory", () => ({
  getCredentialSecretService: () => ({
    deleteSecret: mockDeleteSecret,
    getSecretMetadata: mockGetSecretMetadata,
    rotateSecret: mockRotateSecret,
    shareSecret: mockShareSecret,
    revokeSecretShare: mockRevokeSecretShare,
  }),
}));

function request(method: string, body?: unknown) {
  return {
    method,
    headers: new Headers(body ? { "content-type": "application/json" } : undefined),
    json: async () => body,
    url: "http://localhost/api/credentials/secrets/secret-1",
  } as never;
}

const context = { params: Promise.resolve({ secret_id: "secret-1" }) };

describe("/api/credentials/secrets/[secret_id]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
  });

  it("returns masked detail metadata only", async () => {
    const { GET } = await import("../[secret_id]/route");
    mockGetSecretMetadata.mockResolvedValue({
      id: "secret-1",
      name: "GitHub token",
      maskedPreview: "ghp_...abcd",
    });

    const response = await GET(request("GET"), context);

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        id: "secret-1",
        name: "GitHub token",
        maskedPreview: "ghp_...abcd",
      },
    });
  });

  it("rotates secret material and returns masked metadata", async () => {
    const { PATCH } = await import("../[secret_id]/route");
    mockRotateSecret.mockResolvedValue({
      id: "secret-1",
      name: "GitHub token",
      maskedPreview: "new_...alue",
    });

    const response = await PATCH(request("PATCH", { action: "rotate", value: "new-token-value" }), context);
    const json = await response.json();

    expect(json).toEqual({
      success: true,
      data: {
        id: "secret-1",
        name: "GitHub token",
        maskedPreview: "new_...alue",
      },
    });
    expect(mockRotateSecret).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: "secret-1", plaintext: "new-token-value" }),
    );
    expect(JSON.stringify(json)).not.toContain("new-token-value");
  });

  it("shares and revokes team access without returning raw values", async () => {
    const { PATCH } = await import("../[secret_id]/route");
    const shareResponse = await PATCH(
      request("PATCH", { action: "share", teamId: "platform-team" }),
      context,
    );
    const revokeResponse = await PATCH(
      request("PATCH", { action: "revoke", teamId: "platform-team" }),
      context,
    );

    expect(shareResponse.status).toBe(200);
    expect(revokeResponse.status).toBe(200);
    expect(mockShareSecret).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: "secret-1", teamId: "platform-team" }),
    );
    expect(mockRevokeSecretShare).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: "secret-1", teamId: "platform-team" }),
    );
  });

  it("deletes the secret ref and encrypted payload", async () => {
    const { DELETE } = await import("../[secret_id]/route");
    const response = await DELETE(request("DELETE"), context);

    expect(response.status).toBe(200);
    expect(mockDeleteSecret).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: "secret-1" }),
    );
  });
});
