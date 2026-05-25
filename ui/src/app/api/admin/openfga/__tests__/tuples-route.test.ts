/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockLogOpenFgaRebacAuditEvent = jest.fn();
const mockWithOpenFgaAdminAuth = jest.fn(
  async (_request: NextRequest, handler: (auth: unknown) => Promise<unknown>) =>
    handler({
      user: { email: "alice@example.com" },
      session: { sub: "alice-sub", org: "platform" },
    }),
);
const mockWithOpenFgaViewAuth = jest.fn(
  async (_request: NextRequest, handler: (auth: unknown) => Promise<unknown>) =>
    handler({
      user: { email: "alice@example.com" },
      session: { sub: "alice-sub", org: "platform" },
    }),
);

jest.mock("../_lib", () => ({
  ...jest.requireActual("../_lib"),
  withOpenFgaAdminAuth: (...args: unknown[]) => mockWithOpenFgaAdminAuth(...args),
  withOpenFgaViewAuth: (...args: unknown[]) => mockWithOpenFgaViewAuth(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logOpenFgaRebacAuditEvent: (...args: unknown[]) => mockLogOpenFgaRebacAuditEvent(...args),
}));

function request(path: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReadOpenFgaTuples.mockResolvedValue({ tuples: [], continuationToken: undefined });
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
});

describe("/api/admin/openfga/tuples", () => {
  it("audits tuple inspector reads", async () => {
    const { GET } = await import("../tuples/route");

    const response = await GET(
      request("/api/admin/openfga/tuples?user=team%3Aplatform%23member&limit=25"),
    );

    expect(response.status).toBe(200);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25 }),
    );
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "platform",
        sub: "alice-sub",
        operation: "list_tuples",
      }),
    );
  });

  it("applies tuple inspector relation filters after a valid OpenFGA read", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        { key: { user: "user:alice", relation: "member", object: "team:platform" } },
        { key: { user: "team:platform#member", relation: "user", object: "agent:incident" } },
      ],
      continuationToken: undefined,
    });
    const { GET } = await import("../tuples/route");

    const response = await GET(request("/api/admin/openfga/tuples?relation=m&limit=25"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25 }),
    );
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith(
      expect.not.objectContaining({ tuple: expect.objectContaining({ relation: "m" }) }),
    );
    expect(body.data.tuples).toEqual([
      { key: { user: "user:alice", relation: "member", object: "team:platform" } },
    ]);
  });

  it("audits raw tuple writes", async () => {
    const { POST } = await import("../tuples/route");

    const response = await POST(
      request("/api/admin/openfga/tuples", {
        method: "POST",
        body: JSON.stringify({
          writes: [{ user: "team:platform#member", relation: "user", object: "agent:agent-1" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "team:platform#member", relation: "user", object: "agent:agent-1" }],
      deletes: [],
    });
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "platform",
        sub: "alice-sub",
        operation: "write_tuples",
        resourceRef: expect.stringContaining('"applied_writes":1'),
      }),
    );
  });

  it("rejects materialized can_* tuple writes", async () => {
    const { POST } = await import("../tuples/route");

    const response = await POST(
      request("/api/admin/openfga/tuples", {
        method: "POST",
        body: JSON.stringify({
          writes: [{ user: "team:platform#member", relation: "can_use", object: "agent:agent-1" }],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("materialized relation can_use is not writable"),
    });
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
});
