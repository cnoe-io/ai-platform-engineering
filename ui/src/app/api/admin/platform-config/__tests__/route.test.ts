/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockWithAuth = jest.fn();
const mockRequireAdmin = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockGetCollection = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  withAuth: (...args: unknown[]) => mockWithAuth(...args),
  withErrorHandler:
    <T,>(handler: (request: NextRequest) => Promise<T>) =>
    (request: NextRequest) =>
      handler(request),
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  requireRbacPermission: (...args: unknown[]) => mockRequireAdmin(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
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
      findOne: jest.fn().mockResolvedValue({
        _id: "platform_settings",
        default_agent_id: "agent-default",
        release_notes: {
          enabled: true,
          release_version: "0.6.0",
          announcement_revision: 4,
          announcement_id: "0.6.0:revision-4",
          show_toast: true,
          toast_duration_ms: 10000,
          show_migration_cta: true,
        },
      }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    });
    mockRequireAdmin.mockResolvedValue(undefined);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
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

  it("returns release notes notification config with platform settings", async () => {
    const { GET } = await import("../route");

    const response = await GET(request("/api/admin/platform-config"));
    const body = await response.json();

    expect(body.data.release_notes).toMatchObject({
      enabled: true,
      release_version: "0.6.0",
      announcement_revision: 4,
      announcement_id: "0.6.0:revision-4",
      show_toast: true,
      toast_duration_ms: 10000,
      show_migration_cta: true,
    });
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
    expect(mockRequireAdmin).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      "admin_ui",
      "admin",
    );
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "admin-sub", role: "admin" },
      { type: "system_config", id: "platform_settings", action: "admin" },
    );
  });

  it("grants all authenticated users access to the configured default dynamic agent", async () => {
    const collection = {
      findOne: jest.fn().mockResolvedValue({ _id: "platform_settings", default_agent_id: "agent-old" }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    mockGetCollection.mockResolvedValue(collection);
    const { PATCH } = await import("../route");

    const response = await PATCH(
      request("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_agent_id: "agent-next" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "user:*", relation: "user", object: "agent:agent-next" }],
      deletes: [{ user: "user:*", relation: "user", object: "agent:agent-old" }],
    });
  });

  it("revokes the previous all-users default-agent grant when falling back to the supervisor", async () => {
    const collection = {
      findOne: jest.fn().mockResolvedValue({ _id: "platform_settings", default_agent_id: "agent-old" }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    mockGetCollection.mockResolvedValue(collection);
    const { PATCH } = await import("../route");

    const response = await PATCH(
      request("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_agent_id: null }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [],
      deletes: [{ user: "user:*", relation: "user", object: "agent:agent-old" }],
    });
  });

  it("updates release notes config without clearing default agent", async () => {
    const collection = {
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    mockGetCollection.mockResolvedValue(collection);
    const { PATCH } = await import("../route");

    const response = await PATCH(
      request("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          release_notes: {
            enabled: true,
            release_version: "0.6.0",
            announcement_revision: 2,
            show_toast: true,
            toast_duration_ms: 12000,
            show_migration_cta: false,
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(collection.updateOne).toHaveBeenCalledWith(
      { _id: "platform_settings" },
      expect.objectContaining({
        $set: expect.objectContaining({
          release_notes: expect.objectContaining({
            release_version: "0.6.0",
            announcement_revision: 2,
            announcement_id: "0.6.0:revision-2",
          }),
        }),
      }),
      { upsert: true },
    );
    expect(collection.updateOne.mock.calls[0][1].$set).not.toHaveProperty("default_agent_id");
    expect(body.data.release_notes.announcement_id).toBe("0.6.0:revision-2");
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
