/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockWithAuth = jest.fn();
const mockRequireAdmin = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  withAuth: (...args: unknown[]) => mockWithAuth(...args),
  withErrorHandler:
    <T,>(handler: (request: NextRequest) => Promise<T>) =>
    (request: NextRequest) =>
      handler(request),
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

describe("admin platform-config route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DEFAULT_AGENT_ID;
    mockWithAuth.mockImplementation((_request, handler) =>
      handler(_request, { email: "admin@example.com" }, { sub: "admin-sub", role: "admin" }),
    );
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ _id: "platform_settings", default_agent_id: "agent-default" }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    });
    mockRequireAdmin.mockResolvedValue(undefined);
    mockRequireResourcePermission.mockResolvedValue(undefined);
  });

  it("requires system_config read access before returning platform config", async () => {
    const { GET } = await import("../route");

    const response = await GET(request("/api/admin/platform-config"));

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      { type: "system_config", id: "platform_settings", action: "read" },
    );
  });

  it("does not read platform config when system_config read is denied", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("no read"));
    const { GET } = await import("../route");

    await expect(GET(request("/api/admin/platform-config"))).rejects.toThrow("no read");

    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("returns the env fallback when no DB default agent is configured", async () => {
    process.env.DEFAULT_AGENT_ID = "agent-env-default";
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn(),
    });
    const { GET } = await import("../route");

    const response = await GET(request("/api/admin/platform-config"));
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      data: { default_agent_id: "agent-env-default", source: "env" },
    });

    delete process.env.DEFAULT_AGENT_ID;
  });

  it("requires admin and system_config manage access before updating platform config", async () => {
    const { PATCH } = await import("../route");

    const response = await PATCH(
      request("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_agent_id: "agent-next" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockRequireAdmin).toHaveBeenCalledWith({ sub: "admin-sub", role: "admin" });
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      { type: "system_config", id: "platform_settings", action: "admin" },
    );
  });

  it("checks coarse admin before system_config manage on updates", async () => {
    mockRequireAdmin.mockRejectedValue(new Error("not admin"));
    const { PATCH } = await import("../route");

    await expect(
      PATCH(
        request("/api/admin/platform-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ default_agent_id: "agent-next" }),
        }),
      ),
    ).rejects.toThrow("not admin");

    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("does not update platform config when system_config manage is denied", async () => {
    mockRequireResourcePermission.mockRejectedValue(new Error("no manage"));
    const { PATCH } = await import("../route");

    await expect(
      PATCH(
        request("/api/admin/platform-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ default_agent_id: "agent-next" }),
        }),
      ),
    ).rejects.toThrow("no manage");

    expect(mockGetCollection).not.toHaveBeenCalled();
  });
});
