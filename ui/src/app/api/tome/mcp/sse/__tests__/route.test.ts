/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();

jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
}));

jest.mock("@/lib/tome/guard", () => ({ isTomeServerEnabled: () => true }));

import { GET } from "../route";
import { POST } from "../../messages/route";

describe("legacy TOME MCP SSE transport", () => {
  beforeEach(() => {
    process.env.TOME_PUBLIC_ORIGIN = "https://grid.example.test";
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user: { email: "viewer@example.test", name: "Viewer", role: "user" },
      session: { principalType: "tome_api_key", sub: "viewer-subject", authScopes: ["tome:mcp"] },
    });
  });

  afterEach(() => {
    delete process.env.TOME_PUBLIC_ORIGIN;
    jest.restoreAllMocks();
  });

  it("opens an authenticated SSE stream and advertises the messages endpoint", async () => {
    const response = await GET(
      new NextRequest("http://caipe-ui:3000/api/tome/mcp/sse", {
        headers: { "x-caipe-token": "tome_redacted.secret" },
      }),
    );
    const reader = response.body?.getReader();
    const first = await reader?.read();
    await reader?.cancel();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(new TextDecoder().decode(first?.value)).toMatch(
      /event: endpoint\ndata: https:\/\/grid\.example\.test\/api\/tome\/mcp\/messages\?sessionId=[^\n]+\n\n/,
    );
  });

  it("forwards a JSON-RPC message and publishes the response as an SSE message", async () => {
    const sseResponse = await GET(
      new NextRequest("http://caipe-ui:3000/api/tome/mcp/sse", {
        headers: { "x-caipe-token": "tome_redacted.secret" },
      }),
    );
    const sseReader = sseResponse.body?.getReader();
    const first = new TextDecoder().decode((await sseReader?.read())?.value);
    const sessionId = first.match(/sessionId=([^\n]+)\n/)?.[1];
    expect(sessionId).toBeTruthy();

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(
      Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
    );
    try {
      const response = await POST(
        new NextRequest(`http://caipe-ui:3000/api/tome/mcp/messages?sessionId=${sessionId}`, {
          method: "POST",
          headers: { "x-caipe-token": "tome_redacted.secret" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      const message = new TextDecoder().decode((await sseReader?.read())?.value);

      expect(response.status).toBe(202);
      expect(message).toContain("event: message");
      expect(message).toContain('"id":1');
      expect(global.fetch).toHaveBeenCalledWith(
        "http://caipe-ui:3000/api/tome/mcp",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      global.fetch = originalFetch;
      await sseReader?.cancel();
    }
  });
});
