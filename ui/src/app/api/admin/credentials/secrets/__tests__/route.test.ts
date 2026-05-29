/**
 * @jest-environment node
 */

const mockListAllSecretsForAdmin = jest.fn();
const mockUpdateSecretMetadataForAdmin = jest.fn();
const mockDeleteSecretForAdmin = jest.fn();
const mockRequireAdminSurfaceManage = jest.fn(async () => undefined);

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: jest.fn(async () => ({ session: { sub: "admin-sub" } })),
  };
});

jest.mock("@/lib/feature-flags/credentials", () => ({
  getCredentialFeatureConfig: jest.fn(() => ({ enabled: true })),
}));

jest.mock("@/lib/rbac/require-openfga", () => ({
  requireAdminSurfaceManage: mockRequireAdminSurfaceManage,
}));

jest.mock("@/lib/credentials/secret-service-factory", () => ({
  getCredentialSecretService: jest.fn(async () => ({
    listAllSecretsForAdmin: mockListAllSecretsForAdmin,
    updateSecretMetadataForAdmin: mockUpdateSecretMetadataForAdmin,
    deleteSecretForAdmin: mockDeleteSecretForAdmin,
  })),
}));

function request(method: string, body?: unknown) {
  return {
    method,
    headers: new Headers(body ? { "content-type": "application/json" } : undefined),
    json: async () => body,
    url: "http://localhost/api/admin/credentials/secrets",
  } as never;
}

describe("/api/admin/credentials/secrets", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists all secret metadata behind the credentials admin surface", async () => {
    mockListAllSecretsForAdmin.mockResolvedValue([
      { id: "secret-1", owner: { type: "user", id: "alice" }, maskedPreview: "ghp_...abcd" },
    ]);
    const { GET } = await import("../route");
    const response = await GET(request("GET"));
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: "secret-1", maskedPreview: "ghp_...abcd" }],
    });
    expect(mockRequireAdminSurfaceManage).toHaveBeenCalledWith({ sub: "admin-sub" }, "credentials");
  });

  it("updates and deletes secret metadata through admin routes", async () => {
    mockUpdateSecretMetadataForAdmin.mockResolvedValue({ id: "secret-1", name: "Renamed" });
    const { PATCH } = await import("../[secret_id]/route");
    const patchResponse = await PATCH(request("PATCH", { name: "Renamed" }), {
      params: Promise.resolve({ secret_id: "secret-1" }),
    });
    await expect(patchResponse.json()).resolves.toMatchObject({
      success: true,
      data: { id: "secret-1", name: "Renamed" },
    });
    expect(mockUpdateSecretMetadataForAdmin).toHaveBeenCalledWith({
      secretId: "secret-1",
      name: "Renamed",
      description: undefined,
    });

    const { DELETE } = await import("../[secret_id]/route");
    await DELETE(request("DELETE"), { params: Promise.resolve({ secret_id: "secret-1" }) });
    expect(mockDeleteSecretForAdmin).toHaveBeenCalledWith("secret-1");
  });
});
