/**
 * @jest-environment node
 */
/**
 * T010 — GET /api/admin/service-accounts/grantable.
 *
 * FR-007/009: the grantable set is the CALLING USER's own holdings — agents via
 * `user:<sub> can_use agent` and tools via `user:<sub> can_call tool`. The route
 * resolves friendly names best-effort (falling back to the ref) and never leaks
 * anything beyond what the caller holds.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

const mockListOpenFgaObjects = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  listOpenFgaObjects: (...args: unknown[]) => mockListOpenFgaObjects(...args),
}));

const mockListRebacCatalog = jest.fn();
jest.mock("@/lib/rbac/resource-catalog", () => ({
  listRebacCatalog: (...args: unknown[]) => mockListRebacCatalog(...args),
}));

import { GET } from "../grantable/route";

const SESSION = { sub: "caller-sub", user: { email: "caller@example.com" } };

function req(): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/service-accounts/grantable");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockListRebacCatalog.mockResolvedValue({ resources: [] });
});

describe("GET /api/admin/service-accounts/grantable", () => {
  it("keys on the CALLER's own holdings (FR-007/009) and shapes {ref,name}", async () => {
    mockListOpenFgaObjects
      .mockResolvedValueOnce({ objects: ["agent:incident-resolver"] }) // can_use agent
      .mockResolvedValueOnce({ objects: ["tool:jira/search", "tool:jira/*"] }); // can_call tool
    mockListRebacCatalog.mockResolvedValue({
      resources: [{ type: "agent", id: "incident-resolver", display_name: "Incident Resolver" }],
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // The two list-objects calls are keyed on the caller subject + correct relations.
    const calls = mockListOpenFgaObjects.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      { user: "user:caller-sub", relation: "can_use", type: "agent" },
      { user: "user:caller-sub", relation: "can_call", type: "tool" },
    ]);

    expect(body.data.agents).toEqual([{ ref: "incident-resolver", name: "Incident Resolver" }]);
    // Tools humanized; wildcard rendered as "all tools". Sorted by name.
    expect(body.data.tools).toEqual([
      { ref: "jira/*", name: "jira: all tools" },
      { ref: "jira/search", name: "jira: search" },
    ]);
  });

  it("falls back to the raw ref when the catalog has no display name", async () => {
    mockListOpenFgaObjects
      .mockResolvedValueOnce({ objects: ["agent:mystery-agent"] })
      .mockResolvedValueOnce({ objects: [] });

    const res = await GET(req());
    const body = await res.json();
    expect(body.data.agents).toEqual([{ ref: "mystery-agent", name: "mystery-agent" }]);
    expect(body.data.tools).toEqual([]);
  });

  it("still returns agents/tools when the name catalog throws (names are decorative)", async () => {
    mockListOpenFgaObjects
      .mockResolvedValueOnce({ objects: ["agent:a1"] })
      .mockResolvedValueOnce({ objects: ["tool:srv/do"] });
    mockListRebacCatalog.mockRejectedValue(new Error("catalog down"));

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.agents).toEqual([{ ref: "a1", name: "a1" }]);
    expect(body.data.tools).toEqual([{ ref: "srv/do", name: "srv: do" }]);
  });

  it("401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("503 when the OpenFGA list call fails", async () => {
    mockListOpenFgaObjects.mockRejectedValue(new Error("openfga down"));
    const res = await GET(req());
    expect(res.status).toBe(503);
  });
});
