/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockQueryRebacGraph = jest.fn();
const mockLogOpenFgaRebacAuditEvent = jest.fn();
const mockWithOpenFgaViewAuth = jest.fn(async (_request: NextRequest, handler: () => Promise<unknown>) =>
  handler({
    user: { email: "alice@example.com" },
    session: { sub: "alice-sub", org: "default" },
  })
);

jest.mock("../_lib", () => ({
  withOpenFgaViewAuth: (...args: unknown[]) => mockWithOpenFgaViewAuth(...args),
}));

jest.mock("@/lib/rbac/rebac-graph", () => ({
  queryRebacGraph: (...args: unknown[]) => mockQueryRebacGraph(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logOpenFgaRebacAuditEvent: (...args: unknown[]) => mockLogOpenFgaRebacAuditEvent(...args),
}));

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryRebacGraph.mockResolvedValue({ nodes: [], edges: [], scope: {}, truncated: false });
});

describe("GET /api/admin/openfga/graph", () => {
  it("forwards the selected subject to the ReBAC graph query", async () => {
    const { GET } = await import("../graph/route");

    const response = await GET(
      request("/api/admin/openfga/graph?team=platform&subject=user%3Aalice-sub&limit=250")
    );

    expect(response.status).toBe(200);
    expect(mockQueryRebacGraph).toHaveBeenCalledWith({
      team: "platform",
      subject: "user:alice-sub",
      limit: 250,
    });
    expect(mockLogOpenFgaRebacAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "alice-sub",
        email: "alice@example.com",
        operation: "query_graph",
        resourceRef: expect.stringContaining("user:alice-sub"),
      }),
    );
  });
});
