/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockQueryRebacGraph = jest.fn();
const mockWithOpenFgaViewAuth = jest.fn(async (_request: NextRequest, handler: () => Promise<unknown>) =>
  handler()
);

jest.mock("../_lib", () => ({
  withOpenFgaViewAuth: (...args: unknown[]) => mockWithOpenFgaViewAuth(...args),
}));

jest.mock("@/lib/rbac/rebac-graph", () => ({
  queryRebacGraph: (...args: unknown[]) => mockQueryRebacGraph(...args),
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
  });
});
